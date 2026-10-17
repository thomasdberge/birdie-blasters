# Birdie Blasters

A silly first-person golf game where the clubs are guns. Players stand where
their shot lands, so the next player can shoot them back toward the tee.
Built with Three.js. Currently a single-file prototype in index.html.

## Rules
- All code, comments, commit messages and documentation must be in English.
- Keep the physics (stepBall, launchState, weapon data) as plain JavaScript
  with no Three.js or DOM dependencies, so it can later run on a game server.
- Do not change how the game plays unless asked. Keep weapon numbers as they are.
- The game must work on both desktop (mouse with pointer lock) and mobile (touch).

## Roadmap
1. Split the prototype into a Vite project with separate files for physics,
   weapons, courses, rendering and UI.
2. Deploy the frontend (Vercel or Netlify).
3. Live online multiplayer: rooms with invite links, a shot clock per turn,
   and a server that runs the physics and decides every shot.
4. Real 3D character models (glTF) later.