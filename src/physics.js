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

// Getting loose: past the grip limit the path bends at the grip cap while the
// nose keeps some of the extra rotation, so a slip angle opens up instead of
// hard understeer. Capped and self-recovering — a slide, never a spinout.
const SLIP_MAX = 0.55;      // rad (~31°) — biggest drift angle; only power holds you there
const SLIP_YAW_KEEP = 0.6;  // fraction of over-limit yaw the nose keeps
const SLIP_RECOVER = 3.2;   // 1/s — how fast the tires bite the slide back in line
const SLIP_SQUEAL = 0.30;   // rad of slip that reads as a full-intensity squeal
const SLIP_SCRUB = 0.35;    // /s per rad — hanging sideways bleeds speed (roasting tires isn't free)
const SLIP_SCRUB_CAP = 0.20; // but never a wall: worst case 20%/s

// Friction circle: drive force and cornering share one tire budget, so a car
// with power to spare can steer with the throttle — stab it mid-corner and
// the lateral share shrinks, the slip model opens, and it power-slides.
// Weak cars can't load the circle at corner speeds, so they stay hooked up.
// Floored so full throttle never kills cornering outright (stays forgiving);
// braking is deliberately exempt from the circle — trail-braking always grips.
export const POWER_GRIP_FLOOR = 0.40; // lateral share is never squeezed below this (AI imports it)
const SLIP_THROTTLE_HOLD = 0.92; // how much of the slip recovery a lit throttle holds off

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
    gears: Math.max(tier.gears + (partLevels.gearbox >= 2 ? 1 : 0), gb.minGears ?? 0),
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

    // hills plumbing (track elevation is flat for now, so these stay 0):
    // the car is glued to the road height — no vertical velocity, no jumps
    this.y = s.elev ?? 0;    // road height under the car
    this.grade = s.grade ?? 0; // road slope (dy per metre along the road)
    this.groundPitch = 0;    // rad, ground attitude for the mesh root (+ = nose-down)

    this.gear = 1;
    this.rpm = IDLE_RPM;
    this.shiftTimer = 0;
    this.throttleOut = 0;   // what the engine actually gets (cut during shifts)
    this.screech = 0;       // 0..1, smoothed slide intensity for squeal + effects
    this.slip = 0;          // rad, nose vs travel direction (+ = tail out left)
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
    let force = 0, wheelspin = 0, powerLoad = 0;
    if (throttle > 0) {
      force = throttle * st.power / Math.max(this.speed, 5);
      // fraction of the total tire budget the drive wheels are asking for —
      // feeds the friction circle in the steering section below
      powerLoad = Math.min(1, force / (st.grip * st.mass));
      const tractionCap = st.grip * st.mass * 0.95;
      if (force > tractionCap) {
        wheelspin = Math.min(1, (force / tractionCap - 1) * 0.8); // launch chirp
        force = tractionCap; // traction-limited launch
      }
    }
    force -= st.drag * this.speed * this.speed;
    force -= 0.18 * st.mass; // rolling resistance
    force -= st.mass * 9.8 * (this.grade / Math.hypot(1, this.grade)); // gravity along the slope (0 until hills)
    if (brake > 0) force -= brake * st.mass * 8;
    if (this.offroad) force -= st.mass * (1.2 + this.speed * 0.06);

    const prevSpeed = this.speed;
    this.speed = Math.max(0, this.speed + (force / st.mass) * dt);
    const longAccel = (this.speed - prevSpeed) / dt;

    // ----- steering -----
    // yaw authority fades with speed; demanding more lateral g than grip
    // makes the car get loose (see SLIP_* above) and gently scrubs speed
    const maxYaw = 2.2 / (1 + this.speed / 18);
    let yawRate = steer * maxYaw;
    // load transfer: a rolled body overloads the outside tires. Because roll
    // lags and (softly sprung) overshoots, flick transitions cost extra grip.
    const rollLoss = Math.min(ROLL_GRIP_LOSS_CAP, ROLL_GRIP_LOSS * Math.abs(this.roll));
    // friction circle (see POWER_GRIP_FLOOR above): what the throttle takes,
    // cornering loses. latShare 1 = coasting, POWER_GRIP_FLOOR = wheels lit.
    const latShare = Math.max(POWER_GRIP_FLOOR, Math.sqrt(Math.max(0, 1 - powerLoad * powerLoad)));
    const powerEat = (1 - latShare) / (1 - POWER_GRIP_FLOOR); // 0..1 throttle pressure on the tires
    const gripAvail = (this.offroad ? st.grip * 0.55 : st.grip) * (1 - rollLoss) * latShare;
    // fastest the tires can actually bend the car's path (rad/s)
    const velYawMax = gripAvail / Math.max(this.speed, 4);
    let velYaw = yawRate;   // how fast the velocity direction turns
    let slide = wheelspin;  // drives the squeal; dirt doesn't squeal
    if (Math.abs(yawRate) > velYawMax && this.speed > 4) {
      const excess = Math.abs(yawRate) / velYawMax;
      velYaw = Math.sign(yawRate) * velYawMax;      // path bends at the grip cap
      yawRate = velYaw + (yawRate - velYaw) * SLIP_YAW_KEEP; // nose keeps going — loose
      this.speed *= 1 - Math.min(0.10, (excess - 1) * 0.05) * dt; // gentle scrub
      slide = Math.max(slide, Math.min(1, (excess - 1) * 1.5 + 0.25));
    }
    this.heading += yawRate * dt;
    // slip angle: nose vs path. Grows while sliding; the tires bite it back
    // toward zero, and that bite bends the path (the drift-exit hook).
    this.slip += (yawRate - velYaw) * dt;
    // the tires bite the slide back in line — unless the throttle keeps them
    // lit: foot down holds the drift, lifting snaps the recovery to full
    this.slip -= this.slip * Math.min(1, SLIP_RECOVER * (1 - SLIP_THROTTLE_HOLD * powerEat) * dt);
    this.slip = Math.max(-SLIP_MAX, Math.min(SLIP_MAX, this.slip));
    // sideways is slow: a held drift trades speed for the angle
    this.speed *= 1 - Math.min(SLIP_SCRUB_CAP, Math.abs(this.slip) * SLIP_SCRUB) * dt;
    slide = Math.max(slide, Math.min(1, Math.abs(this.slip) / SLIP_SQUEAL));
    if (this.offroad) slide *= 0.15;
    // squeal envelope: near-instant attack, short tail so chirps ring a touch
    this.screech += (slide - this.screech) * Math.min(1, dt * (slide > this.screech ? 30 : 5));

    // ----- body attitude (suspension) -----
    // spring-damper toward the pose the chassis accelerations demand; soft
    // suspension is slow and underdamped (cartoonish slosh), race is snappy+flat
    const soft = Math.min(1.3, st.softness ?? 1);
    const wn = 13 - 6.5 * soft;         // natural frequency, rad/s
    const zeta = 0.95 - 0.45 * soft;    // damping ratio
    // lean follows the real lateral g (the path bend), not the loose nose yaw
    const rollTarget = (velYaw * this.speed / st.grip) * soft * ROLL_MAX;
    const longG = Math.max(-1.1, Math.min(1.1, longAccel / 9.8));
    const pitchTarget = -longG * soft * PITCH_MAX;
    this.rollVel += ((rollTarget - this.roll) * wn * wn - 2 * zeta * wn * this.rollVel) * dt;
    this.roll += this.rollVel * dt;
    this.pitchVel += ((pitchTarget - this.pitch) * wn * wn - 2 * zeta * wn * this.pitchVel) * dt;
    this.pitch += this.pitchVel * dt;

    // ----- integrate -----
    // the car travels where the velocity points, not where the nose points
    const velHeading = this.heading - this.slip;
    this.x += Math.sin(velHeading) * this.speed * dt;
    this.z += Math.cos(velHeading) * this.speed * dt;

    // ----- track relation -----
    // Skip once finished: the centerline ends at the finish, so projecting a
    // car coasting past it misreads overshoot as lateral offset and the soft
    // boundary would snap the car back every frame (camera rubber band).
    if (this.finished) return;
    const proj = this.track.project({ x: this.x, z: this.z }, this.trackDist);
    this.trackDist = proj.dist;
    this.lateral = proj.lateral;
    this.offroad = Math.abs(proj.lateral) > ROAD_HALF_W - 0.8;

    // ride the road surface (ribbon world: nearby off-road shares the
    // centerline height). Finished cars keep their last y/grade — fine while
    // everything is flat; revisit if a finish line ever sits on a slope.
    const surf = this.track.sample(this.trackDist);
    this.y = surf.elev ?? 0;
    this.grade = surf.grade ?? 0;
    this.groundPitch = -Math.atan(this.grade); // uphill tips the nose up

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

// Car-vs-car contact. Each car is two circles (front/rear), so which end
// takes the hit decides the reaction: door-to-door rubs just push apart,
// clipping a quarter panel knocks the nose/tail around and the slip model
// plays the recovery — a shove, never a wreck (kick capped, slip capped,
// self-recovering). Returns the closing speed (m/s) for impact effects.
const CONTACT_END = 1.3;    // circle centers sit this far fore/aft of car center
const CONTACT_R = 1.15;     // circle radius; pair sum 2.3 ≈ car width
const CONTACT_KICK = 0.03;  // rad of nose/tail kick per m/s of closing speed
const CONTACT_KICK_CAP = 0.25;
const CONTACT_SCRUB = 0.04; // speed fraction shed per m/s of closing speed
const CONTACT_TAP = 1.2;    // m/s closing speed below which it's a rub, not a hit
const CONTACT_SLAM = 5;     // m/s that counts as a fresh hit even mid-contact
const CONTACT_RELAX = 10;   // 1/s — separation eases out instead of snapping

export function resolveContact(a, b, dt) {
  const cdx = a.x - b.x, cdz = a.z - b.z;
  const reach = 2 * (CONTACT_END + CONTACT_R);
  if (cdx * cdx + cdz * cdz > reach * reach) return 0;

  const ends = (c) => {
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    return [
      { x: c.x + fx * CONTACT_END, z: c.z + fz * CONTACT_END, end: 1 },  // nose
      { x: c.x - fx * CONTACT_END, z: c.z - fz * CONTACT_END, end: -1 }, // tail
    ];
  };
  // Every overlapping circle pair pushes (eased, so door-to-door rubbing is
  // a steady lean instead of a per-frame snap — resolving only the deepest
  // pair made the winner flip-flop between nose and tail every frame, which
  // read as stuttering while rubbing). The deepest pair alone decides the
  // impact reaction.
  let hit = null;
  // depth-weighted torque per car: a lone corner clip yaws hard, but a full
  // door-to-door contact touches both ends and their torques cancel — side
  // pressure translates the car, it doesn't spin it
  let torqueA = 0, torqueB = 0, depthSum = 0;
  const relax = Math.min(1, dt * CONTACT_RELAX);
  for (const pa of ends(a)) for (const pb of ends(b)) {
    const dx = pa.x - pb.x, dz = pa.z - pb.z;
    const d2 = dx * dx + dz * dz, minD = CONTACT_R * 2;
    if (d2 >= minD * minD || d2 === 0) continue;
    const d = Math.sqrt(d2), depth = minD - d, nx = dx / d, nz = dz / d;
    const push = depth * 0.5 * relax;
    a.x += nx * push; a.z += nz * push;
    b.x -= nx * push; b.z -= nz * push;
    torqueA += depth * pa.end * (nx * Math.cos(a.heading) - nz * Math.sin(a.heading));
    torqueB += depth * pb.end * -(nx * Math.cos(b.heading) - nz * Math.sin(b.heading));
    depthSum += depth;
    if (!hit || depth > hit.depth) hit = { depth, nx, nz, ea: pa.end, eb: pb.end };
  }
  a._hitCool = Math.max(0, (a._hitCool ?? 0) - dt);
  if (!hit) { a._contact = false; return 0; }
  // a "hit" is the moment contact begins (or a genuine mid-contact slam);
  // everything after that is leaning, however hard the steer pushes. The
  // cooldown stops leaning from reading as a bang-chase-bang cycle: a kick
  // knocks the other car away, the steer closes back in, and that re-touch
  // must not thump again. _contact/_hitCool are pair state stashed on the
  // first car — fine for a 2-car race, needs a pair key for a third car.
  const canHit = a._hitCool <= 0; // cooldown gates slams too — without it a
  // mutual-steer grind hovers at the slam threshold and machine-guns kicks
  const fresh = !a._contact;
  a._contact = true;

  // closing speed along the deepest normal is the "impulse": it collapses to
  // ~0 once separated, so a tap and a slam produce different numbers without
  // tracking any contact state
  const vax = Math.sin(a.heading - a.slip) * a.speed, vaz = Math.cos(a.heading - a.slip) * a.speed;
  const vbx = Math.sin(b.heading - b.slip) * b.speed, vbz = Math.cos(b.heading - b.slip) * b.speed;
  const impact = Math.max(0, -((vax - vbx) * hit.nx + (vaz - vbz) * hit.nz));

  // Real hits knock the hit end sideways: heading and slip move together so
  // the travel direction is untouched — then SLIP_RECOVER straightens the
  // car out just like a drift exit. A nose hit steers the car away, a tail
  // hit fishtails it. Sustained rubbing gets pushes only, no kicks —
  // per-frame micro-kicks were the other half of the rubbing stutter, and
  // steering hard into a car mid-rub legitimately builds >CONTACT_TAP of
  // closing speed, so the onset flag (not the speed) is what gates here.
  const isHit = canHit && impact > CONTACT_TAP && (fresh || impact > CONTACT_SLAM);
  if (isHit) {
    a._hitCool = 0.5;
    const punch = impact - CONTACT_TAP; // only the speed beyond "touch" hits
    for (const [car, torque] of [[a, torqueA / depthSum], [b, torqueB / depthSum]]) {
      const dpsi = Math.max(-CONTACT_KICK_CAP, Math.min(CONTACT_KICK_CAP,
        CONTACT_KICK * punch * torque));
      car.heading += dpsi;
      car.slip = Math.max(-SLIP_MAX, Math.min(SLIP_MAX, car.slip + dpsi));
      car.speed *= 1 - Math.min(0.35, punch * CONTACT_SCRUB);
    }
  }
  // gentle rubbing friction while touching (door-to-door leaning)
  a.speed *= 1 - 0.3 * dt;
  b.speed *= 1 - 0.3 * dt;
  return isHit ? impact : 0; // rubs report 0 — contact sound is hits only
}
