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
// tracking a spline. Straights are sacred: every driver floors it flat-out
// there (Jason's call, 2026-07-11) — skill expresses in the corners.

import { ROAD_HALF_W } from "./track.js";
import { POWER_GRIP_FLOOR } from "./physics.js";

export class AIDriver {
  constructor(car, track, skill, lanePreference = 2.5) {
    this.car = car;
    this.track = track;
    this.skill = skill;
    this.lane = lanePreference;      // preferred lateral offset (stays out of your lane... mostly)
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

    // --- speed planning: slowest corner in the next few seconds ---
    // cornerGrip folds in the steady-state body-roll penalty, so soft-sprung
    // AI plans slower corners instead of understeering off the road
    const grip = (car.stats.cornerGrip ?? car.stats.grip) * (0.86 + 0.12 * this.skill);
    // corner we're in (or about to enter): hold its speed. Straights are
    // flat-out for everyone — vmax is asymptotic, so a target above it never
    // lets the pedal band engage; corners set the real cap
    let targetSpeed = car.vmax * 1.05;
    for (let ahead = 8; ahead <= 15 + car.speed * 0.5; ahead += 7) {
      const k = this.track.curvatureAt(car.trackDist + ahead);
      if (k > 1e-4) targetSpeed = Math.min(targetSpeed, Math.sqrt(grip / k));
    }

    // corners further out: brake late, when physics demands it, instead of
    // coasting down the moment a corner enters the lookahead. Scan the whole
    // braking distance and find the decel the most binding corner requires.
    const comfort = 4.0 + 3.2 * this.skill; // m/s^2 decel that gets the driver on the brakes
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

    // gentle rubber band: struggling AI finds a little extra, runaway AI lifts
    const gap = car.trackDist - playerDist; // positive = AI ahead
    const band = Math.max(-1, Math.min(1, -gap / 120));
    targetSpeed *= 1 + band * (0.10 - 0.06 * this.skill);

    let throttle = 0, brake = 0;
    if (needBrake > comfort) brake = Math.min(1, needBrake / 7); // /7 not /8: arrive a hair under
    else if (needBrake > comfort * 0.7) throttle = 0;            // lift and coast to the marker
    else if (car.speed < targetSpeed - 1) throttle = 1;
    else if (car.speed > targetSpeed + 2) brake = Math.min(1, (car.speed - targetSpeed) / 8);
    else throttle = 0.55;

    // friction-circle awareness: throttle eats lateral grip (physics.js), so
    // budget the corner-throttle duty by how much grip this car's pedal
    // actually eats. Near-stock cars barely load the circle and keep their
    // pace; a built machine lifts and coasts through its binding corners.
    // load vs the car's real grip (not the skill-discounted planning grip):
    // low-skill margin is genuine headroom, don't lift inside it
    const kNow = this.track.curvatureAt(car.trackDist + car.speed * 0.4);
    const realLoad = kNow * car.speed * car.speed / (car.stats.cornerGrip ?? car.stats.grip);
    const instLoad = Math.min(1, car.stats.power / Math.max(car.speed, 5) / (car.stats.grip * car.stats.mass));
    const shareOn = Math.max(POWER_GRIP_FLOOR, Math.sqrt(1 - instLoad * instLoad)); // lateral share left while the pedal is down
    // 0.95: lift a beat early — high-skill planners run ~2% grip margin and
    // need the anticipation; low-skill plans sit far below this anyway
    if (realLoad > 0.5 && shareOn < 0.995) {
      throttle = Math.min(throttle, Math.max(0, (0.95 - realLoad) / (1 - shareOn)));
    }

    // --- steering: pure pursuit toward centerline + preferred lane ---
    const lookahead = 10 + car.speed * (0.55 + 0.25 * this.skill);
    const target = this.track.sample(car.trackDist + lookahead);
    // slow lane drift, not a slalom: the period is long enough (~16 s) that
    // holding it costs only occasional small trims (Jason's wobble fix #2)
    const wobble = (1 - this.skill) * Math.sin(this.t * 0.4 + this.wobblePhase) * 0.5;
    let lane = this.lane + wobble;
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
