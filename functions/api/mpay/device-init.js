const UPSTREAM = 'https://sdk-os.mpsdk.easebar.com/api/devices/init';

function sameOrigin(request) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  return origin === url.origin;
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ msg: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function onRequestPost({ request }) {
  if (!sameOrigin(request)) return jsonError(403, 'same-origin request required');
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/x-www-form-urlencoded')) {
    return jsonError(415, 'form body required');
  }
  const body = await request.text();
  if (body.length > 16_384) return jsonError(413, 'request too large');

  const upstream = await fetch(UPSTREAM, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
      'accept': 'application/json, text/plain, */*',
    },
    body,
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-wwsync-proxy': 'mpay-device-init-only',
    },
  });
}

export function onRequest() {
  return jsonError(405, 'method not allowed');
}
