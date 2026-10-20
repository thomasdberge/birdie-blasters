# Birdie Blasters

A silly first-person golf game where the clubs are guns. Players stand where
their shot lands, so the next player can shoot them back toward the tee.
Built with Three.js and Vite.

## Commands
- `npm install` once (it also installs the `server/` workspace), then
  `npm run dev` and open http://localhost:5173
- `npm run dev:server` runs the game server on ws://localhost:2567 and
  restarts it when its files change
- Online on a phone over Wi-Fi: run `npm run dev:server` and
  `npm run dev -- --host`, then open the Network address Vite prints. Unless
  `VITE_SERVER_URL` is set, the client uses port 2567 on the host that served
  the page.
- `npm run build` writes a static site to `dist/`; `npm run preview` serves it
- `npm test` runs the tests. `tests/golden/shots.json` records how ~200 seeded
  shots play out; update it with `npx vitest run -u` only after an intended
  change to how shots play.

## Code layout
- `src/core/`: physics, weapons, courses, rules, the shot simulator
  (`shot.js`) and the match rules (`match.js`: seats, turns, wind, strokes,
  holes, disconnects). No Three.js, DOM or `Math.random`; `tests/core.test.js`
  checks. `protocol.js` is what browser and server agree on: raise
  `PROTOCOL_VERSION` whenever messages or room state change in a way an older
  client cannot handle; older clients are then told to reload.
- `server/`: the Colyseus game server (an npm workspace with its own
  dependencies). It imports `src/core/` directly. `GolfRoom.js` is the room;
  `server/tests/` boots a real server and talks to it with the browser SDK.
  Behind a proxy, set `CLIENT_IP_HEADER` to the header that carries the real
  client IP (`Fly-Client-IP` on Fly.io), or the per-IP room limit can be dodged.
  Run it with `NODE_ENV=production` in production: the host then needs at least
  2 players to start (in development the host may start alone).
- `src/net/`: talking to the game server. The online menu and lobby screen are
  in `src/ui/lobby.js`; the browser SDK only loads when someone goes online.
  `remoteMatch.js` is the match an online client plays: the same shape as
  `makeMatch`, with its state read from the room state (`server/src/state.js`
  writes it).
- `src/game/`: plays the match on screen. The match decides each shot when it
  is fired; `shot.js` plays it back, and the players' ball, strokes, done and
  scores in `state.js` are display copies that catch up as it plays out.
  Online, `online.js` makes the screen follow the room state.
- `src/render/`: everything Three.js (scene, course, characters, camera, effects).
- `src/ui/`: HUD, golf bag, reticle, minimap, scorecard, setup screen and input.
- `src/audio/`: synthesised sound effects.
- `src/main.js`: frame loop and boot.
- The game, render and UI modules import each other in cycles. Attach event
  listeners in `init*()` functions called from `main.js`. Code that runs at
  import time may only use imports from `core/`, `platform.js`,
  `game/state.js`, `ui/elements.js` and `render/scene.js`.
- Three.js is pinned to 0.128.0, the version the prototype was built on. Newer
  versions change colour management and light intensity, so upgrading changes
  how the game looks.

## Rules
- All code, comments, commit messages and documentation must be in English.
- Keep the physics (stepBall, launchState, weapon data) as plain JavaScript
  with no Three.js or DOM dependencies, so it can later run on a game server.
- Do not change how the game plays unless asked. Keep weapon numbers as they are.
- The game must work on both desktop (mouse with pointer lock) and mobile (touch).

## Roadmap
1. Done: split the prototype into a Vite project with separate files for
   physics, weapons, courses, rendering and UI.
2. Deploy the frontend (Vercel or Netlify).
3. Live online multiplayer: rooms with invite links, a shot clock per turn,
   and a server that runs the physics and decides every shot. In progress on
   the `online` branch; the plan, its progress and every decision so far are in
   `docs/online-plan.md` (update it in the same commit as each step).
4. Real 3D character models (glTF) later.