const UPSTREAM = 'https://wwmmap.pages.dev/service/relay_servers';
const FALLBACK = { servers: [{ id: 'default', name: 'Vietnam Main Server', location: 'SG', webSocketDomain: 'wwmmapsync-sg1.sangtacvietcdn.xyz', alternateDomains: ['wwmsync-sg1.stv-appdomain-00000001.org'] }] };
const allowedHost = (host) => /^(?:[a-z0-9-]+\.)?(?:sangtacvietcdn\.xyz|stv-appdomain-00000001\.org)$/.test(host) || host === 'frankfurt.onyxdigital.net';
export async function onRequestGet() {
  try {
    const res = await fetch(UPSTREAM, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error('upstream');
    const data = await res.json();
    const servers = Array.isArray(data?.servers) ? data.servers.map((s) => ({ id: String(s.id || '').slice(0, 40), name: String(s.name || s.id || 'Relay').slice(0, 80), location: String(s.location || '').slice(0, 8), webSocketDomain: String(s.webSocketDomain || '').toLowerCase(), alternateDomains: Array.isArray(s.alternateDomains) ? s.alternateDomains.map((v) => String(v).toLowerCase()).filter(allowedHost).slice(0, 4) : [] })).filter((s) => s.id && allowedHost(s.webSocketDomain)) : [];
    const body = JSON.stringify({ servers: servers.length ? servers : FALLBACK.servers });
    return new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60, s-maxage=300', 'x-content-type-options': 'nosniff' } });
  } catch { return new Response(JSON.stringify(FALLBACK), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=30', 'x-content-type-options': 'nosniff' } }); }
}
