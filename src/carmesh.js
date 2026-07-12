// Procedural low-poly classic car meshes. Three era styles: prewar, fifties, muscle.
// Returns a THREE.Group facing +Z, resting on y=0, with .userData.wheels for spin,
// .userData.body (the sprung body sub-group — roll/pitch this, wheels stay planted),
// and .userData.paintMat for tinting (bosses get pink treatments elsewhere if wanted).

import * as THREE from "three";

const CHROME = new THREE.MeshPhongMaterial({ color: 0xcfd6dd, shininess: 120, specular: 0xffffff });
const GLASS = new THREE.MeshPhongMaterial({ color: 0x9fd8e8, shininess: 100, specular: 0xffffff, transparent: true, opacity: 0.75 });
const TIRE = new THREE.MeshLambertMaterial({ color: 0x1b1b1b });
const HUB = new THREE.MeshPhongMaterial({ color: 0xd8d8d8, shininess: 90 });
const HEADLIGHT = new THREE.MeshPhongMaterial({ color: 0xfff6c8, emissive: 0xaa9033, shininess: 90 });
const TAILLIGHT = new THREE.MeshPhongMaterial({ color: 0xff2222, emissive: 0x881111 });

function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  return m;
}

// Triangular prism, right angle at the back-bottom: used for windshield rakes and fastbacks.
// Width w (x), height h (y), length d (z); slope faces +Z when flip=false.
function wedge(w, h, d, mat, flip = false) {
  const s = flip ? -1 : 1;
  const hw = w / 2;
  const verts = [
    // bottom face corners
    [-hw, 0, -d / 2 * s], [hw, 0, -d / 2 * s], [hw, 0, d / 2 * s], [-hw, 0, d / 2 * s],
    // top edge (at the back)
    [-hw, h, -d / 2 * s], [hw, h, -d / 2 * s],
  ];
  // wound counter-clockwise seen from outside. `flip` mirrors z, which reverses
  // handedness, so its triangles have to be reversed back or the prism renders
  // inside-out: with FrontSide culling you lose the near faces and see straight
  // through to the far ones (a windshield that only appears from behind).
  const idx = [
    0, 1, 2, 0, 2, 3,        // bottom
    0, 5, 1, 0, 4, 5,        // back
    3, 2, 5, 3, 5, 4,        // slope
    0, 3, 4,                 // left
    1, 5, 2,                 // right
  ];
  const g = new THREE.BufferGeometry();
  const pos = [];
  for (let i = 0; i < idx.length; i += 3) {
    const tri = flip ? [idx[i], idx[i + 2], idx[i + 1]] : [idx[i], idx[i + 1], idx[i + 2]];
    for (const k of tri) pos.push(...verts[k]);
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

function wheel(radius, width, whitewall) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 14), TIRE);
  tire.rotation.z = Math.PI / 2;
  g.add(tire);
  if (whitewall) {
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width + 0.015, 14),
      new THREE.MeshLambertMaterial({ color: 0xe8e4d8 }));
    wall.rotation.z = Math.PI / 2;
    g.add(wall);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.34, radius * 0.34, width + 0.03, 10), HUB);
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  return g;
}

function addWheels(group, spec) {
  const wheels = [];
  const { wheelR, wheelW, trackW, wheelBase, whitewall } = spec;
  for (const [x, z] of [
    [-trackW / 2, wheelBase / 2], [trackW / 2, wheelBase / 2],
    [-trackW / 2, -wheelBase / 2], [trackW / 2, -wheelBase / 2],
  ]) {
    const w = wheel(wheelR, wheelW, whitewall);
    // steer yaw (y) must wrap the accumulated spin (x), or the spin angle
    // tumbles the yawed wheel and the fronts wobble once per revolution
    w.rotation.order = "YXZ";
    w.position.set(x, wheelR, z);
    group.add(w);
    wheels.push(w);
  }
  return wheels;
}

// ------- era builders -------

function buildPrewar(paint, accentMat) {
  // Tall narrow cabin, long hood, exposed fenders, running boards. Hot-rod stance.
  const g = new THREE.Group();
  const spec = { wheelR: 0.42, wheelW: 0.26, trackW: 1.55, wheelBase: 2.7, whitewall: true };

  // hood runs back under the cabin's front face — leave a sliver between them
  // and the cowl shows a slot straight through the car
  const hood = box(1.05, 0.62, 1.75, paint); hood.position.set(0, 0.75, 0.925); g.add(hood);
  // cabin is a paint lower half (doors) + a glazed upper half; the rear quarter
  // stays solid paint, coupe-style, with a small backlight punched in it
  const cabin = box(1.15, 0.62, 1.25, paint); cabin.position.set(0, 0.76, -0.55); g.add(cabin);
  const sideGlass = box(1.12, 0.4, 0.95, GLASS); sideGlass.position.set(0, 1.25, -0.4); g.add(sideGlass);
  const quarter = box(1.15, 0.4, 0.3, paint); quarter.position.set(0, 1.25, -1.025); g.add(quarter);
  const backlight = box(0.5, 0.22, 0.05, GLASS); backlight.position.set(0, 1.27, -1.19); g.add(backlight);
  const roof = box(1.2, 0.12, 1.3, accentMat); roof.position.set(0, 1.5, -0.55); g.add(roof);
  const ws = wedge(1.05, 0.5, 0.35, GLASS); ws.position.set(0, 1.05, 0.24); g.add(ws);
  // trunk rides high enough to show the exposed rear axle beneath it
  const trunk = box(1.05, 0.45, 0.55, paint); trunk.position.set(0, 0.8, -1.45); g.add(trunk);
  for (const sx of [-1, 1]) {
    const tl = box(0.09, 0.11, 0.06, TAILLIGHT); tl.position.set(sx * 0.36, 0.88, -1.75); g.add(tl);
  }

  // vertical grille: chrome radiator shell with a dark insert standing proud of it
  const grille = box(0.85, 0.6, 0.12, CHROME); grille.position.set(0, 0.78, 1.85); g.add(grille);
  const mesh = box(0.62, 0.44, 0.05, accentMat); mesh.position.set(0, 0.78, 1.925); g.add(mesh);
  // fenderless hot-rod look: bare wheels, solid axles at both ends (added on the
  // root in buildCar so they stay planted with the wheels)
  spec.rearAxle = true;
  spec.frontAxle = true;
  // running boards
  for (const sx of [-1, 1]) {
    const rb = box(0.22, 0.07, 1.6, accentMat); rb.position.set(sx * 0.72, 0.32, -0.15); g.add(rb);
  }
  // round headlights, hung off a chrome bar across the nose (they used to float)
  const bar = box(1.25, 0.06, 0.06, CHROME); bar.position.set(0, 0.85, 1.95); g.add(bar);
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), HEADLIGHT);
    hl.position.set(sx * 0.55, 0.85, 1.92); g.add(hl);
  }
  // exhaust pipe out the side (hot rod!) — it must live between the wheels
  // (z -0.93..0.93) and tuck against the body, or it spears the front tire
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.5, 8), CHROME);
  pipe.rotation.x = Math.PI / 2 - 0.1; pipe.position.set(0.6, 0.44, -0.05); g.add(pipe);

  spec.length = 4.0;
  return { g, spec };
}

function buildFifties(paint, accentMat, fins) {
  // Long, low, bulbous. Chrome everywhere. Optional tailfins + two-tone roof.
  const g = new THREE.Group();
  const spec = { wheelR: 0.38, wheelW: 0.3, trackW: 1.72, wheelBase: 3.0, whitewall: true };

  const body = box(1.85, 0.62, 4.7, paint); body.position.set(0, 0.62, 0); g.add(body);
  // deck runs nearly to the tail so the fins have something to stand on
  const bodyTop = box(1.7, 0.22, 4.55, paint); bodyTop.position.set(0, 1.03, 0); g.add(bodyTop);
  // hardtop greenhouse: glass on the sides with slim paint pillars. This was a
  // solid paint box — a windowless brick between the two glass wedges.
  const cabin = box(1.5, 0.44, 1.9, GLASS); cabin.position.set(0, 1.34, -0.35); g.add(cabin);
  for (const sx of [-1, 1]) {
    const cp = box(0.07, 0.44, 0.18, paint); cp.position.set(sx * 0.755, 1.34, -1.21); g.add(cp);
    const ap = box(0.07, 0.44, 0.14, paint); ap.position.set(sx * 0.755, 1.34, 0.53); g.add(ap);
  }
  const roof = box(1.55, 0.1, 2.0, accentMat); roof.position.set(0, 1.6, -0.35); g.add(roof);
  const ws = wedge(1.45, 0.45, 0.5, GLASS); ws.position.set(0, 1.12, 0.85); g.add(ws);
  const rw = wedge(1.45, 0.45, 0.45, GLASS, true); rw.position.set(0, 1.12, -1.55); g.add(rw);

  // chrome bumpers + grille bar
  const fb = box(1.9, 0.22, 0.25, CHROME); fb.position.set(0, 0.45, 2.42); g.add(fb);
  const rb = box(1.9, 0.22, 0.25, CHROME); rb.position.set(0, 0.45, -2.42); g.add(rb);
  const gr = box(1.5, 0.16, 0.1, CHROME); gr.position.set(0, 0.75, 2.38); g.add(gr);
  // side chrome spear
  for (const sx of [-1, 1]) {
    const spear = box(0.04, 0.07, 3.8, CHROME); spear.position.set(sx * 0.94, 0.82, 0); g.add(spear);
  }
  if (fins) {
    // fin rises toward the tail (it used to be built flipped — tall at the cabin,
    // tapering to nothing at the back) and stands on the deck instead of being
    // half-buried in it. Kept low and in the accent color: a trim spear, not a wing.
    for (const sx of [-1, 1]) {
      const fin = wedge(0.16, 0.22, 1.15, accentMat);
      fin.position.set(sx * 0.8, 1.13, -1.7); g.add(fin);
    }
  }
  // brake lights on the tail panel for both bodies (fin tips left them floating)
  for (const sx of [-1, 1]) {
    const tl = box(0.14, 0.1, 0.06, TAILLIGHT); tl.position.set(sx * 0.7, 0.8, -2.36); g.add(tl);
  }
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), HEADLIGHT);
    hl.position.set(sx * 0.68, 0.75, 2.36); g.add(hl);
  }

  spec.length = 4.9;
  return { g, spec };
}

function buildMuscle(paint, accentMat) {
  // Low, wide, long hood, fastback. Rake stance, fat rear tires.
  const g = new THREE.Group();
  const spec = { wheelR: 0.37, wheelW: 0.34, trackW: 1.78, wheelBase: 2.95, whitewall: false };

  const body = box(1.9, 0.5, 4.6, paint); body.position.set(0, 0.62, 0); g.add(body);
  const hoodScoop = box(0.5, 0.14, 0.8, accentMat); hoodScoop.position.set(0, 0.94, 1.3); g.add(hoodScoop);
  // belt slab, cowl (z=1.0) to tail: everything in the greenhouse lands on it —
  // the windshield foot, the fastback and the spoiler legs. Stop it short and
  // those float over the deck with open air underneath.
  const belt = box(1.68, 0.2, 3.15, paint); belt.position.set(0, 0.97, -0.575); g.add(belt);
  // windshield is the same width as the side glass so their edges line up
  const ws = wedge(1.5, 0.48, 0.75, GLASS); ws.position.set(0, 1.06, 0.62); g.add(ws);
  // greenhouse sides: side glass forward, solid quarter panels aft. The roof
  // needs them or the cabin is an open box you can see straight through.
  const sideGlass = box(1.5, 0.42, 0.73, GLASS); sideGlass.position.set(0, 1.26, -0.115); g.add(sideGlass);
  const quarter = box(1.53, 0.42, 0.42, paint); quarter.position.set(0, 1.26, -0.69); g.add(quarter);
  // roof must reach the windshield's top edge (z=0.245) — stop it short and that
  // edge's vertical back face pokes out ahead of it as a second pane of glass
  const roof = box(1.55, 0.1, 1.18, paint); roof.position.set(0, 1.5, -0.31); g.add(roof);
  const fast = wedge(1.55, 0.48, 1.0, paint, true); fast.position.set(0, 1.06, -1.4); g.add(fast);
  // backlight lying on the fastback slope (rise 0.48 over run 1.0), lifted
  // along the slope normal so it doesn't z-fight the paint under it
  const slope = Math.atan2(0.48, 1.0);
  const bl = box(1.35, 0.05, 0.92, GLASS);
  bl.rotation.x = -slope;
  bl.position.set(0, 1.3 + 0.03 * Math.cos(slope), -1.4 - 0.03 * Math.sin(slope));
  g.add(bl);
  // racing stripe: hood and roof, broken by the glass like the real thing
  const hstripe = box(0.42, 0.02, 1.28, accentMat); hstripe.position.set(0, 0.885, 1.65); g.add(hstripe);
  const rstripe = box(0.42, 0.02, 1.18, accentMat); rstripe.position.set(0, 1.556, -0.31); g.add(rstripe);
  // front air dam + rear valance
  const fb = box(1.92, 0.18, 0.2, accentMat); fb.position.set(0, 0.42, 2.35); g.add(fb);
  const rbmp = box(1.92, 0.16, 0.18, CHROME); rbmp.position.set(0, 0.45, -2.34); g.add(rbmp);
  // grille slot with the lamps set into it — they must stand proud of the
  // grille's front face (z=2.36) or the black box swallows them whole
  const gr = box(1.5, 0.2, 0.08, accentMat); gr.position.set(0, 0.68, 2.32); g.add(gr);
  for (const sx of [-1, 1]) {
    const hl = box(0.3, 0.14, 0.06, HEADLIGHT); hl.position.set(sx * 0.64, 0.68, 2.375); g.add(hl);
  }
  const tl = box(1.4, 0.1, 0.06, TAILLIGHT); tl.position.set(0, 0.72, -2.32); g.add(tl);
  // rear spoiler, on pedestals off the deck (it used to hover on nothing)
  const sp = box(1.6, 0.06, 0.28, accentMat); sp.position.set(0, 1.19, -2.0); g.add(sp);
  for (const sx of [-1, 1]) {
    const leg = box(0.1, 0.14, 0.12, accentMat); leg.position.set(sx * 0.6, 1.12, -2.0); g.add(leg);
  }

  spec.length = 4.8;
  spec.rearWheelR = 0.42; // fat rears
  return { g, spec };
}

export function buildCar(tier, opts = {}) {
  const paint = new THREE.MeshPhongMaterial({
    color: opts.color ?? tier.color, shininess: 60, specular: 0x666666,
  });
  const accentMat = new THREE.MeshPhongMaterial({ color: tier.accent, shininess: 40 });

  let built;
  if (tier.style === "prewar") built = buildPrewar(paint, accentMat);
  else if (tier.style === "fifties") built = buildFifties(paint, accentMat, tier.fins);
  else built = buildMuscle(paint, accentMat);

  const { g: body, spec } = built;
  // wheels live on the root so suspension roll/pitch only moves the body
  const root = new THREE.Group();
  root.add(body);
  const wheels = addWheels(root, spec);
  if (spec.rearAxle) {
    const axle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, spec.trackW, 8), CHROME);
    axle.rotation.z = Math.PI / 2;
    axle.castShadow = true;
    const diff = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), CHROME);
    diff.castShadow = true;
    const rear = new THREE.Group();
    rear.add(axle, diff);
    rear.position.set(0, spec.wheelR, -spec.wheelBase / 2);
    root.add(rear);
  }
  if (spec.frontAxle) {
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, spec.trackW, 8), CHROME);
    beam.rotation.z = Math.PI / 2;
    beam.castShadow = true;
    beam.position.set(0, spec.wheelR, spec.wheelBase / 2);
    root.add(beam);
  }
  // fat rear tires for muscle cars
  let rake = 0;
  if (spec.rearWheelR) {
    for (const i of [2, 3]) {
      wheels[i].scale.setScalar(spec.rearWheelR / spec.wheelR);
      wheels[i].position.y = spec.rearWheelR;
    }
    // rake: nose down
    rake = 0.015;
    body.rotation.x = rake;
  }

  root.userData.body = body;
  root.userData.bodyRake = rake;
  root.userData.wheels = wheels;
  root.userData.wheelR = spec.wheelR;
  root.userData.paintMat = paint;
  root.userData.length = spec.length;
  return root;
}
