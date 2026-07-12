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

function wheel(radius, width, whitewall, hubF) {
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
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * hubF, radius * hubF, width + 0.03, 10), HUB);
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  return g;
}

// Tire upgrades, in width: skinny bias-ply pizza cutters at stock, fat blackwall
// slicks (with a big polished mag face) when maxed, rears growing faster than
// fronts for drag stagger. Radius stays put — the wheels are what the body sits
// on, and userData.wheelR drives the visual spin rate.
const TIRE_VIZ = [
  { front: 0.72, rear: 0.82, wall: true,  hub: 0.34 },
  { front: 1.00, rear: 1.08, wall: true,  hub: 0.36 },
  { front: 1.26, rear: 1.42, wall: false, hub: 0.44 },
  { front: 1.42, rear: 1.60, wall: false, hub: 0.52 },
];

function addWheels(group, spec, tireLvl) {
  const wheels = [];
  const { wheelR, wheelW, trackW, wheelBase, whitewall } = spec;
  const v = TIRE_VIZ[tireLvl];
  for (const [x, z, isRear] of [
    [-trackW / 2, wheelBase / 2, false], [trackW / 2, wheelBase / 2, false],
    [-trackW / 2, -wheelBase / 2, true], [trackW / 2, -wheelBase / 2, true],
  ]) {
    // muscle cars carry a bigger rear tire on top of whatever the parts add
    const r = isRear && spec.rearWheelR ? spec.rearWheelR : wheelR;
    const w = wheel(r, wheelW * (isRear ? v.rear : v.front), whitewall && v.wall, v.hub);
    // steer yaw (y) must wrap the accumulated spin (x), or the spin angle
    // tumbles the yawed wheel and the fronts wobble once per revolution
    w.rotation.order = "YXZ";
    w.position.set(x, r, z);
    group.add(w);
    wheels.push(w);
  }
  return wheels;
}

// ------- bolt-on upgrade hardware -------
// The visible reward for spending money. Same two rules as the rest of the mesh:
// a piece must OVERLAP whatever it bolts to (or it's floating) and STAND PROUD
// of it (or that surface eats it). Both are covered by the part-level sweep in
// the mesh checks — re-run them after touching anything here.

// Induction comes up through the hood. `m` is the hood mounting surface:
// { y: top face, z: center of the usable hood span }.
function addInduction(g, level, m, paint, accent) {
  if (level === 1) {
    // twin carbs: a cut in the hood with velocity stacks poking out of it
    const cut = box(0.34, 0.06, 0.52, accent);
    cut.position.set(0, m.y + 0.01, m.z); g.add(cut);
    for (const sz of [-1, 1]) {
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.16, 10), CHROME);
      stack.castShadow = true;
      stack.position.set(0, m.y + 0.1, m.z + sz * 0.14); g.add(stack);
    }
  } else if (level === 2) {
    // turbo: a blister raised over the plumbing, dark inlet slot in its nose,
    // and the snail itself sitting on the hood beside it
    const blister = box(0.52, 0.14, 0.95, paint);
    blister.position.set(0, m.y + 0.04, m.z); g.add(blister);
    const slot = box(0.36, 0.08, 0.05, accent);
    slot.position.set(0, m.y + 0.05, m.z + 0.49); g.add(slot);
    // the snail is body-colored and buried to its axle — centering it ON the hood
    // face (m.y) leaves a half-round bulge, which reads as a swelling in the
    // sheetmetal rather than a drum sitting on top of it
    const snail = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.13, 12), paint);
    snail.castShadow = true;
    snail.rotation.z = Math.PI / 2;
    snail.position.set(0.3, m.y, m.z - 0.32); g.add(snail);
  } else if (level === 3) {
    // blower: case standing out of a hole in the hood, butterfly scoop on top,
    // drive pulley off the front. The one part everybody buys twice.
    const cut = box(0.5, 0.06, 0.68, accent);
    cut.position.set(0, m.y + 0.01, m.z); g.add(cut);
    // everything above the hood is scaled 0.8 in Y off a full-height blower —
    // heights AND offsets, so the stack still lands on the hood and the pulley
    // stays centered on the casing. Total rise is 0.308 above the hood face.
    const casing = box(0.46, 0.208, 0.6, accent);
    casing.position.set(0, m.y + 0.128, m.z); g.add(casing);
    // the scoop's nose runs out to the pulley's mid-plane (m.z+0.33), so it
    // overhangs the front half of the pulley — clear of it in Y, so it shades
    // the pulley rather than swallowing it
    const scoop = box(0.56, 0.088, 0.58, CHROME);
    scoop.position.set(0, m.y + 0.264, m.z + 0.04); g.add(scoop);
    // the drive pulley turns on the crank axis, so the disc faces FORWARD (+Z).
    // Spun about x it lies broadside and reads as a jug strapped to the blower.
    const pulley = new THREE.Mesh(new THREE.CylinderGeometry(0.071, 0.071, 0.07, 12), CHROME);
    pulley.castShadow = true;
    pulley.rotation.x = Math.PI / 2;
    pulley.position.set(0, m.y + 0.128, m.z + 0.33); g.add(pulley);
  }
}

function pipe(radius, len, mat) {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 8), mat);
  p.castShadow = true;
  p.rotation.x = Math.PI / 2;
  return p;
}

// Exhaust grows: a tucked stub you can barely see -> one pipe -> duals -> open
// side pipes with header stubs. `e` carries the era's mounting geometry:
//   sideOnly  hot rods run pipes down the flank at every level (no rear exit)
//   tail      { x, y, z, len, r } the under-tail pipe
//   rocker    { x, y, z, len, r } the side pipe, hung off the flank
//   flankX    the body's side face, so header stubs reach back into it
function addExhaust(g, level, e) {
  const rear = (x, r, len) => {
    const p = pipe(r, len, CHROME);
    p.position.set(x, e.tail.y, e.tail.z);
    g.add(p);
  };
  const side = (sx, r, headers) => {
    const p = pipe(r, e.rocker.len, CHROME);
    p.position.set(sx * e.rocker.x, e.rocker.y, e.rocker.z);
    g.add(p);
    if (!headers) return;
    // zoomie stubs bridging body flank to pipe — they must reach into both
    const midX = (e.flankX + e.rocker.x) / 2;
    for (let i = 0; i < 4; i++) {
      const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, (e.rocker.x - e.flankX) + 0.16, 6), CHROME);
      stub.castShadow = true;
      stub.rotation.z = Math.PI / 2;
      stub.position.set(sx * midX, e.rocker.y + r + 0.02, e.rocker.z + (i - 1.5) * 0.22);
      g.add(stub);
    }
  };

  if (level === 0) { rear(e.tail.x, e.tail.r * 0.8, e.tail.len * 0.75); return; }
  if (e.sideOnly) {
    if (level === 1) side(1, e.rocker.r, false);
    else if (level === 2) { side(1, e.rocker.r, false); side(-1, e.rocker.r, false); }
    else { side(1, e.rocker.r * 1.25, true); side(-1, e.rocker.r * 1.25, true); }
    return;
  }
  if (level === 1) rear(e.tail.x, e.tail.r, e.tail.len);
  else if (level === 2) { rear(e.dualX, e.tail.r, e.tail.len); rear(-e.dualX, e.tail.r, e.tail.len); }
  else { side(1, e.rocker.r, true); side(-1, e.rocker.r, true); }
}

// ------- era builders -------

function buildPrewar(paint, accentMat, viz) {
  // Tall narrow cabin, long hood, exposed fenders, running boards. Hot-rod stance.
  const g = new THREE.Group();
  const spec = { wheelR: 0.42, wheelW: 0.26, trackW: 1.55, wheelBase: 2.7, whitewall: true };

  // hood runs back under the cabin's front face — leave a sliver between them
  // and the cowl shows a slot straight through the car
  const hood = box(1.05, 0.62, 1.75, paint); hood.position.set(0, 0.75, 0.925); g.add(hood);
  // cabin is a paint lower half (doors) + a glazed upper half; the rear quarter
  // stays solid paint, coupe-style, with a small backlight punched in it
  const cabin = box(1.15, 0.62, 1.25, paint); cabin.position.set(0, 0.76, -0.55); g.add(cabin);
  const sideGlass = box(1.05, 0.4, 0.95, GLASS); sideGlass.position.set(0, 1.25, -0.4); g.add(sideGlass);
  const quarter = box(1.15, 0.4, 0.3, paint); quarter.position.set(0, 1.25, -1.025); g.add(quarter);
  // sunk into the quarter panel, 5 mm proud — enough to beat z-fighting, not
  // enough to read as a slab stuck on the back (same as the muscle backlight)
  const backlight = box(0.5, 0.22, 0.04, GLASS); backlight.position.set(0, 1.27, -1.16); g.add(backlight);
  const roof = box(1.2, 0.12, 1.3, accentMat); roof.position.set(0, 1.5, -0.55); g.add(roof);
  // glass tops out on the roof's underside (y=1.44) — run it higher and the
  // wedge stabs halfway into the roof slab, breaking the roofline
  const ws = wedge(1.05, 0.39, 0.35, GLASS); ws.position.set(0, 1.05, 0.24); g.add(ws);
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
  // running boards, centred in the gap between the tires (z -0.93..0.93) — they
  // used to sit 0.15 rearward and all but touch the back tire. They must also
  // reach the body's flank (x=0.575) and underside (y=0.45): at 0.22 wide and
  // y=0.32 they hung in space, bolted to nothing.
  for (const sx of [-1, 1]) {
    const rb = box(0.3, 0.1, 1.55, accentMat); rb.position.set(sx * 0.7, 0.405, 0); g.add(rb);
  }
  // round headlights, hung off a chrome bar across the nose (they used to float)
  const bar = box(1.25, 0.06, 0.06, CHROME); bar.position.set(0, 0.85, 1.95); g.add(bar);
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), HEADLIGHT);
    hl.position.set(sx * 0.55, 0.85, 1.92); g.add(hl);
  }
  // hood top is y=1.06; the cut has to clear the cowl (z=1.8) and the windshield
  addInduction(g, viz.induction, { y: 1.06, z: 1.0 }, paint, accentMat);
  // hot rods run their pipes down the flank at every level (no rear exit). The
  // side pipe must live between the wheels (z -0.93..0.93) or it spears the front
  // tire, and it hangs off the BODY, above the running board — resting it on the
  // board (its top is y=0.455) stacks the two, and the board's dark outer face
  // peeking out below the chrome reads as a second exhaust pipe underneath.
  // Lakes-pipe height (y=0.60) leaves a clean gap and the board is a step again.
  // The stock stub tucks under the raised trunk instead.
  addExhaust(g, viz.exhaust, {
    sideOnly: true,
    flankX: 0.525, // the hood is the narrowest thing a header stub must reach
    tail: { x: 0.3, y: 0.55, z: -1.55, len: 0.7, r: 0.055 },
    rocker: { x: 0.62, y: 0.6, z: -0.05, len: 1.5, r: 0.06 },
  });

  // STANCE: the prewar body can barely come down at all, and the exposed rear end
  // is why. The diff ball (root, top y=0.58) already sits flush against the trunk
  // floor (y=0.575) — that flush fit is the whole point of the raised trunk, so
  // any straight drop swallows the axle Jason wanted showing. Way out: lean on
  // RAKE instead. Nose-down rake pivots the body about the ground line at z=0, so
  // the tail RISES (+1.175·rake at the trunk's nearest corner) even as the nose
  // comes down — a hot rod in the weeds, and the diff gets *more* daylight, not
  // less. The drop is then only allowed to spend what the rake bought:
  //   drop ≤ 1.175·rake − 0.005, i.e. 0.024 ≤ 0.030 at level 3. Keep that true.
  spec.stance = { drop: 0.008, rake: 0.010 };

  spec.length = 4.0;
  return { g, spec };
}

function buildFifties(paint, accentMat, fins, viz) {
  // Long, low, bulbous. Chrome everywhere. Optional tailfins + two-tone roof.
  const g = new THREE.Group();
  const spec = { wheelR: 0.38, wheelW: 0.3, trackW: 1.72, wheelBase: 3.0, whitewall: true };

  // paint mass is 10% shorter than it was, scaled about the ground: the belt
  // drops 1.14 -> 1.06 and everything mounted on it (glass, fins, trim, lamps)
  // comes down with it, while the roof stays put. That buys back greenhouse.
  const body = box(1.85, 0.56, 4.7, paint); body.position.set(0, 0.59, 0); g.add(body);
  // deck runs nearly to the tail so the fins have something to stand on
  const bodyTop = box(1.7, 0.2, 4.55, paint); bodyTop.position.set(0, 0.96, 0); g.add(bodyTop);
  // hardtop greenhouse: glass on the sides with slim paint pillars. This was a
  // solid paint box — a windowless brick between the two glass wedges. Glass
  // height and both wedges track the belt and the roof: the screens must top out
  // on the roof's underside (y=1.45), never partway into the slab.
  const cabin = box(1.5, 0.4, 1.9, GLASS); cabin.position.set(0, 1.26, -0.35); g.add(cabin);
  // pillars tuck under the roof's edge (x=0.775) — at 0.755 their outer faces
  // stood 15 mm proud of it and the roof looked too narrow for its own posts
  for (const sx of [-1, 1]) {
    const cp = box(0.07, 0.4, 0.18, paint); cp.position.set(sx * 0.74, 1.26, -1.21); g.add(cp);
    const ap = box(0.07, 0.4, 0.14, paint); ap.position.set(sx * 0.74, 1.26, 0.53); g.add(ap);
  }
  // thin slab, underside pinned at y=1.45 so the glass still tops out flush
  const roof = box(1.55, 0.06, 2.0, accentMat); roof.position.set(0, 1.48, -0.35); g.add(roof);
  const ws = wedge(1.45, 0.39, 0.5, GLASS); ws.position.set(0, 1.06, 0.85); g.add(ws);
  const rw = wedge(1.45, 0.39, 0.45, GLASS, true); rw.position.set(0, 1.06, -1.55); g.add(rw);

  // chrome bumpers + grille bar
  const fb = box(1.9, 0.22, 0.25, CHROME); fb.position.set(0, 0.44, 2.42); g.add(fb);
  const rb = box(1.9, 0.22, 0.25, CHROME); rb.position.set(0, 0.44, -2.42); g.add(rb);
  const gr = box(1.5, 0.16, 0.1, CHROME); gr.position.set(0, 0.71, 2.38); g.add(gr);
  // side chrome spear
  for (const sx of [-1, 1]) {
    const spear = box(0.04, 0.07, 3.8, CHROME); spear.position.set(sx * 0.94, 0.77, 0); g.add(spear);
  }
  if (fins) {
    // fin rises toward the tail (it used to be built flipped — tall at the cabin,
    // tapering to nothing at the back) and stands on the deck instead of being
    // half-buried in it. Low, thin and body-colored: a blade, not a wing.
    for (const sx of [-1, 1]) {
      const fin = wedge(0.08, 0.22, 1.15, paint);
      fin.position.set(sx * 0.8, 1.05, -1.7); g.add(fin);
    }
  }
  // brake lights on the tail panel for both bodies (fin tips left them floating)
  for (const sx of [-1, 1]) {
    const tl = box(0.14, 0.1, 0.06, TAILLIGHT); tl.position.set(sx * 0.7, 0.75, -2.36); g.add(tl);
  }
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), HEADLIGHT);
    hl.position.set(sx * 0.68, 0.71, 2.36); g.add(hl);
  }

  // hood surface is the deck's top face (y=1.06), forward of the windshield foot
  addInduction(g, viz.induction, { y: 1.06, z: 1.65 }, paint, accentMat);
  // tailpipes exit under the rear bumper (its underside is y=0.33 — a pipe any
  // higher spears it); open headers dump down the rockers instead. The side pipe
  // is short enough (±1.2) to stay clear of the widest tires at z ±1.29.
  addExhaust(g, viz.exhaust, {
    flankX: 0.925,
    dualX: 0.62,
    tail: { x: 0.55, y: 0.27, z: -2.28, len: 0.75, r: 0.055 },
    // a side pipe is bounded by the TIRES' inner faces (axle -+ wheel RADIUS,
    // not half its width): +-1.12 here, so 2.1 long leaves 70 mm of daylight
    rocker: { x: 0.96, y: 0.3, z: 0, len: 2.1, r: 0.065 },
  });

  // nothing exposed under this one, so it can genuinely slam: 0.075 of drop
  // leaves the rockers 0.16 off the deck
  spec.stance = { drop: 0.025, rake: 0.004 };

  spec.length = 4.9;
  return { g, spec };
}

function buildMuscle(paint, accentMat, viz) {
  // Low, wide, long hood, fastback. Rake stance, fat rear tires.
  const g = new THREE.Group();
  const spec = { wheelR: 0.37, wheelW: 0.34, trackW: 1.78, wheelBase: 2.95, whitewall: false };

  const body = box(1.9, 0.5, 4.6, paint); body.position.set(0, 0.62, 0); g.add(body);
  // the hood scoop is no longer standard equipment — it's what INDUCTION buys.
  // Hood top face is y=0.87, clear from the belt (z=1.0) to the grille.
  addInduction(g, viz.induction, { y: 0.87, z: 1.6 }, paint, accentMat);
  // belt slab, cowl (z=1.0) to tail: everything in the greenhouse lands on it —
  // the windshield foot, the fastback and the spoiler legs. Stop it short and
  // those float over the deck with open air underneath.
  const belt = box(1.68, 0.2, 3.15, paint); belt.position.set(0, 0.97, -0.575); g.add(belt);
  // windshield is the same width as the side glass so their edges line up, and
  // tops out on the roof's underside (y=1.45) rather than partway into the slab
  const ws = wedge(1.5, 0.39, 0.75, GLASS); ws.position.set(0, 1.06, 0.62); g.add(ws);
  // greenhouse sides: side glass forward, solid quarter panels aft. The roof
  // needs them or the cabin is an open box you can see straight through.
  const sideGlass = box(1.5, 0.42, 0.74, GLASS); sideGlass.position.set(0, 1.26, -0.11); g.add(sideGlass);
  const quarter = box(1.53, 0.42, 0.42, paint); quarter.position.set(0, 1.26, -0.69); g.add(quarter);
  // roof must reach the windshield's top edge (z=0.245) — stop it short and that
  // edge's vertical back face pokes out ahead of it as a second pane of glass
  const roof = box(1.55, 0.1, 1.18, paint); roof.position.set(0, 1.5, -0.31); g.add(roof);
  const fast = wedge(1.55, 0.48, 1.0, paint, true); fast.position.set(0, 1.06, -1.4); g.add(fast);
  // backlight lying on the fastback slope (rise 0.48 over run 1.0). It can't sit
  // truly recessed — the fastback is a solid prism, so an inset pane just gets
  // buried in it — so sink it until only 5 mm clears the paint: enough to beat
  // z-fighting, too thin to read as a slab stuck on the roof.
  const slope = Math.atan2(0.48, 1.0);
  const blOff = -0.015;
  const bl = box(1.35, 0.04, 0.92, GLASS);
  bl.rotation.x = -slope;
  bl.position.set(0, 1.3 + blOff * Math.cos(slope), -1.4 - blOff * Math.sin(slope));
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

  // rear exit under the valance until open headers move it to the rockers
  addExhaust(g, viz.exhaust, {
    flankX: 0.95,
    dualX: 0.6,
    tail: { x: 0.5, y: 0.33, z: -2.25, len: 0.8, r: 0.055 },
    // fat rears (r=0.42) crowd the pipe harder than the fronts (r=0.37), so the
    // clear span -1.055..1.105 is off-center — nudge the pipe forward to match
    rocker: { x: 1.0, y: 0.32, z: 0.02, len: 1.95, r: 0.07 },
  });

  spec.stance = { drop: 0.025, rake: 0.004 }; // on top of the era's built-in rake

  spec.length = 4.8;
  spec.rearWheelR = 0.42; // fat rears
  return { g, spec };
}

// opts.parts is the player's (or the AI's) part levels — induction, exhaust and
// tires are the three you can see, so buying them changes the car you look at.
// Engine and gearbox live inside the body; they stay an audio/stat reward.
const lvl = (parts, key) => Math.max(0, Math.min(3, parts?.[key] ?? 0));

// Suspension = stance. Sagging leaf springs sit at stock height; each level
// drops the sprung body onto the wheels and adds a touch of nose-down rake.
// Both are per-level increments, era-scaled (spec.stance) because the eras have
// wildly different things underneath them to hit — see buildPrewar.
function applyStance(body, spec, level, baseRake) {
  const st = spec.stance;
  body.position.y = -st.drop * level;
  return baseRake + st.rake * level;
}

export function buildCar(tier, opts = {}) {
  const paint = new THREE.MeshPhongMaterial({
    color: opts.color ?? tier.color, shininess: 60, specular: 0x666666,
  });
  const accentMat = new THREE.MeshPhongMaterial({ color: tier.accent, shininess: 40 });
  const viz = {
    induction: lvl(opts.parts, "induction"),
    exhaust: lvl(opts.parts, "exhaust"),
    tires: lvl(opts.parts, "tires"),
    suspension: lvl(opts.parts, "suspension"),
  };

  let built;
  if (tier.style === "prewar") built = buildPrewar(paint, accentMat, viz);
  else if (tier.style === "fifties") built = buildFifties(paint, accentMat, tier.fins, viz);
  else built = buildMuscle(paint, accentMat, viz);

  const { g: body, spec } = built;
  // wheels live on the root so suspension roll/pitch only moves the body
  const root = new THREE.Group();
  root.add(body);
  const wheels = addWheels(root, spec, viz.tires);
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
  // muscle cars get taller rears (addWheels builds them that way) and a nose-down
  // rake; suspension parts drop the body onto the wheels and rake it further.
  // Only the sprung body moves — the wheels (and the prewar axles) stay planted,
  // which is also why the drop can't just be dialed up: see buildPrewar's stance.
  let rake = spec.rearWheelR ? 0.015 : 0;
  rake = applyStance(body, spec, viz.suspension, rake);
  body.rotation.x = rake;

  root.userData.body = body;
  root.userData.bodyRake = rake;
  root.userData.wheels = wheels;
  root.userData.wheelR = spec.wheelR;
  root.userData.paintMat = paint;
  root.userData.length = spec.length;
  return root;
}
