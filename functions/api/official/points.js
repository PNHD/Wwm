const BASE = 'https://s2.easebar.com/39f12eda6b86452b/api/map/points';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? 'public, max-age=120, s-maxage=600' : 'no-store',
      'x-content-type-options': 'nosniff',
      'x-wwm-atlas-source': 'official-global-map',
    },
  });
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const mapId = String(url.searchParams.get('mapId') || '').trim();
  if (!/^\d{1,3}$/.test(mapId)) return json({ error: 'Invalid mapId' }, 400);

  const cache = caches.default;
  const cacheKey = new Request(new URL(`/api/official/points?mapId=${encodeURIComponent(mapId)}`, request.url).toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const upstream = await fetch(`${BASE}?mapId=${encodeURIComponent(mapId)}`, {
      headers: {
        accept: 'application/json,text/plain,*/*',
        'accept-language': 'en-US',
        'user-agent': 'WWM-Atlas/official-map-adapter',
      },
    });
    if (!upstream.ok) return json({ error: 'Official map points unavailable', upstreamStatus: upstream.status }, 502);

    const data = await upstream.json();
    if (!data || data.code !== 200 || !data.data || !Array.isArray(data.data.categories)) {
      return json({ error: 'Unexpected official map points schema' }, 502);
    }

    const response = json(data, 200);
    await cache.put(cacheKey, response.clone());
    return response;
  } catch {
    return json({ error: 'Official map points unavailable' }, 502);
  }
}
