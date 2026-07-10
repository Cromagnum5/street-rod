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
  const idx = [
    0, 2, 1, 0, 3, 2,        // bottom
    0, 1, 5, 0, 5, 4,        // back
    3, 5, 2, 3, 4, 5,        // slope
    0, 4, 3,                 // left
    1, 2, 5,                 // right
  ];
  const g = new THREE.BufferGeometry();
  const pos = [];
  for (const i of idx) pos.push(...verts[i]);
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

  const hood = box(1.05, 0.62, 1.7, paint); hood.position.set(0, 0.75, 0.95); g.add(hood);
  const cabin = box(1.15, 1.0, 1.25, paint); cabin.position.set(0, 0.95, -0.55); g.add(cabin);
  const roof = box(1.2, 0.12, 1.3, accentMat); roof.position.set(0, 1.5, -0.55); g.add(roof);
  const ws = wedge(1.05, 0.5, 0.35, GLASS); ws.position.set(0, 1.05, 0.28); g.add(ws);
  const trunk = box(1.05, 0.55, 0.55, paint); trunk.position.set(0, 0.7, -1.45); g.add(trunk);

  // vertical grille + radiator
  const grille = box(0.85, 0.6, 0.12, CHROME); grille.position.set(0, 0.78, 1.85); g.add(grille);
  // exposed fenders: half-cylinders over wheels
  for (const z of [spec.wheelBase / 2, -spec.wheelBase / 2]) {
    for (const sx of [-1, 1]) {
      const f = new THREE.Mesh(
        new THREE.CylinderGeometry(0.52, 0.52, 0.3, 10, 1, false, 0, Math.PI),
        accentMat);
      f.rotation.z = Math.PI / 2;
      f.rotation.y = Math.PI / 2;
      f.position.set(sx * spec.trackW / 2, 0.48, z);
      g.add(f);
    }
    // running boards
  }
  for (const sx of [-1, 1]) {
    const rb = box(0.22, 0.07, 1.6, accentMat); rb.position.set(sx * 0.72, 0.32, -0.15); g.add(rb);
  }
  // round headlights on stalks
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), HEADLIGHT);
    hl.position.set(sx * 0.55, 0.85, 1.92); g.add(hl);
  }
  // exhaust pipe out the side (hot rod!)
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 8), CHROME);
  pipe.rotation.x = Math.PI / 2 - 0.12; pipe.position.set(0.62, 0.42, 0.5); g.add(pipe);

  spec.length = 4.0;
  return { g, spec };
}

function buildFifties(paint, accentMat, fins) {
  // Long, low, bulbous. Chrome everywhere. Optional tailfins + two-tone roof.
  const g = new THREE.Group();
  const spec = { wheelR: 0.38, wheelW: 0.3, trackW: 1.72, wheelBase: 3.0, whitewall: true };

  const body = box(1.85, 0.62, 4.7, paint); body.position.set(0, 0.62, 0); g.add(body);
  const bodyTop = box(1.7, 0.22, 4.3, paint); bodyTop.position.set(0, 1.03, 0); g.add(bodyTop);
  const cabin = box(1.5, 0.52, 1.9, paint); cabin.position.set(0, 1.3, -0.35); g.add(cabin);
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
    for (const sx of [-1, 1]) {
      const fin = wedge(0.14, 0.42, 1.15, paint, true);
      fin.position.set(sx * 0.83, 0.92, -1.85); g.add(fin);
      const tl = box(0.1, 0.12, 0.08, TAILLIGHT); tl.position.set(sx * 0.83, 1.0, -2.42); g.add(tl);
    }
  } else {
    for (const sx of [-1, 1]) {
      const tl = box(0.14, 0.1, 0.06, TAILLIGHT); tl.position.set(sx * 0.7, 0.8, -2.36); g.add(tl);
    }
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
  const cabinBase = box(1.68, 0.2, 2.2, paint); cabinBase.position.set(0, 0.97, -0.35); g.add(cabinBase);
  const ws = wedge(1.55, 0.48, 0.75, GLASS); ws.position.set(0, 1.06, 0.62); g.add(ws);
  const roof = box(1.55, 0.1, 1.1, paint); roof.position.set(0, 1.5, -0.35); g.add(roof);
  const fast = wedge(1.55, 0.48, 1.15, paint, true); fast.position.set(0, 1.06, -1.5); g.add(fast);
  // racing stripe
  const stripe = box(0.42, 0.02, 4.62, accentMat); stripe.position.set(0, 0.885, 0); g.add(stripe);
  // front air dam + rear valance
  const fb = box(1.92, 0.18, 0.2, accentMat); fb.position.set(0, 0.42, 2.35); g.add(fb);
  const rbmp = box(1.92, 0.16, 0.18, CHROME); rbmp.position.set(0, 0.45, -2.34); g.add(rbmp);
  // grille slot + hidden-lamp look
  const gr = box(1.5, 0.2, 0.08, accentMat); gr.position.set(0, 0.68, 2.32); g.add(gr);
  for (const sx of [-1, 1]) {
    const hl = box(0.28, 0.12, 0.05, HEADLIGHT); hl.position.set(sx * 0.62, 0.68, 2.33); g.add(hl);
  }
  const tl = box(1.4, 0.1, 0.06, TAILLIGHT); tl.position.set(0, 0.72, -2.32); g.add(tl);
  // rear spoiler
  const sp = box(1.6, 0.05, 0.3, accentMat); sp.position.set(0, 1.06, -2.2); g.add(sp);

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
