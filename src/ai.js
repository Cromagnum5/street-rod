// AI driver: pure-pursuit steering toward a lookahead point on the centerline,
// with corner-speed planning from track curvature. `skill` (0..1) scales how
// hard the driver pushes; a light rubber band keeps races close but honest.
//
// The pursuit math produces analog "intent", but the driver actually plays
// on a virtual keyboard like the human: controls leave here as on/off key
// states. Steer is closed-loop tapping (press toward the want, release past
// it, no faster than a human taps) run through the same dt*9 ramp raceTick
// applies to the player's keys; pedals are duty-cycle taps. That's what
// makes a passing AI weave and feather its throttle instead of tracking a
// spline.

import { ROAD_HALF_W } from "./track.js";

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
    this.pedalPeriod = 0.5 - 0.25 * skill;    // throttle/brake feathering is slower
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
    const grip = (car.stats.cornerGrip ?? car.stats.grip) * (0.72 + 0.26 * this.skill);
    let targetSpeed = car.vmax * (0.82 + 0.18 * this.skill);
    for (let ahead = 15; ahead <= 25 + car.speed * 2.2; ahead += 20) {
      const k = this.track.curvatureAt(car.trackDist + ahead);
      if (k > 1e-4) {
        const vCorner = Math.sqrt(grip / k);
        targetSpeed = Math.min(targetSpeed, vCorner);
      }
    }

    // gentle rubber band: struggling AI finds a little extra, runaway AI lifts
    const gap = car.trackDist - playerDist; // positive = AI ahead
    const band = Math.max(-1, Math.min(1, -gap / 120));
    targetSpeed *= 1 + band * (0.10 - 0.06 * this.skill);

    let throttle = 0, brake = 0;
    if (car.speed < targetSpeed - 1) throttle = 1;
    else if (car.speed > targetSpeed + 2) brake = Math.min(1, (car.speed - targetSpeed) / 8);
    else throttle = 0.55;

    // low-skill drivers breathe the throttle
    if (this.skill < 0.6) throttle *= 0.88 + 0.12 * Math.sin(this.t * 1.3 + this.wobblePhase);

    // --- steering: pure pursuit toward centerline + preferred lane ---
    const lookahead = 10 + car.speed * (0.55 + 0.25 * this.skill);
    const target = this.track.sample(car.trackDist + lookahead);
    const wobble = (1 - this.skill) * Math.sin(this.t * 0.9 + this.wobblePhase) * 1.2;
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
    // Releases are free — a human lets go the instant the correction lands.
    // Only re-presses are tap-rate limited (dwell), and presses only ever go
    // in the direction of the want; overshoot sheds by itself on release.
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
      if (this.steerKey !== dir || done) this.steerKey = 0;
    } else if (dir !== 0 && Math.abs(steerWant - this.steer) > 0.05 && this.t - this.keyT >= dwell) {
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
