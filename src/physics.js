// Arcade car physics — forgiving and readable. A car is a point with heading,
// scalar speed, and an automatic gearbox whose state drives the audio RPM.

import { ROAD_HALF_W } from "./track.js";
import { PARTS, PART_KEYS } from "./data.js";

export const IDLE_RPM = 850;
export const REDLINE = 5800;

// Combine a tier's base stats with owned part levels into effective numbers.
export function effectiveStats(tier, partLevels) {
  let powerMult = 1, gripMult = 1;
  for (const key of PART_KEYS) {
    const lvl = PARTS[key].levels[partLevels[key] ?? 0];
    if (PARTS[key].affects === "power" || PARTS[key].affects === "shift") powerMult *= lvl.mult;
    if (PARTS[key].affects === "grip") gripMult *= lvl.mult;
  }
  const gb = PARTS.gearbox.levels[partLevels.gearbox ?? 0];
  return {
    power: tier.power * powerMult,
    mass: tier.mass,
    drag: tier.drag,
    grip: tier.grip * gripMult,
    gears: tier.gears + (partLevels.gearbox >= 2 ? 1 : 0),
    shiftTime: gb.shiftTime,
    cyl: tier.cyl,
  };
}

// Estimated top speed (m/s): solve power/(v) = drag*v^2 + rolling, by iteration.
export function topSpeed(stats) {
  let v = 30;
  for (let i = 0; i < 40; i++) {
    v = Math.cbrt((stats.power - 0.18 * stats.mass * v) / stats.drag);
  }
  return v;
}

export class CarSim {
  constructor(stats, track, startLateral) {
    this.stats = stats;
    this.track = track;
    this.trackDist = 0;
    this.lateral = startLateral;

    const s = track.sample(0);
    const nx = Math.cos(s.heading), nz = -Math.sin(s.heading);
    this.x = s.pos.x + nx * startLateral;
    this.z = s.pos.z + nz * startLateral;
    this.heading = s.heading;
    this.speed = 0;

    this.gear = 1;
    this.rpm = IDLE_RPM;
    this.shiftTimer = 0;
    this.throttleOut = 0;   // what the engine actually gets (cut during shifts)
    this.screech = 0;       // 0..1, for skid sound + effects
    this.offroad = false;
    this.finished = false;

    this.vmax = topSpeed(stats);
    // gear speed bands: geometric-ish spread up to vmax
    this.gearTop = [];
    for (let g = 1; g <= this.stats.gears; g++) {
      this.gearTop.push(this.vmax * Math.pow(g / this.stats.gears, 0.72));
    }
  }

  // throttle 0..1, brake 0..1, steer -1..1 (left is negative)
  step(dt, throttle, brake, steer) {
    const st = this.stats;

    // ----- gearbox -----
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      throttle *= 0.1; // torque cut during the shift — audible!
    }
    const top = this.gearTop[this.gear - 1];
    const lo = this.gear > 1 ? this.gearTop[this.gear - 2] : 0;
    if (this.speed > top * 0.97 && this.gear < st.gears) {
      this.gear++; this.shiftTimer = st.shiftTime;
    } else if (this.speed < lo * 0.82 && this.gear > 1) {
      this.gear--; this.shiftTimer = st.shiftTime * 0.6;
    }
    // rpm sweeps through each gear band
    const bandLo = this.gear > 1 ? this.gearTop[this.gear - 2] * 0.55 : 0;
    const frac = Math.min(1, Math.max(0, (this.speed - bandLo) / Math.max(1, top - bandLo)));
    const targetRpm = this.shiftTimer > 0
      ? this.rpm * 0.985 // sag while clutch is in
      : IDLE_RPM + frac * (REDLINE - IDLE_RPM) * (0.35 + 0.65 * Math.max(throttle, this.speed / this.vmax));
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * 8);
    this.throttleOut = throttle;

    // ----- longitudinal -----
    let force = 0;
    if (throttle > 0) {
      force = throttle * st.power / Math.max(this.speed, 5);
      force = Math.min(force, st.grip * st.mass * 0.95); // traction-limited launch
    }
    force -= st.drag * this.speed * this.speed;
    force -= 0.18 * st.mass; // rolling resistance
    if (brake > 0) force -= brake * st.mass * 8;
    if (this.offroad) force -= st.mass * (1.2 + this.speed * 0.06);

    this.speed = Math.max(0, this.speed + (force / st.mass) * dt);

    // ----- steering -----
    // yaw authority fades with speed; demanding more lateral g than grip scrubs speed
    const maxYaw = 2.2 / (1 + this.speed / 18);
    let yawRate = steer * maxYaw;
    const latDemand = Math.abs(yawRate * this.speed);
    const gripAvail = this.offroad ? st.grip * 0.55 : st.grip;
    this.screech = 0;
    if (latDemand > gripAvail && this.speed > 4) {
      const excess = latDemand / gripAvail;
      yawRate /= excess;                       // understeer to the grip limit
      this.speed *= 1 - Math.min(0.10, (excess - 1) * 0.05) * dt; // gentle scrub
      this.screech = Math.min(1, excess - 1 + 0.3);
    }
    this.heading += yawRate * dt;

    // ----- integrate -----
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += Math.cos(this.heading) * this.speed * dt;

    // ----- track relation -----
    const proj = this.track.project({ x: this.x, z: this.z }, this.trackDist);
    this.trackDist = proj.dist;
    this.lateral = proj.lateral;
    this.offroad = Math.abs(proj.lateral) > ROAD_HALF_W - 0.8;

    // soft boundary: way off the road, ease the car back (relaxing, not punishing)
    const limit = ROAD_HALF_W + 14;
    if (Math.abs(proj.lateral) > limit) {
      const s = this.track.sample(this.trackDist);
      const nx = Math.cos(s.heading), nz = -Math.sin(s.heading);
      const want = Math.sign(proj.lateral) * limit;
      this.x = s.pos.x + nx * want;
      this.z = s.pos.z + nz * want;
      // nudge heading back toward the road
      let dh = s.heading - this.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      this.heading += dh * Math.min(1, dt * 2);
    }

    if (this.trackDist >= this.track.length - 6) this.finished = true;
  }
}

// Soft car-vs-car separation. Pushes both cars apart laterally; tiny speed penalty.
export function resolveContact(a, b, dt) {
  const dx = a.x - b.x, dz = a.z - b.z;
  const d2 = dx * dx + dz * dz;
  const minD = 2.6;
  if (d2 > minD * minD || d2 === 0) return;
  const d = Math.sqrt(d2);
  const push = (minD - d) * 0.5;
  const nx = dx / d, nz = dz / d;
  a.x += nx * push; a.z += nz * push;
  b.x -= nx * push; b.z -= nz * push;
  a.speed *= 1 - 0.3 * dt;
  b.speed *= 1 - 0.3 * dt;
}
