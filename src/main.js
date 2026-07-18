// STREET ROD '86 — main game module.
// States: TITLE -> GARAGE <-> OPPONENTS -> RACE -> RESULTS -> GARAGE

import * as THREE from "three";
import { CAR_TIERS, PARTS, PART_KEYS, BOSSES, STARTING_MONEY, SAVE_KEY } from "./data.js";
import { makeRoster, aiParts, carSaleValue, partPrice, freshParts, wagerLoss, buildLevel } from "./economy.js";
import { buildCar } from "./carmesh.js";
import { Track, PALETTES, ROAD_HALF_W } from "./track.js";
import { CarSim, effectiveStats, topSpeed, resolveContact, resolveDraft, REDLINE, IDLE_RPM, ROLL_MAX, GRAV } from "./physics.js";
import { AIDriver } from "./ai.js";
import * as sfx from "./audio.js";

// ---------------------------------------------------------------- renderer

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById("game").appendChild(renderer.domElement);
// debug handle, same as __race. Note renderer.info can NOT see shadow cost:
// info.reset() runs after the shadow pass, so those draws are wiped from the
// count. Frame timing is the only handle the smoke tests have on it.
window.__renderer = renderer;
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 6000);
window.__camera = camera; // debug handle: lets the smoke tests project world points to pixels
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function disposeScene(scene) {
  scene.traverse((o) => {
    // shadow maps are render targets, not materials — nothing else here frees
    // them, and a 2048² map per race scene is ~16 MB a leak
    if (o.isLight && o.shadow?.map) { o.shadow.map.dispose(); o.shadow.map = null; }
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
  parts: freshParts(),
  bossesBeaten: 0,
};

function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(player)); } catch {} }
function load() {
  try {
    const p = JSON.parse(localStorage.getItem(SAVE_KEY));
    // the whole economy moves in even $100s now; older saves carried $25 steps
    if (p && typeof p.money === "number") p.money = Math.max(0, Math.round(p.money / 100) * 100);
    return p;
  } catch { return null; }
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

// ---------------------------------------------------------------- input

const keys = {};
addEventListener("keydown", (e) => {
  if (e.repeat) { keys[e.code] = true; return; }
  keys[e.code] = true;
  states[state]?.onKey?.(e.code);
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
});
addEventListener("keyup", (e) => { keys[e.code] = false; });

// ---------------------------------------------------------------- touch controls
// Drag anywhere on the canvas: horizontal = steering, vertical up = throttle,
// vertical down = brake. Blends with keyboard so a Bluetooth keyboard still works
// alongside touch. Only active during RACE state to avoid interfering with garage
// menu navigation.

let touchSteer = 0, touchThrottle = 0, touchBrake = 0;
let touchActive = false, touchStartX = 0, touchStartY = 0;

const TOUCH_STEER_RANGE = 80;   // px of horizontal drag = full lock
const TOUCH_THROTTLE_RANGE = 120; // px of vertical drag = full throttle/brake

function onTouchStart(e) {
  if (state !== "RACE") return;
  e.preventDefault();
  const t = e.touches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;
  touchActive = true;
  touchSteer = touchThrottle = touchBrake = 0;
}

function onTouchMove(e) {
  if (!touchActive || state !== "RACE") return;
  e.preventDefault();
  const t = e.touches[0];
  const dx = t.clientX - touchStartX;
  const dy = touchStartY - t.clientY; // positive = dragged up = throttle
  touchSteer    = Math.max(-1, Math.min(1, dx / TOUCH_STEER_RANGE));
  touchThrottle = dy > 0 ? Math.min(1, dy / TOUCH_THROTTLE_RANGE) : 0;
  touchBrake    = dy < 0 ? Math.min(1, -dy / TOUCH_THROTTLE_RANGE) : 0;
}

function onTouchEnd() {
  touchActive = false;
  touchSteer = touchThrottle = touchBrake = 0;
}

// Attach to the canvas once it exists (renderer appends it in the next tick)
requestAnimationFrame(() => {
  const canvas = renderer.domElement;
  canvas.addEventListener("touchstart", onTouchStart, { passive: false });
  canvas.addEventListener("touchmove",  onTouchMove,  { passive: false });
  canvas.addEventListener("touchend",   onTouchEnd);
  canvas.addEventListener("touchcancel", onTouchEnd);
});

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
// The garage panel doubles as the player's card on the opponent screen; this is
// which of the two it's currently rendering. See setPanelMode.
let panelCompact = false;

states.GARAGE = {
  enter() {
    // animate the card back into the panel only if it's already on screen (i.e.
    // we came back from OPPONENTS); arriving from TITLE/RESULTS it's hidden
    const animate = !el("garagePanel").classList.contains("hidden");
    show("garagePanel");
    show("garageScreen");
    garageSel = 0;
    buildGarageScene();
    setPanelMode(false, animate);
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
  const price = partPrice(key, cur + 1, player.carTier);
  if (player.money < price) { sfx.beep(180, 0.2, "sawtooth", 0.1); return; }
  player.money -= price;
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
  // the key casts: it's the light the eye already reads as the shop lamp, so the
  // shadow lands where you expect. Left a PointLight (6 cube faces) rather than
  // swapped for a spot — a spot's cone would change the look, and this is a menu
  // screen rendering one low-poly car.
  const key = new THREE.PointLight(0xfff0d0, 160, 80);
  key.position.set(4, 6, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 40;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const fill = new THREE.PointLight(0x6688ff, 60, 60);
  fill.position.set(-6, 4, -4);
  scene.add(fill);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60),
    new THREE.MeshPhongMaterial({ color: 0x1c1a22, shininess: 30 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(60, 30, 0x333344, 0x22222e);
  grid.position.y = 0.01;
  scene.add(grid);
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.8, 0.2, 32),
    new THREE.MeshPhongMaterial({ color: 0x2e2a38, shininess: 60 }));
  plat.position.y = 0.1;
  plat.receiveShadow = true;
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

// The build block both cards wear. Shared so the player's parts and the
// opponent's are listed in one order — PART_KEYS, same as the garage's list —
// and land in the same spot on both cards, which is the whole point: you compare
// pips against pips without re-reading the labels.
function buildGridHTML(parts) {
  return PART_KEYS.map((k) => {
    const lvl = parts[k] ?? 0;
    const boxes = [0, 1, 2].map((j) =>
      `<span class="${j < lvl ? "" : "off"}">&#9632;</span>`).join("");
    return `<div class="bRow"><span class="bName">${PARTS[k].label}</span><span class="pips">${boxes}</span></div>`;
  }).join("");
}

function renderGaragePanel() {
  const tier = playerTier();
  el("garageTitle").textContent = panelCompact ? "YOUR RIDE" : "THE GARAGE";
  el("garageCarName").textContent = tier.name;
  el("garageMoney").textContent = `CASH  $${player.money}`;
  // photo only on the card: in the garage the turntable is already showing the
  // real thing, but next to the opponent it's the A/B that sells the comparison
  const photo = el("playerPhoto");
  photo.className = panelCompact ? "carPhoto" : "";
  photo.innerHTML = panelCompact
    ? `<img src="${carPortrait(player.carTier, undefined, player.parts)}" alt="${tier.name}">`
    : "";

  const list = el("partList");
  list.className = panelCompact ? "buildGrid" : "";
  list.innerHTML = "";
  if (panelCompact) {
    list.innerHTML = buildGridHTML(player.parts);
  } else PART_KEYS.forEach((key, i) => {
    const cur = player.parts[key] ?? 0;
    const next = PARTS[key].levels[cur + 1];
    const price = next ? partPrice(key, cur + 1, player.carTier) : 0;
    const row = document.createElement("div");
    row.className = "partRow" + (i === garageSel ? " sel" : "");
    const pips = PARTS[key].levels.slice(1).map((_, j) =>
      `<span class="${j < cur ? "" : "off"}">&#9632;</span>`).join("");
    row.innerHTML = `
      <div class="pName">${PARTS[key].label}<span class="pips">${pips}</span></div>
      <div class="pLevel">${PARTS[key].levels[cur].n}</div>
      ${next
        ? `<div class="pNext">&rarr; ${next.n} &mdash; $${price}${player.money < price ? ' <span class="short">(short on cash)</span>' : ""}</div>`
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
    // skidpad G, the number a car magazine quotes and a driver already has a
    // feel for (~1 G is the sports-car brag). cornerGrip is a lateral
    // acceleration, so this is a real unit conversion, not a rescale.
    ["LATERAL GRIP", `${(stats.cornerGrip / GRAV).toFixed(2)} G`],
    ["BODY LEAN", `~${(stats.softness * ROLL_MAX * 57.3).toFixed(1)}&deg;`],
    ["GEARS", `${stats.gears}-speed`],
  ];
  el("garageStats").innerHTML =
    statRows.map(([l, v]) => `<div class="statRow"><span class="sLabel">${l}</span><span class="sVal">${v}</span></div>`).join("") +
    (panelCompact // the boss note is shop talk; on the card the boss is a card
      ? ""
      : nextBoss
        ? `<div class="statNote boss">NEXT BOSS: ${nextBoss}</div>`
        : `<div class="statNote">YOU HOLD THE CROWN &#128081;</div>`);
}

// ---- the panel morph -------------------------------------------------------
//
// The garage panel and the player's card are the same element, so the box
// genuinely travels and resizes rather than one thing vanishing and another
// fading in. Two mechanisms, and they're separate on purpose: the geometry is a
// CSS transition (left/top/width/height — that's why the panel is sized by
// `height` and not `bottom`, which can't animate into a card), while the
// contents cross-fade and swap at the bottom of the fade. Morphing the contents
// in place would mean animating a 6-row shopping list into a 3x2 grid of pips;
// the fade costs 0.15 s and the box is moving through all of it.
const PLAYER_CARD_W = 320;
const PLAYER_CARD_GAP = 96; // clears #arrL at the stage's left edge (-60px)
let morphT = null;

function setPanelMode(compact, animate = true) {
  const panel = el("garagePanel");
  panelCompact = compact;
  clearTimeout(morphT);
  if (!animate) panel.style.transition = "none";
  if (compact) {
    // measure the stage instead of duplicating its geometry here — the card just
    // has to sit beside it, and #opponentScreen's padding-left reserves the room
    const s = el("cardStage").getBoundingClientRect();
    panel.style.left = `${Math.max(16, s.left - PLAYER_CARD_GAP - PLAYER_CARD_W)}px`;
    panel.style.top = `${s.top}px`;
    panel.style.width = `${PLAYER_CARD_W}px`;
    panel.style.height = `${s.height}px`;
  } else {
    // back to the stylesheet's full-height panel
    panel.style.left = panel.style.top = panel.style.width = panel.style.height = "";
  }
  panel.classList.toggle("compact", compact);
  if (!animate) {
    panel.getBoundingClientRect(); // flush, so the cleared transition can't play
    panel.style.transition = "";
    renderGaragePanel();
    return;
  }
  panel.classList.add("morphing");
  morphT = setTimeout(() => {
    renderGaragePanel();
    panel.classList.remove("morphing");
  }, 150);
}

// ---------------------------------------------------------------- OPPONENTS

let roster = [], rosterIdx = 0, cardEl = null;

states.OPPONENTS = {
  enter() {
    roster = makeRoster(player);
    rosterIdx = 0;
    show("opponentScreen");
    cardEl = null;
    showCard(0, 0);
    // after showCard, not before: setPanelMode measures the stage to line the
    // player's card up with it, and the stage only settles once #cardCounter has
    // its text — an empty counter rides the flex column 7px off
    setPanelMode(true);
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
      // no cash check: the purse has a floor, and you can never forfeit more
      // than you're carrying (wagerLoss) — so a thin wallet is never a locked door
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
  const build = aiParts(opp, player);
  return `
    <div class="oppName">${opp.name}</div>
    <div class="oppCar">${carName}</div>
    <div class="carPhoto"><img src="${carPortrait(opp.carTier, opp.carColor, build)}" alt="${carName}"></div>
    <div class="oppFlavor">&ldquo;${opp.flavor}&rdquo;</div>
    <div class="buildGrid">${buildGridHTML(build)}</div>
    <div class="oppStats">
      <div>SKILL <span class="stars"><span class="lit">${"&#9733;".repeat(stars)}</span>${"&#9734;".repeat(5 - stars)}</span></div>
      ${opp.boss
        ? `<div class="pinkslip">&#9825; PINK SLIP RACE &#9825;</div>
           <div class="warn">Win: you drive home in the ${CAR_TIERS[opp.carTier].short}.<br>Lose: you hand over YOUR keys.</div>`
        : opp.wager === 0
          ? `<div class="wager">PRIDE RUN &mdash; win $${opp.prize ?? 0}</div>`
          : `<div class="wager">WAGER &nbsp;$${opp.wager}${opp.bonus
              ? `<span class="bonusCash"> + $${opp.bonus} BONUS</span>` : ""}</div>`}
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
const CAM_FOLLOW = 10;     // chase-camera follow gain; steady-state trail = speed / CAM_FOLLOW
const CAM_FLOAT = 10;      // how lazily the boom's height chases the road: the small dip as the nose tips up
const CAM_CLIMB_LIFT = 15; // metres of boom rise per unit uphill grade — the "see over the crest" lift
const CAM_GRADE_LAG = 2;   // lag on the grade that drives the lift: the "beat" before the rise
const CAM_LIFT_UP = 3;     // lift gain climbing (the rise, once the beat has passed)
const CAM_LIFT_DOWN = 1.5; // lift gain settling (slow release: hold the height across the crest)

// Shadows: only the cars cast (nothing in track.js is flagged), so the map only
// ever holds two cars and the ortho box only has to cover them — that's what
// buys sharp shadows off a single 2048 map over a 3 km track. The box follows
// the pair; see aimSun.
const SUN_DIR = new THREE.Vector3(0.4, 1, 0.3).normalize();
const SUN_DIST = 150;
const SHADOW_MAP = 2048;
const SHADOW_STEP = 15; // box half-extents are quantized to this — see aimSun
const SHADOW_MIN = 15, SHADOW_MAX = 90;

// Aim the sun's shadow box at the player, sized to take the AI in with him.
// Two things here are deliberate. The half-extent is *quantized* rather than
// continuous, so the texel size holds still across frames instead of breathing;
// and the focus is then snapped to that texel grid, so the map samples land on
// the same spots frame to frame and the shadow edge doesn't crawl as the car
// moves. (Snapping in world XZ rather than light space is an approximation, but
// SUN_DIR is 88% vertical, so the two nearly coincide.)
function aimSun(sun, p, ai) {
  const gap = Math.hypot(p.x - ai.x, p.z - ai.z);
  // past SHADOW_MAX the AI is beyond the fog start anyway, so let him drop out
  // rather than blow the box out to cover a shadow nobody can see
  const half = THREE.MathUtils.clamp(
    Math.ceil((gap + 8) / SHADOW_STEP) * SHADOW_STEP, SHADOW_MIN, SHADOW_MAX);
  const cam = sun.shadow.camera;
  if (cam.right !== half) {
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
    cam.updateProjectionMatrix();
  }
  const texel = (2 * half) / SHADOW_MAP;
  const fx = Math.round(p.x / texel) * texel, fz = Math.round(p.z / texel) * texel;
  sun.target.position.set(fx, p.y, fz);
  sun.position.set(fx + SUN_DIR.x * SUN_DIST, p.y + SUN_DIR.y * SUN_DIST, fz + SUN_DIR.z * SUN_DIST);
}

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
    // the player's card rides through OPPONENTS, so RACE is what takes it away;
    // GARAGE.enter puts it back (and reads its hidden state to decide whether to
    // animate the card back into a panel)
    hide("garagePanel");
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

function buildRaceScene(opp) {
  if (scene) disposeScene(scene);
  const palette = PALETTES[Math.floor(Math.random() * PALETTES.length)];
  race.palette = palette; // debug handle: the prop/contrast checks assert on this
  scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.sky);
  scene.fog = new THREE.Fog(palette.fog, 150, 1400);
  scene.add(new THREE.AmbientLight(0xffffff, palette.ambient));
  const sun = new THREE.DirectionalLight(palette.sun, 1.6);
  sun.position.copy(SUN_DIR);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  // the box is aimed per-frame (aimSun); near/far only have to bracket the
  // cars either side of the focus plane, which keeps the depth range tight
  sun.shadow.camera.near = SUN_DIST - 100;
  sun.shadow.camera.far = SUN_DIST + 100;
  sun.shadow.normalBias = 0.02; // low-poly boxes, so this is what kills the acne
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target); // target needs to be in the graph or it never updates
  race.sun = sun;
  const hemi = new THREE.HemisphereLight(palette.sky, palette.ground, 0.5);
  scene.add(hemi);

  // boss races match the longest street race at the tier — no longer (Jason,
  // 2026-07-11: a pink-slip race shouldn't drag past the money races)
  const length = opp.boss ? 2700 + player.carTier * 200 : 2300 + player.carTier * 200 + Math.random() * 400;
  const track = new Track(length, (Math.random() * 1e9) | 0);
  track.buildMeshes(scene, palette);

  const pStats = effectiveStats(playerTier(), player.parts);
  const oppParts = aiParts(opp, player);
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
  race.camY = 0; // boom height; the launch zone is pinned flat so 0 is the road
  race.camLift = 0; // extra boom height banked while climbing (see-over-the-crest lift)
  race.camGradeSm = 0; // lagged grade that drives the lift, so the rise trails the dip
  race.lastClunk = -9;
  race.aiRev = 0;
  race.aiRevT = 0.3 + Math.random() * 0.6; // first blip lands shortly after staging

  el("hudMoney").textContent = `CASH $${player.money}`;
  el("hudWager").innerHTML = opp.boss ? "♡ PINK SLIP RACE ♡"
    : opp.wager === 0 ? `PRIDE RUN — $${opp.prize ?? 0}`
    : `WAGER $${opp.wager}` + (opp.bonus ? ` <span class="bonusCash">+ $${opp.bonus}</span>` : "");
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

  const keyThr = (keys.ArrowUp || keys.KeyW || keys.ControlLeft || keys.ControlRight) ? 1 : 0;
  const keyBrk = (keys.ArrowDown || keys.KeyS) ? 1 : 0;
  const thr = Math.max(keyThr, touchThrottle);
  const brk = Math.max(keyBrk, touchBrake);
  // keys are digital; ramp toward the target so taps give partial steer
  const keySteerTarget = ((keys.ArrowLeft || keys.KeyA) ? 1 : 0) - ((keys.ArrowRight || keys.KeyD) ? 1 : 0);
  const steerTarget = touchActive ? touchSteer : keySteerTarget;
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
    // who's in whose wake — read by the drag term inside step()
    resolveDraft(p, ai, dt);
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
  aimSun(race.sun, p, ai);

  // ----- chase camera -----
  // follow the travel direction, not the nose: in a slide the car visibly
  // hangs sideways in frame while the camera keeps tracking the path
  const velHeading = p.heading - p.slip;
  const fx = Math.sin(velHeading), fz = Math.cos(velHeading);
  // framing follows a smoothed speed, extra slow once the race is over, so
  // braking to a stop past the finish line doesn't rubber-band the camera
  race.camSpeed += (p.speed - race.camSpeed) * Math.min(1, dt * (race.over ? 1.0 : 6));
  // Vertical: a camera boom that climbs with the hill (Jason, 2026-07-17). Two
  // terms, and the GIMBAL stays locked on the car through both (aim is `p.y`
  // below) — that lock is the whole safety margin, because a lagged *aim* is
  // what made the car itself slide 20% down the screen last time. Move the
  // camera, never the car in frame.
  //  - camY lags the road height, so the boom dips slightly as the nose first
  //    tips up. Kept deliberately (Jason likes the drama), just gentler than the
  //    pure-drone version — CAM_FLOAT raised 6 -> 10 roughly halves the dip.
  //  - camLift flies the boom UP while the road under the car climbs, to see
  //    over the crest into the curves beyond, but deliberately AFTER a beat so
  //    the dip lands first (Jason, 2026-07-17: "camera drop as starting up, then
  //    a beat of delay, then a gentle rise as climbing and nearing the crest").
  //    The delay is a lag on the grade that drives the lift (`camGradeSm`);
  //    cascaded into the lift's own follow it makes an S-curve — zero initial
  //    slope, so the rise starts a beat late instead of instantly. Slow release
  //    holds the height across the crest, then it settles on the far side.
  //    Height is half the first pass (Jason: the rise was killing the sense of
  //    speed) — `CAM_CLIMB_LIFT` 30 → 15, ~1.5 m at a 10% climb. Grade-gated, so
  //    descents and flats are a plain chase cam (grade 0 -> lift 0).
  race.camY += (p.y - race.camY) * Math.min(1, dt * CAM_FLOAT);
  race.camGradeSm += (p.grade - race.camGradeSm) * Math.min(1, dt * CAM_GRADE_LAG);
  const targetLift = Math.max(0, race.camGradeSm) * CAM_CLIMB_LIFT;
  const liftGain = targetLift > race.camLift ? CAM_LIFT_UP : CAM_LIFT_DOWN;
  race.camLift += (targetLift - race.camLift) * Math.min(1, dt * liftGain);
  const camHeight = race.camY + 2.15 + race.camSpeed * 0.002 + race.camLift;

  const dist = 4.3 + race.camSpeed * 0.0065;
  const camGoal = new THREE.Vector3(p.x - fx * dist, camHeight, p.z - fz * dist);
  // CAM_FOLLOW is the real chase-distance knob: an exponential smoother chasing a
  // target moving at v settles v/gain behind it, so this adds 0.1 s of travel (8 m
  // at 180 mph) on top of `dist` — 30x the dolly term. Lower it and the camera
  // falls back at speed; raise it and the chase goes rigid.
  camera.position.lerp(camGoal, 1 - Math.exp(-dt * CAM_FOLLOW));
  // Directly behind, no side-to-side (Jason, 2026-07-17: "stay directly behind
  // the car"). That same CAM_FOLLOW lag swings the camera wide through a turn —
  // the goal whips laterally and the camera trails it, ~0.35 m of drift. Keep
  // only the component straight behind the travel line and project the lateral
  // part out; the trail (the good, longitudinal half of the lag) survives. y is
  // driven entirely by camHeight, so overwrite it rather than let the lerp add a
  // vertical trail-lag that would delay the climb lift.
  const behind = Math.min(-1, (camera.position.x - p.x) * fx + (camera.position.z - p.z) * fz);
  camera.position.x = p.x + fx * behind;
  camera.position.z = p.z + fz * behind;
  camera.position.y = camHeight;
  camera.lookAt(p.x + fx * 7, p.y + 1.1, p.z + fz * 7);
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
  // the tow is invisible in the world, so the HUD is the only thing that tells
  // you you've found it — it fades up as you slide into the tunnel
  el("draft").style.opacity = p.draft > 0.08 ? String(Math.min(1, p.draft * 2.5)) : "0";
  el("draftFill").style.width = `${Math.round(p.draft * 100)}%`;
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
        const sale = carSaleValue(player);
        const newTier = CAR_TIERS[opp.carTier];
        html += `${opp.name} slaps the pink slip in your hand.<br>` +
          `The <span class="pink">${newTier.name}</span> is yours.<br>` +
          `Your old ${playerTier().short} sells for <span class="money">$${sale}</span>.`;
        player.money += sale;
        player.carTier = opp.carTier;
        player.parts = freshParts();
        player.bossesBeaten++;
        sfx.cashSound();
      } else {
        html += `${opp.name} takes your keys and doesn't look back.<br>` +
          `Your built <span class="pink">${playerTier().name}</span> is gone.<br>` +
          `The junkyard man takes pity — there's a bone-stock ${playerTier().short} out back with your name on it.<br><br>` +
          `${opp.gloat}`;
        player.parts = freshParts();
        sfx.loseSound();
      }
    } else {
      const stake = opp.wager === 0 ? (won ? (opp.prize ?? 0) : 0) : opp.wager;
      const bonus = opp.wager > 0 ? (opp.bonus ?? 0) : 0; // reach-up gold rides a real wager only
      if (won) {
        player.money += stake + bonus;
        html += `You take ${opp.name} for <span class="money">$${stake}</span>.`;
        if (bonus) html += `<br>The crowd pays <span class="bonusCash">$${bonus}</span> more &mdash; nobody bet on you.`;
        // a risky pride win pays in crowd noise, never money — the flat purse
        // is load-bearing (see CLAUDE.md), so the reward here is words only
        if (opp.wager === 0) {
          const gap = (opp.bLvl ?? 0) - buildLevel(player.parts);
          if (gap >= 0.75) html += `<br>Broke, outgunned, and you put him away anyway &mdash; the crowd loses its mind. They'll be telling this one for years.`;
          else if (gap > 0.25) html += `<br>Nothing on the hood but pride, and the crowd saw exactly who you beat. Word gets around.`;
          else html += `<br>You both knew how this would end. Maybe let him have one someday &mdash; pride's all he's got.`;
        }
        sfx.cashSound();
      } else {
        const lost = wagerLoss(player, stake);
        player.money -= lost;
        html += lost > 0
          ? `${opp.name} pockets your <span class="money">$${lost}</span> and grins.`
          : `${opp.name} wins nothing but bragging rights. Somehow that's worse.`;
        if (opp.gloat) html += `<br>${opp.gloat}`;
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
