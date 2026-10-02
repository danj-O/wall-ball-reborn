# Experimental phone controllers: one room, two seats

The host device alone runs Wall Ball simulation. One Red phone and one Blue phone can join the same room; either seat may instead use host-device controls. Cloudflare owns room codes, approvals, and WebRTC signaling. After approval, each phone attempts a direct WebRTC connection to the host. The existing WebSocket relay carries controls only while direct transport is unavailable. This experiment is on `phone-controller-test`; the current Pages workflow deploys only `main`.

## Local test

1. Run `npm ci`, `npm run relay:dev`, and `npm run dev` in separate terminals. Use `npm run relay:smoke` to check room creation, both seat approvals, isolated inputs, targeted feedback, and independent disconnects.
2. Open the game on the host at the Vite URL. On each phone, open the same Vite site with `?controller=1` (use the computer's LAN address, not `localhost` on the phone).
3. On the host, open **Menu → Remote Controller** and tap **Create Room** once. Both phones enter the same 8-character code, choose different Red/Blue seats, and tap **Join Room**.
4. Accept each seat request on the host. The host and phone diagnostics should change from **Path RELAY** to **Path DIRECT** when WebRTC opens. A rejected request or occupied seat cannot send controls. If a phone leaves, that seat returns to local host controls while the other phone keeps playing.
5. A stalled phone stream releases movement and held aims after 650 ms without closing the room. Fresh input resumes play. Closing the room disconnects both phones.

Local development assumes `ws://<game hostname>:8787`. If Wrangler uses another port, set `VITE_CONTROLLER_RELAY_URL` to the actual public WebSocket address and restart Vite. WebRTC uses the built-in public STUN URL unless `VITE_CONTROLLER_STUN_URL` is set. For iPad home-screen testing, use an HTTPS game preview and a WSS relay.

## Customize phone controls

On the Vite development server, each phone controller has **Customize Controls**. Drag the movement area or Wall, Bomb, and Mega Bomb pads; use the sliders for position, size, and movement-area width/height. **HIDE OPTIONS** exposes pads behind the settings panel while keeping editing active. Draft changes are saved to that phone's browser storage during development.

**Dev Save Default** asks for confirmation, validates the full layout, and writes `src/remote/phoneControlDefaults.json` through the development-only `/__dev/phone-control-defaults` route. Commit and deploy this JSON file to make the layout the bundled default for all phones. Production builds do not expose the editor or file-writing endpoint. **Reset** loads the bundled default. The layout is independent of team choice and does not change gameplay throw distances or ability strength.

## Hosted test

1. The Cloudflare Worker and Durable Object are deployed at `https://wall-ball-controller-relay.wall-ball-reborn.workers.dev`. To publish a later relay change, run `npm run relay:deploy` while signed in to Cloudflare. Verify the endpoint with `RELAY_SMOKE_URL=https://wall-ball-controller-relay.wall-ball-reborn.workers.dev npm run relay:smoke`.
2. Set GitHub repository variable `CONTROLLER_RELAY_URL` to `wss://wall-ball-controller-relay.wall-ball-reborn.workers.dev`. The Pages build passes it to Vite. Merge this branch into `main` and push; the Pages workflow deploys `main` only.
3. Open the same HTTPS game build on host and both phones. The phone path is `https://danj-O.github.io/wall-ball-reborn/?controller=1` once this branch reaches Pages.

If the production relay URL is absent, room creation/joining is disabled. Normal host controls still work.

## Architecture and limits

- `RoomControllerLink.ts` owns one host signaling connection and up to two independently approved seat sessions. `relay/worker.ts` routes each code to one Durable Object and labels every input with its seat. A host-only token protects room ownership. The same room can be extended with more seats later.
- `DirectPeer.ts` creates one peer connection per seat, with an unordered state channel for movement and aiming and an ordered channel for button events, status, and feedback. WebRTC signaling goes through the approved room. Direct transport is tried again after failures; room WebSockets remain open for signaling and immediate fallback. A sparse room keepalive protects signaling while direct play is active. If the room socket nevertheless closes, an established direct link can continue until it fails or the player disconnects.
- `RemoteInput.ts` is the host-side per-seat input gate. It keeps sequence rejection, ownership, timeout neutralization, and held-action cleanup. Gameplay physics and rules remain host-authoritative.
- Movement/aim state is throttled on each phone; release and stop events use a reliable channel. Sequence checks reject delayed state after a transport switch. Status and feedback are sent only to the correct seat. A silent direct connection falls back to the room relay after 1.5 seconds.
- No TURN service is configured. WebRTC may fail on some networks; the room relay then carries gameplay as before. This is an experiment rather than a production account/authentication system. Physical iPad/phone multitouch, standalone layout, direct-path latency, and fallback still need device testing.
