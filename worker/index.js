// Cloudflare Worker entry for CYB Line Balancing.
// Static files come from ./public (ASSETS binding); everything passes through
// the same login check and data API as the Pages version in ../functions.
import { loggedIn, json, html } from '../functions/_shared.js';
import * as login from '../functions/login.js';
import { onRequest as logout } from '../functions/logout.js';
import { onRequest as api } from '../functions/api/[[path]].js';

function harden(res) {
  res = new Response(res.body, res);
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'SAMEORIGIN');
  res.headers.set('Referrer-Policy', 'same-origin');
  return res;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (p === '/healthz') return json(200, { ok: true });
    if (p === '/login') return harden(request.method === 'POST' ? await login.onRequestPost({ request, env }) : await login.onRequestGet());
    if (p === '/logout') return harden(await logout());
    if (!env.CYB_PASSWORD) return harden(html(503, '<h1>Setup not finished</h1><p>Add the CYB_PASSWORD secret in Cloudflare (Settings &rsaquo; Variables and Secrets).</p>'));
    if (!(await loggedIn(request, env))) {
      if (p.startsWith('/api/')) return harden(json(401, { code: 'unauthenticated', message: 'sign in required' }));
      return new Response(null, { status: 303, headers: { Location: '/login' } });
    }
    if (p.startsWith('/api/')) {
      const rest = p.slice(5).split('/').filter(Boolean);
      return harden(await api({ request, env, params: { path: rest } }));
    }
    let res = await env.ASSETS.fetch(request);
    res = harden(res);
    if (/\.(html|json|js)$|\/$/.test(p)) res.headers.set('Cache-Control', 'no-store');
    return res;
  },
};
