# STREET ROD '86 — project notes for Claude

Browser 3D driving game homaging the C64/DOS classic *Street Rod*. Chase-cam
racing against AI for cash wagers, with pink-slip boss races (win their
next-tier car / lose yours). Verified working in Chrome (July 2026).

## Running it

No build step, no dependencies to install. ES modules require HTTP:

```sh
python3 -m http.server 8000    # from repo root, then open localhost:8000
```

Three.js 0.160 is vendored at `lib/three.module.js` and mapped via an
importmap in `index.html` (`import * as THREE from "three"`). Keep it that
way — the game must stay fully offline/self-contained: **no CDN scripts, no
downloaded 3D models, no audio files**. Cars are procedural meshes, engine
sound is synthesized live with the Web Audio API.

## Architecture (~1,900 lines, plain ES modules)

- `index.html` — all CSS + DOM for HUD/menus (retro amber/pink terminal look),
  importmap, loads `src/main.js`.
- `src/main.js` — state machine (`TITLE → GARAGE ⇄ OPPONENTS → RACE →
  RESULTS`), renderer, chase camera, race loop, economy, localStorage save
  (`SAVE_KEY` in data.js). States are objects with `enter/exit/onKey`;
  per-frame work goes through the module-level `sceneTick` callback.
- `src/data.js` — all balance data: `CAR_TIERS` (7-car pink-slip ladder,
  Model A → Hemi 'Cuda, each with a `susp` base softness), `PARTS`
  (6 categories × 3 buyable levels), racer names/flavor, `BOSSES` ladder.
- `src/carmesh.js` — procedural car builder; three era styles (`prewar`,
  `fifties`, `muscle`) from boxes/cylinders + a `wedge()` prism helper.
  Returns a Group facing +Z with `userData.wheels` for spin/steer and
  `userData.body`, the sprung-body sub-group that suspension roll/pitch
  rotates while the wheels stay planted on the road. Prewar cars (Model A
  + Deuce share `buildPrewar`) are fenderless hot rods with an exposed
  solid rear axle (Jason's call, 2026-07-10): unsprung parts like that
  axle go on the **root** group, not the body, so they stay level with
  the wheels. The prewar trunk is deliberately raised (bottom y≈0.58) —
  lower it and it swallows the axle, which sits at wheel-center height.
- `src/track.js` — seeded random-walk centerline (`mulberry32`), road ribbon
  mesh, instanced dashes/trees, palettes (noon/dusk/desert/night). Also the
  math API used by physics/AI: `sample(d)`, `curvatureAt(d)`, `project(pos,
  hint)`.
- `src/physics.js` — `CarSim`: scalar speed + heading, traction-limited
  launch, drag-limited top speed, grip-capped steering with speed scrub,
  automatic gearbox (RPM drives the audio), sprung-body roll/pitch (see
  suspension notes below). `effectiveStats(tier, parts)` merges base car +
  part multipliers; its `cornerGrip` (roll-adjusted) feeds the AI planner
  and the garage GRIP stat.
- `src/ai.js` — pure-pursuit steering to a lookahead point, corner-speed
  planning from curvature, skill-scaled reaction delay, light rubber band.
- `src/audio.js` — `EngineVoice`: firing frequency = rpm/60 × cyl/2 into a
  saw stack + sub square, throttle-keyed exhaust noise, lowpass opened by RPM
  and exhaust upgrades, turbo/supercharger whine. Requires a user gesture
  first (title screen Enter calls `audioContext()`).

## Design intent (from Jason — keep these)

- Physics stay **relaxing/forgiving**: no hard walls, no spinouts, off-road
  slows but doesn't punish, losing AI gets a mild rubber band.
- Upgrades must be **audible**, not just faster (that's why audio is synth).
- Bosses are **pink** (pink card, pink-painted car) and pink-slip only.
- A broke player must never soft-lock — `makeRoster()` injects a $0 "pride
  run" opponent when cash < $25.
- Balance target: stock car beats 1–2★ racers, upgrades needed for 4–5★,
  near-maxed car beats the boss. Street racers run near-stock (`aiParts()`),
  bosses get built machines.
- Camera drama comes from **acceleration, not speed**: framing follows the
  smoothed `race.camSpeed`, and a small accel-driven FOV kick (+6°/−3° max)
  handles launches/braking. Keep zooms subtle — Jason gets seasick from big
  FOV swings. Steady-speed widening is capped at +9°. Chase distance is
  deliberately tight (Jason, 2026-07-10): `4.3 + camSpeed * 0.013` — ~5 m
  behind at speed, height scaled to keep the same look-down angle. Don't
  pull it back out; any closer needs the lookAt point pulled in too.
- Suspension (added 2026-07-10): the body is a spring-damper chasing chassis
  acceleration — soft springs lean ~7–8° with underdamped slosh (deliberately
  cartoonish), Full Race Suspension sits ~1° flat. Roll costs grip (load
  transfer), which is the "per-tire grip" aggregated: soft = penalty, never
  a stock-grip bonus, capped so it stays forgiving. Roll lags the steering,
  so S-curve flicks in a wallowy car cost extra grip — that's intended.
  Only the body leans (`userData.body`); wheels and camera stay level.
  Knobs, all in `physics.js`: `ROLL_MAX` / `PITCH_MAX` (lean size),
  `wn`/`zeta` in `CarSim.step` (wobble speed / bounciness, both scale with
  softness), `ROLL_GRIP_LOSS` + `ROLL_GRIP_LOSS_CAP` (15% max penalty).
  Softness = tier `susp` (era-scaled, old iron wallows more) × part level
  `softness` in `data.js`. Keep `suspensionGripFactor` in sync with the
  in-step loss so the AI planner and garage stat match what the sim does.
- AI plays on a virtual keyboard (Jason's call, 2026-07-10): `AIDriver`
  quantizes its pure-pursuit intent into on/off key states so passing racers
  weave and correct like a human. Steer is closed-loop tapping — press
  toward the want, release past it — through the same dt*9 ramp as the
  player's keys; pedals are duty-cycle taps. Two load-bearing details:
  releases are instant (only re-presses are dwell-gated — gating releases
  makes the wheels flick ~0.5 steer on every straight-line correction), and
  corners release lazily at `steerWant * 1.2` (release exactly at the want
  and the tap-band sags under it — sim showed the boss running wide,
  4.2s/race offroad vs 0.9 analog baseline; lazy release restores 1.1s).
  Knobs in `ai.js`: `tapPeriod`/`pedalPeriod` (skill-scaled tap cadence),
  the 0.85 hold-solid and 0.05 re-press thresholds. The AI's front-wheel
  visuals follow `race.aiSteer` in main.js — don't hardcode them straight.
- Feel changes (steering, physics, camera) get committed only after Jason
  playtests in his browser and confirms.

## Testing

Headless smoke test pattern that works on this machine: playwright-core
(npm-install it in the scratchpad, not here) driving the cached chromium at
`~/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell`
with args `--use-gl=swiftshader --enable-unsafe-swiftshader`. Serve the repo,
send key events, assert on HUD/menu DOM, screenshot and read the PNGs to
check visuals. `page.on("pageerror")` must stay empty. Quick syntax check:
`npx esbuild --bundle src/main.js --outfile=/dev/null --format=esm
--alias:three=./lib/three.module.js`.

For car-mesh visual checks, don't squint at dark garage screenshots: load
the game page in headless chromium, then `page.evaluate` a dynamic
`import("./src/carmesh.js")` (the importmap is already live), build the car
into a fresh scene on a gray background with your own camera/lights, and
screenshot that. Dead-rear + broadside + rear-3/4 views catch geometry
that's technically present but visually hidden. The garage turntable spins
at 0.35 rad/s (~18 s/rev) if you do need in-game angles.

For physics/balance questions, skip the browser: bundle a Node script that
imports `physics.js` (and `Track` if needed) with the same esbuild
`--alias:three` trick, then step `CarSim` directly. A stub track
(`{ length, sample, project }`) works for straight-line tests; a real
`new Track(len, seed)` plus a crude centerline chaser works for full runs.
Compare tunings by `git stash` / re-bundle / `git stash pop` (use
`git -C <repo>` — the bundles run from the scratchpad). This caught the
cornering-scrub and finish-teleport numbers precisely.

## Gotchas

- `track.project()` clamps to the last centerline segment, so anything past
  the finish line reads its forward overshoot as *lateral* offset — that's
  why `CarSim.step` skips track relation once `this.finished` (finished cars
  coast straight). Don't reintroduce projection for finished cars; it made
  the soft boundary teleport-snap them (~43 m/frame) after the line.
- Player steering is smoothed in `raceTick` (`race.steer` ramps ~0.25 s to
  full lock) because digital keys at full lock always exceed grip; the
  smoothed value also drives the front-wheel visuals. Over-grip speed scrub
  in physics is deliberately gentle (10%/s cap).
- Wheel groups get both accumulated spin (`rotation.x += …`) and steer yaw
  (`rotation.y =`) on the same Euler, so `addWheels()` sets
  `rotation.order = "YXZ"` (yaw wraps spin). Don't remove it — the default
  XYZ order tumbles the yawed wheel with the spin angle and steered fronts
  wobble once per revolution (fixed `8b22178`).

- `/home/cromulon` briefly had a stray commit-less `.git` (deleted
  2026-07-10). If `git add -A` ever stages home-dir files again, stop —
  wrong repo root.
- Commit messages: repo history starts at `2e79ae4`; branch is `main`.
- A dev server from an earlier session may still be running on port 8471.
