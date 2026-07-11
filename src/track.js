// Point-to-point race track: a gently winding road built from a random-walk
// centerline, plus scenery. Exposes centerline sampling helpers used by
// physics (off-road detection, progress) and AI (lookahead).

import * as THREE from "three";

export const ROAD_HALF_W = 7.5;
const STEP = 5; // metres between centerline samples

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Track {
  constructor(lengthM, seed) {
    const rand = mulberry32(seed);
    this.length = lengthM;
    this.points = [];   // THREE.Vector3 per sample
    this.headings = []; // heading at each sample

    // Random-walk curvature: alternating straights and sweepers, never sharp.
    let x = 0, z = 0, heading = 0, curv = 0, curvTarget = 0, segLeft = 0;
    const n = Math.ceil(lengthM / STEP) + 1;
    for (let i = 0; i < n; i++) {
      this.points.push(new THREE.Vector3(x, 0, z));
      this.headings.push(heading);
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
    this._rand = rand;
  }

  // Position/heading at distance d along the track. `elev` is the road height
  // and `grade` its slope (dy per metre along the road) — both always 0 until
  // hills land; they exist now so every consumer is already plumbed. Elevation
  // is deliberately a function of centerline distance only (a "ribbon world"),
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
    const pts = this.points, hd = this.headings;

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
        roadIdx.push(k - 2, k, k - 1, k, k + 1, k - 1);
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
    const nDash = Math.floor(this.length / 12);
    const dashes = new THREE.InstancedMesh(dashGeo, dashMat, nDash);
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0xdddddd });
    const edges = new THREE.InstancedMesh(dashGeo, edgeMat, nDash * 2);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s1 = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < nDash; i++) {
      const d = i * 12 + 6;
      const { pos, heading } = this.sample(d);
      q.setFromAxisAngle(up, heading);
      m4.compose(new THREE.Vector3(pos.x, pos.y + 0.02, pos.z), q, s1);
      dashes.setMatrixAt(i, m4);
      const nx = Math.cos(heading), nz = -Math.sin(heading);
      m4.compose(new THREE.Vector3(pos.x + nx * (ROAD_HALF_W - 0.4), pos.y + 0.02, pos.z + nz * (ROAD_HALF_W - 0.4)), q, new THREE.Vector3(1, 1, 3));
      edges.setMatrixAt(i * 2, m4);
      m4.compose(new THREE.Vector3(pos.x - nx * (ROAD_HALF_W - 0.4), pos.y + 0.02, pos.z - nz * (ROAD_HALF_W - 0.4)), q, new THREE.Vector3(1, 1, 3));
      edges.setMatrixAt(i * 2 + 1, m4);
    }
    scene.add(dashes, edges);

    // Ground. NOTE for hills: this flat plane is the one visual that can't
    // just take y from sample() — it will need to become a skirt that
    // follows the road ribbon (or sit low enough to hide under it).
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(9000, 9000),
      new THREE.MeshLambertMaterial({ color: palette.ground }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    const mid = this.sample(this.length / 2).pos;
    ground.position.x = mid.x; ground.position.z = mid.z;
    scene.add(ground);

    // Trees / cacti along the route
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6);
    const crownGeo = new THREE.ConeGeometry(1.9, 4.2, 7);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5a4327 });
    const crownMat = new THREE.MeshLambertMaterial({ color: palette.tree });
    const nTree = Math.floor(this.length / 14);
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, nTree);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, nTree);
    for (let i = 0; i < nTree; i++) {
      const d = rand() * this.length;
      const { pos, heading } = this.sample(d);
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

    // Distant mountains
    const mtnMat = new THREE.MeshLambertMaterial({ color: palette.mountain });
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2 + rand();
      const r = 1400 + rand() * 800;
      const h = 180 + rand() * 260;
      const mtn = new THREE.Mesh(new THREE.ConeGeometry(h * 1.7, h, 5), mtnMat);
      mtn.position.set(mid.x + Math.sin(ang) * r, h / 2 - 12, mid.z + Math.cos(ang) * r);
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
