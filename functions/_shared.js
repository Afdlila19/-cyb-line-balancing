// Shared helpers for the Cloudflare Pages version of CYB Line Balancing.
export const SESSION_DAYS = 30;
const enc = new TextEncoder();

async function hmacHex(key, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const keyOf = env => 'cyb-session:' + (env.CYB_SECRET || '') + ':' + (env.CYB_PASSWORD || '');

export async function makeToken(env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  return exp + '.' + await hmacHex(keyOf(env), String(exp));
}
export async function tokenOk(env, tok) {
  if (!tok || !tok.includes('.')) return false;
  const [exp, sig] = tok.split('.', 2);
  if (!(+exp > Date.now() / 1000)) return false;
  const good = await hmacHex(keyOf(env), exp);
  if (good.length !== sig.length) return false;
  let d = 0; for (let i = 0; i < good.length; i++) d |= good.charCodeAt(i) ^ sig.charCodeAt(i);
  return d === 0;
}
export function cookie(req, name) {
  for (const p of (req.headers.get('Cookie') || '').split(';')) {
    const i = p.indexOf('='); if (i > 0 && p.slice(0, i).trim() === name) return p.slice(i + 1).trim();
  }
  return '';
}
export async function loggedIn(req, env) {
  if (!env.CYB_PASSWORD) return false;            // online, a password is mandatory
  return tokenOk(env, cookie(req, 'cyb_session'));
}
export const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

let ready = false;
export async function db(env) {
  if (!env.DB) throw new Error('NO_DB');
  if (!ready) {
    await env.DB.batch([
      env.DB.prepare('CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, col TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS docs_col ON docs(col)'),
      env.DB.prepare('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL)'),
      env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('rev', 0)"),
      env.DB.prepare('CREATE TABLE IF NOT EXISTS fails (ip TEXT PRIMARY KEY, n INTEGER NOT NULL, t INTEGER NOT NULL)'),
    ]);
    ready = true;
  }
  return env.DB;
}

export const LOGIN_HTML = (err = '') => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CYB Line Balancing - sign in</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef1f3;font:15px "Segoe UI",system-ui,sans-serif;color:#1c2328}
form{background:#fff;border:1px solid #d3d9de;border-radius:10px;padding:26px;width:min(340px,90vw);display:grid;gap:12px}
h1{font-size:19px;margin:0}p{margin:0;color:#5b6770;font-size:13.5px}input{font:inherit;padding:9px 11px;border:1px solid #d3d9de;border-radius:6px}
button{font:inherit;padding:9px;border:0;border-radius:6px;background:#1f6f8b;color:#fff;cursor:pointer}.e{color:#b3261e}
@media (prefers-color-scheme:dark){body{background:#13181c;color:#e4e9ec}form{background:#1b2227;border-color:#2d373e}input{background:#13181c;color:inherit;border-color:#2d373e}p{color:#95a2ab}}</style></head>
<body><form method="post" action="/login"><h1>CYB Line Balancing</h1><p>4JA1 cylinder body line. Enter the team password.</p>${err ? `<p class="e">${err}</p>` : ''}
<input type="password" name="password" placeholder="Password" autofocus required autocomplete="current-password"><button>Sign in</button></form></body></html>`;
export const html = (code, body, extra = {}) => new Response(body, { status: code, headers: Object.assign({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, extra) });
