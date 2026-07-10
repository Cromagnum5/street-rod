// Arcade car physics — forgiving and readable. A car is a point with heading,
// scalar speed, and an automatic gearbox whose state drives the audio RPM.

import { ROAD_HALF_W } from "./track.js";
import { PARTS, PART_KEYS } from "./data.js";

export const IDLE_RPM = 850;
export const REDLINE = 5800;

// Suspension: the body is a spring-damper chasing chassis acceleration.
// Softness ~1 (stock old iron) leans hard and wobbles; ~0.15 (race) sits flat.
export const ROLL_MAX = 0.11;   // rad of body roll at the grip limit, softness 1
const PITCH_MAX = 0.055;        // rad of squat/dive per g of longitudinal accel, softness 1
const ROLL_GRIP_LOSS = 1.1;     // grip fraction lost per rad of roll (load transfer)
const ROLL_GRIP_LOSS_CAP = 0.15; // forgiving: never lose more than 15%

// Steady-state cornering grip once body roll has set in — what the car can
// actually hold mid-corner. Used by the AI's corner-speed planner too.
export function suspensionGripFactor(softness) {
  return 1 - Math.min(ROLL_GRIP_LOSS_CAP, ROLL_GRIP_LOSS * ROLL_MAX * softness);
}

// Combine a tier's base stats with owned part levels into effective numbers.
export function effectiveStats(tier, partLevels) {
  let powerMult = 1, gripMult = 1;
  for (const key of PART_KEYS) {
    const lvl = PARTS[key].levels[partLevels[key] ?? 0];
    if (PARTS[key].affects === "power" || PARTS[key].affects === "shift") powerMult *= lvl.mult;
    if (PARTS[key].affects === "grip") gripMult *= lvl.mult;
  }
  const gb = PARTS.gearbox.levels[partLevels.gearbox ?? 0];
  const susp = PARTS.suspension.levels[partLevels.suspension ?? 0];
  const softness = (tier.susp ?? 1) * susp.softness;
  const grip = tier.grip * gripMult;
  return {
    power: tier.power * powerMult,
    mass: tier.mass,
    drag: tier.drag,
    grip,
    softness,
    cornerGrip: grip * suspensionGripFactor(softness),
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

    // body attitude (rad) in mesh-rotation convention: roll + raises the car's
    // left (+X) side, pitch + is nose-down. Purely visual state except that
    // roll feeds back into available grip (load transfer).
    this.roll = 0; this.rollVel = 0;
    this.pitch = 0; this.pitchVel = 0;

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

    const prevSpeed = this.speed;
    this.speed = Math.max(0, this.speed + (force / st.mass) * dt);
    const longAccel = (this.speed - prevSpeed) / dt;

    // ----- steering -----
    // yaw authority fades with speed; demanding more lateral g than grip scrubs speed
    const maxYaw = 2.2 / (1 + this.speed / 18);
    let yawRate = steer * maxYaw;
    const latDemand = Math.abs(yawRate * this.speed);
    // load transfer: a rolled body overloads the outside tires. Because roll
    // lags and (softly sprung) overshoots, flick transitions cost extra grip.
    const rollLoss = Math.min(ROLL_GRIP_LOSS_CAP, ROLL_GRIP_LOSS * Math.abs(this.roll));
    const gripAvail = (this.offroad ? st.grip * 0.55 : st.grip) * (1 - rollLoss);
    this.screech = 0;
    if (latDemand > gripAvail && this.speed > 4) {
      const excess = latDemand / gripAvail;
      yawRate /= excess;                       // understeer to the grip limit
      this.speed *= 1 - Math.min(0.10, (excess - 1) * 0.05) * dt; // gentle scrub
      this.screech = Math.min(1, excess - 1 + 0.3);
    }
    this.heading += yawRate * dt;

    // ----- body attitude (suspension) -----
    // spring-damper toward the pose the chassis accelerations demand; soft
    // suspension is slow and underdamped (cartoonish slosh), race is snappy+flat
    const soft = Math.min(1.3, st.softness ?? 1);
    const wn = 13 - 6.5 * soft;         // natural frequency, rad/s
    const zeta = 0.95 - 0.45 * soft;    // damping ratio
    const rollTarget = (yawRate * this.speed / st.grip) * soft * ROLL_MAX;
    const longG = Math.max(-1.1, Math.min(1.1, longAccel / 9.8));
    const pitchTarget = -longG * soft * PITCH_MAX;
    this.rollVel += ((rollTarget - this.roll) * wn * wn - 2 * zeta * wn * this.rollVel) * dt;
    this.roll += this.rollVel * dt;
    this.pitchVel += ((pitchTarget - this.pitch) * wn * wn - 2 * zeta * wn * this.pitchVel) * dt;
    this.pitch += this.pitchVel * dt;

    // ----- integrate -----
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += Math.cos(this.heading) * this.speed * dt;

    // ----- track relation -----
    // Skip once finished: the centerline ends at the finish, so projecting a
    // car coasting past it misreads overshoot as lateral offset and the soft
    // boundary would snap the car back every frame (camera rubber band).
    if (this.finished) return;
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
