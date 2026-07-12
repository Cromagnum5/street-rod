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

export class AIDriver {
  constructor(car, track, skill, lanePreference = 2.5) {
    this.car = car;
    this.track = track;
    this.skill = skill;
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
  }

  // Returns { throttle, brake, steer }
  drive(dt, raceTime, playerDist) {
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
    lane = Math.max(-(ROAD_HALF_W - 1.6), Math.min(ROAD_HALF_W - 1.6, lane));
    const nx = Math.cos(target.heading), nz = -Math.sin(target.heading);
    const tx = target.pos.x + nx * lane, tz = target.pos.z + nz * lane;

    const desired = Math.atan2(tx - car.x, tz - car.z);
    let dh = desired - car.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const steerWant = Math.max(-1, Math.min(1, dh * 2.4));

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
}
