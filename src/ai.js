// AI driver: pure-pursuit steering toward a lookahead point on the centerline,
// with corner-speed planning from track curvature. `skill` (0..1) scales how
// hard the driver pushes; a light rubber band keeps races close but honest.
//
// The pursuit math produces analog "intent", but the driver actually plays
// on a virtual keyboard like the human: controls leave here as on/off key
// states. Steer is closed-loop tapping (press toward the want, hold it a
// human-length beat, release past it) run through the same dt*9 ramp
// raceTick applies to the player's keys; pedals are duty-cycle taps. That's
// what makes a passing AI weave and correct like a human instead of
// tracking a spline. The foot is down by default everywhere (Jason's call,
// 2026-07-11): only the brakes and the friction circle take it away, exactly
// like the player. Skill expresses in how early it brakes and how close to the
// grip limit it plans — not in a lifted throttle.

import { ROAD_HALF_W } from "./track.js";
import { POWER_GRIP_FLOOR } from "./physics.js";

// Racecraft: how the driver reacts to a car leaning on him. He does not swerve
// at you and he does not block — he simply refuses to be moved, holding a little
// steering pressure into the car in his door, so a door-to-door fight is two
// drivers each pushing and the contact model splits the difference.
//
// This is steering PRESSURE (added to steerWant), not a lane offset, and that
// distinction is the whole feature: a lane bias big enough to feel (1 m) is only
// ~0.07 of steer at racing lookahead, which is *under* the driver's own 0.12
// re-press deadband — his virtual keyboard never sees it and the lean does
// nothing at all (measured). Pressure goes through the same keyboard, so he
// leans on you with the same clumsy human hands he drives with.
//
// Bounded so it stays racing and never becomes a punt:
//  - it is gated on ACTUAL CONTACT (`car.touching`, set by resolveContact), not
//    on proximity. Gating on lateral distance instead was measurably wrong: at
//    any believable reach, a car merely running alongside 2.6 m away is inside
//    it, so the AI would steer into a player who was quietly holding his own
//    lane and drag you both across the road. He answers contact; he never
//    starts it. LEAN_HOLD keeps the lean alive briefly through a bounce so it
//    doesn't chatter as panels part and re-touch.
//  - it needs real side-by-side overlap (SIDE_BY_SIDE), so a rear-ender doesn't
//    read as a door-to-door fight,
//  - it's a fraction of lock (LEAN_MAX), not a swerve,
//  - and it fades out once the car being leaned on runs out of road
//    (LEAN_SPARE). He'll hold you door-to-door; he won't run you into the
//    weeds. That bound is what keeps this inside the forgiving physics.
const SIDE_BY_SIDE = 5.5;  // m of longitudinal overlap that counts as alongside
const LEAN_HOLD = 0.35;    // s the lean outlives the contact that triggered it
const LEAN_MAX = 0.38;     // fraction of steering lock he'll hold into you
const LEAN_SPARE = 2.4;    // m of road he leaves you before he stops leaning

// Hunting the wake (see the drafting entry in CLAUDE.md). A driver behind you on
// a straight moves over into your tow, rides it up to your bumper, then steps out
// and slingshots past. Unlike leanBack this really *is* a lane offset, and that's
// legitimate: lining up with a wake is a multi-metre lateral move, far above the
// keyboard deadband that made a 1 m lean bias a no-op.
//
// Skill is the whole difficulty knob: it scales the pressure he puts into lining
// up, and since that pressure has to clear his own keyboard deadband to exist at
// all, it *self-limits* — a 1-star pushes toward the dirty air until the last
// metre or so falls under his deadband and he stops, collecting a fraction of the
// tow; a 5-star squares up behind you and takes all of it. That falloff is the
// mechanic, not a tuned curve.
//
// Learned the hard way (twice now — see leanBack): this CANNOT be a lane bias.
// Biasing the pursuit aim lane toward your wake looks right and measures as a
// literal no-op, because at a racing lookahead of ~46 m a 2 m lateral error is
// only ~0.11 of steer — under the 0.12 re-press deadband. Steering pressure with
// its own short aim distance (WAKE_AIM) is what actually reaches the keyboard.
// WAKE_MIN is only "we're basically touching, let the contact model have it" —
// it must NOT be set at bumper range. The tow is strongest right behind you, so
// that is exactly where he has to keep holding station; an earlier cut-off at 6 m
// made him find the wake and then abandon it the moment it started paying.
const WAKE_MIN = 2;         // m — below this they're in contact, not drafting
const WAKE_MAX = 26;        // m — base reach; skill adds the run-up below
const WAKE_APPROACH = 20;   // extra m of run-up a good driver uses to line up early
const WAKE_STRAIGHT = 6e-4; // curvature above which the racing line beats the tow
const WAKE_AIM = 12;        // m — he lines up with a short deliberate look at the car
                            // ahead, NOT through his long racing lookahead (see above)
const WAKE_STEER_MAX = 0.45; // fraction of lock: a move across, never a swerve
const SLINGSHOT = 6;        // m gap inside which, with a run on you, he pulls out
const SLINGSHOT_OUT = 2.8;  // m he steps aside to make the pass

export class AIDriver {
  constructor(car, track, skill, lanePreference = 2.5, aggression = 0.6) {
    this.car = car;
    this.track = track;
    this.skill = skill;
    // 0..1: how hard he leans back when you lean on him. Racer personality —
    // set per-opponent in makeRoster, not derived from skill, so a 2-star can
    // be a bruiser and a 5-star can be clean.
    this.aggression = aggression;
    this.lane = lanePreference;      // preferred lateral offset (stays out of your lane... mostly)
    // How much of the track's racing line this driver actually drives, vs just
    // holding his lane. 0 = holds his lane like a bus, 1 = drives the line.
    // Skill buys the line: 1-star ~0.44, 3-star ~0.70, 5-star/boss 1.0.
    this.lineWeight = 0.25 + 0.75 * skill;
    this.reaction = 0.35 + (1 - skill) * 0.9; // seconds before the steering brain wakes up
    this.wobblePhase = Math.random() * 10;
    this.t = 0;
    // virtual keyboard: better drivers tap faster (finer duty control)
    this.tapPeriod = 0.3 - 0.14 * skill;      // steering tap cycle, seconds
    this.pedalPeriod = 0.5 - 0.25 * skill;    // corner throttle/brake duty cycle
    // a press is a deliberate stab, not a one-frame flick: once down, the key
    // stays down at least this long (worse drivers make coarser stabs)
    this.minHold = 0.09 + 0.09 * (1 - skill);
    this.steer = 0;                       // smoothed key steer, like race.steer
    this.steerKey = 0;                    // current key state: -1 / 0 / +1
    this.keyT = -1;                       // when the key state last changed
    this.leanT = 99;                      // seconds since a panel last touched his
  }

  // Returns { throttle, brake, steer }
  drive(dt, raceTime, playerDist, player = null) {
    const car = this.car;
    this.t += dt;
    if (raceTime < this.reaction) {
      // launch is floored from the green — the car was revving at the line
      // and holds it down; only corner planning/steering wakes up late
      this.steer += (0 - this.steer) * Math.min(1, dt * 9);
      return { throttle: 1, brake: 0, steer: this.steer };
    }

    // gentle rubber band: struggling AI finds a little extra, runaway AI lifts.
    // It scales the planning grip (not the speed target) so it reaches both the
    // corner cap and the braking scan — with the throttle flat-out by default,
    // a target-only band could no longer help a trailing AI, only slow a
    // leading one. Squared, because speed goes as sqrt(grip).
    const gap = car.trackDist - playerDist; // positive = AI ahead
    const band = Math.max(-1, Math.min(1, -gap / 120));
    const bandMul = 1 + band * (0.10 - 0.06 * this.skill);

    // --- speed planning: slowest corner in the next few seconds ---
    // cornerGrip folds in the steady-state body-roll penalty, so soft-sprung
    // AI plans slower corners instead of understeering off the road
    // Planning grip is *at or over* the car's real limit, because that is where
    // a human actually drives: a keyboard steer over-asks for yaw, the car
    // plows/slides a little, and it gets round the corner anyway on a 14 m road.
    // Planning under the limit (this used to be 0.90-0.98) made the AI arrive at
    // every corner with grip in hand and no way to spend it.
    const grip = (car.stats.cornerGrip ?? car.stats.grip)
      * (0.98 + 0.10 * this.skill) * bandMul * bandMul;

    // The only thing that lifts the foot is a corner the car genuinely cannot
    // make. Scan the whole braking distance and find the decel the most binding
    // corner demands; brake only past a skill-scaled comfort threshold.
    const comfort = 6.5 + 3.0 * this.skill; // m/s^2 decel that gets the driver on the brakes
    const scan = Math.max(60, car.speed * car.speed / (1.7 * comfort));
    let needBrake = 0;
    for (let ahead = 15; ahead <= scan; ahead += 12) {
      const k = this.track.curvatureAt(car.trackDist + ahead);
      if (k > 1e-4) {
        const vc = Math.sqrt(grip / k);
        if (car.speed > vc) {
          needBrake = Math.max(needBrake, (car.speed * car.speed - vc * vc) / (2 * ahead));
        }
      }
    }

    // The foot is down everywhere unless a corner physically demands otherwise.
    // Speed in a corner is managed by the STEERING — the plow scrub and the slip
    // angle bleed exactly as much as the corner needs — which is how the player
    // drives (Jason, 2026-07-12: "in the Model A I keep the gas down for 100% of
    // the race"). What used to live here was an "ease" band that dropped to 55%
    // throttle whenever the car was carrying more than the planned corner speed.
    // It fired in corners the car could take flat, and because the pedal is a
    // duty-cycle tap it was *audible*: Jason could hear the AI feathering
    // alongside him. Measured, the AI's corner throttle duty was 0.95 in a stock
    // Model A whose corners only use 59% of the grip available — it was lifting
    // for nothing. Corner pace is now capped by the brakes and the friction
    // circle, which is what caps the player.
    let throttle = 1, brake = 0;
    if (needBrake > comfort) {
      brake = Math.min(1, needBrake / 7); // /7 not /8: arrive a hair under
      throttle = 0;
    }

    // friction-circle awareness: throttle eats lateral grip (physics.js), so
    // budget the corner-throttle duty by what the circle actually leaves. At a
    // lateral load of `realLoad` the tires still have sqrt(1 - load^2) of drive
    // budget — solve for that instead of interpolating toward a lift, and the
    // AI stays on the power right up to the limit. Near-stock cars can't load
    // the circle at corner speed and simply keep their foot in it.
    // load vs the car's real grip (not the skill-discounted planning grip):
    // low-skill margin is genuine headroom, don't lift inside it
    const kNow = this.track.curvatureAt(car.trackDist + car.speed * 0.4);
    const realLoad = kNow * car.speed * car.speed / (car.stats.cornerGrip ?? car.stats.grip);
    const instLoad = Math.min(1, car.stats.power / Math.max(car.speed, 5) / (car.stats.grip * car.stats.mass));
    // 0.97: a hair of anticipation, so the pedal eases before the tires let go
    const latNeed = Math.min(1, realLoad / 0.97);
    // POWER_GRIP_FLOOR: physics never squeezes the lateral share below it, so
    // below that load full throttle can't break the corner anyway
    const driveRoom = Math.max(POWER_GRIP_FLOOR, Math.sqrt(Math.max(0, 1 - latNeed * latNeed)));
    if (instLoad > 1e-3) throttle = Math.min(throttle, driveRoom / instLoad);

    // --- steering: pure pursuit toward the line the driver is trying to drive ---
    const lookahead = 10 + car.speed * (0.55 + 0.25 * this.skill);
    const aimDist = car.trackDist + lookahead;
    const target = this.track.sample(aimDist);
    // Where he's aiming: somewhere between "hold my lane" and the true racing
    // line, by skill (see lineWeight). A weak driver isn't driving a *wrong*
    // line, he's driving a shallow one — he uses less of the road, so he gets
    // the shape of the corner right but leaves time on it. A 1-star uses about
    // half the line's width, a 5-star/boss drives it properly.
    const line = this.track.racingOffset(aimDist);
    // slow lane drift, not a slalom: the period is long enough (~16 s) that
    // holding it costs only occasional small trims (Jason's wobble fix #2)
    const wobble = (1 - this.skill) * Math.sin(this.t * 0.4 + this.wobblePhase) * 0.5;
    let lane = line * this.lineWeight + this.lane * (1 - this.lineWeight) + wobble;
    // ...and if there's a tow on this straight, he aims at it instead of his line.
    // This is NOT what makes him move over (that's the pressure term below, which
    // is the only part his keyboard can feel) — it's what stops his own pursuit
    // from fighting the move and holding him a couple of metres wide of the tow.
    const wk = this.wake(player);
    if (wk) lane = lane * (1 - wk.commit) + wk.lane * wk.commit;
    lane = Math.max(-(ROAD_HALF_W - 1.6), Math.min(ROAD_HALF_W - 1.6, lane));
    const nx = Math.cos(target.heading), nz = -Math.sin(target.heading);
    const tx = target.pos.x + nx * lane, tz = target.pos.z + nz * lane;

    const desired = Math.atan2(tx - car.x, tz - car.z);
    let dh = desired - car.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    // ...plus the lean: pressure held into whoever is leaning on him. It rides
    // on top of the pursuit want, so in a corner the line still gets driven —
    // he leans while racing, he doesn't abandon the corner to fight you.
    // ...plus the wake: pressure toward the tow of the car ahead, on straights.
    const steerWant = Math.max(-1, Math.min(1,
      dh * 2.4 + this.leanBack(dt, player) + this.wakeSteer(player)));

    // --- virtual keyboard: closed-loop key tapping ---
    // Press toward the wanted steer, release once past it — but the key
    // state can only flip as fast as a human taps (dwell), so the actual
    // steer hunts around the target instead of tracking it. Big wants get
    // held solid: full lock is the one thing a keyboard does perfectly.
    // Presses are deliberate stabs (minHold — Jason wants visible human-size
    // wheel swings, not one-frame flicks; approved 2026-07-11, superseding
    // the old instant-release rule), except a wrong-direction press still
    // lets go immediately. Re-presses are tap-rate limited (dwell) and
    // deadbanded — a human doesn't chase 0.1-size errors with a full stab;
    // overshoot sheds by itself on release.
    const dwell = this.tapPeriod * 0.5;
    const dir = Math.sign(steerWant);
    if (Math.abs(steerWant) > 0.85) {
      this.steerKey = dir;
      this.keyT = this.t;
    } else if (this.steerKey !== 0) {
      // hold a beat past "enough" in big corners (lazy release), so the
      // tap-band straddles the want instead of sagging under it
      const past = steerWant * 1.2;
      const done = this.steerKey > 0 ? this.steer >= past : this.steer <= past;
      // stab length tracks the correction: full minHold only for real corners,
      // small straight-line trims get a crisp short tap — a full-length stab
      // there overshoots and demands a counter-stab, and the car wobbles
      // down the straight in a limit cycle (Jason saw it, 2026-07-11)
      const hold = Math.max(0.03, this.minHold * Math.min(1, Math.abs(steerWant) / 0.5));
      if (this.steerKey !== dir) this.steerKey = 0;
      else if (done && this.t - this.keyT >= hold) this.steerKey = 0;
    } else if (dir !== 0 && Math.abs(steerWant - this.steer) > 0.12 && this.t - this.keyT >= dwell) {
      this.steerKey = dir;
      this.keyT = this.t;
    }
    // same ramp raceTick applies to the player's digital steer
    this.steer += (this.steerKey - this.steer) * Math.min(1, dt * 9);

    const pPhase = (this.t / this.pedalPeriod) % 1;
    const thrKey = throttle > 0.95 ? 1 : throttle < 0.1 ? 0 : pPhase < throttle ? 1 : 0;
    const brkKey = brake > 0.85 ? 1 : brake < 0.12 ? 0 : pPhase < brake ? 1 : 0;

    return { throttle: thrKey, brake: brkKey, steer: this.steer };
  }

  // Where the tow is and how hard he's willing to go get it — or, once he has a
  // run on you, where to step out to and pass. null when there's no tow worth
  // chasing, and he just races his own line.
  //
  // Deliberately straight-line only: through a corner the racing line is worth
  // more than the tow, and chasing a wake through a bend only drives him off the
  // line and into the scrub terms. Real drivers draft on the straights; so does he.
  wake(player) {
    if (!player || player.finished || this.car.finished || this.skill <= 0) return null;
    const gap = player.trackDist - this.car.trackDist; // + = you're ahead of him
    const reach = WAKE_MAX + WAKE_APPROACH * this.skill; // good drivers see it coming
    if (gap < WAKE_MIN || gap > reach) return null;
    // Is the road ahead straight enough to be worth a tow? Scan the whole stretch
    // he'd be committed through, not a single point: sampling one spot a half-
    // second ahead let a fast car commit to the wake lane on the last of a
    // straight and then arrive at the corner off its line (measured — it doubled
    // the boss's time in the dirt). The most binding curvature in the window wins.
    let k = 0;
    for (let ahead = this.car.speed * 0.4; ahead <= this.car.speed * 1.6; ahead += 15) {
      k = Math.max(k, this.track.curvatureAt(this.car.trackDist + ahead));
    }
    const straight = Math.max(0, 1 - k / WAKE_STRAIGHT);
    if (straight <= 0) return null;

    let lane = player.lateral; // the hole in the air: square up behind him
    // The slingshot. Once he's on your bumper with a run on you, he pulls out of
    // the tow and goes by. Without this he'd ride your wake to the finish line —
    // the draft would make him *follow* better instead of *race* better.
    if (gap < SLINGSHOT && this.car.speed > player.speed + 0.5) {
      lane = player.lateral + (player.lateral > 0 ? -1 : 1) * SLINGSHOT_OUT; // roomier side
    }
    // Commitment fades with distance as well as skill. Without the distance term
    // he mirrors your every lane change from 45 m back like a duckling — which is
    // shadowing, not drafting. Far out he only leans toward the tow; on your
    // bumper, where the tow is actually worth something, he commits to it.
    const near = 1 - Math.min(1, (gap - WAKE_MIN) / (reach - WAKE_MIN));
    const commit = straight * (0.25 + 0.75 * this.skill) * (0.35 + 0.65 * near);
    return { lane, commit };
  }

  // Steering pressure (fraction of lock) toward the tow. This rides on top of the
  // pursuit want, and it is the half that actually reaches his hands: aiming the
  // pursuit at the wake alone leaves the last couple of metres generating less
  // steer than his re-press deadband, so he'd stall out wide of the tunnel (that
  // version measured as a total no-op — see the note above the constants).
  // Skill scales the pressure, and then the deadband does the rest for free: a
  // weak driver's push falls under it while he's still a metre or two wide, so he
  // wanders into the dirty air and never quite finds the clean tow. That falloff
  // is the skill gradient — it isn't tuned, it's the controller's own floor.
  wakeSteer(player) {
    const wk = this.wake(player);
    if (!wk) return 0;
    const err = wk.lane - this.car.lateral; // + = the tow is to his left
    const push = Math.max(-WAKE_STEER_MAX, Math.min(WAKE_STEER_MAX, (err / WAKE_AIM) * 2.4));
    return push * wk.commit;
  }

  // Steering pressure (fraction of lock) held *into* a car leaning on him.
  // Reactive by design: it only answers a car already against his panels, so
  // you can still pass him cleanly if you're quicker — he leans back on you,
  // he doesn't block you.
  leanBack(dt, player) {
    if (this.car.touching) this.leanT = 0;
    else this.leanT += dt;
    if (!player || this.aggression <= 0) return 0;
    // fade out over LEAN_HOLD once you're off him, so bouncing apart and
    // re-touching doesn't strobe the lean on and off
    const fade = 1 - Math.min(1, this.leanT / LEAN_HOLD);
    if (fade <= 0) return 0;
    // alongside? (longitudinal overlap; both are on the same centerline metric)
    // A rear-ender is contact too, and it must not read as a door fight.
    const along = Math.abs(player.trackDist - this.car.trackDist);
    const overlap = 1 - Math.min(1, along / SIDE_BY_SIDE);
    if (overlap <= 0) return 0;
    const dl = player.lateral - this.car.lateral; // + = player is track-left of him
    const push = Math.sign(dl); // leaning always shoves you away from him
    // Does he have room to lean without putting you in the dirt? Once your
    // outside wheels near the edge the lean fades out — he'll hold you
    // door-to-door, he won't run you off the road. This only applies when the
    // lean would shove you *outward*: if he's the one being run out of road
    // (you're inboard of him), he leans back with everything he has, which is
    // exactly when a real driver would.
    let room = 1;
    if (push === Math.sign(player.lateral)) {
      room = Math.max(0, Math.min(1,
        (ROAD_HALF_W - LEAN_SPARE - Math.abs(player.lateral)) / 1.5));
      if (room <= 0) return 0;
    }
    return push * overlap * fade * room * this.aggression * LEAN_MAX;
  }
}
