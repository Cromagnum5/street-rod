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
  `buildCar(tier, { color, parts })` — `parts` are the owner's part levels, and
  three of them are *visible* (see the visual-upgrade entry in Design intent):
  `addInduction` bolts hardware through the hood, `addExhaust` grows the pipes,
  `TIRE_VIZ` widens the tires. Every caller (garage, race, portraits) passes the
  real build, so the AI's car wears its own upgrades.
  Returns a Group facing +Z with `userData.wheels` for spin/steer and
  `userData.body`, the sprung-body sub-group that suspension roll/pitch
  rotates while the wheels stay planted on the road. Prewar cars (Model A
  + Deuce share `buildPrewar`) are fenderless hot rods with an exposed
  solid rear axle (Jason's call, 2026-07-10): unsprung parts like that
  axle go on the **root** group, not the body, so they stay level with
  the wheels. The prewar trunk is deliberately raised (bottom y≈0.58) —
  lower it and it swallows the axle, which sits at wheel-center height.
  A gap-hunting pass landed 2026-07-12 (Jason: "weird gaps in the car"),
  and the bugs it found are all the same shape — **a box or wedge whose
  neighbour ran out from under it**, so mind these when moving anything:
  every era's cabin is now paint + glass, not a solid paint brick, and each
  greenhouse needs a belt slab under it that spans the *whole* cabin (the
  muscle car's stopped short, so the windshield foot, the fastback and the
  spoiler all hung over open air, and its cabin had no sides at all — you
  could see straight through the car broadside). Two rules that keep
  recurring: **a part must stand proud of the surface it sits on or that
  surface eats it** (the muscle headlights were behind the grille's front
  face; the prewar headlight bar was chrome-on-chrome inside the radiator
  shell), and **the roof must overhang its windshield's top edge** — stop it
  short and the wedge's vertical back face pokes out ahead of it, which
  reads as a redundant second pane of glass with a slot in front of the roof
  (Jason caught this on the 'Cuda; an angled pane never needs a vertical one
  behind it). Also: `wedge()`'s `flip` puts the tall face at −z, so a
  tailfin wants `flip=false` — the Bel Air's fins were built backwards
  (tall at the cabin, tapering to nothing at the tail) with their lamps
  floating in open air 0.07 m *behind* the body. Fins are now low accent
  trim, not wings, and all fifties brake lights live on the tail panel
  (Jason's call). Cross-check a mesh edit with dead-side + rear-3/4 + a
  *low* front-3/4 — the low angle is what exposes floating parts.
- `src/track.js` — seeded random-walk centerline (`mulberry32`), road ribbon
  mesh, instanced dashes/trees, palettes (noon/dusk/desert/night). Also the
  math API used by physics/AI: `sample(d)`, `curvatureAt(d)`, `project(pos,
  hint)`. `sample` also returns `elev`/`grade` — gentle rolling hills landed
  2026-07-11: a slope random walk with a soft spring toward mid-height
  (underdamped, ~500 m wavelength), elevation confined to [0, 6 m] so the
  flat ground plane never shows above the road, grades ≲4%, a smoothstep
  envelope pinning the launch zone and finish approach to y = 0 (launch
  balance stays flat-road; finished cars coast level), and 3 smoothing
  passes so per-segment grade never steps visibly in `groundPitch`.
  Elevation is deliberately a function of centerline distance only (ribbon
  world: nearby off-road shares the road height) so `project`/`curvatureAt`
  stay plan-view math forever. Corollary (fixed 2026-07-11 after Jason hit
  it): the walk must never loop back near itself, or the two passes sit at
  different heights and the lower road runs through the upper hillside —
  the constructor rerolls the walk on derived sub-seeds until all far-apart
  sample pairs (visual run-up/run-off included) keep `SELF_CLEAR` 210 m
  plan distance (each pass's skirt reaches ±100 m). ~55% of raw seeds pass,
  so it converges in ~2 tries (worst measured 21 ms, once at race start);
  already-clean seeds reproduce unchanged (attempt 0 = the original
  stream). Pre-fix, 39% of seeds had the road *crossing itself* — flat,
  that camouflaged as an X-intersection; hills exposed it. `CarSim` rides
  the surface
  (`y`/`grade`/`groundPitch`, no vertical velocity — no jumps by design),
  race-mesh roots take ground pitch (their `rotation.order` is `"YXZ"` for
  the same reason as wheels), the camera height rides `race.camY`, a
  slow-smoothed copy of car y, and dash/edge-line instances pitch with
  `grade` so they lie on the slope. The ground is a terrain skirt riding
  the ribbon (flat at road height to ±62 m, past the tree band, then
  falling to y=−1.2 by ±100 m to dip under the 9000 m plane — same
  material, so the seam is invisible). Two skirt constraints: the outer
  edge must stay inside the tightest curve radius (~1/0.009 m) or the band
  folds over itself, and the strips leave the ±7 m lane to the road
  ribbon — a strip spanning it chords the elevation in 124 m triangles
  and surfaces above the asphalt on graded curves. The visible road also
  runs 400 m before the start and 900 m past the finish (straight and
  flat, `buildMeshes` only — physics/AI still see [0, length]; the
  run-off is long because raceTick keeps coasting the cars behind the
  results overlay at brake 0.3). Mountains reroll placement (≤12 tries)
  if their footprint touches the extended road corridor — straighter
  seeds put the run-off out among the cones.
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
  near-maxed car beats the boss. Street racer builds scale with stars
  (`aiParts()` in main.js, reworked 2026-07-11 after Jason found a 4★ easily
  beatable stock): since flat-out straights landed, driver skill is worth
  <1 s/race in the sim — **parts are the real difficulty lever**. Street
  level = `max(0, round(skill*5) − 2) + (playerTier − opp.carTier)`:
  1–2★ stock-pace, 3★ bolt-ons, 4★ a built car, and one tier of lesser
  iron buys one extra level (in this data one tier ≈ one part level almost
  exactly — Model A L2 70.3 s vs Deuce L1 69.7 s, 16-seed sim). The tier
  bump is a **baseline, not a bonus** (Jason's tweak, 2026-07-11): the
  stars term floors at 0 and the per-part −1 jitter floors at the deficit,
  so even a 1★ in a Model A at Deuce level runs Deuce-stock pace (79.8 s
  vs 78.0 ref) instead of a free win (~89 s stock). Exception:
  Free-Ride Freddy carries `freebie: true` and skips the deficit baseline —
  the mercy run stays a stock lesser car so broke never means stuck. The
  tier term can't strip below stock, so `makeRoster` reserves the +1-tier
  car draw for skill ≥ 0.55 (a 2★ in a better car would outrun its label).
  `opp.partBoost` (chance = skill, previously assigned but never read)
  bumps one random "pride part" a level. Bosses keep their own formula.
  16-seed ladder at player tier 1 (stock proxy ref 78.0 s): 1★ 78.3 same
  tier / 79.8 −1 tier, 2★ 77.9 / 79.5, 3★ 72.7 / 73.7, 4★ 64.6 / 65.2
  (Jason's Model A case, was ~85+), +1-tier 4★ 68.1, boss 58.6. Upgraded
  opponents also *sound* built for free (`soundSpec` gets the same parts).
- Crown era — after THE KING (Jason's call, 2026-07-12). `crown` = player
  carTier 6, the only way to own the 'Cuda, and there's no boss left to
  race. Endgame rosters are their own mode in `makeRoster`/`aiParts`:
  skill draws 0.5–1.0 (3–5★ only), builds run `1 + round(skill*2)` part
  levels with a **floor of 1** (nobody brings a stock car to race the
  champ; the −1 jitter and `partBoost` decide who shows up actually maxed),
  and wagers jump to `(300 + skill*800 + carTier*60)` — $1,025–$1,400 vs the
  old $450–$620, so two wins ≈ one top-shelf part. Same lesser-iron rule
  as the street ladder: a −1-tier Charger buys one extra part level.
  16-seed sim at the tier-6 race length (skill-1.0 AI as the player proxy,
  maxed 'Cuda 61.6 s): crown 3★ 68.3, 4★ 62.4, 5★ maxed 61.9, 5★ maxed
  Charger 64.2 — a maxed 'Cuda still wins every one, but the 4–5★ races are
  ~1 s knife fights instead of the 21 s walkover the old stars−2 formula
  gave (1★ stock 'Cuda was 82.5 s). A player who *stops* upgrading (level-2
  parts, 66.8 s) now loses to the 4–5★ challengers — the crown's money sink
  is the point. The mercy freebie is exempt (no `crown` flag on Freddy).
- Upgrades you can **see** (Jason's call, 2026-07-12: "reward the player for
  upgrading parts on each model"). Four of the six parts show on the car; the
  other two honestly don't:
  **induction** — stock is a flat hood (this *took away* the muscle cars' free
  hood scoop; you earn it now), then a cut with velocity stacks, then a
  body-colored half-round turbo bulge sunk to its axle in the hood, then the
  blower: case through the hood, butterfly scoop overhanging the drive pulley.
  **exhaust** — a tucked stub you can barely see, then one pipe, then duals,
  then open headers with zoomie stubs; hot rods run theirs down the flank at
  every level, the later eras exit under the rear valance until open headers
  move them to the rockers. **tires** — skinny whitewall pizza cutters to fat
  blackwall slicks with a big mag face, rears growing faster than fronts for
  drag stagger (width only; radius is what the body sits on and what
  `userData.wheelR` spins). **suspension** — stance: `applyStance` drops the
  sprung body onto the wheels and adds nose-down rake, per-level, era-scaled by
  `spec.stance`. Stance rake folds into `userData.bodyRake` (raceTick overwrites
  `body.rotation.x` every frame with `bodyRake + sim.pitch`, so it has to live
  there, not on the mesh); the drop rides `body.position.y`, which nothing
  per-frame touches. **engine and gearbox change nothing** — a motor under a
  hood and a box inside the car have nowhere to show, and faking it would be
  noise. Keep that honesty; the audio already carries engine.
  Prewar stance is the constrained one and the constraint is instructive: the
  diff ball (unsprung, on the root) already sits flush under the trunk floor,
  and that flush fit is the *point* of the raised trunk, so any straight drop
  swallows the exposed axle. The way out is that nose-down rake pivots the body
  about the ground line at z=0 — the tail RISES as the nose falls, so rake buys
  headroom over the diff and the drop then spends it: keep
  `drop ≤ 1.175·rake − 0.005` (0.024 vs 0.030 at level 3). Check 4 asserts it.
  Load-bearing consequences: buying a part rebuilds the garage turntable car
  (`refreshGarageCar` in main.js) — seeing it appear the moment you pay *is* the
  feature. Opponent card portraits render the AI's real `aiParts()` build, so a
  blown 4★ shows up on his card with a blower and the pips match the photo (the
  portrait cache key had to grow from tier+color to tier+color+build). Same
  spirit as "upgraded opponents sound built": now they look it.
- Camera drama comes from **acceleration, not speed**: framing follows the
  smoothed `race.camSpeed`, and a small accel-driven FOV kick (+6°/−3° max)
  handles launches/braking. Keep zooms subtle — Jason gets seasick from big
  FOV swings. Steady-speed widening is capped at +9°. Chase distance is
  deliberately tight (Jason, 2026-07-10): `4.3 + camSpeed * 0.0065`, height
  scaled to keep the same look-down angle. Don't pull it back out; any
  closer needs the lookAt point pulled in too.
  **The real chase-distance knob is `CAM_FOLLOW`, not that formula**
  (measured 2026-07-12 after Jason said the camera was still way back at
  180 mph). `camera.position.lerp(camGoal, 1 - exp(-dt*CAM_FOLLOW))` is an
  exponential smoother chasing a target that never stops moving, so it
  settles a *speed-proportional* distance behind it: trail = speed /
  CAM_FOLLOW. At the old gain of 5 that was 0.2 s of travel — 16 m at
  180 mph, ~30x the dolly term, and it's framerate-independent (measured
  0.176–0.19 · v across 12–35 fps, i.e. the same in a real browser). The
  documented "~5 m behind at speed" was never true in motion; it was ~20 m.
  Gain is now 10, halving the drift (measured at 180 mph: 19.5 m → 11.0 m
  camera distance, car 67 → 134 px wide). Lower it and the camera falls
  back at speed; raise it and the chase goes rigid (and jitter/contact
  stutter stops being damped — see the contact-stutter notes).
  The "reaching new speeds" rush comes from the **FOV** widening, not the
  dolly (63.5° at 60 mph → 69.2° at 180 is unchanged by any of this), so
  cutting pull-back keeps the drama and keeps the car big in frame.
  Measure this with a pinned-speed harness, don't eyeball it: pin
  `player.speed` via `Object.defineProperty` on the `__race` handle (seed
  the value *before* pinning or `undefined` NaNs the integrator), let
  camSpeed settle ~3 s, then read camera-to-car distance and the car's
  projected pixel box.
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
  toward the want, hold a human-length beat, release past it — through the
  same dt*9 ramp as the player's keys; pedals are duty-cycle taps.
  Load-bearing details: presses are deliberate stabs (Jason, 2026-07-11,
  superseding the old releases-are-instant rule — he wanted visible
  player-size wheel swings, not one-frame flicks): release is gated by a
  hold that scales with the correction, `minHold * min(1, |want|/0.5)`,
  floored at **0.03 s** — the floor is load-bearing, at 0.05 every small
  trim overshot and demanded a counter-stab and the car visibly wobbled
  down straights in a limit cycle (the tap-floor cycle also turned out to
  be most of the boss's remaining wide-corner offroad). Wrong-direction
  presses still release instantly. Corners release lazily at
  `steerWant * 1.2` (release exactly at the want and the tap-band sags
  under it — sim showed the boss running wide; lazy release fixed it).
  Low-skill lane wobble is a slow drift (±0.5 m, 0.4 rad/s ≈ 16 s period) —
  faster/bigger reads as slaloming, which Jason vetoed. Knobs in `ai.js`:
  `tapPeriod`/`pedalPeriod` (skill-scaled tap cadence), `minHold`, the 0.85
  hold-solid and 0.12 re-press deadband thresholds. The AI's front-wheel
  visuals follow `race.aiSteer` in main.js — don't hardcode them straight.
- AI throttle & braking (Jason playtested + approved 2026-07-12 twice, the
  second time "AI driving much better in the turns"): **the foot is down
  everywhere, and the STEERING is what manages corner speed** — the plow scrub
  and the slip angle bleed off exactly as much as the corner needs. That is how
  the player drives (Jason: "in the Model A I keep the gas down for 100% of the
  race... I only let off the gas to brake"), so it is how the AI drives. The
  **only** thing that lifts the foot is a corner the car genuinely cannot make.
  Skill expresses in how late it brakes and how close to the limit it plans,
  never in a lifted throttle. Corner planning grip is `0.98 + 0.10 * skill` —
  note that's *at or over* the car's real limit, deliberately: a keyboard steer
  over-asks for yaw, the car plows a little, and it gets round anyway on a 14 m
  road. Planning **under** the limit is the bug that keeps coming back — it
  makes the AI arrive with grip in hand and no way to spend it. Braking is late:
  scan the full braking distance, compute the decel each corner demands
  (`(v² − vc²)/2d`), and only brake past a skill-scaled comfort threshold
  (`6.5 + 3.0*skill` m/s², brake sized `/7` not `/8` to arrive a hair under).
  Boss races are shortened to match the longest street race at the tier
  (`2700 + tier*200` in main.js) — a pink-slip race shouldn't outlast the
  money races.
  Three things have been cut from here, all the same mistake — a lift the car
  didn't need:
  1. a corner **cruise band** (55% duty once the planned corner speed was
     reached) plus a **lift-and-coast** branch. The AI arrived at every turn
     already slow: 0.53 of its own grip limit mid-corner vs 0.62 for a flat-out
     driver in the same car, who won by 3.2 s.
  2. the friction-circle budget *interpolating* toward a lift instead of
     solving the circle (see the power-drifting entry below).
  3. the **55% "ease" band** (`speed > targetSpeed + 2`), cut 2026-07-12 after
     Jason said he could *hear* the AI feathering alongside him. It was firing
     in corners the car could take flat out, and because the pedal is a
     duty-cycle tap, a partial throttle is audible. Measured: a stock Model A
     uses only **59% of its available grip** in these corners — flat out is
     simply correct there — yet the AI still braked 11% of corner time and eased
     another 6%, for a corner throttle duty of 0.95. It was lifting for nothing.
     `targetSpeed` had no other reader and went with it.
  The rubber band scales the **planning grip** (squared — speed goes as √grip),
  not a speed target. Load-bearing: with the throttle flat-out by default, a
  target-only band can only slow a *leading* AI, it can never help a trailing
  one. Don't reintroduce `targetSpeed` to hang it on.
  Net of cut 3 (16-seed sim, stock Model A, corner throttle duty / race gap to
  a flat-out human in the identical car): 1★ 0.94→**1.00** duty, 1.40→0.75 s;
  3★ 0.95→1.00, 1.13→0.46 s; 4★ 0.95→1.00, 1.01→0.36 s; 5★ 0.96→1.00,
  1.02→0.45 s. Offroad stays 0.00 s. Balance watch: the AI got ~0.6 s faster,
  so boss margins tightened ~1.5 s — a maxed car still wins the pink-slip race
  by 4.5–12.6 s across the ladder, but if the boss ever becomes unbeatable the
  planning-grip line above is the first knob.
- **Lifting is never worth it in this game — the brake pedal is a trap.** Not a
  bug to fix, but know it before you tune anything: measured over 16 seeds, the
  same car driven flat-out with *no brakes at all* beats a driver who brakes
  properly at every tier — Model A 76.1 s vs 77.4, Bel Air stock 65.2 vs 73.2
  (6 s faster **and it never leaves the road**), maxed 'Cuda 48.2 vs 62.9. The
  steering scrub is a better brake than the brake, because you keep making power
  and you keep your corner exit. Two reasons it's free: race progress is
  centerline distance (`project()`), so a wide line costs nothing, and the road
  plus soft margin is 28 m of run-off. At the top of the ladder the flat-out
  line runs through the **dirt** for a quarter of the race, and the dirt is a
  cheaper brake than the brakes (6.0 m/s² of offroad drag at 80 m/s *while you
  keep the throttle*, vs 8.0 m/s² with the power cut) — which is why the AI is
  still ~8 s down in a maxed 'Cuda: it won't rally-drive, and letting it costs
  18 s/race offroad. **Known and deferred** (Jason, 2026-07-12: "we'll address
  the dirt issue at some other time"). If it's ever taken up, the lever is the
  free wide line / cheap dirt, **not** `PLOW_SCRUB` — turning that back up
  re-breaks the steering-as-brake feel he explicitly rejected (see the
  turning-must-not-act-as-a-brake gotcha).
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
  friction-circle awareness in `ai.js`, and 2026-07-12 it started **solving**
  the circle instead of interpolating toward a lift: at a lateral load of
  `realLoad` the tires still have `√(1 − realLoad²)` of drive budget, so
  that — over `instLoad`, the load a pinned pedal would ask for — is the
  throttle cap. realLoad is measured against the car's *physical*
  `cornerGrip`, never the skill-discounted planning grip (that made street
  racers lift inside genuine margin and cost them ~2 s/race); the 0.97
  divisor is a hair of anticipation; the drive room is floored at the
  imported `POWER_GRIP_FLOOR`, below which physics won't squeeze the lateral
  share anyway, so a near-stock car simply keeps its foot in it. The old
  form (`(0.95 − realLoad) / (1 − shareOn)`) was a lift dressed up as a
  budget and was half of why the AI crawled through corners.
  Consequence, and it's the intended one: **opponents now power-slide.** In
  a real race the AI runs ~0.95 corner throttle and peaks around 0.24 rad of
  slip — the old note here claimed "AI slip peaks ≤0.03 rad, opponents never
  drift by accident", and that is no longer true by design. They drift on
  purpose now, same as you do.
- `SkidSound` gains are deliberately ≫1 (0.35+2.0x sing, 0.8 scrub): its
  Q=8 bandpass keeps ~1% of the noise power, so unity-ish gain sits ~30 dB
  under the engine voice. The original 0.015–0.11 gains shipped physically
  playing but inaudible — Jason had never heard the squeal (fixed
  2026-07-11, verified with AnalyserNode RMS ≈ engine level mid-drift).
  Lesson, same family as the banner-mirror one: sim numbers and screenshots
  can't hear — audio changes need Jason's ears (or at least an RMS check).
  Then Jason heard it and found it annoying: **both layers are muted**
  (gains pinned to 0 in `update()`, 2026-07-11) — node graph and the
  `screech` intensity plumbing kept for a future retune. Don't un-mute
  without his say-so.
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
  Hits land as pending state, never instant steps (Jason confirmed smooth
  2026-07-11): `kickPending` rotates the knock in over ~0.15 s and
  `impulseDrag` bleeds the speed loss over ~0.3 s (same integrated total as
  an instant cut). Every contact speed loss (incl. rub friction) is
  reported via `contactLoss`, which raceTick adds back into the FOV-kick
  accel signal so contact never pulses the camera — instant versions of
  any of these read as stutter (FOV sawtooth + ~10°/frame mesh snap).
  Five stutter causes were fixed in one session; before touching this
  code, measure with the rub harness (4 s steer-into-contact: lateral
  sign flips, hit-event log, and a replica of the raceTick FOV pipeline
  counting FOV direction reversals — 5 reversals/4 s was the bad state,
  0 is correct). Earlier fixed causes, for pattern-matching: deepest-pair
  flip-flop jerking the push normal, per-frame micro-kicks, and the slam
  threshold acting as a feedback setpoint (impact pinned at exactly 5.00
  every frame — cooldown must gate slams too). `_contact`/`_hitCool` are
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
menu path is Enter (title) → Space (garage) → Enter (opponent card). For a
maxed test car, seed the save before reload:
`localStorage.setItem("streetrod86-save-v1", JSON.stringify({money:99999,
carTier:6,parts:{engine:3,induction:3,exhaust:3,tires:3,suspension:3,
gearbox:3},bossesBeaten:5}))` (Jason knows this trick too). Quick syntax check:
`npx esbuild --bundle src/main.js --outfile=/dev/null --format=esm
--alias:three=./lib/three.module.js`.

For car-mesh visual checks, don't squint at dark garage screenshots: load
the game page in headless chromium, then `page.evaluate` a dynamic
`import("./src/carmesh.js")` (the importmap is already live), build the car
into a fresh scene on a gray background with your own camera/lights, and
screenshot that. Dead-rear + broadside + rear-3/4 views catch geometry
that's technically present but visually hidden — add a *low* front-3/4, it's
what exposes parts floating off the body. The garage turntable spins
at 0.35 rad/s (~18 s/rev) if you do need in-game angles.

But renders are the weakest of the mesh checks — screenshots hid the whole
2026-07-12 gap crop (see the carmesh.js notes) for the life of the project.
Two Node checks, bundled with the same esbuild `--alias:three` trick, find
that class objectively and in seconds; run both before trusting a car render:
1. **Floating parts** — build each `CAR_TIERS` car, world-`Box3` every mesh,
   and flag any whose box (grown 1 mm) intersects no other. A part touching
   nothing is bolted to nothing. This is what finally caught the prewar
   running boards, which had hung in space since the first commit — 0.09
   under the body's underside and 0.035 outboard of its flank, with the
   right-hand one masked because it grazed the (also floating) exhaust pipe.
2. **Wedge winding** — the prisms are convex, so a triangle is correctly
   wound iff its normal points away from the centroid. See the winding gotcha.
3. **Pipe/tire clearance** — the inverse bug: a part quietly *intersecting* its
   neighbour, which check 1 can never flag (it only hunts parts touching
   nothing). Box3 every long chrome cylinder against every wheel and demand a
   real gap. Added 2026-07-12 after the side pipes speared the wheels on every
   fifties and muscle car — see the tire-diameter gotcha for why the hand
   arithmetic said they cleared.
4. **Stance** — lowering the sprung body drives it down onto things that do NOT
   move with it (the wheels; on prewar, the exposed axle + diff). Three limits,
   swept over tier × tire level × suspension level: ground clearance ≥ 0.10 m,
   rear-axle burial ≤ 0.02 m (it measures 0.005, the untouched stock baseline —
   if that number ever climbs, a drop is eating the hot-rod axle), and each tire
   still ≥ 0.02 m proud of the body's flank so the car never looks wheel-less.
   Two traps when writing this kind of check, both of which I hit: the **body is
   itself a root child**, so "everything on the root that isn't a wheel" measures
   the body against itself; and the prewar **front beam is meant to be buried**
   in the hood (it's 1.55 wide against a 1.05 hood, so its visible ends always
   clear) — assert on the rear group only.
All four now **sweep part levels**, not just the 7 tiers: every visible part is
a fresh chance to bolt a box to nothing or bury it in its neighbour. 224 builds
(7 cars × 4 visible categories × 4 levels, off both a stock and a maxed base)
still runs in seconds. Re-run all four after *any* mesh edit: moving one box
out from under another is exactly how these bugs get introduced.

**Never use an AI as the player proxy in a balance sim.** Every balance number
in this file predating 2026-07-12 was measured with a skill-1.0 `AIDriver`
standing in for Jason — so the whole ladder was tuned against a player who
*lifts in corners*, and Jason does not lift. That is why "the AI feathers and
I'm faster mid-corner" survived two rounds of throttle fixes: the proxy had the
same blind spot as the thing being measured, so the sim agreed with itself. The
player proxy must be a **flat-out human**: pure-pursuit steer → digital key →
the same `dt*9` ramp `raceTick` applies, `throttle = 1`, `brake = 0`, forever.
It's ~25 lines and it is the only honest yardstick. Same lesson family as the
banner-mirror one — an objective proxy that shares the defect proves nothing.

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
  smoothed value also drives the front-wheel visuals.
- **Turning must not act as a brake** (Jason, 2026-07-12: "steering can be
  used as braking, the effect is so pronounced", worst on low tiers —
  playtested + approved, "much better"). Two speed penalties bill the same
  event: the plow scrub (over-grip) and `SLIP_SCRUB` (sideways). The plow
  scrub charges by the *ratio* `excess = yawRate / velYawMax`, and that is
  the trap: a held `steer = 1` asks for `maxYaw = 2.2/(1 + v/18)`, which at
  any real speed is **3–5x more yaw than the tires can deliver**, so `excess`
  is never near 1 — it saturates the cap instantly, and the cap is a fraction
  of *speed* per second, i.e. a speed-proportional decel. At the old
  0.05/cap-0.10 that measured **37–77% of braking decel** (Model A stock
  73→43 mph over 3 s of turning) and did 3–7x the damage of the slip scrub.
  Low tiers got it worst for a structural reason: **low grip → smaller
  `velYawMax` → bigger `excess` for the same input**, so they pin the cap
  harder *and* have no power to recover. Now `PLOW_SCRUB` 0.018 / cap 0.035
  (13–28% of braking), because the real consequence for over-driving is the
  slip angle it opens and `SLIP_SCRUB` already charges for that — the plow is
  a garnish, not a second brake pedal. `SLIP_SCRUB_FREE` (0.06 rad) makes
  small slip free: that much is just what cornering looks like. Slip
  *generation* (`SLIP_YAW_KEEP`/`SLIP_MAX`/`SLIP_THROTTLE_HOLD`/the friction
  circle) is untouched — a deliberate power-drift still hangs 0.25 rad and
  still costs 67 mph vs. straight, so the drift fest and its consequence
  both survive. Don't "fix" the over-ask by lowering `maxYaw` to the grip
  limit: the over-ask *is* the drift-entry mechanic.
  Balance drift this caused (watch it): the AI drives smoothly and rarely
  over-asks, so it was never paying much of this tax — the player gains more
  than it does. Gap to a 4★ went 1.07→1.01 s (Model A stock), 2.03→2.69
  (Deuce stock), 3.43→4.61 ('Cuda built); ordering intact, nothing inverted,
  but **the boss is now slightly easier**. First knob if it's a walkover is
  the planning grip in `ai.js` (`0.90 + 0.08 * skill`).
- **A wheel's extent along the car is its DIAMETER, not its width** — obvious
  written down, and I still got it backwards (2026-07-12). Sizing the open-header
  side pipes, I checked them against the tires' *width* and computed 60 mm of
  clearance; the real number was −80 mm, and the pipes speared all four wheels on
  every fifties and muscle car at every tire level. Jason saw it on the Merc.
  The clear span between the tires is `wheelBase/2 − wheelR` at each end, and on
  muscle cars it's **asymmetric** (fat rears, r=0.42, crowd harder than the
  fronts, r=0.37), so their pipe is nudged forward to sit in the middle of it.
  This is why mesh check 3 exists: the floating-part check hunts parts touching
  *nothing* and is structurally blind to a part jammed *through* something.
- Wheel groups get both accumulated spin (`rotation.x += …`) and steer yaw
  (`rotation.y =`) on the same Euler, so `addWheels()` sets
  `rotation.order = "YXZ"` (yaw wraps spin). Don't remove it — the default
  XYZ order tumbles the yawed wheel with the spin angle and steered fronts
  wobble once per revolution (fixed `8b22178`).

- The road ribbon's triangles were wound face-down (culled, never rendered)
  from the first commit until 2026-07-11 — the "asphalt" everyone saw was
  the ground plane between the edge lines. Nobody's eyes caught it because
  the composition still read as a road; it only surfaced when hills opened
  a gap under the lane. Same lesson family as the banner-mirror one:
  perception tests need an objective proxy (here, pixel-comparing road
  center vs offroad in headless screenshots — they were byte-identical).
  **`wedge()` in carmesh.js had the identical bug**, also since the first
  commit, found 2026-07-12 when Jason said the 'Cuda's windshield "only
  shows up when viewed from the side looking forward — like the glass
  polygon is facing backwards". It was: every face was wound clockwise from
  outside, so with FrontSide culling the near surfaces vanished and you saw
  through to the far interior ones. It hid because `flip` negates z, and
  that mirror reverses handedness — it *cancelled* the bug, so every
  fastback and rear window was correct while every windshield was inverted
  (hence the winding now flips back explicitly when `flip` is set). Objective
  proxy for this one, since a screenshot can't see it: the wedges are convex,
  so a triangle is correctly wound iff its normal points away from the
  prism's centroid — that check said 72 of 112 triangles faced inward before
  the fix, 0 after. Write that check before trusting a mesh render.
- `/home/cromulon` briefly had a stray commit-less `.git` (deleted
  2026-07-10). If `git add -A` ever stages home-dir files again, stop —
  wrong repo root.
- Commit messages: repo history starts at `2e79ae4`; branch is `main`.
- A dev server from an earlier session may still be running on port 8471.
