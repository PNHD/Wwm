const UPSTREAM = 'https://s2.easebar.com/39f12eda6b86452b/api/map/list';

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? 'public, max-age=120, s-maxage=600' : 'no-store',
      'x-content-type-options': 'nosniff',
      'x-wwm-atlas-source': 'official-global-map',
      ...extra,
    },
  });
}

export async function onRequestGet({ request }) {
  const cache = caches.default;
  const cacheKey = new Request(new URL('/api/official/maps', request.url).toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const upstream = await fetch(UPSTREAM, {
      headers: {
        accept: 'application/json,text/plain,*/*',
        'accept-language': 'en-US',
        'user-agent': 'WWM-Atlas/official-map-adapter',
      },
    });
    if (!upstream.ok) return json({ error: 'Official map list unavailable', upstreamStatus: upstream.status }, 502);

    const data = await upstream.json();
    if (!data || data.code !== 200 || !data.data || !Array.isArray(data.data.maps)) {
      return json({ error: 'Unexpected official map list schema' }, 502);
    }

    const response = json(data, 200);
    await cache.put(cacheKey, response.clone());
    return response;
  } catch {
    return json({ error: 'Official map list unavailable' }, 502);
  }
}
