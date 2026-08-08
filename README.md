# WWSync

WWSync is a fan-made Where Winds Meet companion focused on importing account-backed map progress without depending on the retired WWMMAP bridge.

## Architecture

- Brand: **WWSync**.
- Map/catalog source: public Official Where Winds Meet map endpoints and raster map assets, loaded at runtime; no bulk mirror is stored in this repository.
- Authentication: official NetEase Mpay web SDK. WWSync has no password field.
- Account mapping: official `ursRoles` / `ursLogin` flow used by the Official Where Winds Meet map.
- Progress diagnostic: reads the authenticated Official Map `finished` state. This is intentionally labelled as Official Map state until a real account field test proves that it mirrors in-game collectible progress.
- No dependency on the old WWMMAP password, gameauth/client-method bridge, legacy relay servers, MapGenie, or 17173.
- VI/EN shell; Official point names currently use the official English catalog.

## Safety boundary

WWSync does not inject code into the game process, patch memory, bypass anti-cheat, or install Lua hotfixes to extract progress.

## Deployment

WWSync uses a dedicated Cloudflare Pages project and production branch. `main` remains the unrelated City Flow history and must not be merged as part of WWSync deployment.
