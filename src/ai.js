// AI driver: pure-pursuit steering toward a lookahead point on the centerline,
// with corner-speed planning from track curvature. `skill` (0..1) scales how
// hard the driver pushes; a light rubber band keeps races close but honest.

import { ROAD_HALF_W } from "./track.js";

export class AIDriver {
  constructor(car, track, skill, lanePreference = 2.5) {
    this.car = car;
    this.track = track;
    this.skill = skill;
    this.lane = lanePreference;      // preferred lateral offset (stays out of your lane... mostly)
    this.reaction = 0.35 + (1 - skill) * 0.9; // seconds asleep at the light
    this.wobblePhase = Math.random() * 10;
    this.t = 0;
  }

  // Returns { throttle, brake, steer }
  drive(dt, raceTime, playerDist) {
    const car = this.car;
    this.t += dt;
    if (raceTime < this.reaction) return { throttle: 0, brake: 0, steer: 0 };

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
    const steer = Math.max(-1, Math.min(1, dh * 2.4));

    return { throttle, brake, steer };
  }
}
