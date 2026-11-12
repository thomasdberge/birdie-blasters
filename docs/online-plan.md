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
| 8 | Shots decided by the server | `b45f3b0`, `db90594` |
| 9 | Shot clock | `420b57b`, `7de49b9` |
| 10 | Disconnects and reconnecting | `a1dc4bc` |
| 11 | Between holes and the end | `aeb5cd8` |
| 12 | Live aim for spectators | `20c9787`, follow-up with step 13 |
| 13 | Game server on Railway | built and tested locally; deploying is done by hand (hash added with step 14) |
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
- **Hosting:** the game server on Railway, in EU West (Amsterdam), the region closest to Norway. Railway instead of the
  first plan, Fly.io, because there is already a Railway account: the Trial plan to begin with, Hobby before the game
  is shared widely. Vercel cannot host the server, because its functions cannot keep WebSockets open. The frontend
  stays on Vercel and finds the server through `VITE_SERVER_URL`.
- **One instance, rooms in memory:** exactly one server process runs, and deploying it ends games in progress. Fine for
  now; more than one would need Colyseus's Redis driver. Step 13 says how Railway is held to one.
- **Railway's settings live in its dashboard**, listed in step 13. Its config file in the repo (`railway.json`) is
  deprecated: new services cannot use it, and it stops being read on 2026-12-01. Its replacement, Infrastructure as Code
  (`.railway/railway.ts`), needs the `railway` npm package and is applied with the Railway CLI, and its docs do not yet
  cover the Dockerfile or watch paths. Revisit when they do.

### Cost

- **Hobby:** $5 a month, and that includes $5 of usage, so the server costs **$5 a month** unless it uses more. Railway
  charges for what is used: memory $10 per GB-month, CPU $20 per vCPU-month, data sent $0.05 per GB; builds are free.
- **Measured** (step 13, the image on the development PC, bots playing): idle, 45 MiB and next to no CPU, about
  $0.50–1 a month. Ten four-player games at once: 52 MiB, at most 1.4% of one CPU, and 4.5 MB sent per player-hour,
  so a player-hour costs about $0.0003, almost all of it data. Usage would pass the included $5 only at roughly 15,000
  player-hours a month (500 a day). Rough figures: Railway meters its own way, and real players aim longer than bots.
- **Trial:** a one-time $5 credit for 30 days (limits: 1 GB memory, shared CPU). This server uses about $1 of it; when
  the 30 days or the credit run out, Railway stops the server until the plan is upgraded.
- After upgrading, set a usage alert (soft limit) on the workspace's Usage page. A hard limit (at least $10) takes the
  server offline when it is reached.

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
  is clamped to the limit rather than rejected, so a client's rounding can never make a valid shot fail. The shooter
  is told why a shot was refused and can aim again.
- Hits are checked where players stand (the layout from the match), and knock-backs start from their ball. The one
  difference from the old game: a character still walking into place is hit where they are heading, not mid-walk.
- Turn order is round-robin, as before; the lowest score on the previous hole tees off first, seat order breaks ties.
- After a shot, the next turn starts once every screen that got it has watched it land, but at most 10 seconds after
  it lands. A screen that is still showing it then skips ahead; a tab in the background never holds anyone up.

### Live aim

- While the shooter picks a weapon and aims, everyone else watches their character turn, hold the weapon they have
  picked and tilt it up and down; the camera over the shooter's shoulder follows. When the shot arrives, the aim it was
  fired at is shown.
- The shooter's screen sends `aim {turn, weapon, yaw, pitch}` at most 10 times a second when it has changed, and once
  a second anyway, so a screen that has just reloaded catches up. Yaw is rounded to a thousandth of a radian and pitch
  to a tenth of a degree. Nothing is sent while the connection is lost: the SDK would keep the messages and send them
  all at once when it is back.
- The room passes an aim on only from the player whose turn it is, during that turn, and only its weapon, yaw and pitch
  (`cleanAim`), with the turn and seat added. It goes to everyone but the shooter. The match never sees it, so it cannot
  change a shot.
- The weapon tilts by 60% of the pitch, held within −20° to 50°, and only on the other players' screens, so the
  one-screen game looks as before.
- On the screen of someone watching another player's turn (while they aim, while the shot flies, during the rifle
  choice and while it settles), any figure within 4 m of the camera is hidden, measured to its body from feet to head:
  standing right by the camera over the shooter's shoulder, it would fill the view. The shooter's own screen keeps the
  one-screen rule: only a figure whose head is right at the lens (their own, in first person) is hidden, so players near
  the one aiming stay in sight.

### Shot clock and timeouts

- 30 seconds per turn, timed on the server, starting when the turn begins (the golf bag opens then).
- Running out of time costs one stroke and passes the turn. Without the penalty, a player who never shoots would block
  the hole forever, since a hole only ends when everyone has holed out or reached par + 5.
- The assault rifle keeps "pick which bullet counts". That needs one extra message (`chooseBullet`) besides weapon,
  yaw, pitch and power. The choice has its own 15 seconds, counted from when the bullets have landed (the room adds
  the flight time); after that the bullet nearest the cup counts.
- A shot carries the turn it was fired in, and the room turns down a shot meant for another turn. Otherwise a late
  shot from a turn that just timed out could count in the next one when the same player has it (the last player left
  on a hole).
- **Grace for network delay:** screens count down to 0 at the deadline (30 seconds), but the room takes a shot until
  half a second after it, and only then passes the turn. A screen's countdown runs behind the server's by a network
  delay, and a shot needs another to arrive, so a player who fires while their screen still shows time left never loses
  the shot to latency (up to half a second there and back). At 0 on screen, Fire goes off and any charge is dropped, so
  nothing is fired that could arrive after the grace. The rifle choice has the same grace, and its buttons go at 0.
- After the grace the cut is exact: a shot after it is refused as too late ("Too late: your time ran out.") even if the
  room clock, which only ticks with each state patch, has not fired yet. Nor does the turn pass early: the room clock
  can fire a timeout up to one patch early, and the room then waits on.
- The time left is in the room state, written when the clock starts and about once a second. Each screen counts down
  from the last value it got, so a reloaded or lagging screen is right again within a second.
- **Turn alert:** when it becomes your turn, a short sound plays and the browser tab title shows "Your turn!" until you
  act (pick a weapon) or the turn passes, so players who look away don't lose strokes to the shot clock.

### Disconnects and leaving

- A dropped player keeps their seat for 60 seconds. Their turns are skipped without penalty; if it was their turn, it
  passes at once. They rejoin the rotation when they reconnect.
- The client keeps its reconnection token in `sessionStorage` and reconnects by itself after a reload or a network
  drop. Others see e.g. "Barry · reconnecting 0:42" under the hole card, and a short message when someone loses the
  connection, comes back or leaves. The player whose connection is lost sees "You · reconnecting…" and cannot fire
  meanwhile.
- Only a game in progress holds seats. In the lobby a dropped connection frees the seat at once, as leaving does, and
  the tab keeps no token. So the lobby does not try to reconnect either: it says at once that the connection was lost.
- Disconnecting or leaving during the rifle choice takes the bullet nearest the cup, as when time runs out.
- Disconnected players can still be hit: their character is still standing on the course. A player who has left
  disappears from the course and the minimap.
- If everyone who still has to finish the hole is disconnected, the match waits (phase `waiting`) until one of them
  reconnects or their seat expires. Screens say who they are waiting for.
- After 60 seconds the player is out for the rest of the match: no more turns, "—" on the scorecard for the remaining
  holes and their total, not ranked. Scores of holes they finished are kept. One who leaves after finishing the last
  hole is still ranked.
- "Leave game" on the online scorecard (tap the hole card) frees the seat at once; while the game is on it asks once
  more ("Leave for good?"). Pressed while the connection is lost, it takes the tab back to the start at once, and the
  seat is given up when its 60 seconds run out.
- The host role passes to the next connected player when the host leaves or drops; if everyone has dropped, the first
  one back is host. The room closes when nobody is left and no seat is held.

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
- After the last hole, the host's "Play again" takes everyone back to the lobby with the same code. Only players who are
  still connected keep their seat and look; one who is away loses the seat, as in the lobby, and their token is turned
  down. The room opens again for new players, and the next start begins a new match. If the host leaves at the end, the
  next host gets the button.
- Between holes everyone sees the scorecard with a countdown, and the next hole starts 10 seconds after the hole ended
  (once every screen has watched its last shot). The room's clock times it as it times turns, but with no grace, since
  nothing is sent between holes.
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

- `PROTOCOL_VERSION` (`src/core/protocol.js`, now 7) is raised whenever messages or room state change in a way an
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
- **`CLIENT_IP_HEADER`:** behind a proxy, names the header that carries the real client IP: `X-Real-IP` on Railway,
  set in the image. Without it, Colyseus uses the first `X-Forwarded-For` entry, which a client can set itself where
  no proxy replaces it, and the per-IP room limit could be dodged.
- **Which pages may use the server (CORS):** Colyseus allows every origin by default. In production the server answers
  a browser's matchmaking requests only for the pages in `CLIENT_ORIGINS` (comma-separated origins, e.g.
  `https://birdieblasters.vercel.app`) and pages on localhost (`originAllowed` in `server/src/app.js`), so a copy of
  the game on another site cannot use it. In development every page may, for phones on the Wi-Fi. A program that is
  not a browser can still send anything; the room checks are what stop it. In production the server warns at start
  when `CLIENT_ORIGINS` is not set.
- **Health check:** `GET /health` answers `{ ok, process, rooms, players }`. `process` is this server process's id, so
  asking a few times shows whether more than one is answering; `rooms` and `players` show whether a deploy would end
  games.
- **Load size:** the browser SDK is a separate chunk, loaded only when someone picks Online.
- **Message flood:** a client that sends more than 30 messages in a second (`maxMessagesPerSecond`) is disconnected,
  and its seat is held as after any drop. A fair client sends at most 10 aims a second, a few other messages, and the
  up to 10 the SDK kept while its connection was lost.

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

**8. Shots decided by the server** · `b45f3b0`, follow-up `db90594`
- Messages (listed in `src/core/protocol.js`):
  - client → server: `shoot {weapon, yaw, pitch, power}`, `chooseBullet {k}`, `replayDone {turn}`
  - server → clients: `shotResult {turn, shooter, aim, shot, result}`, with the whole `simulateShot` result (per
    projectile: launch, start and end step, result, path, final, rest; the events; the outcome) and the match's result.
    New: `bulletChosen {turn, k, result}` tells everyone which rifle bullet the shooter picked, and
    `shotRejected {reason}` tells the shooter alone why a shot was turned down.
- Both results are sent just after the state patch with the change (`afterNextPatch`), so a client's room state already
  has the shot when its result arrives: the match on screen is ahead of the display copies, as on one screen.
- The room only finds the sender's seat; `match.shoot` and `match.chooseBullet` turn anything else down without a
  change. A refused shot is answered with `shotRejected {reason}` (the match's error), after the next state patch so
  the shooter's screen knows where the match stands: it says why ("Too late: it is not your turn any more.", or "The
  server could not take that shot. Aim and fire again.") and goes back to aiming if the turn is still theirs. Added
  before the shot clock, since a refusal nobody hears about could quietly cost a stroke. A refused rifle choice gets
  no answer: a fair client's choice is only refused once the choice has been made for it, and that result arrives.
- Paths go as the bytes of a `Float32Array` in a `Uint8Array` (`packShot`, `unpackShot`): msgpack garbles a
  `Float32Array` itself, but carries a `Uint8Array` intact.
- The next turn waits for every client that got the shot to send `replayDone`, at most until 10 seconds after the shot
  lands (after its flight, or after the rifle choice). A client that drops out is not waited for, and one that comes
  back does not count. `replayDone` sent while the shooter is still choosing counts. The room's `replayMargin` (10 s)
  can be shortened in tests.
- On screen: `fire()` plays the sound, recoil and muzzle flash at once and sends the shot; only the projectile waits
  for the result (one round trip), with the view still first person. Then `playShot()` plays it in every window. Spectators get the chase camera from the start and an empty Fire button. In a
  rifle choice they see the numbered bullets and "Ann is picking the bullet that counts."; a choice that arrives
  before the bullets have landed on that screen is applied when they land.
- A screen still showing the last shot when the server moves on (the 10 seconds ran out) skips to the end of it. A tab
  in the background sends `replayDone` at once, since browsers pause its animation, so it never holds anyone up; when
  it is opened again it already shows the current turn.
- Until step 11 the online scorecard after a hole has no buttons. Until steps 9 and 10, a shooter who reloaded during
  the rifle choice could not choose any more and the game waited; now the drop picks the bullet nearest the cup.
- `PROTOCOL_VERSION` is now 3.

*Test: integration tests turn down bad shots (wrong turn, not-a-number, power 5 and 0.01, weapon 9, 1.5 and −1, no
aim at all, a second shot) without a change, each answered with its reason to the shooter alone; check that every client gets the same shot as the server
decided, after the state patch, with float32 paths; that the next turn waits for both screens, ignores a `replayDone`
for another turn, gives up after the flight plus the margin, and does not wait for a player who drops out; that only
the shooter picks the rifle bullet and every client learns which; that a hit moves the other player for every client;
and that shot messages before the start are ignored. In headless Edge (Ann on a computer, Ben on a phone-sized screen
over the Wi-Fi address): a shot with power 5 goes off at once on Ann's screen, is refused, and Ann is told why and
aims again while Ben sees nothing; Ann's dart goes off before the server answers, then plays in both windows and ends where the server says; Ben's sniper hit knocks Ann
back in both; Ann picks a rifle bullet while Ben sees the numbered bullets without buttons; with Ann's tab in the
background and its animation paused, the next turn starts 0.1 s after Ben has watched his shot, and Ann's screen has
already skipped to it. The step 7 browser test and the one-screen playtest still pass.*

**9. Shot clock** · `420b57b`, follow-up `7de49b9`
- The room's `sync()` copies the match into the room state and starts the clock whenever a turn or a rifle choice
  begins: 30 seconds for a turn, flight time plus 15 seconds for a choice (`this.clock.setTimeout`); anything else
  stops it. `match.clock` says what it times (`turn`, `choose` or empty) and `match.timeLeft` the milliseconds left,
  written at the start and every second.
- When a turn's time runs out, the room calls `match.timeout()` and sends `timeUp {turn, seat, result}`; every screen
  shows "TIME’S UP! +1 stroke. Ann’s turn passes.", the shooter's golf bag and controls close, and the next turn waits
  for `replayDone` as after a shot. When a rifle choice runs out, the bullet nearest the cup counts: `bulletChosen`
  with `timeUp: true`, and screens say "Time’s up: the bullet nearest the cup counts."
- `shoot` carries `turn`. A shot for another turn is refused with `not your turn`, a shot after the deadline and its
  grace with `time`. Each room has `turnSeconds` and `chooseSeconds`, which tests shorten.
- Follow-up, grace for network delay: `timeLeft` still counts down to the deadline, but the room takes a shot or a rifle
  choice until half a second later (`GRACE_SECONDS`, the room's `graceSeconds`) and only then times out. The room clock's
  first tick also counts the time from before a timeout was set, so a timeout can fire up to one patch early;
  `expireAt` then sets another for the rest. Every frame online, `stopAtZero()` (`src/game/online.js`) turns Fire off,
  drops a charge and hides the bullet buttons once the screen's own countdown has reached 0, and `startCharge()`
  refuses from then on.
- The clock sits on the hole card next to the current player's name, in whole seconds, red and beating for the last 5.
  It shows for the turn while the golf bag is open, while aiming and while watching, and for a rifle choice once the
  bullets have landed on that screen; not while a shot flies.
- Turn alert: when a turn becomes yours, a two-note sound plays and the tab title says "Your turn!" until you pick a
  weapon or the turn passes. A tab in the background reports a time-up at once, as it does a shot.
- `PROTOCOL_VERSION` is now 4.

*Test: integration tests (with the clock shortened per room) check that the clock starts with every turn, counts down
in the room state and stops when the shot is fired; that a turn with no shot passes with a penalty stroke and everyone
is told, never before the grace has ended; that a shot 0.4 s after the deadline counts and one 0.1 s after the grace is
refused as `time` while the turn passes; and that an unmade rifle choice takes the bullet nearest the cup after the
flight plus the choice time. In headless
Edge (Ann on a computer, Ben on a phone-sized screen over the Wi-Fi address): only the player whose turn it is gets the
sound and "Your turn!", which goes once they pick a weapon; both countdowns agree within 0.2 s at the start and at
4.5 s; the last seconds are red in both; when Ann's 30 seconds run out both see TIME’S UP and Ann has a penalty stroke;
no clock shows while a shot flies; Ann's tab in the background with its animation paused still gets "Your turn!" and
the sound, and keeps the title until she picks. The step 7 and 8 browser tests and the one-screen playtest still
pass. Follow-up, in headless Edge: Ann holds Space as her time runs out; at 0 on her screen the charge is dropped and
Fire is off while the server still has her turn, Space fires nothing, and TIME’S UP follows about half a second later;
Ben, on a phone whose every message reaches the server 0.4 s late, fires with under 0.1 s showing and the shot
counts. The step 9 browser test still passes.*

**10. Disconnects and reconnecting** · done
- `onDrop` holds the seat for the room's `reconnectSeconds` (60) and calls `match.setConnected(seat, false)`;
  `onReconnect` sets it back. When the time runs out, Colyseus calls `onLeave`, which calls `match.leave(seat)` and makes
  the player out. A consented leave goes to `onLeave` at once. `writeMatch` copies `connected` from the match, which is
  now the only place it is kept. A seat the room cannot hold because it is closing is let go quietly
  (`allowReconnection(…).catch`), so it never becomes an unhandled rejection.
- Each seat has `reconnectLeft`: the milliseconds a dropped player has left to come back, written when they drop and
  every second, 0 otherwise. Screens count down from it as from the shot clock.
- `match.setConnected` and `match.leave` return the rifle choice they make for the shooter, as `chooseBullet` does. The
  room then sends `bulletChosen` with `gone: true`, and screens say "Without Ann, the bullet nearest the cup counts."
  Such a choice can come while the bullets are still flying on screen, so the replay now remembers when the shot lands
  and `settled()` waits until then plus the margin.
- The host role passes to the next connected player when the host drops or leaves; if everyone has dropped, the first
  one back is host. Colyseus closes the room once it has no clients and holds no seat.
- On screen (`src/game/online.js`): while this player's connection is lost (the SDK's `onDrop` until `onReconnect`),
  `holdControls()` keeps Fire off as at 0 on the clock, and "You · reconnecting…" shows under the hole card. The SDK
  retries for about a minute; the lobby turns its retries off until the game starts. For other players the same list
  shows "Ben · reconnecting 0:42", and toasts say "Ben lost the connection.", "Ben is back." and "Ben left the game."
  Someone who has left disappears from the course and the minimap at once. In `waiting` the hint says "Waiting for Ben
  to come back."
- "Leave game" on the online scorecard (peek, between holes and at the end), with "Leave for good?" while the game is
  on. Without a connection it stops the retries and goes back to the start; if a retry already under way gets through
  after all, that room is left at once.
- Until step 11 the scorecard shows "·" for the holes a player who left will not play, and ranks them like everyone
  else.
- `PROTOCOL_VERSION` is now 5.

*Test: integration tests check that a drop on your own turn passes it at once without a penalty and others see the
time left counting down; that a player who drops during someone else's turn is skipped and, back after half their time,
has their strokes and their place in the rotation; that one who does not come back is out, their token turned down and
their turns gone; that leaving puts you out at once and passes your turn and the host role; that a drop during the rifle
choice picks the bullet nearest the cup for everyone; that when everyone still playing is away the match waits and the
first one back is host and plays on; and that the room closes only once nobody is left and no seat is held. A match
test checks the choice that `setConnected` and `leave` return. In headless Edge (Ann and Cy on computers, Ben on a
phone-sized screen over the Wi-Fi address): Ben reloads during Ann's turn and is back on the same turn while Ann saw
"Ben · reconnecting 1:00 … 0:55", "Ben lost the connection." and "Ben is back."; on Ben's own turn his network goes for
20 seconds: his screen says "You · reconnecting…" and Fire is off, the turn passes to Cy without a penalty, Ann and Cy
see his countdown run, and when the network is back he reconnects by himself with his strokes intact and watches Cy's
turn; Cy leaves from the scorecard (the first press only asks), is back at the start with no error, his turn passes,
and his character is gone from both courses. The step 7–9 browser tests, the grace test and the one-screen playtest
still pass. By hand: reload a tab mid-game, and put a phone in airplane mode for 20 seconds.*

**11. Between holes and the end** · done
- The room's clock also times the scorecard between holes: when the match reaches `between`, `match.clock` is
  `between` and `timeLeft` counts down from 10 seconds (`BETWEEN_SECONDS`, the room's `betweenSeconds`); then the room
  calls `match.nextHole()`. No grace here: the next hole starts at the deadline the screens count down to.
- Screens show the scorecard with "Hole 2 starts in 8 s." and "Leave game". A screen that joins between holes (a
  reload) or at the end shows the hole and then the scorecard at once.
- On the scorecard a player who left before finishing the last hole has "—" for the holes they will not play and for
  their total, and is not ranked. While it is up, the scorecard follows the room: someone leaving, or the host changing.
- At `end` the host's final scorecard has "Play again"; everyone else's says "Waiting for Ann to play again." The
  `playAgain` message (host only, only at `end`) turns down the seats Colyseus holds for players who are away, so their
  tokens no longer work, keeps the connected seats in their order and look, clears the match from the room state
  (`clearMatch`), sets the phase back to `lobby` and unlocks the room.
- On screen the lobby takes over again: the game view stops and removes its room listeners (a second game in the same
  room hears every message once), and the tab drops its rejoin token and turns reconnection off, as in the lobby.
- The room starts writing `reconnectLeft` every second when it is created, not on every start.
- `PROTOCOL_VERSION` is now 6.

*Test: integration tests play whole games with 2, 3 and 4 players through the clients' messages: after each hole every
client has the `between` clock counting down, the next hole starts when it ends and not before, and every client ends
with the server's scorecard. Only the host can play again, and only at the end; everyone is then in the lobby with the
same code, seats and looks, a friend can join, and the next start begins a new match whose first shot arrives. Playing
again frees the seat of a player who left and of one who is away, and turns the latter's token down. In headless Edge
(Ann and Cy on computers, Ben on a phone-sized screen, all over the Wi-Fi address), bots play a whole game: after hole 1
all three see the same scorecard with countdowns that agree within a second; Ben reloads and is back on it, in step with
Ann (the test gives this scorecard 30 seconds: a reload with software rendering takes longer than 10); Cy leaves during
hole 2 (the first press only asks) and afterwards has his hole 1 score, "—" for the rest, no total and no ranking; on
that scorecard the countdown ticks down second by second and the server starts hole 3 ten seconds after hole 2 ended;
at the end Ann and Ben see the same final scorecard with the server's scores and the right winner, Ann has Play
again and Ben waits; Play again takes both to the lobby with the same code and no rejoin token; in the next game Ann's
first shot plays once on each screen; at the end of that game Ann leaves and Ben gets Play again; a one-screen hole still
ends with "To hole 2".*

**12. Live aim for spectators (looks only)** · `20c9787`, follow-up with step 13
- `shareAim()` (`src/game/online.js`) runs every frame online and sends the shooter's aim while they pick a weapon and
  aim: at most every `AIM_EVERY_MS` (100) when it has changed, and every `AIM_REPEAT_MS` (1000) anyway. The remote
  match's `aim()` adds the turn and sends nothing while the connection is lost.
- The room's `relayAim` checks the sender, the phase and the turn, cleans the aim with `cleanAim`
  (`src/core/protocol.js`) and broadcasts `aim {turn, seat, weapon, yaw, pitch}` to everyone but the sender. The room
  disconnects a client that sends more than `MAX_MESSAGES_PER_SECOND` (30) messages in a second.
- A screen watching that turn (`watch`) takes the aim as its own yaw, pitch and weapon: the shooter's character turns
  to the yaw (as before, from `state.yaw`), shows the weapon, and the camera over their shoulder follows. A new
  `hold` tilt on the character shows the pitch on the other players' screens. When the shot arrives, its aim is shown
  the same way, so the character faces where the shot really went.
- `PROTOCOL_VERSION` is now 7: a client that sends `aim` to an older server would be disconnected for a message type
  it has no handler for.

*Test: integration tests check that the shooter's aim reaches everyone else with the turn and seat added and nothing
else of it, and not the shooter; that aims from another player, for another turn, with bad numbers or after the shot is
in go nowhere and get nobody thrown out; that the same seeded match plays exactly the same shot, and ends in the same
state, whether the shooter swung their aim around 20 times first or not; and that a client sending ten aims a second
stays while one sending more than 30 messages in a second is dropped. The whole-game tests lift the limit, since their
bot plays dozens of turns a second. In headless Edge (Ann on a computer, Ben on a phone-sized screen, over the Wi-Fi
address): Ann picks the shotgun instead of the recommended bazooka and Ben sees it in her hands; she turns with the
arrow key and Ben's screen turns with her as she does, never more than a quarter radian behind, ending on her aim, with
her character facing it and his camera looking along it; she sends 10–14 frames in 1.5 seconds of turning and 2–3 in 3
seconds of holding still; she raises her aim and her weapon tilts up on Ben's screen but not on hers; Ben reloads and
has her aim and weapon again within a second; her shot plays on Ben's screen along the aim she fired at and her ball
ends where the server put it. With Ben's aims blocked on his turn, Ann sees him unchanged, and his shot still plays with
his real aim and weapon and ends where the server put it. A one-screen turn shows no tilt.*

Follow-up, with step 13: on a spectator's screen, figures within 4 m of the camera are hidden (`hideNearCamera` in
`src/render/characters.js`, see Live aim above). *Test: in headless Edge (Ann, Ben and Cy online), on Ben's screen
while Ann has her turn, Cy stood 1 m in front of his camera, or 2.5 m ahead and 1.5 m aside, is hidden; 7 m in front
he is drawn, and so is Ann; on Ann's own screen, aiming in first person, Cy 3 m in front of her is drawn; when she fires,
Cy 1 m in front of Ben's camera is still hidden while the shot flies.*

### Phase D: deploy (in progress)

**13. Game server on Railway** · built and tested locally; the deploy is done by hand
- **Image:** `Dockerfile` at the root, which Railway finds and builds by itself: `node:24-alpine`, only the server
  workspace's production dependencies (`npm ci --omit=dev --workspace=server`: no Three.js or Vite; the browser SDK
  comes along, as the browser needs it too), then `src/core/` and `server/src/`. It runs as the `node` user and starts
  `node` itself rather than npm, so the stop signal reaches the server, which closes its rooms and exits. A
  `.dockerignore` lets in only those files.
- **Environment:** the image sets `NODE_ENV=production` and `CLIENT_IP_HEADER=X-Real-IP`. Railway sets `PORT`, which
  the server listens on. `CLIENT_ORIGINS` is a Railway variable, set in step 14 when the Vercel address is known.
- **Client IP:** Railway's docs name `X-Real-IP` as the header for the client's address, and Railway staff say (June
  2026) that the edge replaces both `X-Real-IP` and `X-Forwarded-For` on every request, whatever the client sent.
  That is a forum answer, not a documented promise, so `server/scripts/check-deploy.js --room-limit` tries it against
  the live server. Requests over Railway's private network skip the edge, but this project has no other services.
- **One instance:** Railway runs one replica per region unless told to run more. The service has one region, 1
  replica and Serverless off (a sleeping server would answer the first request after a pause with an error). Railway
  keeps one deployment per service: on a deploy, the old server runs on until the new one answers `/health`, then
  traffic moves to the new one and the old one is stopped, ending its games. `check-deploy.js` asks `/health` twelve
  times and fails if more than one process answers.
- **Deploys only for server changes:** watch paths limit Railway's automatic deploys to the files in the image, so a
  change to the browser game does not end games in progress.
- **Railway settings** (service settings in the dashboard; the labels may differ slightly):

  | Setting | Value |
  |---|---|
  | Source branch | `online` (`main` once step 14 merges it) |
  | Builder | Dockerfile (found at the root) |
  | Watch paths | `/Dockerfile`, `/.dockerignore`, `/package.json`, `/package-lock.json`, `/server/package.json`, `/server/src/**`, `/src/core/**` |
  | Region and replicas | EU West (Amsterdam), 1 replica; no other region |
  | Serverless | off |
  | Healthcheck path | `/health` |
  | Restart policy | On failure |
  | Public networking | Generate Domain; Railway picks the port the server listens on |
  | Variables | `CLIENT_ORIGINS`: none until step 14 |

- **Server:** `GET /health` and the CORS rule (see Network and security). Colyseus's own `/__healthcheck` only says
  "OK".
- **`server/scripts/check-deploy.js <address> [--origin <page>] [--room-limit]`** checks a deployed server from this
  computer: the health check, one process, that a page elsewhere may not use it but localhost and each `--origin` may,
  and that two players can start a game and both get the shot the server decided. With `--room-limit` it then creates
  rooms with a different forged `X-Forwarded-For` and `X-Real-IP` each time until it is turned down, and fails if
  that takes more than `CREATE_LIMIT` + 1 tries. That uses up the limit, so nobody on this network can create a room
  on that server for ten minutes.

*Test, done: integration tests check that `/health` names the process and counts rooms and players, and that in
production a preflight from the pages in `CLIENT_ORIGINS`, localhost and 127.0.0.1 is allowed while one from another
site, the same site on `http://`, a look-alike domain or the origin `null` is not, and that in development a Wi-Fi
address is allowed. The image, built with Docker Desktop and run with `PORT=8080`, passes `check-deploy.js` (health,
one process, CORS, a shot by two players) and stops in 0.7 s with exit code 0 on `docker stop`. Without an edge in
front, its `--room-limit` check fails as it should: 11 rooms with forged headers. Ten four-player bot games for two
minutes: memory 45 → 52 MiB, CPU at most 1.4% of one core, 6 MB sent. To do by hand, after the deploy:
`check-deploy.js` passes against the Railway address, with `--room-limit` last; a local client
(`VITE_SERVER_URL=https://<address> npm run dev`) plays a game in two windows; and after the room-limit check, a phone
on mobile data can still create a room, so the server sees players' real addresses, not the edge's.*

**14. Frontend on Vercel**
- Set `VITE_SERVER_URL` to the Railway address (`https://…up.railway.app`). Invite links then use the Vercel address.
- On Railway, set `CLIENT_ORIGINS` to the Vercel address (e.g. `https://birdieblasters.vercel.app`, no slash at the
  end), and run `check-deploy.js` with `--origin` set to it.
- HTTPS makes the clipboard and the phone share sheet available for invites.
- After the merge, switch Railway's source branch to `main`.

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
- Rooms live in one server process: a deploy or crash ends games in progress. Before pushing a server change, `/health`
  shows whether any rooms are open.
- Railway does not promise how long a WebSocket stays open; its edge may close one now and then. The SDK then
  reconnects by itself, and the seat is held for 60 seconds.
- On plain `http://` (the Wi-Fi address during development) browsers allow neither the clipboard nor the share sheet;
  the lobby then shows the invite link to copy by hand.
- Phones may pause a page in the background, so there the turn alert may only sound once the page is opened again.
- A player whose connection drops just as the host starts, before their screen has seen the game begin, has kept no
  token and cannot come back; their seat runs out after 60 seconds.
- A server notices a connection that dies without a goodbye (a phone in airplane mode) only by its ping timeout, after
  a few seconds; until then the turn of that player goes on.

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
  the module as `…?t=…`, and a plain import makes a second, unused copy. Once, a test started seconds after an edit
  still got a stale copy; if a hook reads nothing, run the test again.
- A PC going to standby in the middle of a browser test fails it; rerun it on a fresh headless Edge.
- A browser test can run the game server in its own process: import `server/src/app.js` and `listen` from
  `@colyseus/tools` on port 2567. It can then reach a room with `matchMaker.getLocalRoomById(code)`, time it and
  fast-forward its match.
- Network drops in browser tests: CDP `Network.emulateNetworkConditions` with `offline: true` fires the page's
  `offline` event, and the SDK closes its socket at once; the server notices at once if the close frame gets out, and
  otherwise by its ping timeout (about 6 seconds).
- Since the shot clock, a turn passes after 30 seconds, also in browser tests. Software rendering is slow, so tests must
  not assume the game stays on one turn while they wait (the step 7 and 8 tests check against whatever turn it is).
- On Windows, stop a server or browser started for a test with `taskkill /PID <pid> /T /F`. `/T` ends its child
  processes too: npm runs the server as a child that otherwise keeps the port, and Edge runs many.
- The server image locally: Docker Desktop is installed but not running; start it, then `docker build -t birdie-server .`
  and `docker run -p 2567:8080 -e PORT=8080 birdie-server`, and stop it again with `docker desktop stop`. Without
  Railway's edge in front, the image believes any `X-Real-IP`, so a load test can give each game its own address to
  stay under the room limit.
