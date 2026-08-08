# WWMSync

WWMSync is a fan-made Where Winds Meet companion map. The current production-safe build renders the public Official Where Winds Meet map catalog and exposes a character UID field without pretending that a browser can independently trigger in-game sync.

## Verified sync boundary

Public-client forensic testing of the legacy WWMMAP flow established this sequence:

1. The site identifies a character by UID and authenticates that character through its own backend.
2. Its authenticated backend starts a game-sync request.
3. The player approves the request inside the game.
4. A separate relay WebSocket returns full game state and real-time player position to the web map.

The in-game Allow prompt is therefore not produced by UID alone. It depends on a private game-side/backend transport that is not part of the public Official Map API. WWMSync does not bypass that authentication boundary and does not claim a successful sync when that transport is unavailable.

## Current architecture

- Brand: **WWMSync**.
- Map/catalog source: public Official Where Winds Meet map endpoints and raster assets loaded at runtime; no bulk mirror is stored in this repository.
- UID: stored locally in the browser only.
- No NetEase Mpay login SDK.
- No password, PIN, cookie, session token, Discord permission, legacy relay, MapGenie, or 17173 dependency in the active sync flow.
- VI/EN UI; Official point names currently use the official English catalog.
- A Sync click validates and stores the UID, then reports the verified transport blocker rather than fabricating an in-game connection.

## Safety boundary

WWMSync does not inject code into the game process, patch or read process memory, bypass anti-cheat, steal account credentials, or bypass the legacy service's character-authentication requirement.

## Deployment

WWMSync deploys to the dedicated Cloudflare Pages project `wwmsync` from `production/wwsync`. The repository `main` branch remains the unrelated City Flow history and must not be merged as part of WWMSync deployment.
