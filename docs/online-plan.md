# Online multiplayer plan

Live online play for Birdie Blasters: private rooms with invite links, a 30-second shot clock, and a game server that
runs the physics and decides every shot. This file is the plan, its progress and every decision made along the way.

**Workflow.** All work happens on the branch `online`. Each step is committed once its test passes, and this file is
updated in the same commit. `online` is merged into `main` when phase D (deployment) works.

## Status

| Step | | Commit |
|---|---|---|
| 1 | Record golden shots | `d383114` |
| 2 | Pure shot simulator | `59c1e0d` |
| 3 | Match rules | `36a716a` |
| 4 | One-screen game runs on the match | `34747ee` |
| 5 | Game server with private rooms | `3feb680` |
| 6 | Online menu, lobby and invite links | `f3e2ae2` |
| 7 | The server runs the match | `51c8609` |
| 8 | Shots decided by the server | done (hash added with step 9) |
| 9 | Shot clock | to do |
| 10 | Disconnects and reconnecting | to do |
| 11 | Between holes and the end | to do |
| 12 | Live aim for spectators | to do |
| 13 | Game server on Fly.io | to do |
| 14 | Frontend on Vercel | to do |
| later | Public quick match | not planned yet |

## Requirements

- Private rooms first: the host creates a room and gets a short code and an invite link; friends join with the code.
  A lobby with nicknames; the host starts.
- Built so public quick match (join any open room) can be added later.
- Server-authoritative: clients only send weapon, yaw, pitch and power. The server runs the existing physics and
  broadcasts the result. Clients replay the flight for animation, but the server's final positions are the truth.
- A 30-second shot clock per turn; when it runs out, the turn passes.
- A disconnected player keeps their seat for 60 seconds, and their turns are skipped meanwhile.
- No text chat.
- The frontend stays on Vercel.

## Decisions

### Stack and hosting

- **Server:** Colyseus 0.18 on Node.js (22 or newer), plain JavaScript like the client, in `server/` (an npm workspace).
  It imports `src/core/` directly, so client and server run the same rules and physics.
- **Packages:** `@colyseus/core`, `@colyseus/schema` (v5), `@colyseus/ws-transport`, `@colyseus/tools`; tests use
  `@colyseus/testing`; the browser uses `@colyseus/sdk` 0.18. Not the `colyseus` umbrella package: it pulls in
  `@colyseus/auth`, which depends on a vulnerable `elliptic`, and we need none of it.
- **Hosting:** the game server on Fly.io (Railway is the fallback) in the region closest to Norway, Stockholm or
  Amsterdam. Vercel cannot host it, because its functions cannot keep WebSockets open. The frontend stays on Vercel and
  finds the server through `VITE_SERVER_URL`.
- **One machine, rooms in memory:** deploying the server ends games in progress. Fine for now; more than one machine
  would need Colyseus's Redis driver.

### Authority and shots

- The match rules (`src/core/match.js`) decide everything; on the server they are the only truth. Clients send actions
  and draw what the room state says.
- A shot is simulated in full the moment it is fired (`simulateShot` in `src/core/shot.js`). The server sends flight
  paths sampled at 60 Hz plus an event list (bounce, burst, explode, hit, end) instead of letting each browser re-run
  the physics: `Math.sin`, `Math.hypot` and friends can differ in the last digit between browsers, and bounces magnify
  that until a replay and the server disagree.
- Clients show what the match decided only as the flight plays out: each player's ball, strokes, done and scores on
  screen are display copies that catch up at the same moments as in the one-screen game.
- Input checks live in the match: wrong turn, weapon not an integer 0–7, yaw or pitch not finite, power outside
  0.04–1 and a second shot in the same turn are rejected without changing anything. Pitch outside the weapon's limits
  is clamped to the limit rather than rejected, so a client's rounding can never make a valid shot fail.
- Hits are checked where players stand (the layout from the match), and knock-backs start from their ball. The one
  difference from the old game: a character still walking into place is hit where they are heading, not mid-walk.
- Turn order is round-robin, as before; the lowest score on the previous hole tees off first, seat order breaks ties.
- After a shot, the next turn starts once every screen that got it has watched it land, but at most 10 seconds after
  it lands. A screen that is still showing it then skips ahead; a tab in the background never holds anyone up.

### Shot clock and timeouts

- 30 seconds per turn, timed on the server, starting when the golf bag opens.
- Running out of time costs one stroke and passes the turn. Without the penalty, a player who never shoots would block
  the hole forever, since a hole only ends when everyone has holed out or reached par + 5.
- The assault rifle keeps "pick which bullet counts". That needs one extra message (`chooseBullet`) besides weapon,
  yaw, pitch and power. The choice has its own 15 seconds; after that the bullet nearest the cup counts.
- **Turn alert:** when it becomes your turn, a short sound plays and the browser tab title shows "Your turn!" until you
  act (pick a weapon) or the turn passes, so players who look away don't lose strokes to the shot clock.

### Disconnects and leaving

- A dropped player keeps their seat for 60 seconds. Their turns are skipped without penalty; if it was their turn, it
  passes at once. They rejoin the rotation when they reconnect.
- The client keeps its reconnection token in `sessionStorage` and reconnects by itself after a reload or a network
  drop. Others see e.g. "Barry · reconnecting 0:42".
- Only a game in progress holds seats. In the lobby a dropped connection frees the seat at once, as leaving does, and
  the tab keeps no token.
- Disconnecting during the rifle choice takes the bullet nearest the cup, as when time runs out.
- Disconnected players can still be hit: their character is still standing on the course.
- If everyone who still has to finish the hole is disconnected, the match waits (phase `waiting`) until one of them
  reconnects or their seat expires.
- After 60 seconds the player is out for the rest of the match: no more turns, "—" on the scorecard for the remaining
  holes, not ranked. Scores of holes they finished are kept.
- The Leave button frees the seat at once. The host role passes to the next player when the host leaves or drops. The
  room closes when everyone has left.

### Rooms, codes and the lobby

- Private rooms only, for now. A room is found by a 5-character code that is also its room id. Private rooms are never
  matched to a player who did not bring the code.
- Code alphabet `BCDFGHJKMNPQRSTVWXZ256789`: no vowels (Y counts as one), no digits that read as vowels (0, 1, 3, 4)
  and no look-alikes (O/0, I/1/L), so a code never spells a word. 25 symbols, about 9.8 million codes. Codes are read
  in any case, with spaces or dashes ignored.
- Invite links are `<page address>?room=CODE`. Opening one shows the Online tab with the code filled in. While in the
  lobby the address bar shows the invite link too.
- At most 4 seats, one per character look. Seats are taken in join order; a new player gets the lowest free look.
- The room locks when the host starts, so nobody joins a game in progress.
- Start rule: in development the host may start alone; in production (`NODE_ENV=production`) at least 2 players are
  needed. The minimum is part of the room state, so the lobby's Start button follows the server.
- After the last hole, the host's "Play again" takes everyone back to the lobby with the same code.
- Between holes everyone sees the scorecard, and the next hole starts after 10 seconds.
- The room takes a `mode` option. Only `private` exists now; quick match comes later as `public`.

### Nicknames

- 1–16 characters: letters in any language, digits, spaces and basic punctuation (`. , ' ’ ! ? _ -`). Trimmed, runs of
  spaces made single, Unicode-normalised. Rules in `cleanName` (`src/core/protocol.js`), checked by client and server.
- A name someone in the room already has gets a number: "Ann", "Ann 2".
- The nickname field remembers the last name used in that browser; a new device starts empty.

### Requests the server turns down

All checks run in the room's static `onAuth`, on the HTTP matchmaking request, before a room is created or a seat is
reserved. Colyseus sends the code as the HTTP status of the response, so it must be a valid one.

| Reason | Code | Message |
|---|---|---|
| Outdated client (protocol version differs) | 426 | New version available, please reload |
| Nickname breaks the rules | 422 | Nicknames are 1–16 letters, digits, spaces or basic punctuation |
| Too many new rooms from one IP | 429 | Too many new rooms from your network. Try again in a few minutes. |
| Room mode other than private | 400 | Only private rooms are available |

- `PROTOCOL_VERSION` (`src/core/protocol.js`, now 3) is raised whenever messages or room state change in a way an
  older client cannot handle.
- Colyseus disconnects a client that sends a message type the room has no handler for, so a client never sends a
  message before the server handles it.
- Room creation is limited to 10 per IP address in any 10 minutes. `create` and `joinOrCreate` both count; joining a
  room is not limited.
- Colyseus's own errors (codes 520–526) are turned into plain messages by the client: "not found" becomes "No room with
  that code", and "locked" becomes "That room is full, or its game has already started" (Colyseus uses the same
  message for both).

### Network and security

- **Server address:** the client uses `VITE_SERVER_URL` when it is set (production). Otherwise it connects to port
  2567 on the host that served the page, so a phone on the same Wi-Fi reaches the development server.
- **`CLIENT_IP_HEADER`:** behind a proxy, names the header that carries the real client IP (`Fly-Client-IP` on
  Fly.io). Without it, Colyseus uses the first `X-Forwarded-For` entry, which a client can set itself, and the per-IP
  room limit could be dodged.
- **CORS:** Colyseus allows every origin by default. Step 13 limits it to the Vercel domain and localhost.
- **Load size:** the browser SDK is a separate chunk, loaded only when someone picks Online.

### Testing

- `tests/golden/shots.json` records 206 seeded shots from the original game code. The match must reproduce it byte
  for byte (`tests/golden-shots.test.js`), and so must the simulator (`tests/shot-simulator.test.js`).
- `tests/core.test.js` keeps `src/core/` free of Three.js, browser APIs and `Math.random`.
- `server/tests/` boots a real game server and drives it with the browser SDK. `@colyseus/testing`'s `boot()` ignores
  its port argument when given a server object, so the test server always listens on port 2568.
- Browser flows are checked with scripted headless Edge runs; each step's test below says what to check by hand.

## Steps

### Phase A: rules ready for the server (done)

**1. Record golden shots** · `d383114`
Ran the original shot code in Node with graphics and sound stubbed, and recorded 206 seeded shots across all holes and
weapons, covering every outcome (rest, cup, water, out of bounds, body hit, headshot, blast, burst, rifle choice,
picked up). *Test: the same file twice, every outcome present.*

**2. Pure shot simulator** · `59c1e0d`
`src/core/shot.js`: `launchShot` (the random spread, with the random generator passed in) and `simulateShot` (a whole
shot: 60 Hz paths, events, outcome). *Test: reproduces all 206 golden shots exactly; `src/core/` stays pure.*

**3. Match rules** · `36a716a`
`src/core/match.js` holds a match as plain JSON data, changed only by actions: `shoot`, `chooseBullet`, `timeout`,
`next`, `nextHole`, `setConnected`, `leave`. Phases: `turn`, `choose`, `settle`, `waiting`, `between`, `end`.
Includes the online rules above (timeouts, disconnects, leaving). *Test: a test per rule, plus a scripted three-hole
bot game with the expected scorecard.*

**4. One-screen game runs on the match** · `34747ee`
`fire()` asks the match to decide the shot; `playShotStep()` plays it back step by step. Display copies catch up as it
plays out. The golden test now runs through the match. *Test: automated playtests (keyboard, touch, set-ups for every
outcome) and a phone and desktop playtest.*

### Phase B: rooms and lobby (done)

**5. Game server with private rooms** · `3feb680`
`server/` with the `golf` room (`server/src/GolfRoom.js`). Room state: `phase` (`lobby`, `playing`), `code`, `host`,
`minPlayers`, `seats` (`sessionId`, `name`, `style`, `connected`). Version, nickname and room-limit checks; the room
locks on start. In the lobby a leaving player's seat is removed; once playing it is only marked disconnected (step 10
takes over from there). *Test: server integration tests through the browser SDK.*

**6. Online menu, lobby and invite links** · `f3e2ae2`
The start screen offers One screen or Online. `src/net/online.js` talks to the server; `src/ui/lobby.js` is the online
menu and lobby. The start rule moved into the room state (`minPlayers`). After the host starts, everyone sees
"Starting the game…": that is where step 7 takes over. *Test: four browsers including a phone-sized one on the Wi-Fi
address, then two PC tabs and a phone by hand.*

### Phase C: the server decides every shot (in progress)

**7. The server runs the match** · `51c8609`
- On start, the room creates `makeMatch(seat names, Math.random)` with seats in lobby order, so seat i in the room is
  seat i in the match. Characters keep the look they had in the lobby.
- The room state mirrors the match: `match` (`phase`, `hole`, `turn`, `cur`, `wind` with `x`, `z`, `dir`, `speed`), and
  per seat `ball`, `stand`, `strokes`, `done`, `picked`, `out` and `scores`. Scores store "not played" as 0 (real
  scores are at least 1); a seat that is out keeps its last stand, read as nobody standing there. Positions and wind are
  `float64`: `t.number()` arrives as float32, and clients must see exactly the server's numbers. `writeMatch`
  (`server/src/state.js`) copies a match into the room state; `readMatch` (`src/net/remoteMatch.js`) reads it back.
- The online client plays a remote match (`src/net/remoteMatch.js`) with the same shape as `makeMatch`: its state is
  read from the room state, and `src/game/online.js` shows the hole it is on through the same display copies as the
  one-screen game. Only the active player gets the golf bag. Everyone else is in the client phase `watch`: the camera
  sits over the shooter's right shoulder looking along their aim (toward the cup until step 12), and the shooter holds
  the weapon the bag recommends.
- The remote match's `shoot` turns the shot down with a message for now; step 8 makes it send `shoot`, once the server
  handles it. `fire()` is split from `playShot()`, which step 8 calls when the result arrives.
- Brought forward from step 10, because the test reloads a window: while a game is on, a dropped connection keeps its
  seat for 60 seconds (`onDrop` → `allowReconnection`), and the room seat shows it as not connected meanwhile. The tab
  keeps `{ code, token }` in `sessionStorage` (`birdieblasters-rejoin`) and rejoins with it after a reload; the token is
  renewed on every reconnection. The match itself is not told yet: that, and what happens after 60 seconds, is step 10.
- `PROTOCOL_VERSION` is now 2.

*Test: integration tests check that every client reads the same match as the server, at the start and after every
action of a whole three-hole bot game (with a timed-out turn now and then and a player leaving); a dropped connection
takes its seat back with its token while playing, but not in the lobby. In headless Edge, three players (one on a
phone-sized screen over the Wi-Fi address) see the same match, wind, hole card and character positions; only the
shooter has the golf bag; both spectators' cameras sit at the same spot; reloading a spectator and then the shooter
restores the same view; a new tab with the invite link is still turned away. The one-screen playtest still passes.*

**8. Shots decided by the server** · done
- Messages (listed in `src/core/protocol.js`):
  - client → server: `shoot {weapon, yaw, pitch, power}`, `chooseBullet {k}`, `replayDone {turn}`
  - server → clients: `shotResult {turn, shooter, aim, shot, result}`, with the whole `simulateShot` result (per
    projectile: launch, start and end step, result, path, final, rest; the events; the outcome) and the match's result.
    New: `bulletChosen {turn, k, result}` tells everyone which rifle bullet the shooter picked.
- Both results are sent just after the state patch with the change (`afterNextPatch`), so a client's room state already
  has the shot when its result arrives: the match on screen is ahead of the display copies, as on one screen.
- The room only finds the sender's seat; `match.shoot` and `match.chooseBullet` turn anything else down without a
  change and nothing is sent back. A client that plays fair never sends a shot the match refuses, and if the server
  has moved on meanwhile, the room state shows it.
- Paths go as the bytes of a `Float32Array` in a `Uint8Array` (`packShot`, `unpackShot`): msgpack garbles a
  `Float32Array` itself, but carries a `Uint8Array` intact.
- The next turn waits for every client that got the shot to send `replayDone`, at most until 10 seconds after the shot
  lands (after its flight, or after the rifle choice). A client that drops out is not waited for, and one that comes
  back does not count. `replayDone` sent while the shooter is still choosing counts. The room's `replayMargin` (10 s)
  can be shortened in tests.
- On screen: `fire()` sends the shot and keeps the first-person view until the result arrives (one round trip), then
  `playShot()` plays it in every window. Spectators get the chase camera from the start and an empty Fire button. In a
  rifle choice they see the numbered bullets and "Ann is picking the bullet that counts."; a choice that arrives
  before the bullets have landed on that screen is applied when they land.
- A screen still showing the last shot when the server moves on (the 10 seconds ran out) skips to the end of it. A tab
  in the background sends `replayDone` at once, since browsers pause its animation, so it never holds anyone up; when
  it is opened again it already shows the current turn.
- Until step 11 the online scorecard after a hole has no buttons. Until steps 9 and 10, a shooter who reloads during
  the rifle choice cannot choose any more and the game waits.
- `PROTOCOL_VERSION` is now 3.

*Test: integration tests turn down bad shots (wrong turn, not-a-number, power 5 and 0.01, weapon 9, 1.5 and −1, no
aim at all, a second shot) without a change or a reply; check that every client gets the same shot as the server
decided, after the state patch, with float32 paths; that the next turn waits for both screens, ignores a `replayDone`
for another turn, gives up after the flight plus the margin, and does not wait for a player who drops out; that only
the shooter picks the rifle bullet and every client learns which; that a hit moves the other player for every client;
and that shot messages before the start are ignored. In headless Edge (Ann on a computer, Ben on a phone-sized screen
over the Wi-Fi address): Ann's dart plays in both windows and ends where the server says; Ben's sniper hit knocks Ann
back in both; Ann picks a rifle bullet while Ben sees the numbered bullets without buttons; with Ann's tab in the
background and its animation paused, the next turn starts 0.1 s after Ben has watched his shot, and Ann's screen has
already skipped to it. The step 7 browser test and the one-screen playtest still pass.*

**9. Shot clock**
- 30 seconds per turn on the room clock (`this.clock.setTimeout`), starting when the turn begins. The rifle choice gets
  its own 15 seconds.
- The server sends the time left at the start of each turn and the HUD counts down, with the last 5 seconds
  highlighted. When time runs out, the room calls `match.timeout()`.
- A shot that arrives after the deadline is rejected.
- Turn alert: when the new turn is yours, play a short sound and set the tab title to "Your turn!"; put the title back
  when you pick a weapon or the turn passes.

*Test: with the room clock advanced in tests, no shot passes the turn at 30 s; a shot at 29.9 s counts and one at 30.1 s
is rejected; the countdowns in two windows agree within half a second; with the window in the background, your turn
plays the sound and shows "Your turn!" in the tab title, which goes back once you pick a weapon.*

**10. Disconnects and reconnecting**
- `onDrop` already holds the seat for 60 seconds (step 7). Now it also calls `match.setConnected(seat, false)`, and
  `onReconnect` sets it back. When the 60 seconds run out, `match.leave(seat)` makes the player out. `writeMatch` then
  copies `connected` from the match, which becomes the only place it is kept.
- A consented leave (the Leave button) calls `match.leave` at once.
- The client already rejoins after a reload (step 7), and the SDK reconnects by itself after a network drop. The HUD
  shows who is reconnecting, with the seconds left.
- The host role passes on when the host drops; the room closes when nobody is left.

*Test: integration tests for a drop during your own turn and during someone else's, a return after 30 seconds with
strokes intact, and no return (seat gone at 60 seconds); by hand, reload a tab mid-game and put a phone in airplane
mode for 20 seconds.*

**11. Between holes and the end**
- (Since step 8 the online scorecard after a hole shows no buttons; this step adds the countdown and Play again.)
- In `between`, the room waits 10 seconds and then calls `match.nextHole()`. Clients show the scorecard with a
  countdown, "—" for players who are out, and no ranking for them.
- At `end`, the final scorecard. The host's "Play again" sets the room back to the lobby with the same code (unlocked,
  connected seats kept), and the next start begins a new match.

*Test: a full three-hole game with 2–4 players ends with the same scorecard in every window; Play again returns
everyone to the lobby.*

**12. Live aim for spectators (looks only)**
- The active player sends `aim {weapon, yaw, pitch}` about 10 times a second.
- The server relays it to the others, limited per client (`maxMessagesPerSecond`), and never uses it for physics.
  Spectators see the shooter's character turn.

*Test: a second window shows the shooter turning live; blocking these messages changes no shot results.*

### Phase D: deploy (to do)

**13. Game server on Fly.io**
- **Image:** a Dockerfile on Node 22 or newer that copies `package.json`, `package-lock.json`, `server/` and
  `src/core/`, and installs only the server workspace's production dependencies.
- **Environment:** `NODE_ENV=production` and `CLIENT_IP_HEADER=Fly-Client-IP`.
- **Fly app:**
  - Region Stockholm (`arn`) or Amsterdam (`ams`); check which Fly offers at the time.
  - Exactly one machine that never stops while rooms are open, since rooms live in memory.
  - HTTPS and `wss://` through Fly's proxy.
- **Server:** a health endpoint, plus CORS limited to the Vercel domain and localhost (override
  `matchMaker.controller.getCorsHeaders`).

*Test: the health endpoint answers; a local client plays a game against the deployed server; a forged
`X-Forwarded-For` does not get around the room limit.*

**14. Frontend on Vercel**
- Set `VITE_SERVER_URL` to the Fly address. Invite links then use the Vercel address.
- HTTPS makes the clipboard and the phone share sheet available for invites.

*Test: two phones on mobile data and a desktop finish a game from one invite link, including one airplane-mode
reconnect. Then merge `online` into `main`.*

### Later: public quick match

A "Quick match" button calls `joinOrCreate` with mode `public`. Public rooms are not private, are filtered by mode,
lock when full or started, and start once at least 2 players have waited a few seconds. Steps 5 and 6 already leave room
for it: the `mode` option, private rooms that are never matched, and `joinOrCreate` already counting toward the room
limit.

## Known limits

- Colyseus reports a full room and a started game with the same "locked" message, so the client says "full, or its
  game has already started".
- Rooms live in one server process: a deploy or crash ends games in progress.
- On plain `http://` (the Wi-Fi address during development) browsers allow neither the clipboard nor the share sheet;
  the lobby then shows the invite link to copy by hand.
- Phones may pause a page in the background, so there the turn alert may only sound once the page is opened again.

## Development notes

- `npm install` once; it also installs the `server/` workspace.
- Two terminals: `npm run dev:server` (game server on port 2567) and `npm run dev -- --host` (Vite on 5173). Vite
  prints a Network address such as `http://192.168.0.11:5173/` for phones on the same Wi-Fi.
- For phone tests, create the room from the Network address on the PC as well, so the invite link contains an address
  the phone can open.
- `npm test` runs everything, including the server tests on port 2568.
- On the development PC, Windows Firewall already allows Node.js to accept connections on the (Public) Wi-Fi network.
  Guest Wi-Fi networks often stop devices reaching each other.
- Browser tests: on the development PC, an Edge started from Node exits at once (since October 2026), so puppeteer
  cannot launch it. Start headless Edge from PowerShell with `--remote-debugging-port=9333` (plus
  `--enable-unsafe-swiftshader --use-angle=swiftshader` for WebGL) and `puppeteer.connect` to it.
- Tests that import game modules inside the page must import the exact URL the page loaded: after an edit, Vite serves
  the module as `…?t=…`, and a plain import makes a second, unused copy.
