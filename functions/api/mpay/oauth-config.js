const UPSTREAM = 'https://sdk-os.mpsdk.easebar.com/api/users/login/v2/oauth/config';
const ALLOWED = new Set([
  'game_id', 'cp', 'cv', 'gv', 'ci', 'app_channel', 'lang', 'device_id',
  'debug_mode', 'package_name', 'qrcode_app_id', 'version',
]);

function sameOrigin(request) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin) return origin === url.origin;
  const fetchSite = request.headers.get('sec-fetch-site');
  return fetchSite === 'same-origin' || fetchSite === 'same-site';
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ msg: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function onRequestGet({ request }) {
  if (!sameOrigin(request)) return jsonError(403, 'same-origin request required');
  const incoming = new URL(request.url);
  const upstreamUrl = new URL(UPSTREAM);
  for (const [key, value] of incoming.searchParams) {
    if (!ALLOWED.has(key)) return jsonError(400, `unsupported query key: ${key}`);
    if (value.length > 512) return jsonError(400, `query value too long: ${key}`);
    upstreamUrl.searchParams.set(key, value);
  }

  const upstream = await fetch(upstreamUrl, {
    headers: { 'accept': 'application/json, text/plain, */*' },
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-wwsync-proxy': 'mpay-oauth-config-only',
    },
  });
}
