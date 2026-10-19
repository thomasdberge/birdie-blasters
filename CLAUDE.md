# Birdie Blasters

A silly first-person golf game where the clubs are guns. Players stand where
their shot lands, so the next player can shoot them back toward the tee.
Built with Three.js and Vite.

## Commands
- `npm install` once, then `npm run dev` and open http://localhost:5173
- `npm run build` writes a static site to `dist/`; `npm run preview` serves it
- `npm test` runs the tests. `tests/golden/shots.json` records how ~200 seeded
  shots play out; update it with `npx vitest run -u` only after an intended
  change to how shots play.

## Code layout
- `src/core/`: physics, weapons, courses and rules. No Three.js or DOM imports.
- `src/game/`: shared state (`state.js`) and the turn and shot flow.
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
   and a server that runs the physics and decides every shot.
4. Real 3D character models (glTF) later.