const UPSTREAM = 'https://wwmmap.pages.dev/service/call_client_method';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
export async function onRequestPost({ request }) {
  const uid = String(request.headers.get('x-wwm-uid') || '').trim();
  const pass = String(request.headers.get('x-wwm-pass') || '');
  const lang = request.headers.get('client-lang') === 'en' ? 'en' : 'vi';
  if (!/^\d{4,20}$/.test(uid) || !pass || pass.length > 160) return json({ error: 'Unauthorized' }, 401);
  const length = Number(request.headers.get('content-length') || 0); if (length > 2048) return json({ error: 'Payload too large' }, 413);
  let body; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (body?.method !== 'start_game_sync') return json({ error: 'Unsupported client method' }, 400);
  const connectionKey = String(body?.args?.connectionKey || '');
  const relayServerId = String(body?.args?.relayServerId || 'default');
  if (!/^[a-z0-9]{8}$/.test(connectionKey) || !/^[a-zA-Z0-9_-]{1,40}$/.test(relayServerId)) return json({ error: 'Invalid sync arguments' }, 400);
  const payload = { method: 'start_game_sync', args: { connectionKey, relayServerId } };
  try {
    const upstream = await fetch(UPSTREAM, { method: 'POST', headers: { 'content-type': 'application/json', 'accept': 'application/json', 'X-WWM-UID': uid, 'X-WWM-PASS': pass, 'Client-Lang': lang }, body: JSON.stringify(payload) });
    const text = await upstream.text();
    return new Response(text, { status: upstream.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  } catch { return json({ error: 'Sync bridge unavailable' }, 502); }
}
