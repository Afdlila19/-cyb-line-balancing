#!/usr/bin/env python3
"""CYB Line Balancing - local network server.

Serves the balancing tool to every computer on the LAN and stores shared data
(scenarios, time studies, line settings) in data/cyb_data.json.

Needs only Python 3.8+ (no extra packages, no internet).

    python server.py                 # port 8080, anyone on the LAN can edit
    python server.py --port 9000
    python server.py --pin 4321      # viewing is open, saving needs the PIN

Online (cloud) use: set CYB_PASSWORD so the whole site needs a login, and
CYB_DATA_DIR to a persistent disk. PORT is read from the environment.
"""
import argparse, json, os, re, shutil, socket, sys, threading, time, hashlib, hmac, secrets, html
from datetime import datetime
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(HERE, "public")
DATA_DIR = os.environ.get("CYB_DATA_DIR") or os.path.join(HERE, "data")
DATA_FILE = os.path.join(DATA_DIR, "cyb_data.json")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
SEG = re.compile(r"^[A-Za-z0-9_\-.~:@+]{1,200}$")
MAX_BODY = 512 * 1024

lock = threading.Lock()
store = {"rev": 0, "docs": {}}   # docs: path -> {"data":..., "at": iso}
PIN_HASH = None
SITE_PW = ""                 # login password for the whole site (online use)
SECRET = b""
SESSION_DAYS = 30
fails = {}                   # ip -> [count, first_time]

LOGIN_HTML = """<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CYB Line Balancing - sign in</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef1f3;font:15px "Segoe UI",system-ui,sans-serif;color:#1c2328}
form{background:#fff;border:1px solid #d3d9de;border-radius:10px;padding:26px;width:min(340px,90vw);display:grid;gap:12px}
h1{font-size:19px;margin:0}p{margin:0;color:#5b6770;font-size:13.5px}input{font:inherit;padding:9px 11px;border:1px solid #d3d9de;border-radius:6px}
button{font:inherit;padding:9px;border:0;border-radius:6px;background:#1f6f8b;color:#fff;cursor:pointer}.e{color:#b3261e}
@media (prefers-color-scheme:dark){body{background:#13181c;color:#e4e9ec}form{background:#1b2227;border-color:#2d373e}input{background:#13181c;color:inherit;border-color:#2d373e}p{color:#95a2ab}}</style></head>
<body><form method="post" action="/login"><h1>CYB Line Balancing</h1><p>4JA1 cylinder body line. Enter the team password.</p>%ERR%
<input type="password" name="password" placeholder="Password" autofocus required autocomplete="current-password">
<input type="hidden" name="next" value="%NEXT%"><button>Sign in</button></form></body></html>"""


def make_token():
    exp = int(time.time()) + SESSION_DAYS * 86400
    msg = str(exp).encode()
    return "%d.%s" % (exp, hmac.new(SECRET, msg, hashlib.sha256).hexdigest())


def token_ok(tok):
    try:
        exp, sig = tok.split(".", 1)
        good = hmac.new(SECRET, exp.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(sig, good) and int(exp) > time.time()
    except Exception:
        return False


def load():
    global store
    os.makedirs(BACKUP_DIR, exist_ok=True)
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            store = json.load(f)
        store.setdefault("rev", 0)
        store.setdefault("docs", {})


def save():
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(store, f, ensure_ascii=False)
    os.replace(tmp, DATA_FILE)
    # one backup per day, keep the last 30
    day = datetime.now().strftime("%Y-%m-%d")
    b = os.path.join(BACKUP_DIR, f"cyb_data_{day}.json")
    if not os.path.exists(b):
        shutil.copyfile(DATA_FILE, b)
        olds = sorted(x for x in os.listdir(BACKUP_DIR) if x.startswith("cyb_data_"))
        for x in olds[:-30]:
            os.remove(os.path.join(BACKUP_DIR, x))


def valid_path(p, even):
    if not p:
        return False
    segs = p.split("/")
    if len(segs) > 16 or (len(segs) % 2 == 0) != even:
        return False
    return all(SEG.match(s) and s not in (".", "..") for s in segs)


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=PUBLIC, **kw)

    def log_message(self, fmt, *args):
        if not self.path.startswith("/api/rev"):
            sys.stderr.write("%s  %s  %s\n" % (datetime.now().strftime("%H:%M:%S"), self.client_address[0], fmt % args))

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "same-origin")
        if self.path.startswith("/api/") or self.path.endswith((".html", ".json", ".js")) or self.path == "/":
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # ---- helpers
    def js(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise ValueError("too large")
        return json.loads(self.rfile.read(n) or b"{}")

    def client_ip(self):
        return (self.headers.get("X-Forwarded-For") or self.client_address[0]).split(",")[0].strip()

    def logged_in(self):
        if not SITE_PW:
            return True
        for part in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == "cyb_session" and token_ok(v):
                return True
        return False

    def gate(self, path):
        """Return True if the request may continue."""
        if self.logged_in() or path in ("/login", "/favicon.ico"):
            return True
        if path.startswith("/api/"):
            self.js(401, {"code": "unauthenticated", "message": "sign in required"})
        else:
            self.send_response(303)
            self.send_header("Location", "/login")
            self.end_headers()
        return False

    def login_page(self, err="", nxt="/"):
        b = LOGIN_HTML.replace("%ERR%", '<p class="e">%s</p>' % html.escape(err) if err else "").replace("%NEXT%", html.escape(nxt)).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_POST(self):
        path, q = self.q()
        if path != "/login" or not SITE_PW:
            return self.js(404, {"code": "invalid_argument"})
        ip = self.client_ip()
        f = fails.get(ip)
        if f and f[0] >= 8 and time.time() - f[1] < 600:
            return self.login_page("Too many wrong tries. Wait 10 minutes.")
        n = int(self.headers.get("Content-Length") or 0)
        form = parse_qs(self.rfile.read(min(n, 4096)).decode("utf-8", "replace"))
        pw = (form.get("password") or [""])[0]
        if not hmac.compare_digest(pw.encode(), SITE_PW.encode()):
            if not f or time.time() - f[1] >= 600:
                fails[ip] = [1, time.time()]
            else:
                f[0] += 1
            time.sleep(1)
            return self.login_page("Wrong password.")
        fails.pop(ip, None)
        secure = "; Secure" if self.headers.get("X-Forwarded-Proto") == "https" else ""
        self.send_response(303)
        self.send_header("Set-Cookie", "cyb_session=%s; Path=/; Max-Age=%d; HttpOnly; SameSite=Lax%s" % (make_token(), SESSION_DAYS * 86400, secure))
        self.send_header("Location", "/")
        self.end_headers()

    def pin_ok(self):
        if not PIN_HASH:
            return True
        p = self.headers.get("X-Edit-Pin") or ""
        return hashlib.sha256(p.encode()).hexdigest() == PIN_HASH

    def q(self):
        u = urlparse(self.path)
        return u.path, {k: v[0] for k, v in parse_qs(u.query).items()}

    # ---- routes
    def do_GET(self):
        path, q = self.q()
        if path == "/healthz":
            return self.js(200, {"ok": True})
        if not self.gate(path):
            return
        if path == "/login":
            return self.login_page() if SITE_PW else self.js(404, {})
        if path == "/logout":
            self.send_response(303)
            self.send_header("Set-Cookie", "cyb_session=; Path=/; Max-Age=0")
            self.send_header("Location", "/login" if SITE_PW else "/")
            self.end_headers()
            return
        if not path.startswith("/api/"):
            if path == "/":
                self.path = "/index.html"
            return super().do_GET()
        if path == "/api/rev":
            return self.js(200, {"rev": store["rev"]})
        if path == "/api/auth":
            return self.js(200, {"needPin": bool(PIN_HASH), "ok": self.pin_ok(), "login": bool(SITE_PW)})
        if path == "/api/doc":
            p = q.get("path", "")
            if not valid_path(p, True):
                return self.js(400, {"code": "invalid_argument", "message": "bad document path"})
            d = store["docs"].get(p)
            return self.js(200, {"exists": d is not None, "data": d and d["data"], "at": d and d["at"], "rev": store["rev"]})
        if path == "/api/col":
            p = q.get("path", "")
            if not valid_path(p, False):
                return self.js(400, {"code": "invalid_argument", "message": "bad collection path"})
            pre, n = p + "/", len(p.split("/")) + 1
            out = [{"id": k.split("/")[-1], "data": v["data"], "at": v["at"]}
                   for k, v in store["docs"].items() if k.startswith(pre) and len(k.split("/")) == n]
            out.sort(key=lambda x: x["id"])
            return self.js(200, {"docs": out, "rev": store["rev"]})
        return self.js(404, {"code": "invalid_argument", "message": "unknown endpoint"})

    def do_PUT(self):
        path, q = self.q()
        if not self.gate(path):
            return
        if path != "/api/doc":
            return self.js(404, {"code": "invalid_argument"})
        if not self.pin_ok():
            return self.js(403, {"code": "invalid_argument", "message": "edit PIN required"})
        p = q.get("path", "")
        if not valid_path(p, True):
            return self.js(400, {"code": "invalid_argument", "message": "bad document path"})
        try:
            data = self.body()
        except Exception:
            return self.js(400, {"code": "invalid_argument", "message": "body must be a JSON object under 512 KB"})
        if not isinstance(data, dict):
            return self.js(400, {"code": "invalid_argument", "message": "body must be a JSON object"})
        with lock:
            if p not in store["docs"] and len(store["docs"]) >= 25000:
                return self.js(507, {"code": "quota_exceeded", "message": "database full"})
            store["docs"][p] = {"data": data, "at": datetime.now().isoformat(timespec="seconds")}
            store["rev"] += 1
            save()
        return self.js(200, {"ok": True, "rev": store["rev"]})

    def do_DELETE(self):
        path, q = self.q()
        if not self.gate(path):
            return
        if path != "/api/doc":
            return self.js(404, {"code": "invalid_argument"})
        if not self.pin_ok():
            return self.js(403, {"code": "invalid_argument", "message": "edit PIN required"})
        p = q.get("path", "")
        if not valid_path(p, True):
            return self.js(400, {"code": "invalid_argument"})
        with lock:
            if store["docs"].pop(p, None) is not None:
                store["rev"] += 1
                save()
        return self.js(200, {"ok": True, "rev": store["rev"]})


def lan_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if not ip.startswith("127."):
                ips.add(ip)
    except Exception:
        pass
    return sorted(ips)


def main():
    global PIN_HASH, SITE_PW, SECRET
    ap = argparse.ArgumentParser(description="CYB Line Balancing - local network server")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT") or os.environ.get("CYB_PORT") or 8080))
    ap.add_argument("--password", default=os.environ.get("CYB_PASSWORD", ""), help="site login password; empty = no login (LAN use)")
    ap.add_argument("--pin", default=os.environ.get("CYB_PIN", ""), help="edit PIN; empty = anyone on the LAN can save")
    a = ap.parse_args()
    if a.pin:
        PIN_HASH = hashlib.sha256(a.pin.encode()).hexdigest()
    SITE_PW = a.password
    os.makedirs(DATA_DIR, exist_ok=True)
    kf = os.path.join(DATA_DIR, ".session_key")
    if not os.path.exists(kf):
        with open(kf, "w") as f:
            f.write(secrets.token_hex(32))
    SECRET = (open(kf).read().strip() + SITE_PW).encode()   # changing the password signs everyone out
    load()
    srv = ThreadingHTTPServer(("0.0.0.0", a.port), H)
    print("=" * 60)
    print(" CYB Line Balancing is running")
    print("   On this PC:        http://localhost:%d" % a.port)
    for ip in lan_ips():
        print("   On the network:    http://%s:%d" % (ip, a.port))
    print("   Process search:    add  #lookup  to the address")
    print("   Data file:         %s" % DATA_FILE)
    print("   Login:             %s" % ("password required" if SITE_PW else "none (set CYB_PASSWORD when online)"))
    print("   Saving:            %s" % ("needs the edit PIN" if PIN_HASH else "open to everyone who can open the page"))
    print(" Keep this window open. Press Ctrl+C to stop.")
    print("=" * 60)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
