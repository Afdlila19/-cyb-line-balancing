import { loggedIn, json, html } from './_shared.js';

// Every request (pages, data, API) needs a signed-in session, except the login page.
export async function onRequest(ctx) {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const p = url.pathname;
  let res;
  if (p === '/login' || p === '/logout' || p === '/healthz') {
    res = await ctx.next();
  } else if (!env.CYB_PASSWORD) {
    res = html(503, '<h1>Setup not finished</h1><p>Add the CYB_PASSWORD secret in Cloudflare (Settings &rsaquo; Variables and Secrets), then redeploy.</p>');
  } else if (await loggedIn(request, env)) {
    res = await ctx.next();
    res = new Response(res.body, res);
    if (/\.(html|json|js)$|\/$/.test(p)) res.headers.set('Cache-Control', 'no-store');
  } else if (p.startsWith('/api/')) {
    res = json(401, { code: 'unauthenticated', message: 'sign in required' });
  } else {
    res = new Response(null, { status: 303, headers: { Location: '/login' } });
  }
  res = new Response(res.body, res);
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'SAMEORIGIN');
  res.headers.set('Referrer-Policy', 'same-origin');
  return res;
}
