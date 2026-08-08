const UPSTREAM = 'https://wwmmap.pages.dev/service/gameauth';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
export async function onRequestPost({ request }) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 4096) return json({ error: 'Payload too large' }, 413);
  let body; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const playerId = String(body?.playerId || '').trim();
  if (!/^\d{4,20}$/.test(playerId)) return json({ error: 'Invalid UID' }, 400);
  const action = body?.action == null ? null : String(body.action);
  if (action && !['forgot', 'reset_confirm'].includes(action)) return json({ error: 'Unsupported action' }, 400);
  const payload = { playerId };
  if (body?.password != null) {
    const password = String(body.password);
    if (!password || password.length > 160) return json({ error: 'Invalid sync password' }, 400);
    payload.password = password;
  }
  if (action) payload.action = action;
  if (action === 'reset_confirm' && !payload.password) return json({ error: 'Sync password required' }, 400);
  try {
    const upstream = await fetch(UPSTREAM, { method: 'POST', headers: { 'content-type': 'application/json', 'accept': 'application/json' }, body: JSON.stringify(payload) });
    const text = await upstream.text();
    return new Response(text, { status: upstream.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  } catch { return json({ error: 'Sync service unavailable' }, 502); }
}
