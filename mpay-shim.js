(() => {
  const SAFE_GET = new Map([
    ['/api/users/login/v2/oauth/config', '/api/mpay/oauth-config'],
  ]);
  const SAFE_POST = new Map([
    ['/api/devices/init', '/api/mpay/device-init'],
  ]);

  const form = (payload = {}) => {
    const p = new URLSearchParams();
    for (const [key, value] of Object.entries(payload)) {
      if (value !== undefined && value !== null) p.set(key, String(value));
    }
    return p;
  };

  async function sameOriginGet(endpoint, payload) {
    const url = new URL(endpoint, window.location.origin);
    for (const [key, value] of form(payload)) url.searchParams.set(key, value);
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    const json = await response.json().catch(() => ({ msg: `HTTP ${response.status}` }));
    if (!response.ok) throw json;
    return json;
  }

  async function sameOriginPost(endpoint, payload) {
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: form(payload),
    });
    const json = await response.json().catch(() => ({ msg: `HTTP ${response.status}` }));
    if (!response.ok) throw json;
    return json;
  }

  function install() {
    const Ctor = window.MpayOSSDK;
    if (!Ctor?.prototype || Ctor.prototype.__wwsyncCorsShim) return Boolean(Ctor?.prototype);

    const rawGet = Ctor.prototype.apiGet;
    const rawPost = Ctor.prototype.apiPost;

    Ctor.prototype.apiGet = function(path, data = {}, base) {
      const endpoint = !base && SAFE_GET.get(path);
      if (!endpoint) return rawGet.call(this, path, data, base);
      return sameOriginGet(endpoint, { ...this.getRequiredKey(), ...data });
    };

    Ctor.prototype.apiPost = function(path, data = {}, base) {
      const endpoint = !base && SAFE_POST.get(path);
      if (!endpoint) return rawPost.call(this, path, data, base);
      return sameOriginPost(endpoint, { ...data, ...this.getRequiredKey() });
    };

    Object.defineProperty(Ctor.prototype, '__wwsyncCorsShim', { value: true });
    console.info('[WWSync] Official login metadata CORS shim installed.');
    return true;
  }

  if (!install()) {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (install() || attempts >= 100) clearInterval(timer);
    }, 50);
  }
})();
