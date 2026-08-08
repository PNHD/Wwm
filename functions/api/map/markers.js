const UPSTREAM = 'https://wwmmap.pages.dev/data/markers_2026.json';
export async function onRequestGet({ request }) {
  const cache = caches.default;
  const cacheKey = new Request(new URL('/api/map/markers', request.url).toString(), { method: 'GET' });
  let response = await cache.match(cacheKey);
  if (response) return response;
  try {
    const upstream = await fetch(UPSTREAM, { headers: { accept: 'application/json' } });
    if (!upstream.ok) return new Response(JSON.stringify({ error: 'Marker source unavailable' }), { status: 502, headers: { 'content-type': 'application/json; charset=utf-8' } });
    response = new Response(upstream.body, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300, s-maxage=1800', 'x-content-type-options': 'nosniff', 'x-wwm-atlas-source': 'compatibility-upstream' } });
    await cache.put(cacheKey, response.clone());
    return response;
  } catch { return new Response(JSON.stringify({ error: 'Marker source unavailable' }), { status: 502, headers: { 'content-type': 'application/json; charset=utf-8' } }); }
}
