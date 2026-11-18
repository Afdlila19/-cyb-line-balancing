import { db, json } from '../_shared.js';

const SEG = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
function validPath(p, even) {
  if (!p) return false;
  const s = p.split('/');
  if (s.length > 16 || (s.length % 2 === 0) !== even) return false;
  return s.every(x => SEG.test(x) && x !== '.' && x !== '..');
}
async function pinOk(request, env) {
  if (!env.CYB_PIN) return true;
  return (request.headers.get('X-Edit-Pin') || '') === env.CYB_PIN;
}
const parent = p => p.split('/').slice(0, -1).join('/');

export async function onRequest({ request, env, params }) {
  const route = '/' + [].concat(params.path || []).join('/');
  const url = new URL(request.url);
  const path = url.searchParams.get('path') || '';
  let D;
  try { D = await db(env); }
  catch (e) { return json(503, { code: 'unavailable', message: 'Database not connected: add a D1 binding named DB in Cloudflare, then redeploy.' }); }
  const rev = async () => (await D.prepare("SELECT v FROM meta WHERE k = 'rev'").first('v')) || 0;
  const m = request.method;

  if (route === '/rev' && m === 'GET') return json(200, { rev: await rev() });
  if (route === '/auth' && m === 'GET') return json(200, { needPin: !!env.CYB_PIN, ok: await pinOk(request, env), login: true, cloud: true });

  if (route === '/doc') {
    if (!validPath(path, true)) return json(400, { code: 'invalid_argument', message: 'bad document path' });
    if (m === 'GET') {
      const r = await D.prepare('SELECT data, at FROM docs WHERE path = ?').bind(path).first();
      return json(200, { exists: !!r, data: r ? JSON.parse(r.data) : null, at: r ? r.at : null });
    }
    if (!(await pinOk(request, env))) return json(403, { code: 'invalid_argument', message: 'edit PIN required' });
    if (m === 'PUT') {
      const text = await request.text();
      if (text.length > 512 * 1024) return json(400, { code: 'invalid_argument', message: 'document too large' });
      let data; try { data = JSON.parse(text || '{}'); } catch (_) { data = null; }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return json(400, { code: 'invalid_argument', message: 'body must be a JSON object' });
      const exists = await D.prepare('SELECT 1 FROM docs WHERE path = ?').bind(path).first();
      if (!exists && ((await D.prepare('SELECT COUNT(*) AS n FROM docs').first('n')) >= 25000)) return json(507, { code: 'quota_exceeded', message: 'database full' });
      await D.batch([
        D.prepare('INSERT INTO docs (path, col, data, at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(path) DO UPDATE SET data = ?3, at = ?4').bind(path, parent(path), JSON.stringify(data), new Date().toISOString()),
        D.prepare("UPDATE meta SET v = v + 1 WHERE k = 'rev'"),
      ]);
      return json(200, { ok: true });
    }
    if (m === 'DELETE') {
      const r = await D.prepare('DELETE FROM docs WHERE path = ?').bind(path).run();
      if (r.meta && r.meta.changes) await D.prepare("UPDATE meta SET v = v + 1 WHERE k = 'rev'").run();
      return json(200, { ok: true });
    }
  }
  if (route === '/col' && m === 'GET') {
    if (!validPath(path, false)) return json(400, { code: 'invalid_argument', message: 'bad collection path' });
    const r = await D.prepare('SELECT path, data, at FROM docs WHERE col = ? ORDER BY path').bind(path).all();
    return json(200, { docs: (r.results || []).map(x => ({ id: x.path.split('/').pop(), data: JSON.parse(x.data), at: x.at })) });
  }
  // export everything (backup)
  if (route === '/export' && m === 'GET') {
    const r = await D.prepare('SELECT path, data, at FROM docs ORDER BY path').all();
    const docs = {}; (r.results || []).forEach(x => docs[x.path] = { data: JSON.parse(x.data), at: x.at });
    return new Response(JSON.stringify({ rev: await rev(), docs }), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="cyb_data.json"', 'Cache-Control': 'no-store' } });
  }
  return json(404, { code: 'invalid_argument', message: 'unknown endpoint' });
}
