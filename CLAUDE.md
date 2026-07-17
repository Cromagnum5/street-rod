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
  RESULTS`), renderer, chase camera, race loop, localStorage save
  (`SAVE_KEY` in data.js). States are objects with `enter/exit/onKey`;
  per-frame work goes through the module-level `sceneTick` callback.
  Opponent cards show a portrait of the racer's car (`carPortrait`): a
  second small offscreen WebGLRenderer, data-URLs cached per tier+color.
- `src/economy.js` — part prices, car trade-in, and who shows up to race you:
  the 12-card board (see Design intent), `makeRoster`, `aiParts`, `buildLevel`,
  `slotWager`, `partPrice`/`priceScale`, `brokeLine`, `wagerLoss`, `round100`.
  **Everything is even $100s** (Jason, 2026-07-15): prices, wagers, purses and
  sale values all pass through `round100`, so the player's roll stays a $100
  multiple forever by construction (main.js `load()` rounds pre-existing saves
  in). **Pure functions over a `player` object — no THREE, no DOM.** That's the
  point of the split, and it isn't cosmetic: it's what lets a Node script play a
  whole career against the real physics and the real AI, which is where every
  number in the board entry comes from. Keep it importable from Node.
- `src/data.js` — all balance data: `CAR_TIERS` (7-car pink-slip ladder,
  Model A → Hemi 'Cuda, each with a `susp` base softness), `PARTS`
  (6 categories × 3 buyable levels — prices here are **Model A money** in even
  $100s, scaled by car tier in `economy.js`; the full build is $5,900),
  racer names/flavor (36 characters — the board deals 12 a visit, so the pool
  stays deep; each also carries a `gloat` shown when they beat you, bosses
  included; Jason's wife likes the quotes, keep them good), `RACER_COLORS`
  (14 period paints shuffled per roster in `makeRoster` so no two of the 12
  cards match — the race AI mesh wears the same `opp.carColor` as the card;
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
  hint)`, `racingOffset(d)` (the racing line — see the line entry in Design
  intent; lazily built once per track, ~2 ms). `sample` also returns `elev`/`grade` — rolling hills landed
  2026-07-11: a slope random walk with a soft spring toward mid-height
  (underdamped, ~500 m wavelength), elevation confined to [0, HILL_MAX] so the
  flat ground plane never shows above the road, a smoothstep
  envelope pinning the launch zone and finish approach to y = 0 (launch
  balance stays flat-road; finished cars coast level), and 3 smoothing
  passes so per-segment grade never steps visibly in `groundPitch`.
  **Hill drama is `HILL_SCALE`, and it is ONE knob by construction** (Jason,
  2026-07-17: "can the hills be made more dramatic at times?" — 1 → 3, giving
  peak 18.5 m / median grade 2.0% / per-seed max 7.9–13.4% vs the old 6.2 m /
  0.7% / 2.6–4.5%). The recurrence is *linear* in (elevation, slope, band,
  mid-height), so scaling them together multiplies the profile in y **exactly**
  — measured identical clip rate (3.8%) and crest count (4.7) at every scale
  from ×1 to ×3.5, i.e. same crests in the same places, each taller and
  steeper. That linearity is also why `points[i].y *= k` post-construction is
  an exact stand-in for the real walk, which is how the camera and balance
  harnesses A/B'd hills without touching track.js.
  Widening the band **alone** is the trap: it clips flat against the ceiling
  (30% of the track pinned, grades reaching 7% instead of 14%), and no spring
  tune rescues it — stiffening the spring *lowers* max grade (6.2 → 4.8%) while
  multiplying crests (4.4 → 9.5), because grade × hill length = height and the
  ceiling caps the product. Steep therefore *requires* headroom.
  Drama "at times" is free from the existing uniform roll — `slopeTarget` is
  uniform in ±`HILL_BAND`, so most segments draw a mild target and a few draw a
  steep one. An explicit steep/gentle mix (`steepP`/`steepAmp`) was built and
  measured **worse**: median grade 1.0% vs 2.0%, only 4–6% of track over 6% vs
  14%, and a narrower spread across seeds — more knobs, less drama. Don't.
  The heading walk runs before the hill walk on the same `rand()` stream
  and self-clearance is plan-view, so retuning heights leaves every seed's road
  layout bit-identical — **verified**, 0 of 14,424 plan-view points moved
  across 24 seeds going ×1 → ×3.
  Two fears about taller hills were measured and are **both unfounded** — don't
  re-derive them: the chase camera never clips a crest (see the camera entry),
  and the terrain skirt does *not* become an escarpment. The skirt falls from
  road height to an absolute y = −1.2 over its outer 38 m, so at an 18 m peak
  that is a ~50% drop on paper; rendered, it reads as ordinary rolling
  countryside, because it is the same material and colour as the ground plane
  and is seen at a grazing angle. Headroom past ×3 is real but finite: the
  camera's margin runs out near ×5.
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
  the same reason as wheels), the camera is a boom whose height tracks the road
  under the car while its aim stays locked on the car (see the camera entry),
  and dash/edge-line instances pitch with `grade` so they lie on the slope. The ground is a terrain skirt riding
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
  and the garage LATERAL GRIP stat.
  **`grip`/`cornerGrip` are accelerations in m/s²**, not an abstract score:
  `velYawMax = gripAvail / speed`, so at the limit lateral accel *is* grip, and
  `grip * mass` is used directly as a force. So `cornerGrip / GRAV` is honest
  skidpad G — which is what the garage shows (Jason, 2026-07-16: "change the
  grip stat to something people would intuitively understand... sports cars brag
  about having around 1 G"). It had been printed raw as "7.2 g-units", which was
  neither g nor a unit. No fudge factor was needed and none should be added: the
  ladder falls out at 0.54 G for a stock Model A on bias-plies, 0.88 G for a
  stock 'Cuda, 1.00 G for a maxed Deuce (exactly the sports-car brag) and 1.40 G
  for a maxed 'Cuda on slicks — real numbers for real cars, top to bottom. If a
  tier's `grip` in data.js is ever retuned, this stat is the sanity check: a
  street car outside ~0.5–1.4 G is telling you the physics drifted, not the UI.
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
- **Losing a pink slip costs you your build, not your class** (Jason's call,
  2026-07-12). The boss takes the car you brought; the junkyard hands you a
  bone-stock car of the *same* tier (`player.parts = freshParts()`, `carTier`
  untouched — it used to reset to 0). So a loss is a rebuild-and-retry inside
  the class, not a fall back down the ladder: same boss, same board, and your
  cash is untouched, which keeps the pride-run safety net working at your own
  tier. A class's full build is about a dozen races by design (see the board
  entry), and a rebuild after a boss loss is faster — the cash pile survives.
  **Every loss ends with the winner's gloat** (Jason, 2026-07-16): all 36
  street racers and all 6 bosses carry a `gloat` line in data.js (Freddy's
  lives on his makeRoster card), appended to the losing results card — in
  character, quote-grade (Jason's wife reads these; keep both flavor and
  gloat good when adding racers). History worth knowing: a $1,000 boss
  condolence prize shipped alongside the boss pace-match that morning and
  lasted hours — flagged on arrival as a farm (a stock-build boss loss costs
  nothing, so throwing boss races was a guaranteed risk-free $1,000/race,
  out-earning pride runs), and Jason cut the money and kept the jokes. The
  boss gloats are deliberately written money-free so the card never implies
  cash the CASH line doesn't show; keep them that way, and don't
  reintroduce a payout on any $0-down loss.
- A broke player must never soft-lock — under `brokeLine(tier)` the whole board
  becomes $0-wager "pride runs" for one flat gas-money purse (`pridePurse` =
  the broke line itself, so a single win puts you back into real wagers), with
  Free-Ride Freddy holding the easiest slot. (This *is* the safety net; see
  the board entry for why the purse is flat and why it's a pride run and not
  a floor under the wagers.) Every pride win gets a crowd-reaction flavor line
  in RESULTS — deliberately words and never money (Jason, 2026-07-16: bonus
  cash on pride runs was considered and rejected — any reward gradient on a
  $0-down board is the measured spend-to-zero farm). Three lines by build gap:
  ≥0.75 above the player is legend-grade, >0.25 is word-gets-around, and at or
  below (Freddy included) it's the joke about letting him win one someday —
  pride's all he's got.
- **The board: a dozen cards scaled to your BUILD, not your bankroll**
  (Jason, 2026-07-15, replacing the four-slot percentage board: "a dozen or so
  opponent cards... scaled with player part level. Drivers lower than your
  parts level stop showing up... More advanced AI drivers creep in... each
  tier to take about a dozen races... buy a couple parts, race, win, buy
  another couple parts, race better AI, lose, lose money, race lower AI, get
  money"). `makeRoster` deals `N_CARDS` (12) street cards + the boss, all
  keyed off `buildLevel(parts)` — the mean part level, 0..3 (`pLvl` below):
  - **His build slides with yours**: card i targets `pLvl + (−0.75 … +1.5)`
    across the board (±0.1 jitter, clamped [0,3]). The easiest card is a
    driver a notch below you — lesser drivers fade off the board as you level
    up — and the top is up to 1.5 levels above, so by pLvl ≈ 1.5 the big-money
    cards are maxed 5★ drivers. `aiParts` turns a fractional level into a
    mixed build (1.5 ≈ half the parts at L2) with a 20% per-part −1 jitter.
  - **Skill rides the build**: `0.25 + 0.25*bLvl ± 0.03` — stock cars carry
    1–2★ drivers, L1 ≈ 3★, L2 ≈ 4★, maxed = 5★. Parts are the difficulty
    lever; stars label it, and the portrait renders the real `aiParts` build.
  - **The wager is what HE puts on the hood**: `slotWager(bLvl, tier)` =
    `round100((400 + 700*bLvl) * priceScale(tier))`, min $100 — a tougher man
    pays more, and the board's money grows as your build drags the window up.
    It's an even-money bet **capped at the cash you carry** (`min(money, W)`):
    you can never bet, or win, more than you have on you. That cap kills both
    old failure modes at once — no bet you can't cover (the free-roll bug the
    wager floor shipped), and no percentage-of-nothing death spiral (the old
    all-percentage board punished spending on parts; a fixed ladder doesn't).
    Carrying less than his stake just means racing him for all of yours —
    double-or-nothing drama preserved where it belongs. (The cap used to
    flatten the whole board's payout when the roll was thin — the reach-up
    bonus entry below is the fix.)
  Load-bearing findings, all from the career sim (see Testing):
  1. **A matched build is a photo finish now, and the sure win sits BELOW you.**
     Since the drift-planner/draft-hunting AI upgrades, an equal-build 3★+ AI
     ties or beats the flat-out proxy (±0.2 s); one build level below you is a
     near-sure win, one above is a near-sure loss. This supersedes the old
     "matched slot is a sure thing" note. The economy leans on it: income comes
     from the ~3 cards under your level, matched cards are the gamble, and the
     described lose-reach-up/recover-below rhythm is exactly what Jason asked
     for. Don't flatten the below-you win rates.
  2. **The pride purse is FLAT — one gas-money number per tier — and that
     flatness is load-bearing** (Jason, 2026-07-16: "reduce the appeal of
     pride races so they are not the preferred strat"). Under `brokeLine(tier)`
     (= $400 × priceScale, rounded) every card goes $0-down for the same
     purse: `pridePurse` = the broke line itself, so one win puts you back
     over it and into real wagers. The first cut paid 0.6 × each slot's wager
     instead, and the dominant strategy became "spend every dollar on parts,
     then farm the hardest pride run you can win" — risk-free income that
     scaled with your build. Measured after the fix (8 seeds, races to a
     maxed build, normal vs spend-to-zero): T0 12.4 vs 12.3, T2 9.9 vs 11.8,
     T4 7.4 vs 11.0 — the farm is strictly worse from ~L1 up and merely
     break-even at stock T0, where the net is supposed to be generous. Don't
     reintroduce a purse gradient; that's the farm.
     Regression check (315-board invariant sweep, every tier × cash level ×
     build): no street wager exceeds `player.money`, none is under $100 or off
     the $100 grid, no $0 wager carries a $0 prize, boss always 5★ at his
     tier's `BOSS_BUILD_SUM` build (he stopped being maxed 2026-07-16 — see
     the balance-target entry).
  3. **Pacing, measured (16 careers, real physics, flat-out proxy, races to
     the first boss challenge, incl. pride detours)**: T0 15.6, T1 11.4,
     T2 10.7, T3 9.9, T4 9.9, T5 10.0. T0 reads long on this metric but is
     ~12.4 races to a maxed build — the difference is loss/pride detours the
     cautious sim policy takes; a human who wins the T0 photo finishes
     (proxy loses ~2/tier there) lands nearer a dozen. Two knobs measured
     useless for T0 — don't reach for them: starting cash (800 → 1000 moved
     nothing; the old note's finding still holds) and `WAGER_BASE` (T0 income
     is capped by the pile when the player shops down to the broke line, so
     the ladder never binds there). Losses/tier run ~1-2 at T0, near 0 late
     (the proxy plays safe; a human reaching up eats more, on purpose).
     Cash into each class: $1,000 / ~$950 / $1,700 / $2,300 / $2,300 / $3,200
     ≈ 3–5 parts of the new class (the boss-win sale is the old tin at
     catalog price only — `carSaleValue` — plus whatever's left in your
     pocket; the build itself is gone into the boss's hands).
  4. Part prices are **Model A money scaled by `priceScale(carTier)`**
     (`PRICE_TIER_STEP` 0.35) then rounded to $100 (min $100 — note the
     rounding flattens cheap parts across tiers, that's fine), and the wager
     ladder scales the same way, so every class is the same dozen-race shape.
  Starting cash $1,000 — a few parts and gas money; a full L3 build is
  $5,900 in Model A money.
- **Reach-up bonus: gold on the cards above your build** (Jason, 2026-07-16:
  "give incentive to race higher level AIs... often the player is presented
  with cards of increasing difficulty but the reward is the same... shows up
  more the lower the player is on cash"). The wager cap was what flattened it:
  shopped down near the broke line, every card's wager = the whole roll, so
  the board read as rising risk for identical reward. Now every street card
  built above you carries `bonus = slotBonus(bLvl, pLvl, wager)` =
  `round100(BONUS_FRAC 0.75 × min(BONUS_GAP_MAX 0.75, bLvl − pLvl) × wager)` —
  paid on top of the even-money wager, **on a win only** (a loss still costs
  just the wager), shown in gold on the card ("+ $400 BONUS"), the HUD wager
  line and the results line (`.bonusCash`; gold `--gold` was already the
  "earned things" accent, so this stays inside the two-accent theme). Three
  load-bearing choices, all from the career sim (8 seeds, real physics):
  1. **It rides the STAKE, not the tier.** Bonus ∝ the *capped* wager, so the
     gradient survives any bankroll (a $700 roll at T2 sees its flat $700
     wagers climb to $700 + $400 gold up the board) and the gold can never
     dwarf what's on the hood. Flat $-per-level versions ($600+ Model A money)
     made near-broke boards read as lottery tickets and ground a gold-greedy
     policy's T0 into a 50-race broke↔pride doom loop; stake-proportional at
     0.75 keeps that same policy within ~5 races of baseline everywhere past
     stock T0 (and those 5 are stock-T0 photo finishes the proxy loses ~50/50 —
     human-discounted, same caveat as the pacing entry).
  2. **The gap that pays caps at +0.75** — the winnable one-notch reach. The
     measured win curve vs gap (16 seeds/cell): +0.25 ≈ 0.2–0.9 by tier/build,
     +0.5 ≈ 0.1–0.9, +0.75 ≈ 0.06–0.3, +1 ≈ 0. Uncapped, the biggest gold sat
     on the near-hopeless top cards; capped, the best gold-per-risk is the
     one-notch card, which is exactly the "race better AI, lose, recover below"
     rhythm the board was built for.
  3. **Zero when broke, zero for Freddy, zero for the boss.** The flat pride
     purse is load-bearing (see the board entry) — a gold gradient on a $0-down
     board is precisely the farm that was cut on 2026-07-16.
  No farm at this shape, measured: the no-upgrade farmer *loses money faster*
  with the bonus than without ($1,000 → $250 vs $350 over 40 races — the gold
  drags him into losses); a lottery policy (always the biggest total payout)
  dies cycling broke↔pride at every tier; and the safe player's board is
  bit-identical (bonus is 0 at/below your level), so the shipped pacing holds
  unchanged (13.4/12.1/10.6/10.3/9.8/10.0 races T0–T5 in the same harness).
  Invariant sweep (1,323 boards, tier × cash × build): bonus on the $100 grid,
  ≤ 0.5625 × wager, never on pride/boss/freebie cards, never decreasing up the
  sorted board. One wrinkle: the crown peer's `bonus` is recomputed after his
  build is forced to 3 (his *wager* deliberately stays the one the top slot
  rolled — pre-existing behavior).
- **Sizing him up is a side-by-side: your card, then his** (Jason's ask,
  2026-07-16: "improve the comparison and debate a player makes when choosing an
  opponent"). The opponent screen used to be his card alone against a dark
  garage, so every comparison was from memory — you had to remember your own
  pips from the shop one keypress ago. Now the garage panel *is* the player's
  card: `#garagePanel` lives outside `#garageScreen` and stays up through
  OPPONENTS, where `setPanelMode(true)` shrinks it into a 320 px card at the left
  of the stage. Load-bearing bits:
  - **It's the same element, so the box genuinely travels** — that's the whole
    point of the animation, and it's why the panel is sized by `height` and not
    `bottom` (a `bottom` can't transition into a card). Two mechanisms, kept
    apart on purpose: geometry is a CSS transition on left/top/width/height;
    contents cross-fade (`.morphing`) and swap at the bottom of the fade.
    Morphing the contents *in place* would mean animating a 6-row shopping list
    into a 3×2 grid of pips — the fade costs 0.15 s and the box moves through all
    of it. Verified playing by sampling the rect from inside the page (mid-flight
    at `l:177 w:344 h:679`, contents at opacity 0.22): **a screenshot cannot
    catch this** — under swiftshader a frame costs ~400 ms, so a `waitForTimeout`
    of 170 ms captures the settled state and reads like a broken transition.
  - **The card's geometry is measured, never duplicated.** `setPanelMode` reads
    `#cardStage`'s rect and sits beside it (`PLAYER_CARD_W` 320 +
    `PLAYER_CARD_GAP` 96, which is what clears `#arrL` at the stage's −60 px).
    `#opponentScreen`'s `padding-left: 416px` (= W + GAP) reserves the column,
    and because the stage is flex-centered in what's left, the *pair* lands
    centered for free. Measure it **after** `showCard`, not before: an empty
    `#cardCounter` rides the flex column 7 px off and the cards land misaligned.
    Checked 1024×768 → 1920×1080: both cards share a top and bottom, gap holds at
    96, nothing overlaps the arrow.
  - **One part order everywhere.** `buildGridHTML` is shared by both cards, so
    the pips sit in the same spot on each and you compare without re-reading the
    labels. `.buildGrid` is `grid-auto-flow: column` — filling by row (the old
    `.oppBuild`) ran ENGINE / INDUCTION across the top, so reading the left
    column top-to-bottom gave ENGINE / EXHAUST / SUSPENSION: a different order
    than the garage's list, which is the thing Jason caught. Column-major makes
    both screens read in `PART_KEYS` order down one column and on to the next.
    If a seventh part is ever added, `grid-template-rows: repeat(3, auto)` is the
    line to fix.
  - The player card carries a **portrait** (`carPortrait`, same offscreen
    renderer and angle as his) — the visible-upgrades work is what makes that a
    real A/B: a blower against a flat hood. Both frames are `.carPhoto` at 150 px
    so the two cars are shot alike and the pair reads as a set; the garage itself
    skips the photo, the turntable is already showing the real thing. The boss
    note is dropped on the card (on that screen the boss *is* a card).
  Deliberately NOT done: hp / top speed / grip on the *opponent's* card. The
  difficulty signal is build pips + stars by design (see the board entry) — the
  player's stats stay visible so you can price his pips against your own numbers,
  which is the debate; handing over his stat line would make it arithmetic.
- Balance target (2026-07-16, superseding the 07-15 "boss is a wall"): a
  build-level gap decides street races (see the board entry), and **the boss
  is pace-matched to the top card of your own class**. Jason playtested the
  wall and it was exactly that ("the boss is impossible to beat now with a
  max'd out car"); the new doctrine is his: "if the player feels like they
  can beat the max'd same tier car consistently then they are ready to take
  on the boss." He still drives the next-tier pink car at skill 1.0 / aggro
  1.0 — the equalizer is his BUILD, pulled down per tier: `BOSS_BUILD_SUM`
  in economy.js = [10,13,13,13,14,14] total part levels (`bossParts` spreads
  them evenly, remainder engine > tires > gearbox > induction > suspension >
  exhaust; card pips show the real build, `bLvl` = sum/6). Those sums are
  measured, not derived (16 seeds, solo pace + full-contact head-to-head vs
  the maxed flat-out proxy): boss margin tracks the maxed same-tier 5★ card
  within ~0.3 s at every tier — T0 −1.27 s vs the card's −1.10, T1 +0.08 vs
  −0.25, T2 +0.04 vs −0.69, T3 +1.06 vs +1.08, T4 +2.70 vs +2.76, T5 +4.46
  vs +4.24 (all-L3 was 1–6 s harder than the card and 0/16 winnable through
  T3). The gate by player build (same harness): L2 loses everywhere (−1.4 to
  −8.4 s), L2.5 breaks even only at T4+, maxed races him like the top card —
  below-max still meets a wall, so the boss stays the gate. Proxy caveats as
  ever: the T0–T2 maxed cells are photo finishes the proxy loses ~50/50 and
  a line-driving human wins; T4/T5 margins are fattened by the free dirt
  line. One tier of iron ≈ one part level is why the sums sit well under 18.
  If playtest wants him softer/harder, the sums are the first knob now;
  skill and the `ai.js` planning grip stay the later ones.
  Street builds come off the card's `bLvl` in `aiParts`; one tier of lesser
  iron still buys one extra part level (one tier ≈ one part level in this
  data), the deficit is still a **baseline, not a bonus** (floors at the
  deficit so a lesser-iron draw never runs below player-tier stock pace),
  Free-Ride Freddy (`freebie: true`) still skips it, and the +1-tier car draw
  is still reserved for skill ≥ 0.55. `partBoost` is gone — the fractional
  bLvl mix does its job. Upgraded opponents also *sound* built for free
  (`soundSpec` gets the same parts).
- Crown era — after THE KING (Jason's call, 2026-07-12; reshaped with the
  12-card board 2026-07-15). `crown` = player carTier 6, the only way to own
  the 'Cuda, and there's no boss left to race. It's the same board with
  floors: card builds floor at **level 1** (nobody brings a stock car to race
  the champ), skill floors at 0.55 (3–5★ only), and the top card is the
  **guaranteed peer** (Jason: "there should be opponents with max'd out cars
  and max skill to choose from") — `makeRoster` gives it carTier 6, skill 1.0
  and an explicit all-3 `parts` (`aiParts` honors a pre-set build, which is
  also what the card portrait renders). The biggest bet on the board is the
  hardest man on it, at every tier — the crown is just the last rung. On a
  champion's roll the ladder is the money sink: a $22k pile deals a board of
  ~$3,400 up to $7,800, every race even-money. The mercy freebie is exempt from the level floor (Freddy stays
  a stock lesser car). A player who stops upgrading slides down the window
  and the 4–5★ maxed challengers stop being winnable — the sink is the point.
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
- **Shadows: the cars cast, the world receives** (Jason playtested + approved
  2026-07-16, "frame rate fine, it looks great"). The `castShadow` flags in
  carmesh.js had been **dead since the first commit** — set on every `box()` and
  `wedge()`, but nothing ever enabled `renderer.shadowMap` and no light cast, so
  the cars floated over the asphalt for the life of the project. Now the race sun
  casts and the road / terrain skirt / ground plane receive; in the garage the
  key PointLight casts onto the floor and turntable (deliberately still a point
  light, not a spot — a cone would change the shop's whole look, and it's a menu
  screen rendering one low-poly car). `wheel()` needed flags of its own: the
  originals covered only the two primitives, so the tires cast nothing.
  **Nothing in track.js is flagged, and that's load-bearing.** With only two
  casters the shadow map is nearly empty, which is what lets `aimSun` follow the
  pair with a tight ortho box instead of covering 3 km of road. It sizes itself
  to take the AI in and lets him drop out past `SHADOW_MAX` 90 m (he's beyond the
  fog start anyway). The half-extent is *quantized* (`SHADOW_STEP`) so the texel
  size doesn't breathe frame to frame, and the focus is snapped to that texel
  grid so the shadow edge doesn't crawl as the car moves. Flagging the trees
  would buy back both the fill cost and the crawl on static geometry — think
  before doing it.
  **Sharpness is free, measured** (swiftshader, stationary car, ms/frame): off
  107, 2048 soft 180, 2048 pcf 176, 1024 soft 190, 512 soft 188. Flat across
  every map size and both filters — the cost is not shadow-map fill and not PCF
  taps, it's the fixed cost of the shadow path existing in the fragment shader at
  all. So 2048 + `PCFSoftShadowMap` is the right pick, not a luxury; shrinking
  the map buys nothing. (Absolute ms is software raster and says nothing about a
  real GPU — Jason's playtest is what cleared the frame rate, same as the audio
  rule: some things only his machine can answer.)
- **The road wears the palette, and the number that matters is road-vs-ground**
  (Jason's call, 2026-07-16, straight after shadows). The asphalt was one
  hardcoded `0x3a3a3e` shared by all four palettes, so the road looked the same
  at noon and at midnight. Worse, the ribbon is **Lambert — it wears the sun's
  colour**, which is why picking a road colour in isolation doesn't work: dusk's
  orange sun at 1.6 dragged neutral grey onto almost exactly dusk's brown
  ground, and night's road sat muddy against the dark green. `palette.road` now
  carries it, chosen against that palette's `ground` and `sun` together.
  Measured with an objective proxy (real rendered pixels — asphalt at lateral
  ±4, clear of the centre dashes at 0 and the edge lines at 7.1, vs bare ground
  at ±11, inside the tree line at 13.5; 25 m ahead at the start line, where the
  launch zone is straight by construction; old colour A/B'd against new **in the
  same frame** so light and camera are identical). rgb distance / luma delta:
  noon 111/77 → unchanged (already strong, left alone), dusk 45/24 → 53/29,
  **night 23/9 → 38/16** — that's the real fix, a luma delta of 9 out of 255 is
  not a different surface — and desert 162/100 → **141/87**.
  Desert went *down* on purpose: sun-bleached asphalt is flavour, and it spends
  contrast that palette has in abundance (141 is still ~4x night's 38). Night's
  road runs **lighter than its ground**, which realism forbids — asphalt is
  black at midnight — but the road has to read; that's the call. The unlit
  dash/edge instances are MeshBasic and stay bright at any hour, so they carry
  the other half of night.
  Related, noticed and left alone: `horizon` is a dead palette key — declared on
  all four, read nowhere.
- **Roadside props: the palette picks the SET, not the colours** (Jason's ask,
  2026-07-16). The world was trees and mountains, and `palette.tree` was doing
  all the work — the desert's "cacti" (the comment said cacti, the code said
  `ConeGeometry`) were pines with a tan tint. `palette.props` now carries a real
  set (`veg`: "pine" | "cactus"; `rock`/`scrub`: colours that double as an
  on/off switch; `pole`), built by `Track._roadside`, all instanced.
  Telephone poles are the piece that sells a 1950s two-lane more than anything
  else on the verge. They march one side at `POLE_STEP` 52 m, standing at
  `POLE_OFF` 11 m — deliberately in the gap between the asphalt (ROAD_HALF_W
  7.5) and the tree line (ROAD_HALF_W + 6), which is the *only* reason a pole
  never grows out of a pine: **if the tree band ever moves inboard, POLE_OFF
  moves with it.** Nothing on the verge has collision, exactly as the trees
  never have — cars drive through it and the soft boundary is out at 21.5.
  Everything in `_roadside` is built per-scene, and it all looks hoistable to
  module level. It isn't: `disposeScene` frees every geometry and material it
  traverses, so a hoisted prop geometry would be freed on the first teardown and
  the next race would render without it.
  Objective placement check (8 seeds × 4 palettes): distance from every instance
  to the *extended* centerline (props scatter through the PRE/POST run-up and
  run-off, which `project()` cannot see), asserting nothing within ROAD_HALF_W
  (on the road) and nothing past 62 m (floating out where the terrain skirt
  falls away). Measures 13.5–58.5 m for scatter, exactly 11.0 for poles. The
  prop meshes are named `prop:*` precisely so that check can tell scenery from
  the dash/edge instances, which live ON the road on purpose. Rebuild it if the
  scatter is ever retuned — a cactus on the asphalt is invisible to a
  screenshot unless you happen to drive past it.
- **Drafting** (Jason's ask, 2026-07-12: "I want to be able to draft the car in
  front of me and pick up speed"). `resolveDraft` in physics.js is a symmetric
  pair check: whoever is behind gets `car.draft` 0..1, and `step` spends it as a
  straight **drag cut** (`DRAFT_MAX` 42%), which is the load-bearing choice —
  drag is the only force that goes as v², so the tow is worth nothing at 30 mph
  and everything at 150. That also means it can carry you **past your own
  vmax**, which is the entire move: sit in it, then pull out and go by. Measured
  on the bumper (5 m): Model A 74.5 → 87.2 mph, Bel Air stock 106.7 → 124, maxed
  'Cuda 277 → 329 — about +15% top speed at every tier, so it never becomes a
  low-tier-only crutch or a high-tier-only toy.
  **The wake's length is a time, not a distance** (Jason, 2026-07-13: the
  original fixed 24 m was ~0.35 s of gap at 150 mph — too short to ever catch a
  car down a long straight). `draftLength(speed)` = the leader's last
  `DRAFT_TAIL_T` 0.9 s of travel, floored at `DRAFT_LEN` 24 m, so nothing
  changes below ~60 mph and above it the tunnel stretches: ~30 m behind a
  Model A, ~43 m behind a Bel Air, ~112 m behind a maxed 'Cuda (still a tow at
  100 m back — 281 vs 277 mph base, ramping to +51 on the bumper).
  `AIDriver.wake()` imports `draftLength` for its hunt reach (replacing a fixed
  `WAKE_MAX` 26 m) so he chases exactly the tow physics grants — at 'Cuda
  speeds a 5★ starts leaning toward your lane from ~130 m back on straights;
  the distance-fading commit keeps that a lean, not duckling-shadowing.
  Balance A/B (16 seeds, flat-out proxy, full race loop with contact + draft):
  street cells moved ≤0.04 s; the **boss tightened 0.30 s** (draft peak
  0.80 → 0.98 — he's the one driver good enough to work the longer tow; worst
  seed still a 0.95 s player win, 16/16). That's the fifth boss tightening in
  a row — same knobs as ever if he goes over.
  The tunnel starts *behind the leader's tail* (`DRAFT_MIN` 3.5 m — you cannot
  draft from alongside) and is about a car wide
  (`DRAFT_HALF_W` 1.3, fading to nothing 2 m further out), so you have to line up
  in it: at 8 m back the gain is +9.1 mph on his line, +5.5 one metre off it,
  +1.1 at three. It trails his **travel** direction, not his nose, so a car
  hanging sideways in a drift drags its hole in the air sideways too. `DRAFT_RISE`
  eases the tow in and out over ~0.3 s — a stepped drag change would pop the FOV,
  same lesson as the contact trade.
  Balance is untouched because drafting is **opt-in**: 16-seed A/B with a
  flat-out human proxy (which doesn't chase the tow) moved the margin over the AI
  by ≤0.4 s, and only in the races where the cars are close enough to use it.
  The HUD `#draft` readout
  exists because the wake is invisible: the tow is the one speed source with no
  on-screen cause, so without it a player just sees the speedo climb.
- **The AI hunts your wake, and skill is the knob** (Jason's ask, 2026-07-12,
  straight after drafting shipped). `AIDriver.wake()` finds the tow on a straight
  and `wakeSteer()` puts pressure toward it; he moves across, rides it up to your
  bumper, then **slingshots** out and passes (`SLINGSHOT`: inside 6 m with a speed
  run on you, the aim lane steps `SLINGSHOT_OUT` to the roomier side — without it
  he'd ride your wake to the finish, and the draft would make him *follow* better
  instead of *race* better). Traced at boss skill: lateral 3.0 → −3.9 in 1.5 s,
  draft 0.62 at 9 m back, 94 → 110 mph while the player is pinned at 94, pull out,
  by. Five load-bearing findings, four of them mistakes measurement caught:
  1. **It cannot be a lane bias — this is the deadband trap, for the second time**
     (see the `leanBack` entry, which says the same thing). Biasing the pursuit aim
     lane into your wake reads perfectly and measures as a *literal no-op*: at a
     racing lookahead of ~46 m, a 2 m lateral error is only ~0.11 of steer, under
     his own 0.12 re-press deadband, so his keyboard never sees it and he stalls
     out wide of the tunnel. It needs **pressure** through a short aim distance
     (`WAKE_AIM` 12 m). Any future "nudge the AI" feature hits this floor.
  2. But pressure **alone** leaves him fighting himself — his pure-pursuit keeps
     restoring him to his racing line, and he settles ~2 m wide (tow 0.15). So the
     aim lane *also* shifts (`wake().commit`). The lane shift isn't what moves him;
     it's what stops his own pursuit from opposing the move. Both halves, or neither.
  3. Skill scales the pressure and then **the deadband does the gradient for free**:
     a weak driver's push falls under his own re-press floor while he's still a
     couple of metres wide, so he wanders into the dirty air and never finds the
     clean tow. Measured (player holding a lane off the racing line; tow / metres
     off your line): hunting off = **0.00 at every skill** (3.4–5.8 m wide, he
     never finds it at all); on = 1★ 0.10/3.3 m, 2★ 0.22/2.3, 3★ 0.26/1.8,
     4★ 0.27/1.3, 5★-boss 0.29/0.9. The falloff is the controller's own floor,
     not a tuned curve.
  4. Commitment must **fade with distance**, not just skill. Without that a 5★
     mirrors your every lane change from 45 m back like a duckling — shadowing,
     not drafting — and it measurably distorted the ladder (a 4★ came 4.5 s
     closer). Far out he leans toward the tow; on your bumper he commits.
  5. The straight gate scans the **whole stretch he'd be committed through**
     (`speed*0.4 … speed*1.6`), not one point. A single sample a half-second ahead
     let a fast car commit to the wake lane on the last of a straight and arrive at
     the corner off its line — it doubled the boss's time in the dirt (2.4 → 4.2
     s/race). Drafting is a straight-line move; in a corner the line is worth more.
  6. **The tuck-in waits for your TAIL, not your center** (Jason, 2026-07-13:
     pulling ahead of a side-by-side AI made him "tuck in behind me too early and
     hit my rear end... he goes squirrely" — and his read of the cause was exactly
     right). Every gap in `wake()` is center-to-center, and two car bodies overlap
     out to 2·(CONTACT_END+CONTACT_R) ≈ 4.9 m of it — but the hunt engaged at
     WAKE_MIN 2 m, which is also where commit *peaks*, so he cut for your lane
     hardest at the moment of deepest overlap. Traced: full 0.45 steer pressure
     into the player at 2.05 m of gap, a 3.8 m/s rear-quarter hit, fishtail, and
     **0.00 draft collected all run** — physics grants no tow while the bodies
     overlap, so the early cut bought him nothing. Now below `TUCK_CLEAR` (≈6.1 m,
     nose truly past the tail) he *stages*: the wake lane holds at min(current
     offset, `TUCK_KEEP` ≈ 2.7 m) off yours, and he cuts across only once clear.
     The min() is load-bearing — it only halts inward motion, never demands
     outward, so a car already square in the tow keeps your lane exactly (the
     WAKE_MIN lesson again: an outward shove is the "abandons the draft the moment
     it pays" bug). Measured: repro hits 6 → 0, draft collected 0.00 → 0.72,
     bumper-riding guard 0.94 unchanged, 16-seed ladder margins moved ≤0.08 s.
     CONTACT_END/CONTACT_R are exported from physics.js for this — the stage
     geometry must track the contact geometry.
  Balance: the ladder is intact and unmoved (≤0.2 s in every street cell, both for
  a player on the racing line and one holding a lane). The **boss race tightens**:
  a maxed 'Cuda still wins, but by +2.8 s instead of +5.4 s against a player on the
  line, because the boss is the one opponent good enough to use your tow properly.
  That's the intended shape of the feature, but it is the third change in a row to
  tighten the boss margin — if he ever becomes unbeatable, the planning grip in
  `ai.js` is still the first knob.
  Note it only matters when you're **off the racing line**: if you drive the line,
  the AI is already near it and picks up the tow incidentally, so hunting measures
  as a no-op there (which is why the first A/B looked like a failure — the flat-out
  human proxy drives a perfect line, and a real player doesn't).
- Camera drama comes from **acceleration, not speed**: framing follows the
  smoothed `race.camSpeed`, and a small accel-driven FOV kick (+6°/−3° max)
  handles launches/braking. Keep zooms subtle — Jason gets seasick from big
  FOV swings. Steady-speed widening is capped at +9°. Chase distance is
  deliberately tight (Jason, 2026-07-10): `4.3 + camSpeed * 0.0065`, height
  scaled to keep the same look-down angle. Don't pull it back out; any
  closer needs the lookAt point pulled in too.
  **The camera is a boom, and the one inviolable rule is the GIMBAL: the aim
  point stays locked on the car (`lookAt` at `p.y + 1.1`) no matter what the
  boom's position does.** The camera *position* is free to float for drama; the
  car's spot in frame is not, and the aim lock is what protects it. This was
  learned the hard way (all 2026-07-17): the height first rode `race.camY`, a
  lagged copy of car y — added to `camGoal.y` so the *whole rig including the
  aim* lagged. That decouples the camera from the car and **the car slides up
  and down the screen** (measured: NDC vertical drift 0.137 flat → 0.408 at ×3
  hills → 0.675 at ×5, i.e. the car sliding through ~⅔ of screen height). Lock
  the aim on `p.y` and float only the position, and the same float moves the
  *world* while the car sits still (drift back to 0.05–0.09). Rule of thumb for
  any future camera drama: **move the camera, never the car in frame** — if a
  change touches the `lookAt` target's y with anything lagged, it's the bug.
  With that rule the position does three things, all Jason's asks (playtested +
  approved 2026-07-17):
  1. **Directly behind, no side-to-side.** The `CAM_FOLLOW` lerp trails the
     goal; through a turn the goal whips laterally and the camera swings wide
     with it (~0.35 m of lateral drift). Kill it by projecting the camera's
     horizontal offset onto the car's travel line and keeping only the *behind*
     component — the longitudinal trail (the good half of the same lag) survives,
     the lateral swing is projected out. Measured 0.096 → **0.000** car-swing in
     frame, zero per-frame jolt, even steering hard the whole race.
  2. **A gentle dip as the nose tips up.** `camY` still lags the road height, but
     only the camera's own y rides it (not the aim), so the boom dips slightly
     entering a climb. Kept because Jason likes the drama, just softened —
     `CAM_FLOAT` 6 → 10 roughly halves it (measured dip ~0.12 m).
  3. **Rise to see over the crest — after a beat** (the headline ask: "moving up
     high vertically as you are climbing... visibility into curves that are coming
     after cresting the hill", refined to "camera drop as starting up, then a beat
     of delay, then a gentle rise as climbing and nearing the crest"). `camLift` =
     `max(0, camGradeSm) · CAM_CLIMB_LIFT` (15), where `camGradeSm` is a *lagged*
     grade (`CAM_GRADE_LAG` 2) — that lag is the whole trick. Cascading it into
     the lift's own follow (`CAM_LIFT_UP` 3 / `CAM_LIFT_DOWN` 1.5) makes an
     S-curve: **zero initial slope**, so the rise starts a beat late instead of
     ramping the instant the grade appears, which lets the `camY` dip (a faster
     lag) land first. The measured hill-entry sequence at a clean 10% step, as net
     camera-vs-road: −0.36 m at +0.2 s (dropped), −0.02 m at +0.5 s (the beat,
     back to neutral), +0.49 m at +1.0 s (rising) — drop, beat, rise. Slow release
     holds the height across the crest, then it settles. Grade-gated, so descents
     and flats are a plain chase cam (grade 0 → lift 0).
     **Height is deliberately modest** — a first pass at `CAM_CLIMB_LIFT` 30 (~3 m
     at a 10% climb) killed the sense of speed, so it's halved to 15 (~1.5 m). The
     visibility gain is real but smaller for it (the 30 version bought +22 m of
     road past the crest; half-height buys proportionally less), a trade Jason
     chose — speed sensation over sightline. `CAM_CLIMB_LIFT` is the height knob,
     `CAM_GRADE_LAG` the delay knob (lower = longer beat). On a short steep bump
     the beat compresses (the grade slams up, `camGradeSm` catches it fast); it's
     the sustained climbs where the drop/beat/rise reads cleanly, which is the
     case the feel was tuned for.
  y is driven entirely by that height sum and *overwritten* after the lerp (the
  lerp would add a vertical trail-lag that delays the lift). Terrain clearance
  stays healthy (~1.77 m worst at ×3, lift on) — the arithmetic trap is worth
  keeping though: a crest is cleared by grade × the camera's trail (~11.4 m at
  150 mph) = 1.1 m at 10%, **not** the road's vertical speed (6.7 m/s). The
  drone-float experiment in between (float the position with the aim locked but
  *no* climb lift, `CAM_FLOAT` as the only knob) is what proved the aim-lock rule
  and found the floor where lag sinks the camera through the road on climbs
  (below ~gain 3); the climb-lift model supersedes it.
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
  The fourth lift-the-car-didn't-need was the friction-circle cap itself **on
  corner exits** (fixed 2026-07-13, Jason: "get on the gas harder coming out of
  corners"): the cap solves for the load the car carries *now*, so on the way
  out it chases a falling number and stays a beat behind a human, who commits
  the moment he can see the exit open. `EXIT_PUSH` in ai.js relaxes the cap by
  up to 2x as the corner opens ahead (smoothed signal — the raw comparison
  flutters and chops the pedal duty). Worth −0.11 s (GTO L2) to −0.23 s ('Cuda
  maxed), roads clean, slip peak 0.08→0.16 — a visible squirt of power-on
  rotation. Two measured bounds, don't rediscover them: push 2 and even *no
  cap at all* are NO faster (the 'Cuda gets slower, 1.4 s/race sideways — push
  1 already recovers the cap's whole real cost; the 1.5 s a smooth never-
  braking proxy loses to the cap is mostly hidden by the real driver's brakes
  and line), and it's deliberately **not skill-scaled** (a lift the car didn't
  need is a bug at every skill, and the whole effect is under one star).
  Ladder check: street slots moved ≤0.21 s, boss margins tightened ≤0.14 s.
  Related, measured the same day and REJECTED — never relax `minHold` with
  skill: 0.05 at skill 1.0 alone put a maxed 'Cuda from 0.0 to 15.2 s/race in
  the dirt (the stab-overshoot limit cycle at speed).
- **The AI oversteers on purpose now** (Jason, 2026-07-13: "I can use oversteer
  to exit corners. This is consistently faster than the AI... run trials with a
  few techniques to find what is the fastest"). The trials said the win isn't a
  flashy drift move — it's *planning* like an oversteerer: in this physics the
  fast path through a binding corner is to arrive OVER the grip limit and let
  the steering bleed the excess (slip recovery bends the path on top of the
  grip cap, every scrub is capped, and the throttle keeps making power — the
  same physics behind "lifting is never worth it"). `DRIFT_PLAN` in ai.js banks
  extra planning grip (skill²-scaled: 2★ ~18% of it, boss ~70%, 5★ full), which
  in practice deletes brake time (roughly halved at skill 1). Load-bearing
  findings, all measured (16–32 seeds, flat-out-proxy yardstick):
  1. **A flat boost cannot work — the discriminator is the motor's surplus at
     corner speed.** Per-car clean ceilings differ 3x (GTO L2 takes +0.5 and
     gains 3.9 s; the maxed 'Cuda's ceiling is ~+0.15, and +0.5 puts it 9.6
     s/race in the dirt) because what kills the technique is a car that can
     *hold* its over-limit speed against the scrub: full-throttle surplus at
     corner speeds is ~3–6 m/s² for the GTO but 8–15 for the 'Cuda. `DRIFT_SUR`
     discounts each corner's boost by that surplus (computed per corner in the
     braking scan), which reproduced every per-car optimum from one global
     constant. Don't replace it with per-tier tuning — part levels move it.
  2. **Big-power cars need an over-limit lift, and it is the doctrine's own
     exception, not a violation.** Past the real limit the 'Cuda *accelerates*
     (+3 m/s² net mid-corner): its instLoad sits at `POWER_GRIP_FLOOR`, so the
     solved friction-circle cap resolves to ~1.0 and gives up exactly when
     needed. The lift fades throttle toward **drag-neutral** (hold speed, never
     slow the car itself — the scrub does the shedding) from realLoad 1.0, gated
     on `surplusAt(speed) > DRIFT_LIFT_SUR` so it never touches cars whose
     excess sheds on its own. Every other gate measured wrong: slip-gating fires
     too late (the 'Cuda must lift *before* the slide develops), lateral-gating
     likewise, no gate robs the GTO ~1 s, and thresholds above realLoad 1.0
     re-break the 'Cuda.
  3. **Rejected by trial**: exit-lift flicks and corner throttle-holds (both
     literal no-ops — the cap rarely binds where they fire); early "feasibility"
     braking for big stops (targeted hot arrivals that weren't the failure);
     trail-braking past the limit (cleanest 'Cuda of all, but braking's
     friction-circle exemption makes it a stealth un-boost — it robbed the GTO
     3+ s). And nothing helps the Model A: a stock car never touches its grip
     limit, so there is nothing for oversteer to buy (the whole feature is
     worth 0.00 s there, by design).
  4. Pace, 32 seeds, skill 1.0 vs the old planner: Deuce L1 −1.8 s, Merc L2
     −3.3, Bel Air stock −3.6, GTO L2 −3.6, Charger L3 −2.5, 'Cuda L1 −3.7,
     'Cuda maxed −2.1; offroad at or under the old numbers everywhere; AI slip
     peaks stay 0.07–0.17 — it reads as later braking and committed corners,
     not a drift show. The AI's remaining gap to the flat-out proxy is now
     mostly the proxy's free dirt line (deferred issue), not cornering.
  5. **Balance moved and the movement is healthy, but the boss gate rose.**
     Full build×slot matrix: every matched slot stays 100%, and the one-level-
     short cells got *more* binary (baseline had gone mushy at the top — T5/T6
     reach-up upsets of 75–94% dropped to 25–56%), so the judgment-game
     contract is stronger. Boss margins (maxed player, 16/16 wins everywhere):
     T0 5.05→3.20 s, T1 10.21→7.51, T2 10.27→6.91, T3 10.52→6.84, T4
     12.04→8.09, T5 12.84→9.02. This is the **fourth** boss tightening in a
     row: the readiness gate rose about half a part level (T0 at L2.5:
     16/16→12/16; T1 at L2: 15/16→9/16). (These tightenings are what
     eventually made the all-L3 boss unbeatable — resolved 2026-07-16 by
     pace-matching his build instead, see the balance-target entry;
     `BOSS_BUILD_SUM` is the boss knob now, `driftPlan`/planning grip later.)
- The racing line is real and skill buys it (Jason's call, 2026-07-12: "high
  tiers should take perfect lines, lower tiers less perfect but still in the
  ballpark"). `Track.racingOffset(d)` is the curvature-minimizing path through
  the corridor — not authored, *relaxed*: each station eases toward the midpoint
  of its neighbours (which straightens the path) and gets clamped back inside,
  400 passes. Out-in-out falls out on its own. `AIDriver.lineWeight`
  (`0.25 + 0.75*skill`) blends the aim point from "hold my lane" to the line, so
  a 1★ drives a *shallow* line and the boss drives it properly — a weak driver
  isn't driving a wrong line, he's using less of the road. Measured (24 seeds,
  solo, vs the old lane-holder): 1★ +0.14–0.23 s, 3★ +0.24–0.35 s, boss
  +0.32–0.50 s, and AI offroad went *down* (3★ 'Cuda 0.4 s → 0.0 s).
  Two load-bearing details:
  1. **`LINE_HALF_W` is set by what the AI can hold, not by the road edge.** The
     road allows 5.5; the line uses **3.6**. The AI steers on a virtual keyboard
     with a long lookahead (longest at high skill), so it cuts the apex and
     overshoots on exit — hand it the full-width line and it drives off the road.
     At skill 1.0, corridor → (time gain, offroad): 5.5 → (−1.3 s, 5.4 s off!),
     4.8 → (−0.3 s, 2.3 s), 4.2 → (+0.2 s, 0.8 s), 3.6 → (+0.34 s, 0.2 s). A
     shallow line the driver can hold beats a perfect one he can't. If the AI's
     lookahead or tap cadence is ever retuned, re-sweep this.
  2. The gain is **not** the textbook one. Nobody is braking and the low/mid cars
     never touch the dirt on either path — the line pays because the straighter
     path asks for less steering, so the car spends less time over the grip cap
     bleeding speed to `PLOW_SCRUB`/`SLIP_SCRUB`. Which is why a *bad* line
     genuinely loses: hugging every apex costs 1.2 s, running every corner wide
     costs 5.3 s and 9 s in the dirt. Good line rewarded, bad line punished,
     without touching the forgiving physics.
  Known conservatism: the AI still plans its braking off `curvatureAt` (the
  *centerline*), which is tighter than the line it actually drives, so it brakes
  a hair early. It barely brakes at all, so this is left alone.
  **The AI is blind to `grade`, and teaching it is a measured no-op — don't**
  (built and reverted 2026-07-17 at Jason's ask, after I flagged it as a latent
  gap when `HILL_SCALE` went to 3; the flag was wrong). The full principled
  version was written: `gradeAccel` exported from physics.js so planner and sim
  can't disagree, gravity folded into `surplusAt`, and the braking scan billed
  for it by energy (g·Δh over the run-up — endpoints only, exact however the
  road rolls in between). Result: **≤0.25 s in every cell** (Bel Air L1 / GTO L1
  / 'Cuda maxed / 'Cuda 3★, 16 seeds) at hills ×3, ×5 *and* ×7 — the last being
  ~30% grades, far past anything shippable.
  The mechanism is the point, because it generalises to any future longitudinal
  tweak. The gravity term is *not* small — 1.28 m/s² at ×3, 2.98 m/s² at ×7 —
  but it flips the brake **decision** in only **0.12–0.76% of frames**, because
  `needBrake` is *bimodal*: the foot is down everywhere (see above), so the scan
  is either far under the comfort threshold or far over it, and a 1–3 m/s² nudge
  almost never straddles 9.5. Even the 'Cuda, which brakes 14% of frames, flips
  0.34% at ×3. Grade cannot reach the AI's pace for the same reason the brake
  pedal is a trap for the player: in this game longitudinal forces don't govern
  pace, the steering scrub does. Gravity also never touches `vc` itself
  (`sqrt(grip·(1+boost)/k)` — grip and curvature only), which is where corner
  pace actually comes from.
  Corollary for the hills: `HILL_SCALE` is not gated on AI work. If it ever goes
  past ~5 the *camera* is the binding constraint (see the camera entry), not the
  planner. Re-open this only if the AI is ever made to genuinely brake — e.g. if
  the deferred free-dirt-line issue is taken up and it starts driving
  longitudinally — since the whole no-op rests on it barely braking.
  For the player the same line is worth **0.60–0.80 s** over a 3000 m race
  (32/32 seeds in the low/mid cars) — measured with two flat-out proxies,
  identical spec, neither lifting, differing only in the aim point. That's the
  answer to "does the line matter": it does, and it's now worth roughly what one
  star of AI skill is worth.
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
  rear-quarter tap fishtails catchably) and clunks (`sfx.clunk`,
  rate-limited in raceTick). Kicks are
  depth-weighted torque across all touching circle pairs so door-to-door
  torques cancel — side pressure shoves, only a lone corner clip yaws.
  Hits land as pending state, never instant steps (Jason confirmed smooth
  2026-07-11): `kickPending` rotates the knock in over ~0.15 s. Every
  contact speed change is reported via `contactLoss` (negative when contact
  *gave* speed), which raceTick adds back into the FOV-kick accel signal so
  contact never pulses the camera — instant versions of any of these read
  as stutter (FOV sawtooth + ~10°/frame mesh snap).
- **Rubbing is racing: contact trades speed, it never destroys it** (Jason's
  call, 2026-07-12 — "the cars slow way down when they touch, can this be
  removed?"). Two symmetric speed taxes used to bill both cars for any touch:
  a flat 0.3/s rub drag on *both* (≈12 m/s² at speed — a hidden brake for the
  crime of being alongside someone) and `CONTACT_SCRUB`, which slowed the
  hitter *and* the hit. Both are gone. In their place `resolveContact` does one
  equal-mass momentum trade along the deepest contact pair, rate-limited so it
  converges over ~0.2 s instead of stepping (that easing is what keeps the
  camera and mesh smooth — don't make it instant):
  along the **normal** it's the shunt (`CONTACT_PUSH`) — rear-end a slower car
  and he's fired forward by exactly what you lose; along the **contact face**
  it's rub friction (`CONTACT_RUB`, deliberately gentle) — so door-to-door at
  the same speed costs *nothing*, and only a speed *difference* scrubs, the
  faster car dragging the slower one along with it. Arcade guardrails:
  `CONTACT_REL_CAP` (12 m/s) caps the relative speed the trade will bill for,
  and `CONTACT_BOOST_ACC` (15 m/s²) caps the push a car can *receive* so a
  shunt is a shove, not a launch. Only the component along a car's travel
  direction can move a scalar speed (`applyContactImpulse`); the sideways part
  of a hit is what the heading kick is for. Measured (stock Model A, 8 m/s
  closing rear-end): hitter 40 → 35.1, hit car 32 → 35.5, and they then run
  locked together — a push, like it should be. Side-by-side rubbing at equal
  speed is now bit-identical to not touching at all (same speeds, same FOV
  trace), which is the check to re-run if this is ever retuned.
  Five stutter causes were fixed in one session; before touching this
  code, measure with the rub harness (4 s steer-into-contact: lateral
  sign flips, hit-event log, and a replica of the raceTick FOV pipeline
  counting FOV direction reversals — 5 reversals/4 s was the bad state,
  0 is correct). Earlier fixed causes, for pattern-matching: deepest-pair
  flip-flop jerking the push normal, per-frame micro-kicks, and the slam
  threshold acting as a feedback setpoint (impact pinned at exactly 5.00
  every frame — cooldown must gate slams too). `_contact`/`_hitCool` are
  pair state on the first car — fine for 2 cars, needs a pair key for 3+.
- **The AI leans back** (Jason's call + playtested 2026-07-12, "perfect", the
  natural sequel to speed-trading contact). `AIDriver.leanBack()` holds steering
  pressure *into* a car that's leaning on him, so a door fight is two drivers
  pushing and the contact model splits the difference. Three load-bearing
  design points, two of which I got wrong first and only measurement caught:
  1. It is steering **pressure** (added to `steerWant`), not a lane bias. The
     obvious implementation — bias his aim lane toward you — is a **literal
     no-op**: 1 m of lane at racing lookahead is only ~0.07 of steer, which is
     *under* his own 0.12 re-press deadband, so his virtual keyboard never sees
     it. Any future "nudge the AI's line" feature hits this same floor — if a
     bias is smaller than the deadband it does not exist.
  2. It is gated on **actual contact** (`CarSim.touching`, set by
     `resolveContact`), never on proximity. Distance gating is not fixable by
     tuning: at any believable reach, a car merely running *alongside* 2.6 m
     away is inside it, so the AI steers into a player who is quietly holding
     his own lane and drags you both across the road. He answers contact; he
     never starts it, and he never blocks — pass him cleanly and he lets you.
     `LEAN_HOLD` (0.35 s) keeps the lean alive through a bounce so it doesn't
     strobe as panels part and re-touch.
  3. The lean **fades out once the car being leaned on runs out of road**
     (`LEAN_SPARE`) — he'll hold you door-to-door, he won't run you into the
     weeds; that bound is what keeps this inside the forgiving physics. But the
     fade applies *only* when the lean would shove you outward: when **you're**
     the one running **him** off, he leans back with everything he has.
  `aggro` (0..1) is rolled per racer in `makeRoster` **independent of skill** —
  a 2★ can be a bruiser and a 5★ can be clean, so racecraft is a personality you
  learn per name, not a second star bar. Freddy 0.2 (he gives you the room),
  bosses 1.0 (your car is on the hood). Nothing on the opponent card hints at
  it — deliberate for now, a bruiser is a surprise the first time.
  Measured, 8 s of the player leaning on a straight — metres the AI is shoved
  out of his lane: aggro 0 → 3.84 (the old passive AI: you push him clean off
  the road), 0.5 → 1.48 (gives ground grudgingly), 1.0 → −2.15 (he wins the
  shoving match). In a 12 s "try to run the AI off the road" test the passive AI
  ends up 10.5 s in the dirt and drags the player off with it (8.9 s); at aggro
  ≥0.5 **neither car leaves the road at all**. Balance is untouched: 16-seed
  solo pace is identical to 0.01 s between aggro 0 and 1 — leaning is free when
  nobody is touching you, which is the regression check to re-run.
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

**For economy/progression questions, sim a whole career, not a race.** `economy.js`
is DOM-free precisely so a Node script can `import` it, hand it a `player` object,
and play the ladder end to end: shop → `makeRoster` → race the pick with the real
`CarSim`/`AIDriver` (player = the flat-out human proxy, see below) → settle the
wager → repeat, counting races per class. Seed `Math.random` with an LCG so a
career replays. 16 careers runs in about a minute and it is the *only* way to see
the failure modes that are invisible in a single race — the $25 death spiral, the
"spending on parts shrinks your wagers" trap, and the fact that a coin-flip race
has zero expected growth all showed up here and nowhere else. Two smaller sweeps
paid for themselves too, and are worth rebuilding if the ladder is ever retuned:
**boss win-rate by player build** (which is what "ready for the boss" actually
means, per tier) and the **win-rate matrix of player build × wager slot** (which
is what proves the board is a judgment call and not a lottery).
The trap to avoid: the harness's *player policy* will dominate your numbers if
you let it. My first proxy gambled into races it couldn't win and measured 44
races/class — a fact about my policy, not the game. Make the policy the one the
UI actually invites (2026-07-15 tuning used: buy the cheapest next part while
staying over the broke line; take the biggest wager at least 0.2 build levels
below you; don't stake 70%+ of the pile on a card within 0.5 of your level) and
sanity-check a verbose per-race log before believing any aggregate.
Two harness facts found 2026-07-15, both load-bearing for future sims:
1. **The proxy needs a keep-air dodge or every race is a tie.** A flat-out
   proxy and the AI both converge on the racing line, touch, and the contact
   trade speed-locks them to a 0.1 s photo finish for the whole race. Give the
   proxy a sidestep when overlapped (±3.2 m off the other car inside 14 m) —
   a human doesn't ride the opponent's door for 90 seconds.
2. **Matched builds are photo finishes in current code** (drift-planner +
   draft-hunting made the AI that fast): equal build 3★+ ties or beats the
   proxy; one level down is a near-sure win; one up a near-sure loss. Any
   economy tuning has to put the income on the below-your-level cards.

**Warm the browser before the first screenshot, and never trust screenshot #1.**
The first `page.screenshot` of a cold headless browser came back with the road
ribbon, the dashes and the edge lines *all* missing, while trees, banner and cars
rendered normally — a probe at that same moment showed the mesh visible, in the
scene, 1942 verts, bounding sphere intact, and the renderer issuing all 82 draw
calls. It's a capture artifact of the cold GPU process, and it only hit the first
page of the run; a throwaway screenshot plus a settle before measuring fixes it.
Worth knowing how it was caught, because a screenshot that plausible is a trap:
the A/B included a palette whose colour was *deliberately unchanged*, and when
that one measured a difference the harness convicted itself. Put an unchanged
cell in any visual A/B — it's the cheapest possible check on your own rig.

Two traps when driving the game from a headless test, both of which cost real
time on 2026-07-16:
1. **You cannot force the palette by counting `Math.random` calls.**
   `buildRaceScene` picks `PALETTES[floor(Math.random() * 4)]` as its first
   statement, so a stub returning the palette on call #1 and an LCG afterwards
   looks exactly right — and is wrong by about **3000 calls**: `sfx.uiSelect()`
   synthesises its noise from `Math.random`, and the Enter that starts the race
   fires it. Use a **constant** stub (`Math.random = () => r`): every call
   returns r, so `floor(r*4)` is the palette whatever the call order, and
   varying r *inside that palette's quarter* of [0,1) still moves the track seed
   (`r*1e9`) so seeds differ. `race.palette` is exposed for exactly this — assert
   on what you forced, or the harness will quietly measure the same scene N times
   and report a clean pass.
2. **Wait on DOM state, never on a timeout.** `finishRace` defers RESULTS by a
   real 1.8 s (`setTimeout` in main.js), so Escape → Enter → Space → Enter on
   fixed 350 ms waits lands every keypress back in RACE, where it does nothing
   and the scene silently never rebuilds. Poll
   `!classList.contains("hidden")` on `resultScreen` / `garageScreen` /
   `opponentScreen` / `hud`. Escape bails a race (`states.RACE.onKey`), which is
   what lets a test cycle scenes without a page reload — far faster than a new
   page per case.

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
- **One lateral sign convention: `+` is the LEFT normal `(cos h, −sin h)`.**
  Everything that offsets from the centerline uses it — `lane`, `racingOffset`,
  `startLateral`, the boundary — but `project()` used to return the *opposite*
  sign (`+` = right). It hid for the life of the project because every other
  reader takes `|lateral|` (offroad, `LEAN_SPARE` room) or compares two laterals
  to each other (`leanBack`'s `dl`), and both are sign-symmetric. The one place
  that mixed the two was the soft boundary: it took the side from `project()`
  and placed the car with the left normal, so running off one side **teleported
  you across the road** (measured before the fix: −21.2 → +21.0 lateral in one
  frame, a 42 m jump; Jason: "almost like it portals"). Fixed 2026-07-12 by
  flipping `project()` to the house convention. If you add a signed-lateral
  reader, it's left-positive.
- The soft boundary is a **berm you glance off**, not a wall and not a clamp
  (rewritten 2026-07-12 with the portal fix). At `ROAD_HALF_W + 14` it mirrors
  the travel direction back across the boundary — `rel = velHeading − road
  heading`, and reflecting `rel` about 0 flips the lateral part (`sin rel`) and
  leaves the along-road part (`cos rel`) alone, so it turns you back in without
  stopping you. `BOUNCE_KEEP` is restitution (0 = slide along it, 1 = full
  mirror), `BOUNCE_SCRUB` bills the speed you carried *into* it, `BOUNCE_MIN`
  keeps a gentle graze a slide rather than a hit. Three load-bearing details:
  the bounce plays in over ~0.2 s through `bouncePending` (instant snapped the
  mesh — same lesson as `kickPending`), it rotates **heading only** (a contact
  kick moves heading+slip together to leave the travel direction alone; a berm
  genuinely *changes where you're going*), and the scrub is billed to
  `contactLoss` so the camera's accel signal doesn't pop the FOV.
  Never *rebuild* the position from `sample()` to hold the car in — correct the
  **overshoot** only. Out at 19 m of lever arm, `sample()`'s interpolated normal
  and the polyline projection disagree by ~2 m, so re-placing the car snapped it
  that far in one frame (the original code did this; it was a second, smaller
  teleport riding along with the big one). Regression checks: fling the car off
  each side (`__race.player.heading += ±1.0` at speed) and assert zero far-out
  sign flips and no step bigger than a frame of travel; 16-seed AI pace is
  unchanged to 0.01 s, since the AI never gets near the berm.
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
- **`renderer.info` cannot see shadow cost.** `info.reset()` runs *after* the
  shadow pass in `WebGLRenderer.render` (three.module.js:29600), so every shadow
  draw call and triangle is wiped from the count before you can read it. An A/B
  on `info.render.calls` with shadows on vs off measures nothing but scene
  variation between the two sample windows — it read +3 calls / +45 triangles for
  two entire cars, which is what gave the game away. Frame timing is the only
  handle the smoke tests have on it, and under swiftshader that's software raster
  (see the shadow entry: it exaggerates fill enormously). Same family as the
  banner-mirror lesson — the obvious proxy was structurally blind to the thing
  being measured.
- Shadow maps are **render targets, not materials**, so `disposeScene`'s
  geometry/material sweep never freed them — a 2048² map is ~16 MB leaked per
  race scene, and a career is dozens of races. It now disposes
  `light.shadow.map` explicitly. Any future per-scene render target needs the
  same treatment; nothing else in the teardown path will catch it.
- `/home/cromulon` briefly had a stray commit-less `.git` (deleted
  2026-07-10). If `git add -A` ever stages home-dir files again, stop —
  wrong repo root.
- Commit messages: repo history starts at `2e79ae4`; branch is `main`.
- A dev server from an earlier session may still be running on port 8471.
