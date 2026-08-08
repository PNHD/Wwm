# WWSync

WWSync is a fan-made Where Winds Meet companion focused on importing account-backed map progress without depending on the retired WWMMAP bridge.

## Architecture

- Brand: **WWSync**.
- Map/catalog source: public Official Where Winds Meet map endpoints and raster map assets, loaded at runtime; no bulk mirror is stored in this repository.
- Authentication UI: official NetEase Mpay web SDK. WWSync has no password field.
- Account mapping: official `ursRoles` / `ursLogin` flow used by the Official Where Winds Meet map.
- Progress diagnostic: reads the authenticated Official Map `finished` state. This is intentionally labelled as Official Map state until a real account field test proves that it mirrors in-game collectible progress.
- No dependency on the old WWMMAP password, gameauth/client-method bridge, legacy relay servers, MapGenie, or 17173.
- VI/EN shell; Official point names currently use the official English catalog.

## Mpay CORS adapter

NetEase's public Mpay SDK is origin-restricted for two bootstrap requests when embedded on a third-party domain. WWSync contains exactly two same-origin Cloudflare Pages Functions:

- `POST /api/mpay/device-init` forwards only Mpay anonymous device initialization.
- `GET /api/mpay/oauth-config` forwards only public login-method metadata with an explicit query allowlist.

The adapter is deliberately not a generic proxy. It cannot forward arbitrary URLs or authentication routes. Password submission, OAuth provider navigation, and account credentials are not routed through these WWSync Functions; provider login stays on the official NetEase/provider flow.

## Safety boundary

WWSync does not inject code into the game process, patch memory, bypass anti-cheat, or install Lua hotfixes to extract progress.

## Deployment

WWSync uses a dedicated Cloudflare Pages project and production branch. `main` remains the unrelated City Flow history and must not be merged as part of WWSync deployment.
