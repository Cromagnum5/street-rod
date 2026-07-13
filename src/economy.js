// The economy: what a part costs, what a car is worth, who shows up to race you
// and for how much. Pure functions over a `player` object ({ money, carTier,
// parts }) — no THREE, no DOM — so a Node script can simulate a whole career
// against the real physics. That testability is the point of the split; the
// balance numbers in CLAUDE.md come from it.

import { CAR_TIERS, PARTS, PART_KEYS, STREET_RACERS, RACER_COLORS, BOSSES } from "./data.js";

// ---------------------------------------------------------------- part prices
//
// Prices in data.js are Model A money. Iron gets dearer as you climb the ladder,
// which is what keeps every class the same shape: a class is always "about six
// races' worth of build", never "one race, I'm already rich from last class".
// Set the step to 0 and prices go flat again.
export const PRICE_TIER_STEP = 0.35;
export const priceScale = (carTier) => 1 + PRICE_TIER_STEP * carTier;

export function partPrice(key, level, carTier) {
  const base = PARTS[key].levels[level]?.price ?? 0;
  return Math.round((base * priceScale(carTier)) / 10) * 10;
}

/** What the player has sunk into the car they're standing in. */
export function partsSpent(player) {
  let spent = 0;
  for (const k of PART_KEYS) {
    for (let l = 1; l <= (player.parts[k] ?? 0); l++) spent += partPrice(k, l, player.carTier);
  }
  return spent;
}

/** Trade-in on a boss win: the tin plus 40% of what you bolted to it. */
export function carSaleValue(player) {
  return Math.round(CAR_TIERS[player.carTier].value + partsSpent(player) * 0.4);
}

export const freshParts = () => Object.fromEntries(PART_KEYS.map((k) => [k, 0]));

// ---------------------------------------------------------------- the board
//
// Jason's call, 2026-07-12: "each race is essentially a double or nothing to
// your cash pile." The wager is a FRACTION of what you're carrying, and the
// opponent's skill and build are derived from that fraction — so the board is a
// risk dial, not a lottery, and it reads straight off the card:
//
//   35% of your pile → 2★ in a stock car     (you can take this stock)
//   60%              → 3★ with bolt-ons      (…once you've bought L1)
//   85%              → 4★ in a built car     (…once you've bought L2)
//  100% — the pile   → 5★ in a maxed car     (…once you're maxed)
//
// The skills land on those stars exactly, and aiParts turns them into stock/L1/
// L2/L3 builds, which the card portrait then shows honestly (blower, slicks).
// So "how much do I bet" IS "how built is my car", and the answer is legible
// before you commit. Growth compounds with your build: stock money is 1.35x a
// race, a maxed car doubles. That's the whole progression engine.
export const WAGER_SLOTS = [
  { frac: 0.35, skill: 0.48 }, // 2★
  { frac: 0.60, skill: 0.68 }, // 3★
  { frac: 0.85, skill: 0.88 }, // 4★
  { frac: 1.00, skill: 1.00 }, // 5★ — the whole pile
];
export const MIN_WAGER = 25;

// A wager is ALWAYS money you are carrying. Never dangle a bet the player can't
// cover: it reads as broken and it's a free roll (risk your last $200 to win
// $1,200). The first cut of this got it wrong — it floored the wager at a
// class-scaled purse so a spent-down player still had real money on the hood,
// and Jason immediately hit the consequence: "I spent nearly all my money on
// upgrades yet there are races I can enter with wagers way higher than my
// current purse."
//
// The problem the floor was solving is real, though, and it's the sharp edge of
// a percentage economy: a percentage of nothing is nothing, so one bad night
// leaves you grinding $25 races forever (measured, 29 races to clear class 0).
// The honest place for that mercy is the PRIDE RUN — a $0 wager for a fixed
// purse, which the game already has, already explains on the card, and which
// nobody can mistake for a bet. So Freddy now turns up whenever your roll is too
// thin to race on (not just under $25), and he pays in this class's money. Broke
// is a detour, never a dead end, and every number on the board stays true.
export const BASE_PURSE = 1200;
/** Too broke to bet: below this, the pride run is your way back in. */
export const brokeLine = (carTier) => 0.35 * BASE_PURSE * priceScale(carTier);
export const pridePrize = (carTier) => brokeLine(carTier);

/** Belt and braces: a wager is coverable by construction, but never bill past the roll. */
export const wagerLoss = (player, wager) => Math.min(wager, player.money);

const roundTo = (v, q) => Math.max(q, Math.round(v / q) * q);

export function makeRoster(player, rand = Math.random) {
  const tier = player.carTier;
  // Crown: the King is beaten and the 'Cuda is yours, so the ladder is over.
  // Nobody brings a stock car to race the champ — the street sends its best and
  // the whole-pile slot IS the peer race (5★, his own 'Cuda, every part maxed).
  const crown = tier === 6;
  const names = [...STREET_RACERS].sort(() => rand() - 0.5);
  const colors = [...RACER_COLORS].sort(() => rand() - 0.5);
  const roster = [];

  for (let i = 0; i < WAGER_SLOTS.length; i++) {
    const slot = WAGER_SLOTS[i];
    // A little play in the number so the board doesn't read as a percentage
    // menu — never enough to reorder the slots.
    const frac = slot.frac * (1 + (rand() - 0.5) * 0.08);
    // The crown floor: nothing under 3★ turns up to race the champion.
    const skill = crown ? Math.max(0.55, slot.skill) : slot.skill;
    // Lesser/better iron for variety. aiParts compensates a tier deficit with
    // extra part levels (one tier ≈ one part level), so pace tracks the star,
    // not the tin — but it can't strip below stock, so the better-car draw is
    // reserved for drivers good enough to justify it.
    let bump = [0, 0, -1, 1][Math.floor(rand() * 4)];
    if (bump === 1 && skill < 0.55) bump = 0;
    const carTier = Math.max(0, Math.min(6, tier + bump));

    roster.push({
      name: names[i].name, flavor: names[i].flavor,
      carTier, skill, crown, boss: false,
      // strictly money in your pocket: the top slot is your whole roll, no more
      wager: Math.min(player.money, roundTo(frac * player.money, 25)),
      carColor: colors[i],
      partBoost: rand() < skill ? 1 : 0,
      // how hard he leans back when you lean on him (ai.js). Rolled independent
      // of skill on purpose: a 2★ can be a bruiser and a 5★ can be clean, so
      // racecraft is a personality you learn per name, not a second star bar.
      aggro: 0.25 + rand() * 0.75,
    });
  }

  // The whole-pile slot in the crown era is the race the endgame is actually
  // for: a maxed 'Cuda with nothing to prove against anything less.
  if (crown) {
    const peer = roster[WAGER_SLOTS.length - 1];
    peer.carTier = 6;
    peer.parts = Object.fromEntries(PART_KEYS.map((k) => [k, 3])); // aiParts honors a pre-set build
    peer.partBoost = 0; // nothing left to boost
  }

  // Too thin to bet? Then a percentage of your roll is a fraction of nothing, and
  // a board of $0 wagers paying $0 is a dead end you can race in forever. So when
  // you're under the broke line the WHOLE board turns into pride runs: nothing
  // down, a real purse, and a tougher man still pays more — the risk dial becomes
  // a pure difficulty dial, which is the honest shape when you have nothing to
  // risk. It's the same money the wager floor was trying to hand you, minus the
  // lie: the card says PRIDE RUN, and no number on it is a bet you can't cover.
  // You can't farm it, either — one win puts you back over the line, and by then
  // a real wager pays better than the purse does.
  if (player.money < brokeLine(tier)) {
    for (let i = 0; i < roster.length; i++) {
      roster[i].wager = 0;
      roster[i].prize = roundTo(WAGER_SLOTS[i].frac * BASE_PURSE * priceScale(tier), 25);
    }
    roster[0] = {
      name: "Free-Ride Freddy", flavor: "Races for the love of it. Slips you gas money if you win.",
      // freebie: exempt from the tier-deficit parts baseline in aiParts —
      // the mercy run stays a stock lesser car so broke never means stuck
      freebie: true,
      carTier: Math.max(0, tier - 1), skill: 0.25, wager: 0,
      prize: roundTo(pridePrize(tier), 25), // gas money, in this class's money
      boss: false, partBoost: 0,
      aggro: 0.2, // races for the love of it — he'll give you the room
      carColor: 0x8a8a82, // primer gray — he races for love, not paint
    };
  }

  roster.sort((a, b) => a.wager - b.wager);
  if (tier < 6) {
    const b = BOSSES[tier];
    roster.push({
      name: b.name, flavor: b.flavor,
      carTier: tier + 1, skill: 0.8 + tier * 0.03, wager: 0, boss: true, partBoost: 1,
      aggro: 1, // your car is on the hood: he will not give you an inch
      carColor: 0xff4fa3, // bosses are pink, always
    });
  }
  return roster;
}

export function aiParts(opp, player, rand = Math.random) {
  // Stars are the promise: since straights went flat-out for every skill, driver
  // skill is worth <1 s/race — parts are the real difficulty lever. Street builds
  // run stars−2 part levels, which is what puts the wager ladder's four slots on
  // stock / L1 / L2 / L3 cars, and one tier of lesser iron buys one extra level:
  // in this data one tier ≈ one part level almost exactly, so a hot-rodded Model
  // A honestly matches its star label against Deuce-class company. The tier bump
  // is a baseline, not a bonus: the stars term floors at 0 and the per-part
  // jitter floors at the deficit, so even a 1★ in lesser iron shows up upgraded
  // to player-tier stock pace — never a free win just because of the draw.
  // Bosses keep their own formula: always a properly built machine.
  // Memoized: the card shows this build, so it has to be the one that races.
  if (opp.parts) return opp.parts;
  const deficit = opp.freebie ? 0 : player.carTier - opp.carTier;
  const lvl = opp.boss
    ? Math.min(3, 1 + Math.round(opp.skill))
    : opp.crown
      ? Math.min(3, 1 + Math.round(opp.skill * 2) + deficit)
      : Math.max(0, Math.round(opp.skill * 5) - 2) + deficit;
  const floor = opp.boss ? 0 : Math.max(opp.crown ? 1 : 0, deficit);
  // The jitter is what leaves a car a part short of its class. Out on the street
  // that's flavor, but in the crown era it fades with skill: a 5★ challenger
  // arrives with the car actually finished, not one carb short of it.
  const jitter = opp.crown ? 0.4 * (1 - opp.skill) : 0.4;
  const p = {};
  for (const k of PART_KEYS) p[k] = Math.max(floor, Math.min(3, lvl + (rand() < jitter ? -1 : 0)));
  if (!opp.boss && opp.partBoost) {
    // their one pride part — Donna really did rebuild that motor
    const k = PART_KEYS[Math.floor(rand() * PART_KEYS.length)];
    p[k] = Math.min(3, p[k] + 1);
  }
  opp.parts = p;
  return p;
}
