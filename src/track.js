// Point-to-point race track: a gently winding road built from a random-walk
// centerline, plus scenery. Exposes centerline sampling helpers used by
// physics (off-road detection, progress) and AI (lookahead).

import * as THREE from "three";

export const ROAD_HALF_W = 7.5;
const STEP = 5; // metres between centerline samples
const PRE = 400, POST = 900; // visual road extensions (see buildMeshes)
// Self-clearance: elevation is a function of distance-along-track, so if the
// centerline loops back near itself the two passes sit at different heights
// and the lower road runs through the upper pass's terrain skirt (skirts
// reach ±100 m → any pair of passes needs 210 m). Pairs closer than SELF_ARC
// along the road are one continuous sweeper, not two passes (min turn radius
// is ~111 m, so a half-circle keeps ~222 m and passes; only a >230° carousel
// would flag itself, and rerolling those is fine too).
const SELF_CLEAR = 210;
const SELF_ARC = 350;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One centerline candidate: the heading/hill random walks for one sub-seed.
function generate(lengthM, seed) {
  const rand = mulberry32(seed);
  const points = [];   // THREE.Vector3 per sample
  const headings = []; // heading at each sample

  // Random-walk curvature: alternating straights and sweepers, never sharp.
  let x = 0, z = 0, heading = 0, curv = 0, curvTarget = 0, segLeft = 0;
  const n = Math.ceil(lengthM / STEP) + 1;
  for (let i = 0; i < n; i++) {
    points.push(new THREE.Vector3(x, 0, z));
    headings.push(heading);
    if (segLeft <= 0) {
      segLeft = 120 + rand() * 260; // segment length in metres
      curvTarget = i * STEP < 200 ? 0 : (rand() - 0.5) * 2 * 0.009; // gentle; straight launch zone
      if (rand() < 0.35) curvTarget = 0; // straights are common
    }
    curv += (curvTarget - curv) * 0.06;
    heading += curv * STEP;
    x += Math.sin(heading) * STEP;
    z += Math.cos(heading) * STEP;
    segLeft -= STEP;
  }

  // Gentle rolling hills: a second random walk drives slope the way the
  // one above drives heading. A soft spring toward mid-height turns the
  // walk into an underdamped oscillator (~500 m wavelength), and elevation
  // stays in [0, HILL_MAX] so the flat ground plane never shows above the
  // road. An envelope pins the launch zone and the finish approach to
  // y = 0 — launch balance stays flat-road, and finished cars coasting
  // past the line keep a level y/grade (see physics.js).
  const HILL_MAX = 6;
  const sm01 = (t) => { t = THREE.MathUtils.clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  let ey = 0, slope = 0, slopeTarget = 0, hillLeft = 0;
  for (let i = 0; i < n; i++) {
    if (hillLeft <= 0) {
      hillLeft = 140 + rand() * 300;
      slopeTarget = (rand() - 0.5) * 2 * 0.04; // ≤4% grade wanted; gentle
      if (rand() < 0.25) slopeTarget = 0;
    }
    slope += ((slopeTarget - (ey - HILL_MAX / 2) * 0.012) - slope) * 0.05;
    ey += slope * STEP;
    if (ey < 0) { ey = 0; slope = Math.max(slope, 0); }
    if (ey > HILL_MAX) { ey = HILL_MAX; slope = Math.min(slope, 0); }
    hillLeft -= STEP;
    const d = i * STEP;
    points[i].y = ey * sm01((d - 150) / 300) * sm01((lengthM - d - 80) / 300);
  }
  // round off the clamp/envelope kinks so grade (piecewise per segment)
  // never steps visibly in groundPitch
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < n - 1; i++) {
      points[i].y = (points[i - 1].y + 2 * points[i].y + points[i + 1].y) / 4;
    }
  }

  return { points, headings, rand, clear: selfClearance(points, headings) };
}

// Min plan distance between any two far-apart centerline samples, the PRE/POST
// straight extensions included (the run-off crossing a mid-track hill is the
// same drive-through-terrain artifact, and the results camera lingers on it).
// Early-outs at the first pair under SELF_CLEAR — the returned value is then
// just an upper bound, which is fine for ranking failed candidates.
function selfClearance(points, headings) {
  const xs = [], zs = [];
  const first = points[0], last = points[points.length - 1];
  const h0 = headings[0], h1 = headings[headings.length - 1];
  for (let i = Math.round(PRE / STEP); i >= 1; i--) {
    xs.push(first.x - Math.sin(h0) * STEP * i); zs.push(first.z - Math.cos(h0) * STEP * i);
  }
  for (const p of points) { xs.push(p.x); zs.push(p.z); }
  for (let i = 1; i <= Math.round(POST / STEP); i++) {
    xs.push(last.x + Math.sin(h1) * STEP * i); zs.push(last.z + Math.cos(h1) * STEP * i);
  }
  const skip = Math.round(SELF_ARC / STEP);
  let best = Infinity;
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + skip; j < xs.length; j++) {
      const dx = xs[i] - xs[j], dz = zs[i] - zs[j];
      const d2 = dx * dx + dz * dz;
      if (d2 < best) {
        best = d2;
        if (best < SELF_CLEAR * SELF_CLEAR) return Math.sqrt(best);
      }
    }
  }
  return Math.sqrt(best);
}

export class Track {
  constructor(lengthM, seed) {
    this.length = lengthM;
    // The heading walk is free to loop back across itself — measured over
    // 1000 seeds, 45% of tracks had terrain-skirt overlap and 39% crossed
    // their own road (flat, that passed as an X-intersection; with hills
    // it's driving through the upper pass's hillside). Reroll the walk on a
    // derived sub-seed until it keeps SELF_CLEAR; ~55% of raw seeds pass,
    // so this converges in ~2 tries. Deterministic per (length, seed).
    let best = null;
    for (let attempt = 0; attempt < 24 && (!best || best.clear < SELF_CLEAR); attempt++) {
      const cand = generate(lengthM, (seed + attempt * 0x9e3779b9) >>> 0);
      if (!best || cand.clear > best.clear) best = cand;
    }
    this.points = best.points;
    this.headings = best.headings;
    this._rand = best.rand;
  }

  // Position/heading at distance d along the track. `elev` is the road height
  // and `grade` its slope (dy per metre along the road). Elevation is
  // deliberately a function of centerline distance only (a "ribbon world"),
  // which keeps project() and curvatureAt() plan-view forever.
  sample(d) {
    const f = THREE.MathUtils.clamp(d / STEP, 0, this.points.length - 1.001);
    const i = Math.floor(f), t = f - i;
    const b = this.points[i + 1] ?? this.points[i];
    const p = this.points[i].clone().lerp(b, t);
    return {
      pos: p,
      heading: this.headings[Math.min(i, this.headings.length - 1)],
      elev: p.y,
      grade: (b.y - this.points[i].y) / STEP,
    };
  }

  // Curvature magnitude near distance d (for AI corner-speed planning).
  curvatureAt(d) {
    const i = THREE.MathUtils.clamp(Math.round(d / STEP), 1, this.headings.length - 2);
    let dh = this.headings[i + 1] - this.headings[i - 1];
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    return Math.abs(dh) / (2 * STEP);
  }

  // Project a world position onto the centerline. `hint` is the previous
  // progress distance so we only search locally. Returns { dist, lateral }.
  project(pos, hint) {
    const i0 = Math.max(0, Math.floor(hint / STEP) - 8);
    const i1 = Math.min(this.points.length - 2, i0 + 20);
    let best = { dist: hint, lateral: 0, d2: Infinity };
    for (let i = i0; i <= i1; i++) {
      const a = this.points[i], b = this.points[i + 1];
      const abx = b.x - a.x, abz = b.z - a.z;
      const apx = pos.x - a.x, apz = pos.z - a.z;
      const len2 = abx * abx + abz * abz;
      let t = len2 > 0 ? (apx * abx + apz * abz) / len2 : 0;
      t = THREE.MathUtils.clamp(t, 0, 1);
      const cx = a.x + abx * t, cz = a.z + abz * t;
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < best.d2) {
        // signed lateral: positive = right of centerline
        const cross = abx * dz - abz * dx;
        best = { dist: (i + t) * STEP, lateral: Math.sign(cross) * Math.sqrt(d2), d2 };
      }
    }
    return best;
  }

  // ---------- visuals ----------

  buildMeshes(scene, palette) {
    const rand = this._rand;

    // The drivable track spans d ∈ [0, length], but the visible road gets a
    // straight, flat run-up before the start line and run-off past the
    // finish (both ends sit at y ≈ 0 thanks to the elevation envelope), so
    // the world doesn't dead-end in grass behind the staging line or under
    // cars coasting out past the flag. Visual only — sample()/project()
    // and everything physics/AI touch still see [0, length].
    // POST is long because raceTick keeps coasting the cars behind the
    // results overlay (brake 0.3 ≈ 2.4 m/s² — a top-tier car can roll
    // ~700 m before it's crawling), and fog swallows the far end anyway.
    // PRE/POST are module consts — the self-clearance reroll needs them too.
    const pts = [], hd = [];
    const first = this.points[0], last = this.points[this.points.length - 1];
    const h0 = this.headings[0], h1 = this.headings[this.headings.length - 1];
    for (let i = Math.round(PRE / STEP); i >= 1; i--) {
      pts.push(new THREE.Vector3(first.x - Math.sin(h0) * STEP * i, first.y, first.z - Math.cos(h0) * STEP * i));
      hd.push(h0);
    }
    pts.push(...this.points); hd.push(...this.headings);
    for (let i = 1; i <= Math.round(POST / STEP); i++) {
      pts.push(new THREE.Vector3(last.x + Math.sin(h1) * STEP * i, last.y, last.z + Math.cos(h1) * STEP * i));
      hd.push(h1);
    }
    // sample() over the extended span: straight flat extrapolation off-ends
    const sampleExt = (d) => {
      if (d >= 0 && d <= this.length) return this.sample(d);
      const p = d < 0 ? first : last, h = d < 0 ? h0 : h1, o = d < 0 ? d : d - this.length;
      return { pos: new THREE.Vector3(p.x + Math.sin(h) * o, p.y, p.z + Math.cos(h) * o), heading: h, grade: 0 };
    };

    // Road ribbon
    const roadPos = [], roadIdx = [];
    for (let i = 0; i < pts.length; i++) {
      const nx = Math.cos(hd[i]), nz = -Math.sin(hd[i]); // left normal
      roadPos.push(
        pts[i].x + nx * ROAD_HALF_W, pts[i].y + 0.01, pts[i].z + nz * ROAD_HALF_W,
        pts[i].x - nx * ROAD_HALF_W, pts[i].y + 0.01, pts[i].z - nz * ROAD_HALF_W,
      );
      if (i > 0) {
        const k = i * 2;
        // wound to face up — this was backwards (face-down, so culled) from
        // day one; the flat ground plane between the edge lines passed as
        // asphalt until hills opened a gap under the road
        roadIdx.push(k - 2, k - 1, k, k, k - 1, k + 1);
      }
    }
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute("position", new THREE.Float32BufferAttribute(roadPos, 3));
    roadGeo.setIndex(roadIdx);
    roadGeo.computeVertexNormals();
    scene.add(new THREE.Mesh(roadGeo, new THREE.MeshLambertMaterial({ color: 0x3a3a3e })));

    // Edge lines + center dashes as instanced quads
    const dashGeo = new THREE.PlaneGeometry(0.35, 4);
    dashGeo.rotateX(-Math.PI / 2);
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
    const nDash = Math.floor((PRE + this.length + POST) / 12);
    const dashes = new THREE.InstancedMesh(dashGeo, dashMat, nDash);
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0xdddddd });
    const edges = new THREE.InstancedMesh(dashGeo, edgeMat, nDash * 2);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1);
    const eul = new THREE.Euler(0, 0, 0, "YXZ"); // yaw then pitch, like the car roots
    for (let i = 0; i < nDash; i++) {
      const d = -PRE + i * 12 + 6;
      const { pos, heading, grade } = sampleExt(d);
      eul.set(-Math.atan(grade), heading, 0); // lie on the slope, not chord through it
      q.setFromEuler(eul);
      m4.compose(new THREE.Vector3(pos.x, pos.y + 0.02, pos.z), q, s1);
      dashes.setMatrixAt(i, m4);
      const nx = Math.cos(heading), nz = -Math.sin(heading);
      m4.compose(new THREE.Vector3(pos.x + nx * (ROAD_HALF_W - 0.4), pos.y + 0.02, pos.z + nz * (ROAD_HALF_W - 0.4)), q, new THREE.Vector3(1, 1, 3));
      edges.setMatrixAt(i * 2, m4);
      m4.compose(new THREE.Vector3(pos.x - nx * (ROAD_HALF_W - 0.4), pos.y + 0.02, pos.z - nz * (ROAD_HALF_W - 0.4)), q, new THREE.Vector3(1, 1, 3));
      edges.setMatrixAt(i * 2 + 1, m4);
    }
    scene.add(dashes, edges);

    // Ground: a terrain skirt rides the ribbon (flat at road height out past
    // the tree line, then falling below the flat plane so the hand-off seam
    // hides — same material both sides), and the plane itself sits under the
    // lowest road (elevation never goes below 0) filling out to the horizon.
    const SKIRT_MID = 62;  // covers the tree band (offsets reach ~58 m)
    const SKIRT_OUT = 100; // must stay under the tightest curve radius (~1/0.009 m) or the band folds
    // columns per station, by lateral offset; the ±7 pair leaves the road's
    // lane out of the skirt — a strip spanning it would chord the elevation
    // profile in 124 m triangles and surface above the ribbon on graded curves
    const SKIRT_COLS = [-SKIRT_OUT, -SKIRT_MID, -7, 7, SKIRT_MID, SKIRT_OUT];
    const groundMat = new THREE.MeshLambertMaterial({ color: palette.ground });
    const skPos = [], skIdx = [];
    for (let i = 0; i < pts.length; i++) {
      const nx = Math.cos(hd[i]), nz = -Math.sin(hd[i]);
      for (const off of SKIRT_COLS) {
        const outer = Math.abs(off) === SKIRT_OUT;
        skPos.push(pts[i].x + nx * off, outer ? -1.2 : pts[i].y - 0.02, pts[i].z + nz * off);
      }
      if (i > 0) {
        const k = i * SKIRT_COLS.length;
        for (let c = 0; c < SKIRT_COLS.length - 1; c++) {
          if (c === 2) continue; // the road lane
          const a = k - SKIRT_COLS.length + c, b = k + c;
          skIdx.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    }
    const skGeo = new THREE.BufferGeometry();
    skGeo.setAttribute("position", new THREE.Float32BufferAttribute(skPos, 3));
    skGeo.setIndex(skIdx);
    skGeo.computeVertexNormals();
    scene.add(new THREE.Mesh(skGeo, groundMat));

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.08;
    const mid = this.sample(this.length / 2).pos;
    ground.position.x = mid.x; ground.position.z = mid.z;
    scene.add(ground);

    // Trees / cacti along the route
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6);
    const crownGeo = new THREE.ConeGeometry(1.9, 4.2, 7);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5a4327 });
    const crownMat = new THREE.MeshLambertMaterial({ color: palette.tree });
    const nTree = Math.floor((PRE + this.length + POST) / 14);
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, nTree);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, nTree);
    for (let i = 0; i < nTree; i++) {
      const d = -PRE + rand() * (PRE + this.length + POST);
      const { pos, heading } = sampleExt(d);
      const side = rand() < 0.5 ? -1 : 1;
      const off = ROAD_HALF_W + 6 + rand() * 45;
      const nx = Math.cos(heading), nz = -Math.sin(heading);
      const px = pos.x + nx * off * side, pz = pos.z + nz * off * side;
      const sc = 0.7 + rand() * 0.9;
      q.identity();
      m4.compose(new THREE.Vector3(px, pos.y + 1.2 * sc, pz), q, new THREE.Vector3(sc, sc, sc));
      trunks.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(px, pos.y + (2.4 + 1.6) * sc, pz), q, new THREE.Vector3(sc, sc, sc));
      crowns.setMatrixAt(i, m4);
    }
    scene.add(trunks, crowns);

    // Distant mountains — rerolled off the road corridor: straighter seeds
    // put the track ends (plus the run-up/run-off) out among the cones, and
    // a road dead-ending into a mountain wall right past the flag is exactly
    // what the results camera lingers on
    const mtnMat = new THREE.MeshLambertMaterial({ color: palette.mountain });
    for (let i = 0; i < 14; i++) {
      let x, z, h;
      for (let tries = 0; tries < 12; tries++) {
        const ang = (i / 14) * Math.PI * 2 + rand();
        const r = 1400 + rand() * 800;
        h = 180 + rand() * 260;
        x = mid.x + Math.sin(ang) * r; z = mid.z + Math.cos(ang) * r;
        let clear = true;
        for (let j = 0; j < pts.length; j += 20) { // every 100 m incl. extensions
          const dx = pts[j].x - x, dz = pts[j].z - z;
          if (dx * dx + dz * dz < (h * 1.7 + 140) ** 2) { clear = false; break; }
        }
        if (clear) break; // else keep the last roll — best effort
      }
      const mtn = new THREE.Mesh(new THREE.ConeGeometry(h * 1.7, h, 5), mtnMat);
      mtn.position.set(x, h / 2 - 12, z);
      scene.add(mtn);
    }

    // Start + finish banners
    for (const d of [8, this.length - 4]) this._banner(scene, d);
  }

  _banner(scene, d) {
    const { pos, heading } = this.sample(d);
    const nx = Math.cos(heading), nz = -Math.sin(heading);
    const g = new THREE.Group();
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x999999 });
    for (const s of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 6, 8), poleMat);
      pole.position.set(pos.x + nx * (ROAD_HALF_W + 0.6) * s, pos.y + 3, pos.z + nz * (ROAD_HALF_W + 0.6) * s);
      g.add(pole);
    }
    const cv = document.createElement("canvas");
    cv.width = 512; cv.height = 64;
    const c = cv.getContext("2d");
    // checkered strip
    for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) {
      c.fillStyle = (i + j) % 2 ? "#111" : "#eee";
      c.fillRect(i * 16, j * 16, 16, 16);
    }
    const tex = new THREE.CanvasTexture(cv);
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry((ROAD_HALF_W + 0.6) * 2, 1.4),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    banner.position.set(pos.x, pos.y + 5.3, pos.z);
    banner.rotation.y = heading;
    g.add(banner);
    scene.add(g);
  }
}

// Sky/time-of-day palettes for race variety.
export const PALETTES = [
  { name: "noon",   sky: 0x7ec8f2, fog: 0xb8dcf0, ground: 0x8a9a4e, tree: 0x3e7a34, mountain: 0x7d8aa0, sun: 0xfff2cc, ambient: 0.75, horizon: 0xdfeefb },
  { name: "dusk",   sky: 0x2e2450, fog: 0xd88a5a, ground: 0x6b5c40, tree: 0x2e4a2a, mountain: 0x4a3a5e, sun: 0xff9040, ambient: 0.55, horizon: 0xf0a060 },
  { name: "desert", sky: 0x9fd0ee, fog: 0xe8d5ae, ground: 0xc2a86a, tree: 0x5e7a3a, mountain: 0xb08858, sun: 0xfff8dd, ambient: 0.8, horizon: 0xf2e4bc },
  { name: "night",  sky: 0x0a0e24, fog: 0x141a36, ground: 0x24302a, tree: 0x18301c, mountain: 0x1c2438, sun: 0xcfd8ff, ambient: 0.35, horizon: 0x283454 },
];
