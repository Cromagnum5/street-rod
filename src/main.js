// STREET ROD '86 — main game module.
// States: TITLE -> GARAGE <-> OPPONENTS -> RACE -> RESULTS -> GARAGE

import * as THREE from "three";
import { CAR_TIERS, PARTS, PART_KEYS, STREET_RACERS, RACER_COLORS, BOSSES, STARTING_MONEY, SAVE_KEY } from "./data.js";
import { buildCar } from "./carmesh.js";
import { Track, PALETTES, ROAD_HALF_W } from "./track.js";
import { CarSim, effectiveStats, topSpeed, resolveContact, REDLINE, IDLE_RPM, ROLL_MAX } from "./physics.js";
import { AIDriver } from "./ai.js";
import * as sfx from "./audio.js";

// ---------------------------------------------------------------- renderer

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.getElementById("game").appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 6000);
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function disposeScene(scene) {
  scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}

// ---------------------------------------------------------------- player state

let player = load() ?? {
  money: STARTING_MONEY,
  carTier: 0,
  parts: { engine: 0, induction: 0, exhaust: 0, tires: 0, gearbox: 0 },
  bossesBeaten: 0,
};

function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(player)); } catch {} }
function load() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; }
}

const playerTier = () => CAR_TIERS[player.carTier];

function soundSpec(tier, parts) {
  return {
    cyl: tier.cyl,
    bright: PARTS.exhaust.levels[parts.exhaust ?? 0].bright ?? 0,
    whine: PARTS.induction.levels[parts.induction ?? 0].whine ?? 0,
    sub: Math.min(1, tier.power / 250000),
  };
}

// Resale value of the current car incl. a cut of the parts bolted on.
function carSaleValue() {
  let partsSpent = 0;
  for (const k of PART_KEYS) {
    for (let l = 1; l <= (player.parts[k] ?? 0); l++) partsSpent += PARTS[k].levels[l].price;
  }
  return Math.round(playerTier().value + partsSpent * 0.4);
}

// ---------------------------------------------------------------- input

const keys = {};
addEventListener("keydown", (e) => {
  if (e.repeat) { keys[e.code] = true; return; }
  keys[e.code] = true;
  states[state]?.onKey?.(e.code);
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
});
addEventListener("keyup", (e) => { keys[e.code] = false; });

const el = (id) => document.getElementById(id);
const show = (id) => el(id).classList.remove("hidden");
const hide = (id) => el(id).classList.add("hidden");

// ---------------------------------------------------------------- state machine

let state = "TITLE";
const states = {};
function go(next, arg) {
  states[state]?.exit?.();
  state = next;
  states[state]?.enter?.(arg);
}

// ---------------------------------------------------------------- TITLE

states.TITLE = {
  enter() { show("titleScreen"); buildTitleScene(); },
  exit() { hide("titleScreen"); },
  onKey(code) {
    if (code === "Enter") { sfx.audioContext(); sfx.uiSelect(); go("GARAGE"); }
  },
};

let scene = null, sceneTick = null;

function buildTitleScene() {
  if (scene) disposeScene(scene);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x120a1e);
  scene.fog = new THREE.Fog(0x120a1e, 10, 60);
  scene.add(new THREE.AmbientLight(0xff4fa3, 0.5));
  const key = new THREE.PointLight(0xffb000, 120, 60);
  key.position.set(6, 7, 6);
  scene.add(key);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200),
    new THREE.MeshLambertMaterial({ color: 0x1a1226 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  // attract screen shows the crown car fully built — blower, side pipes, slicks
  const car = buildCar(CAR_TIERS[6], { parts: { induction: 3, exhaust: 3, tires: 3 } });
  scene.add(car);
  camera.fov = 55; camera.updateProjectionMatrix();
  sceneTick = (t) => {
    car.rotation.y = t * 0.3;
    camera.position.set(Math.sin(t * 0.1) * 8, 2.6, Math.cos(t * 0.1) * 8);
    camera.lookAt(0, 0.8, 0);
  };
}

// ---------------------------------------------------------------- GARAGE

let garageSel = 0;
let garageVoice = null;
let garageRev = 0;
let garageCarMesh = null;

states.GARAGE = {
  enter() {
    show("garageScreen");
    garageSel = 0;
    buildGarageScene();
    renderGaragePanel();
    if (!garageVoice) garageVoice = new sfx.EngineVoice(soundSpec(playerTier(), player.parts), 0.16);
    garageVoice.setSpec(soundSpec(playerTier(), player.parts));
    garageVoice.start();
  },
  exit() {
    hide("garageScreen");
    garageVoice?.stop();
  },
  onKey(code) {
    if (code === "ArrowUp" || code === "KeyW") { garageSel = (garageSel + PART_KEYS.length - 1) % PART_KEYS.length; sfx.uiTick(); renderGaragePanel(); }
    if (code === "ArrowDown" || code === "KeyS") { garageSel = (garageSel + 1) % PART_KEYS.length; sfx.uiTick(); renderGaragePanel(); }
    if (code === "Enter") buyPart(PART_KEYS[garageSel]);
    if (code === "Space") { sfx.uiSelect(); go("OPPONENTS"); }
  },
};

function buyPart(key) {
  const cur = player.parts[key] ?? 0;
  const next = PARTS[key].levels[cur + 1];
  if (!next) { sfx.beep(180, 0.15, "square", 0.08); return; }
  if (player.money < next.price) { sfx.beep(180, 0.2, "sawtooth", 0.1); return; }
  player.money -= next.price;
  player.parts[key] = cur + 1;
  save();
  sfx.cashSound();
  garageVoice?.setSpec(soundSpec(playerTier(), player.parts));
  garageRev = 1; // hear the difference
  refreshGarageCar(); // ...and see it, if the part is one you can see
  renderGaragePanel();
}

// Swap the turntable car for one wearing the new hardware. Rebuilding the whole
// garage scene would work too, but this keeps the turntable phase (rotation.y is
// driven off the clock) and the lights alone.
function refreshGarageCar() {
  if (!garageCarMesh || !scene) return;
  const spin = garageCarMesh.rotation.y;
  scene.remove(garageCarMesh);
  garageCarMesh.traverse((o) => {
    if (o.isMesh) o.geometry.dispose();
  });
  garageCarMesh = buildCar(playerTier(), { parts: player.parts });
  garageCarMesh.position.y = 0.2;
  garageCarMesh.rotation.y = spin;
  scene.add(garageCarMesh);
}

function buildGarageScene() {
  if (scene) disposeScene(scene);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0b12);
  scene.fog = new THREE.Fog(0x0d0b12, 14, 46);
  scene.add(new THREE.AmbientLight(0x8888aa, 0.5));
  const key = new THREE.PointLight(0xfff0d0, 160, 80);
  key.position.set(4, 6, 5);
  scene.add(key);
  const fill = new THREE.PointLight(0x6688ff, 60, 60);
  fill.position.set(-6, 4, -4);
  scene.add(fill);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60),
    new THREE.MeshPhongMaterial({ color: 0x1c1a22, shininess: 30 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const grid = new THREE.GridHelper(60, 30, 0x333344, 0x22222e);
  grid.position.y = 0.01;
  scene.add(grid);
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.8, 0.2, 32),
    new THREE.MeshPhongMaterial({ color: 0x2e2a38, shininess: 60 }));
  plat.position.y = 0.1;
  scene.add(plat);

  garageCarMesh = buildCar(playerTier(), { parts: player.parts });
  garageCarMesh.position.y = 0.2;
  scene.add(garageCarMesh);

  camera.fov = 50; camera.updateProjectionMatrix();
  sceneTick = (t, dt) => {
    garageCarMesh.rotation.y = t * 0.35;
    camera.position.set(6.5, 2.8, 7.5);
    camera.lookAt(1.6, 0.8, 0); // car offset right of the panel
    if (garageVoice) {
      garageRev = Math.max(0, garageRev - dt * 0.8);
      const rev = garageRev > 0.4 ? (1 - Math.abs(garageRev - 0.7) / 0.3) : 0;
      const rpm = IDLE_RPM + Math.sin(t * 7) * 40 + rev * 3200;
      garageVoice.update(rpm, rev * 0.8);
    }
  };
}

function renderGaragePanel() {
  const tier = playerTier();
  el("garageCarName").textContent = tier.name;
  el("garageMoney").textContent = `CASH  $${player.money}`;
  const list = el("partList");
  list.innerHTML = "";
  PART_KEYS.forEach((key, i) => {
    const cur = player.parts[key] ?? 0;
    const next = PARTS[key].levels[cur + 1];
    const row = document.createElement("div");
    row.className = "partRow" + (i === garageSel ? " sel" : "");
    const pips = PARTS[key].levels.slice(1).map((_, j) =>
      `<span class="${j < cur ? "" : "off"}">&#9632;</span>`).join("");
    row.innerHTML = `
      <div class="pName">${PARTS[key].label}<span class="pips">${pips}</span></div>
      <div class="pLevel">${PARTS[key].levels[cur].n}</div>
      ${next
        ? `<div class="pNext">&rarr; ${next.n} &mdash; $${next.price}${player.money < next.price ? ' <span class="short">(short on cash)</span>' : ""}</div>`
        : `<div class="pMax">MAXED OUT</div>`}`;
    row.onclick = () => { garageSel = i; renderGaragePanel(); };
    list.appendChild(row);
  });

  const stats = effectiveStats(tier, player.parts);
  const hp = Math.round(stats.power / 745.7);
  const vmax = Math.round(topSpeed(stats) * 2.23694);
  const nextBoss = player.carTier < 6 ? BOSSES[player.carTier].name : null;
  const statRows = [
    ["POWER", `${hp} hp`],
    ["TOP SPEED", `~${vmax} mph`],
    ["GRIP", `${stats.cornerGrip.toFixed(1)} g-units`],
    ["BODY LEAN", `~${(stats.softness * ROLL_MAX * 57.3).toFixed(1)}&deg;`],
    ["GEARS", `${stats.gears}-speed`],
  ];
  el("garageStats").innerHTML =
    statRows.map(([l, v]) => `<div class="statRow"><span class="sLabel">${l}</span><span class="sVal">${v}</span></div>`).join("") +
    (nextBoss
      ? `<div class="statNote boss">NEXT BOSS: ${nextBoss}</div>`
      : `<div class="statNote">YOU HOLD THE CROWN &#128081;</div>`);
}

// ---------------------------------------------------------------- OPPONENTS

let roster = [], rosterIdx = 0, cardEl = null;

function makeRoster() {
  const tier = player.carTier;
  // Crown: the King is beaten and the 'Cuda is yours, so the ladder is over.
  // Nobody brings a stock car to race the champ — the street sends its best,
  // built to the teeth, and the money on the hood goes up to match.
  const crown = tier === 6;
  const names = [...STREET_RACERS].sort(() => Math.random() - 0.5);
  const colors = [...RACER_COLORS].sort(() => Math.random() - 0.5);
  roster = [];
  for (let i = 0; i < 4; i++) {
    const skill = crown ? 0.5 + Math.random() * 0.5 : 0.2 + Math.random() * 0.6;
    // aiParts compensates a lesser car with extra part levels, but can't strip
    // parts below stock — so the better-car draw is reserved for 3★+ drivers
    // (a 2★ in a +1-tier car would outrun their star label)
    let bump = [0, 0, -1, 1][Math.floor(Math.random() * 4)];
    if (bump === 1 && skill < 0.55) bump = 0;
    const carTier = Math.max(0, Math.min(6, tier + bump));
    let wager = crown
      ? Math.round((300 + skill * 800 + carTier * 60) / 25) * 25
      : Math.round((40 + skill * 220 + carTier * 60) / 25) * 25;
    wager = Math.min(wager, Math.max(25, player.money)); // never dangle a bet you can't cover
    roster.push({
      name: names[i].name, flavor: names[i].flavor,
      carTier, skill, wager, boss: false, crown, carColor: colors[i],
      partBoost: Math.random() < skill ? 1 : 0,
      // how hard he leans back when you lean on him (ai.js). Rolled independent
      // of skill on purpose: a 2★ can be a bruiser and a 5★ can be clean, so
      // racecraft is a personality you learn per name, not a second star bar.
      aggro: 0.25 + Math.random() * 0.75,
    });
  }
  // a freebie so being broke never soft-locks the game
  if (player.money < 25) {
    roster[0] = {
      name: "Free-Ride Freddy", flavor: "Races for the love of it. Slips you gas money if you win.",
      // freebie: exempt from the tier-deficit parts baseline in aiParts —
      // the mercy run stays a stock lesser car so broke never means stuck
      freebie: true,
      carTier: Math.max(0, tier - 1), skill: 0.25, wager: 0, prize: 100, boss: false, partBoost: 0,
      aggro: 0.2, // races for the love of it — he'll give you the room
      carColor: 0x8a8a82, // primer gray — he races for love, not paint
    };
  }
  roster.sort((a, b) => a.skill - b.skill);
  if (tier < 6) {
    const b = BOSSES[tier];
    roster.push({
      name: b.name, flavor: b.flavor,
      carTier: tier + 1, skill: 0.8 + tier * 0.03, wager: 0, boss: true, partBoost: 1,
      aggro: 1, // your car is on the hood: he will not give you an inch
      carColor: 0xff4fa3, // bosses are pink, always
    });
  }
}

states.OPPONENTS = {
  enter() {
    makeRoster();
    rosterIdx = 0;
    show("opponentScreen");
    cardEl = null;
    showCard(0, 0);
  },
  exit() {
    hide("opponentScreen");
    el("cardStage").querySelectorAll(".oppCard").forEach((c) => c.remove());
    cardEl = null;
  },
  onKey(code) {
    if (code === "ArrowLeft" || code === "KeyA") { if (rosterIdx > 0) { rosterIdx--; sfx.uiTick(); showCard(rosterIdx, -1); } }
    if (code === "ArrowRight" || code === "KeyD") { if (rosterIdx < roster.length - 1) { rosterIdx++; sfx.uiTick(); showCard(rosterIdx, 1); } }
    if (code === "Escape") { sfx.uiTick(); go("GARAGE"); }
    if (code === "Enter") {
      const opp = roster[rosterIdx];
      if (!opp.boss && opp.wager > player.money) { sfx.beep(180, 0.2, "sawtooth", 0.1); return; }
      sfx.uiSelect();
      go("RACE", opp);
    }
  },
};

// Opponent car portraits: one small offscreen renderer shared by every card,
// results cached per tier+color+build (the roster reshuffles colors each visit,
// and the bolt-on parts are visible — a blown 4-star has to look like one).
let portraitGL = null;
const portraitCache = new Map();
function carPortrait(tierIdx, color, parts) {
  const cacheKey = `${tierIdx}:${color}:${PART_KEYS.map((k) => parts?.[k] ?? 0).join("")}`;
  const hit = portraitCache.get(cacheKey);
  if (hit) return hit;
  if (!portraitGL) {
    portraitGL = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    portraitGL.setPixelRatio(1);
    portraitGL.setSize(816, 300, false);
  }
  const s = new THREE.Scene();
  s.add(new THREE.AmbientLight(0xffffff, 0.65));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(3, 5, 4);
  s.add(sun);
  const fill = new THREE.DirectionalLight(0xbcd0ff, 0.5);
  fill.position.set(-4, 2, -2);
  s.add(fill);
  const car = buildCar(CAR_TIERS[tierIdx], { color, parts });
  car.rotation.y = 0.62; // front three-quarter, like a catalog photo
  s.add(car);
  const L = car.userData.length;
  const cam = new THREE.PerspectiveCamera(26, 816 / 300, 0.1, 60);
  cam.position.set(0, L * 0.34, L * 1.3);
  cam.lookAt(0, 0.68, 0);
  portraitGL.render(s, cam);
  const url = portraitGL.domElement.toDataURL("image/png");
  disposeScene(s);
  portraitCache.set(cacheKey, url);
  return url;
}

function cardHTML(opp) {
  const stars = Math.max(1, Math.round(opp.skill * 5));
  const carName = CAR_TIERS[opp.carTier].name;
  const build = aiParts(opp);
  const buildRows = PART_KEYS.map((k) => {
    const lvl = build[k] ?? 0;
    const boxes = [0, 1, 2].map((j) =>
      `<span class="${j < lvl ? "" : "off"}">&#9632;</span>`).join("");
    return `<div class="bRow"><span class="bName">${PARTS[k].label}</span><span class="pips">${boxes}</span></div>`;
  }).join("");
  return `
    <div class="oppName">${opp.name}</div>
    <div class="oppCar">${carName}</div>
    <div class="oppPhoto"><img src="${carPortrait(opp.carTier, opp.carColor, build)}" alt="${carName}"></div>
    <div class="oppFlavor">&ldquo;${opp.flavor}&rdquo;</div>
    <div class="oppBuild">${buildRows}</div>
    <div class="oppStats">
      <div>SKILL <span class="stars"><span class="lit">${"&#9733;".repeat(stars)}</span>${"&#9734;".repeat(5 - stars)}</span></div>
      ${opp.boss
        ? `<div class="pinkslip">&#9825; PINK SLIP RACE &#9825;</div>
           <div class="warn">Win: you drive home in the ${CAR_TIERS[opp.carTier].short}.<br>Lose: you hand over YOUR keys.</div>`
        : opp.wager === 0
          ? `<div class="wager">PRIDE RUN &mdash; win $${opp.prize ?? 0}</div>`
          : `<div class="wager">WAGER &nbsp;$${opp.wager}</div>`}
    </div>`;
}

function showCard(idx, dir) {
  const stage = el("cardStage");
  const old = cardEl;
  if (old) {
    old.classList.add(dir >= 0 ? "cardOffL" : "cardOffR");
    setTimeout(() => old.remove(), 300);
  }
  const card = document.createElement("div");
  const opp = roster[idx];
  card.className = "oppCard " + (opp.boss ? "boss " : "") + (dir >= 0 ? "cardOffR" : "cardOffL");
  card.innerHTML = cardHTML(opp);
  stage.appendChild(card);
  card.getBoundingClientRect(); // force reflow so the transition plays
  card.classList.remove("cardOffR", "cardOffL");
  cardEl = card;
  el("cardCounter").textContent = `${idx + 1} / ${roster.length}` + (opp.boss ? "  — BOSS" : "");
  el("arrL").style.visibility = idx > 0 ? "visible" : "hidden";
  el("arrR").style.visibility = idx < roster.length - 1 ? "visible" : "hidden";
}

// ---------------------------------------------------------------- RACE

const race = {};
window.__race = race; // debug handle for the headless smoke tests
const CAM_FOLLOW = 10; // chase-camera follow gain; steady-state trail = speed / CAM_FOLLOW
const tachoSegs = [];
{
  const tacho = el("tacho");
  for (let i = 0; i < 12; i++) {
    const s = document.createElement("div");
    s.className = "seg" + (i >= 10 ? " hot" : "");
    tacho.appendChild(s);
    tachoSegs.push(s);
  }
}

states.RACE = {
  enter(opp) {
    buildRaceScene(opp);
    show("hud");
  },
  exit() {
    hide("hud");
    race.playerVoice?.dispose();
    race.aiVoice?.dispose();
    race.skid?.update(0);
    race.rumble?.update(0);
  },
  onKey(code) {
    if (code === "Escape" && !race.over) finishRace(false, "You backed out of the race.");
  },
};

function aiParts(opp) {
  // Stars are the promise: since straights went flat-out for every skill,
  // driver skill is worth <1 s/race — parts are the real difficulty lever.
  // Street builds run stars−2 part levels (1–2★ stock, 3★ bolt-ons, 4★ a
  // genuinely built car), and one tier of lesser iron buys one extra level —
  // in this data one tier ≈ one part level almost exactly, so a hot-rodded
  // Model A honestly matches its star label against Deuce-class company.
  // Bosses keep their own formula: always a properly built machine.
  // The tier bump is a baseline, not a bonus (Jason, 2026-07-11): the stars
  // term floors at 0 and the per-part jitter floors at the deficit, so even
  // a 1★ in lesser iron shows up upgraded to the player-tier stock pace —
  // never a free win just because the draw handed them an older car.
  // Memoized: the card shows this build, so it has to be the one that races.
  // Crown racers (post-King) use their own curve: nothing stock ever shows up
  // to race the champ. 3★ arrives with bolt-ons everywhere, 4–5★ with a fully
  // built car — and the −1 jitter/partBoost decide which of them is maxed out.
  if (opp.parts) return opp.parts;
  const deficit = opp.freebie ? 0 : player.carTier - opp.carTier;
  const lvl = opp.boss
    ? Math.min(3, 1 + Math.round(opp.skill))
    : opp.crown
      ? Math.min(3, 1 + Math.round(opp.skill * 2) + deficit)
      : Math.max(0, Math.round(opp.skill * 5) - 2) + deficit;
  const floor = opp.boss ? 0 : Math.max(opp.crown ? 1 : 0, deficit);
  const p = {};
  for (const k of PART_KEYS) p[k] = Math.max(floor, Math.min(3, lvl + (Math.random() < 0.4 ? -1 : 0)));
  if (!opp.boss && opp.partBoost) {
    // their one pride part — Donna really did rebuild that motor
    const k = PART_KEYS[Math.floor(Math.random() * PART_KEYS.length)];
    p[k] = Math.min(3, p[k] + 1);
  }
  opp.parts = p;
  return p;
}

function buildRaceScene(opp) {
  if (scene) disposeScene(scene);
  const palette = PALETTES[Math.floor(Math.random() * PALETTES.length)];
  scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.sky);
  scene.fog = new THREE.Fog(palette.fog, 150, 1400);
  scene.add(new THREE.AmbientLight(0xffffff, palette.ambient));
  const sun = new THREE.DirectionalLight(palette.sun, 1.6);
  sun.position.set(0.4, 1, 0.3);
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(palette.sky, palette.ground, 0.5);
  scene.add(hemi);

  // boss races match the longest street race at the tier — no longer (Jason,
  // 2026-07-11: a pink-slip race shouldn't drag past the money races)
  const length = opp.boss ? 2700 + player.carTier * 200 : 2300 + player.carTier * 200 + Math.random() * 400;
  const track = new Track(length, (Math.random() * 1e9) | 0);
  track.buildMeshes(scene, palette);

  const pStats = effectiveStats(playerTier(), player.parts);
  const oppParts = aiParts(opp);
  const aiTierData = CAR_TIERS[opp.carTier];
  const aStats = effectiveStats(aiTierData, oppParts);

  race.opp = opp;
  race.track = track;
  race.player = new CarSim(pStats, track, -3);
  race.ai = new CarSim(aStats, track, 3);
  race.driver = new AIDriver(race.ai, track, opp.skill, 3, opp.aggro ?? 0.6);
  race.playerMesh = buildCar(playerTier(), { parts: player.parts });
  // same paint AND same build as the card: if he showed up with a blower, it's there
  race.aiMesh = buildCar(aiTierData, { color: opp.carColor, parts: oppParts });
  // root carries heading (Y) then ground pitch (X) once hills exist; the
  // default XYZ order would pitch about the world axis instead of the car's
  race.playerMesh.rotation.order = "YXZ";
  race.aiMesh.rotation.order = "YXZ";
  scene.add(race.playerMesh, race.aiMesh);

  race.playerVoice = new sfx.EngineVoice(soundSpec(playerTier(), player.parts), 0.5);
  race.aiVoice = new sfx.EngineVoice(soundSpec(aiTierData, oppParts), 0.3);
  race.playerVoice.start(); race.aiVoice.start();
  race.skid = race.skid ?? new sfx.SkidSound();
  race.rumble = race.rumble ?? new sfx.RumbleSound();

  race.time = 0;
  race.goTime = null;
  race.countdown = 3.999;
  race.over = false;
  race.aiFinishedAt = null;
  race.lastBeep = 4;
  race.steer = 0;
  race.aiSteer = 0;
  race.prevSpeed = 0;
  race.accelSm = 0;
  race.camSpeed = 0;
  race.camY = 0;
  race.lastClunk = -9;
  race.aiRev = 0;
  race.aiRevT = 0.3 + Math.random() * 0.6; // first blip lands shortly after staging

  el("hudMoney").textContent = `CASH $${player.money}`;
  el("hudWager").textContent = opp.boss ? "♡ PINK SLIP RACE ♡"
    : opp.wager === 0 ? `PRIDE RUN — $${opp.prize ?? 0}` : `WAGER $${opp.wager}`;
  el("hudWager").classList.toggle("boss", !!opp.boss);
  el("centerMsg").textContent = "";

  camera.fov = 62; camera.updateProjectionMatrix();
  // drop the camera behind the start line
  const s0 = track.sample(0);
  camera.position.set(s0.pos.x - Math.sin(s0.heading) * 7, 3, s0.pos.z - Math.cos(s0.heading) * 7);

  sceneTick = raceTick;
}

function raceTick(t, dt) {
  if (!race.track) return;
  race.time += dt;
  const p = race.player, ai = race.ai;

  const thr = (keys.ArrowUp || keys.KeyW || keys.ControlLeft || keys.ControlRight) ? 1 : 0;
  const brk = (keys.ArrowDown || keys.KeyS) ? 1 : 0;
  // keys are digital; ramp toward the target so taps give partial steer
  const steerTarget = ((keys.ArrowLeft || keys.KeyA) ? 1 : 0) - ((keys.ArrowRight || keys.KeyD) ? 1 : 0);
  race.steer += (steerTarget - race.steer) * Math.min(1, dt * 9);
  const steer = race.steer;

  if (race.countdown > 0) {
    race.countdown -= dt;
    const n = Math.ceil(race.countdown);
    el("centerMsg").textContent = race.countdown <= 0 ? "GO!" : n <= 3 ? String(n) : "";
    if (n < race.lastBeep && n >= 1 && n <= 3) { sfx.beep(440, 0.12); race.lastBeep = n; }
    if (race.countdown <= 0) { sfx.beep(880, 0.4); race.goTime = race.time; setTimeout(() => { if (el("centerMsg").textContent === "GO!") el("centerMsg").textContent = ""; }, 900); }
    // rev at the line, but hold the cars
    p.rpm += ((IDLE_RPM + thr * 3600) - p.rpm) * Math.min(1, dt * 6);
    p.throttleOut = thr;
    // AI stabs random aggressive blips while staging, then pins it for the go
    if (race.countdown < 1.2) race.aiRev = 1;
    else if (race.time >= race.aiRevT) {
      race.aiRev = race.aiRev ? 0 : 1;
      race.aiRevT = race.time + (race.aiRev ? 0.15 + Math.random() * 0.25 : 0.15 + Math.random() * 0.5);
    }
    // stabs hit fast and fall off slower — that asymmetry is what reads angry
    ai.rpm += ((IDLE_RPM + race.aiRev * 3600) - ai.rpm) * Math.min(1, dt * (race.aiRev ? 8 : 3.5));
    ai.throttleOut = race.aiRev;
  } else if (!race.over) {
    p.step(dt, thr, brk, steer);
    const ctrl = race.driver.drive(dt, race.time - race.goTime, p.trackDist, p);
    ai.step(dt, ctrl.throttle, ctrl.brake, ctrl.steer);
    race.aiSteer = ctrl.steer;
    const impact = resolveContact(p, ai, dt);
    // audible contact: real hits clunk (rate-limited), rubbing stays silent
    if (impact > 2 && race.time - race.lastClunk > 0.25) {
      sfx.clunk(Math.min(1, impact / 12));
      race.lastClunk = race.time;
    }

    if (ai.finished && race.aiFinishedAt === null) race.aiFinishedAt = race.time;
    if (p.finished) finishRace(race.aiFinishedAt === null, null);
    else if (race.aiFinishedAt !== null && race.time - race.aiFinishedAt > 2.5) {
      finishRace(false, null);
    }
  } else {
    // race over: coast
    p.step(dt, 0, 0.3, 0);
    ai.step(dt, 0, 0.3, 0);
    race.aiSteer += (0 - race.aiSteer) * Math.min(1, dt * 9);
  }

  // ----- meshes -----
  for (const [sim, mesh] of [[p, race.playerMesh], [ai, race.aiMesh]]) {
    mesh.position.set(sim.x, sim.y, sim.z);
    mesh.rotation.y = sim.heading;
    mesh.rotation.x = sim.groundPitch; // road slope; suspension pitch stays on the body
    // suspension: only the body leans/pitches, wheels stay on the road
    const body = mesh.userData.body;
    body.rotation.z = sim.roll;
    body.rotation.x = mesh.userData.bodyRake + sim.pitch;
    const wheels = mesh.userData.wheels;
    const spin = sim.speed * dt / mesh.userData.wheelR;
    for (let i = 0; i < 4; i++) wheels[i].rotation.x += spin;
    const steerAng = (sim === p ? steer : race.aiSteer) * 0.35;
    wheels[0].rotation.y = steerAng; wheels[1].rotation.y = steerAng;
  }

  // ----- chase camera -----
  // follow the travel direction, not the nose: in a slide the car visibly
  // hangs sideways in frame while the camera keeps tracking the path
  const velHeading = p.heading - p.slip;
  const fx = Math.sin(velHeading), fz = Math.cos(velHeading);
  // framing follows a smoothed speed, extra slow once the race is over, so
  // braking to a stop past the finish line doesn't rubber-band the camera
  race.camSpeed += (p.speed - race.camSpeed) * Math.min(1, dt * (race.over ? 1.0 : 6));
  // camera height rides a slower-smoothed copy of the car's road height so a
  // future crest/dip won't lurch the frame (Jason + big camera moves = seasick)
  race.camY += (p.y - race.camY) * Math.min(1, dt * 4);
  const dist = 4.3 + race.camSpeed * 0.0065;
  const camGoal = new THREE.Vector3(p.x - fx * dist, race.camY + 2.15 + race.camSpeed * 0.002, p.z - fz * dist);
  // CAM_FOLLOW is the real chase-distance knob: an exponential smoother chasing a
  // target moving at v settles v/gain behind it, so this adds 0.1 s of travel (8 m
  // at 180 mph) on top of `dist` — 30x the dolly term. Lower it and the camera
  // falls back at speed; raise it and the chase goes rigid.
  camera.position.lerp(camGoal, 1 - Math.exp(-dt * CAM_FOLLOW));
  camera.lookAt(p.x + fx * 7, race.camY + 1.1, p.z + fz * 7);
  // gentle widening with speed; the drama comes from a small acceleration kick
  // (zoom-out surge on launch/passing, slight tighten under braking)
  // contactLoss is added back so bumping the other car doesn't fire the
  // FOV kick — those speed steps read as camera stutter, not drama
  const accel = (p.speed + p.contactLoss - race.prevSpeed) / Math.max(dt, 1e-4);
  race.prevSpeed = p.speed;
  race.accelSm += (accel - race.accelSm) * Math.min(1, dt * 4);
  const kick = race.over ? 0
    : race.accelSm > 0 ? Math.min(6, race.accelSm * 0.7) : Math.max(-3, race.accelSm * 0.25);
  const fovGoal = 60 + Math.min(9, race.camSpeed * 0.11) + kick;
  camera.fov += (fovGoal - camera.fov) * Math.min(1, dt * 3);
  camera.updateProjectionMatrix();

  // ----- audio -----
  race.playerVoice.update(p.rpm, p.throttleOut);
  const dAI = Math.hypot(ai.x - p.x, ai.z - p.z);
  race.aiVoice.update(ai.rpm, ai.throttleOut ?? 0.6, Math.max(0, 1 - dAI / 90));
  race.skid.update(p.screech);
  race.rumble.update(p.offroad ? Math.min(1, p.speed / 20) : 0);

  // ----- HUD -----
  el("speed").textContent = Math.round(p.speed * 2.23694);
  el("gear").textContent = race.countdown > 0 ? "N" : `GEAR ${p.gear}`;
  const rpmFrac = (p.rpm - IDLE_RPM) / (REDLINE - IDLE_RPM);
  tachoSegs.forEach((s, i) => s.classList.toggle("on", rpmFrac * 12 > i));
  const ahead = p.trackDist >= ai.trackDist;
  el("position").textContent = race.countdown > 0 ? "" : ahead ? "1st" : "2nd";
  el("dotPlayer").style.left = `${Math.min(100, p.trackDist / race.track.length * 100)}%`;
  el("dotAI").style.left = `${Math.min(100, ai.trackDist / race.track.length * 100)}%`;
}

function finishRace(won, note) {
  if (race.over) return;
  race.over = true;
  el("centerMsg").textContent = won ? "YOU WIN!" : "YOU LOSE";
  setTimeout(() => go("RESULTS", { won, note, opp: race.opp }), 1800);
}

// ---------------------------------------------------------------- RESULTS

states.RESULTS = {
  enter({ won, note, opp }) {
    const title = el("resultTitle"), body = el("resultBody");
    title.textContent = won ? "VICTORY" : "DEFEAT";
    title.className = won ? "win" : "lose";
    let html = note ? `${note}<br>` : "";

    if (opp.boss) {
      if (won) {
        const sale = carSaleValue();
        const newTier = CAR_TIERS[opp.carTier];
        html += `${opp.name} slaps the pink slip in your hand.<br>` +
          `The <span class="pink">${newTier.name}</span> is yours.<br>` +
          `Your old ${playerTier().short} sells for <span class="money">$${sale}</span>.`;
        player.money += sale;
        player.carTier = opp.carTier;
        player.parts = { engine: 0, induction: 0, exhaust: 0, tires: 0, gearbox: 0 };
        player.bossesBeaten++;
        sfx.cashSound();
      } else {
        html += `${opp.name} takes your keys and doesn't look back.<br>` +
          `Your <span class="pink">${playerTier().name}</span> is gone.<br>` +
          `The junkyard man takes pity — there's a rusty Model A out back with your name on it.`;
        player.carTier = 0;
        player.parts = { engine: 0, induction: 0, exhaust: 0, tires: 0, gearbox: 0 };
        sfx.loseSound();
      }
    } else {
      const stake = opp.wager === 0 ? (won ? (opp.prize ?? 0) : 0) : opp.wager;
      if (won) {
        player.money += stake;
        html += `You take ${opp.name} for <span class="money">$${stake}</span>.`;
        sfx.cashSound();
      } else {
        player.money = Math.max(0, player.money - stake);
        html += stake > 0
          ? `${opp.name} pockets your <span class="money">$${stake}</span> and grins.`
          : `${opp.name} wins nothing but bragging rights. Somehow that's worse.`;
        sfx.loseSound();
      }
    }
    html += `<br><br>CASH: <span class="money">$${player.money}</span>`;
    body.innerHTML = html;
    save();
    show("resultScreen");
  },
  exit() { hide("resultScreen"); },
  onKey(code) { if (code === "Enter") { sfx.uiSelect(); go("GARAGE"); } },
};

// ---------------------------------------------------------------- main loop

let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  sceneTick?.(now / 1000, dt);
  if (scene) renderer.render(scene, camera);
}

states.TITLE.enter();
requestAnimationFrame(frame);
