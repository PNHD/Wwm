# WWMMAP GFN protocol forensic

Status: public-frontend forensic only. No private relay or game API was connected during this analysis.

## Evidence source

Current public module:

- `https://wwmmap.pages.dev/js/map_2026/gamesync.js?v=4`
- observed bytes: `42,785`
- SHA-256: `D1A7AC076D74650EAA1DE51A46E2734D717F7F3CCA5396AD3C95D0822BEFE348`

Current public auth module exposes `/service/gameauth` and `/service/call_client_method`.

## GFN-compatible sync flow reconstructed from current public source

`GameSyncer2` does not use the local `localhost:63333` path. Its flow is:

1. Generate an 8-character `connectionKey`.
2. Fetch/select a relay from `/service/relay_servers`.
3. Call the authenticated website backend through:

   ```text
   /service/call_client_method
   method = start_game_sync
   args = { connectionKey, relayServerId }
   ```

4. If the method call succeeds, enter `waiting_for_approval` state and open a browser WebSocket to the selected relay:

   ```text
   wss://<relay>/ws/game?uid=<uid>-<connectionKey>
   ```

5. Browser sends `ACTIVE` after WebSocket open and then as liveness polling.
6. Game-originated packets received by the browser include:
   - `t = "p"`: player position payload
   - `t = "f"`: completion/marker state
   - `t = "tr"`: packed task/reward state
   - `t = "c"`: chunk frame used to reassemble a large payload

The source comment on chunking explicitly calls the producer the `Lua client`, so the position/progress packets are generated on the game side, not inferred by the browser map.

## Position payload

`updatePosition(positional, seq)` expects at least three values and destructures:

```text
[pX, pY, pZ, pYaw, spaceInfo]
```

`spaceInfo.id` is used for map switching and `spaceInfo.regionId` for region/underground selection. Map coordinates are produced from game X/Z by `Corellator.gameToMap`.

## Completion payload

`readGameState(state)` maps game completion groups to map marker IDs such as:

- `cs_<type>_<id>` / subtype form
- `kv_<id>`
- `ma_<id>`
- `vst_<id>`
- `bv_<id>`

`readPackedState` additionally maps task/reward IDs to `t_<id>` and `rw_<id>`.

## Legacy local path is separate

The older `GameSyncer` class uses:

```text
http://localhost:63333
GET_GAME_STATE
```

That is not the `GameSyncer2` path described above and cannot explain successful GeForce NOW use.

## Private infrastructure boundary

The public code currently contains private WWMMAP relay hostnames. WWMSync must not reconnect to or depend on those private relays. The protocol is useful only as interoperability evidence.

## First-party DD comparison

A separate public-only forensic pass of NetEase DD found its generic DD/CC browser transport:

- `wss://teamlink-ws.cc.163.com`
- registration/login/heartbeat under appid `44204`
- generic DD web auth/token and teamlink messaging

The public DD SDK did not expose a WWM-specific `start_game_sync`, player-position, or collection-state command. Public guides for the CN realtime-map tool also describe installing the NetEase DD PC client. Therefore DD is not yet evidence for the GFN-compatible server-to-game method used by WWMMAP.

## Current missing link

The remaining unknown is the first-party/authorized mechanism that lets the website backend deliver a client method into an active WWM game session and trigger the in-game approval prompt. This is now the highest-priority target.

Next diagnostic: static inspection of the installed Global game assets for the receiver/approval handler, without process-memory access, injection, packet capture, or game-file writes.
