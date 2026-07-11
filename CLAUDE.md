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

- `index.html` — all CSS + DOM for HUD/menus (monochrome technical-catalog
  theme, mcmaster.com inverted: black paper, white ink, gray hairline rules,
  Helvetica, no glows/shadows; pink stays reserved for boss/pink-slip
  markers. HUD elements each carry a translucent black plate + hairline
  border for contrast over the 3D scene), importmap, loads `src/main.js`.
- `src/main.js` — state machine (`TITLE → GARAGE ⇄ OPPONENTS → RACE →
  RESULTS`), renderer, chase camera, race loop, economy, localStorage save
  (`SAVE_KEY` in data.js). States are objects with `enter/exit/onKey`;
  per-frame work goes through the module-level `sceneTick` callback.
  Opponent cards show a portrait of the racer's car (`carPortrait`): a
  second small offscreen WebGLRenderer, data-URLs cached per tier+color.
- `src/data.js` — all balance data: `CAR_TIERS` (7-car pink-slip ladder,
  Model A → Hemi 'Cuda, each with a `susp` base softness), `PARTS`
  (6 categories × 3 buyable levels), racer names/flavor, `RACER_COLORS`
  (period paints shuffled per roster in `makeRoster` so no two opponents
  match — the race AI mesh wears the same `opp.carColor` as the card;
  bosses stay pink, so no pinks in the list), `BOSSES` ladder.
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
  hint)`. `sample` also returns `elev`/`grade` — hills prep (2026-07-11),
  always 0 until a track sets point `y`s. Elevation is deliberately a
  function of centerline distance only (ribbon world: nearby off-road
  shares the road height) so `project`/`curvatureAt` stay plan-view math
  forever. `CarSim` rides the surface (`y`/`grade`/`groundPitch`, no
  vertical velocity — no jumps by design), race-mesh roots take ground
  pitch (their `rotation.order` is `"YXZ"` for the same reason as wheels),
  and the camera height rides `race.camY`, a slow-smoothed copy of car y.
  The flat ground plane is the one visual that can't take y from
  `sample()` — it needs a skirt following the ribbon when hills land.
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
- AI launch (Jason's call, 2026-07-10, `a61b180`): the AI holds full
  throttle from the green — the skill-scaled `reaction` delay in `ai.js`
  gates only the steering/corner-planning brain, never the launch (it used
  to return throttle 0, which audibly dropped the engine to idle right at
  GO). During the countdown the AI stabs random rev blips (`race.aiRev` /
  `race.aiRevT` state machine in main.js: 0.15–0.4s on, 0.15–0.65s off,
  fast rpm attack + slow fall-off is what reads "angry"), then pins full
  rev for the last 1.2s into the launch. Balance note: launches no longer
  stagger by skill — if 1–2★ racers ever feel too strong off the line,
  reintroduce a small stagger via partial (not zero) pre-reaction throttle.
- Getting loose (Jason playtested + approved 2026-07-10): past the grip
  limit the path still bends at the grip cap, but the nose keeps 60% of the
  excess yaw, opening a slip angle — a slide instead of hard understeer.
  Slip is capped (`SLIP_MAX`, now 0.55 rad) and self-recovering
  (`SLIP_RECOVER` bites it back in ~0.3 s; the bite bends the path — the
  drift-exit hook), so there are no spinouts. Position integrates along
  `heading - slip`, and the chase camera follows that velocity direction so
  the drift angle shows in frame. `screech` is a smoothed 0..1 slide signal
  (launch wheelspin chirps count; offroad mutes it ×0.15 — dirt doesn't
  squeal). `SkidSound` is two-stage: thin ~2 kHz warbling chirp at slide
  onset, pitch sinking + a 620 Hz scrub layer past 0.4 intensity.
- Power drifting via friction circle (Jason playtested + approved
  2026-07-11, "drift fest"): drive force and cornering share one tire
  budget — `powerLoad` shrinks the lateral share (`latShare`, floored at
  `POWER_GRIP_FLOOR` 0.40), so throttle mid-corner opens the slip model and
  the car power-slides; weak cars can't load the circle at corner speed and
  stay hooked (crap tires + big motor = maximum drift, and that emergent
  ladder is the point — no per-car drift tuning). The throttle also holds
  off 92% of slip recovery (`SLIP_THROTTLE_HOLD`) — foot down sustains the
  drift, lifting snaps it straight — and hanging sideways bleeds speed
  (`SLIP_SCRUB`, capped 20%/s), which is the "consequence" in place of
  spinouts (still none — Jason's rule stands; literal spinouts were offered
  2026-07-11 and left open, not declined). Braking is exempt from the
  circle: trail-braking always grips. Full-squeal intensity is
  `SLIP_SQUEAL` (0.30 rad), not `SLIP_MAX`. The AI got matching
  friction-circle awareness in `ai.js`: it budgets corner-throttle duty by
  `(0.95 - realLoad) / (1 - shareOn)` — realLoad measured against the
  car's *physical* `cornerGrip` (not the skill-discounted planning grip,
  which made street racers lift inside genuine margin and cost them ~2
  s/race), shareOn floored at the imported `POWER_GRIP_FLOOR`, and the
  0.95 is anticipation the ~2%-margin boss needs. 16-seed sim: tier-6 boss
  offroad 3.14→2.71 s/race (improved again — lift-and-coast tightens its
  line), boss ~2 s slower overall (acceptable, watch it), street racers
  bit-identical pace, AI slip peaks ≤0.03 rad (opponents never drift by
  accident).
- `SkidSound` gains are deliberately ≫1 (0.35+2.0x sing, 0.8 scrub): its
  Q=8 bandpass keeps ~1% of the noise power, so unity-ish gain sits ~30 dB
  under the engine voice. The original 0.015–0.11 gains shipped physically
  playing but inaudible — Jason had never heard the squeal (fixed
  2026-07-11, verified with AnalyserNode RMS ≈ engine level mid-drift).
  Lesson, same family as the banner-mirror one: sim numbers and screenshots
  can't hear — audio changes need Jason's ears (or at least an RMS check).
- Car contact (Jason playtested + approved 2026-07-11, "push on the other
  car in realistic ways"): each car is two circles (nose/tail,
  `CONTACT_END`/`CONTACT_R` in physics.js), and the reaction depends on the
  event, not just geometry. Leaning/rubbing = eased position pushes only
  (`CONTACT_RELAX`), silent and smooth. A *hit* — contact onset above
  `CONTACT_TAP` closing speed, or `CONTACT_SLAM` mid-contact, both gated by
  a 0.5 s per-pair cooldown — kicks heading+slip together (travel direction
  unchanged; `SLIP_RECOVER` plays the recovery like a drift exit, so a
  rear-quarter tap fishtails catchably), sheds speed by `CONTACT_SCRUB`,
  and clunks (`sfx.clunk`, rate-limited in raceTick). Kicks are
  depth-weighted torque across all touching circle pairs so door-to-door
  torques cancel — side pressure shoves, only a lone corner clip yaws.
  Three stutter bugs were fixed in one session (deepest-pair flip-flop,
  per-frame micro-kicks, slam-threshold feedback loop pinning impact at
  exactly 5.00) — measure with the rub harness (4 s steer-into-contact,
  count lateral sign flips + hit events) before touching this code.
  KNOWN ISSUE (Jason, 2026-07-11): occasional stutter while rubbing
  remains. Prime suspect: the instant per-hit speed cut (`punch *
  CONTACT_SCRUB`, up to ~25% in one frame) — the camera's accel-driven FOV
  kick reacts to that speed step, which may read as a hitch even though
  positions are smooth. Untested hypothesis. `_contact`/`_hitCool` are
  pair state on the first car — fine for 2 cars, needs a pair key for 3+.
- Gearboxes are all automatics — the sim auto-shifts, so part names must
  not say "Manual" (Jason's call, 2026-07-10). Gear count is
  `max(tier.gears + closeRatioBonus, level.minGears)` in `effectiveStats`;
  the level-1 box's `minGears: 4` is what makes it a real 4-speed on the
  3-gear tiers.
- Feel changes (steering, physics, camera) get committed only after Jason
  playtests in his browser and confirms.

## Testing

Headless smoke test pattern that works on this machine: playwright-core
(npm-install it in the scratchpad, not here) driving the cached chromium at
`~/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell`
with args `--use-gl=swiftshader --enable-unsafe-swiftshader`. Serve the repo,
send key events, assert on HUD/menu DOM, screenshot and read the PNGs to
check visuals. `page.on("pageerror")` must stay empty. `window.__race` is a
live debug handle on the race state (`__race.player.speed/slip/screech`…);
menu path is Enter (title) → Space (garage) → Enter (opponent card). Quick syntax check:
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
When A/B-comparing `AIDriver` tunings, stub `Math.random` with a seeded LCG
first — `wobblePhase` makes runs non-deterministic otherwise. Useful
metrics: offroad s/race, worst |lateral|, taps/s, straight-line steer RMS
(sample where `curvatureAt < 2e-4`). 6 seeds is too noisy to trust offroad
deltas; 16 showed a real 4.2s-vs-0.9s regression that 6 hid.
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
  in physics is deliberately gentle (10%/s cap); the separate slip-angle
  scrub (`SLIP_SCRUB`) stacks on top when sideways.
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
