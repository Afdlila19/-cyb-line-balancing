import { makeToken, db, LOGIN_HTML, html, SESSION_DAYS } from './_shared.js';

export async function onRequestGet() { return html(200, LOGIN_HTML()); }

export async function onRequestPost({ request, env }) {
  if (!env.CYB_PASSWORD) return html(503, LOGIN_HTML('The site password is not set up yet.'));
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Math.floor(Date.now() / 1000);
  let D = null; try { D = await db(env); } catch (_) {}
  if (D) {
    const f = await D.prepare('SELECT n, t FROM fails WHERE ip = ?').bind(ip).first();
    if (f && f.n >= 8 && now - f.t < 600) return html(429, LOGIN_HTML('Too many wrong tries. Wait 10 minutes.'));
  }
  const form = await request.formData().catch(() => null);
  const pw = (form && form.get('password')) || '';
  if (pw !== env.CYB_PASSWORD) {
    if (D) await D.prepare('INSERT INTO fails (ip, n, t) VALUES (?1, 1, ?2) ON CONFLICT(ip) DO UPDATE SET n = CASE WHEN ?2 - t >= 600 THEN 1 ELSE n + 1 END, t = CASE WHEN ?2 - t >= 600 THEN ?2 ELSE t END').bind(ip, now).run();
    await new Promise(r => setTimeout(r, 800));
    return html(401, LOGIN_HTML('Wrong password.'));
  }
  if (D) await D.prepare('DELETE FROM fails WHERE ip = ?').bind(ip).run();
  return new Response(null, { status: 303, headers: {
    'Location': '/',
    'Set-Cookie': `cyb_session=${await makeToken(env)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`,
  } });
}
