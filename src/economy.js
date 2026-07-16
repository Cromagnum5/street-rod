// The economy: what a part costs, what a car is worth, who shows up to race you
// and for how much. Pure functions over a `player` object ({ money, carTier,
// parts }) — no THREE, no DOM — so a Node script can simulate a whole career
// against the real physics. That testability is the point of the split; the
// balance numbers in CLAUDE.md come from it.
//
// Everything here deals in even $100 increments (Jason, 2026-07-15: precise
// values are hard to absorb quickly). Money only ever moves by wagers, prizes,
// part prices, sale values and starting cash — all $100 multiples — so the
// player's roll stays an even hundred forever, by construction.

import { CAR_TIERS, PARTS, PART_KEYS, STREET_RACERS, RACER_COLORS, BOSSES } from "./data.js";

export const round100 = (v) => Math.round(v / 100) * 100;

// ---------------------------------------------------------------- part prices
//
// Prices in data.js are Model A money. Iron gets dearer as you climb the ladder,
// which is what keeps every class the same shape: a class is always "about a
// dozen races' worth of build", never "one race, I'm already rich from last
// class". Set the step to 0 and prices go flat again.
export const PRICE_TIER_STEP = 0.35;
export const priceScale = (carTier) => 1 + PRICE_TIER_STEP * carTier;

export function partPrice(key, level, carTier) {
  const base = PARTS[key].levels[level]?.price ?? 0;
  if (base === 0) return 0;
  return Math.max(100, round100(base * priceScale(carTier)));
}

/** What the player has sunk into the car they're standing in. */
export function partsSpent(player) {
  let spent = 0;
  for (const k of PART_KEYS) {
    for (let l = 1; l <= (player.parts[k] ?? 0); l++) spent += partPrice(k, l, player.carTier);
  }
  return spent;
}

/** Trade-in on a boss win: the old tin at catalog price. The build went into
 *  beating the boss; the cash that starts the next class is this plus whatever
 *  is left in your pocket — sim-tuned to "3-5 parts of the new class". */
export function carSaleValue(player) {
  return Math.max(100, round100(CAR_TIERS[player.carTier].value));
}

export const freshParts = () => Object.fromEntries(PART_KEYS.map((k) => [k, 0]));

/** The player's build level, 0..3: mean part level across the six categories.
 *  The whole board is scaled off this number. */
export const buildLevel = (parts) => PART_KEYS.reduce((s, k) => s + (parts[k] ?? 0), 0) / PART_KEYS.length;

// ---------------------------------------------------------------- the board
//
// Jason's call, 2026-07-15, replacing the four-slot percentage board: a dozen
// cards, scaled to the player's BUILD rather than his bankroll. The easiest
// card is a driver a notch below your build (drivers below that stop showing
// up as you level the car), the hardest is up to a level and a half above —
// so better iron creeps in as you bolt yours on, and by the time you're
// nearly maxed the top of the board is maxed 5-star drivers.
//
// A wager is what the OPPONENT will put on the hood — it scales with how
// built he is (a tougher man pays more) — and it is an even-money bet capped
// at the cash you carry: you can never bet, or win, more than you have on
// you, so a thin roll is never a free roll and every number on a card is a
// bet you can cover. Race up the board for big money, drop down it to
// rebuild after a loss. That rhythm is the progression engine; measured
// pacing is ~10-13 races per class (16-career sim, real physics).
export const N_CARDS = 12;
export const CARD_REL_LO = -0.75; // easiest card: this far below your build level
export const CARD_REL_HI = 1.5;   // hardest card: this far above (clamped to [0,3])
export const WAGER_BASE = 400;    // wager = (base + perLvl * his build) * priceScale
export const WAGER_PER_LEVEL = 700;
export const MIN_WAGER = 100;

/** What a racer of build level bLvl puts on the hood, in this class's money. */
export const slotWager = (bLvl, carTier) =>
  Math.max(MIN_WAGER, round100((WAGER_BASE + WAGER_PER_LEVEL * bLvl) * priceScale(carTier)));

// Too broke to bet real money: below this line the whole board turns into
// pride runs — $0 down for a fixed purse — so broke is a detour, never a dead
// end. It can't be farmed: one win puts you back over the line, and a real
// wager pays better than the purse does.
export const brokeLine = (carTier) => round100(400 * priceScale(carTier));
// Every pride run pays the same flat gas-money purse: the broke line itself,
// so ONE win puts you back over it and into real wagers. Flat is the point
// (Jason, 2026-07-16): the first cut paid a fraction of each slot's wager, and
// the optimal strategy became "spend to zero, farm the hardest pride run you
// can win" — risk-free money that scaled with your build. With a flat purse
// there is no pride ladder to climb: a below-your-level REAL wager out-pays it
// from about L1 onward, so pride runs are a recovery mechanism, not a career.
export const pridePurse = (carTier) => brokeLine(carTier);

/** Belt and braces: a wager is coverable by construction, but never bill past the roll. */
export const wagerLoss = (player, wager) => Math.min(wager, player.money);

export function makeRoster(player, rand = Math.random) {
  const tier = player.carTier;
  // Crown: the King is beaten and the 'Cuda is yours, so the ladder is over.
  // Nobody brings a stock car to race the champ — builds floor at level 1,
  // skill at 3 stars, and the top card is the peer race: a maxed 'Cuda driven
  // flat out, for the biggest money on the board.
  const crown = tier === 6;
  const pLvl = buildLevel(player.parts);
  const names = [...STREET_RACERS].sort(() => rand() - 0.5);
  const colors = [...RACER_COLORS].sort(() => rand() - 0.5);
  const broke = player.money < brokeLine(tier);
  const roster = [];

  for (let i = 0; i < N_CARDS; i++) {
    const u = i / (N_CARDS - 1);
    // his build: a window that slides up with yours (a little jitter so the
    // board doesn't read as a ruler — never enough to reorder it)
    let bLvl = pLvl + CARD_REL_LO + (CARD_REL_HI - CARD_REL_LO) * u + (rand() - 0.5) * 0.2;
    bLvl = Math.max(crown ? 1 : 0, Math.min(3, bLvl));
    // skill rides the build: stock cars come with 1-2 star drivers, maxed cars
    // with 5-star ones — parts are the real difficulty lever, stars label it
    const skill = Math.max(crown ? 0.55 : 0.2, Math.min(1, 0.25 + 0.25 * bLvl + (rand() - 0.5) * 0.06));
    // Lesser/better iron for variety. aiParts compensates a tier deficit with
    // extra part levels (one tier ≈ one part level), so pace tracks the card,
    // not the tin — but it can't strip below stock, so the better-car draw is
    // reserved for drivers good enough to justify it.
    let bump = [0, 0, -1, 1][Math.floor(rand() * 4)];
    if (bump === 1 && skill < 0.55) bump = 0;
    const carTier = Math.max(0, Math.min(6, tier + bump));
    const w = slotWager(bLvl, tier);

    roster.push({
      name: names[i % names.length].name, flavor: names[i % names.length].flavor,
      carTier, skill, bLvl, crown, boss: false,
      wager: broke ? 0 : Math.min(player.money, w),
      prize: broke ? pridePurse(tier) : 0,
      carColor: colors[i % colors.length],
      // how hard he leans back when you lean on him (ai.js). Rolled independent
      // of skill on purpose: a 2-star can be a bruiser and a 5-star can be
      // clean, so racecraft is a personality you learn per name.
      aggro: 0.25 + rand() * 0.75,
    });
  }

  if (broke) {
    roster[0] = {
      name: "Free-Ride Freddy", flavor: "Races for the love of it. Slips you gas money if you win.",
      // freebie: exempt from the tier-deficit parts baseline in aiParts —
      // the mercy run stays a stock lesser car so broke never means stuck
      freebie: true, bLvl: 0,
      carTier: Math.max(0, tier - 1), skill: 0.25, wager: 0,
      prize: pridePurse(tier),
      boss: false, crown,
      aggro: 0.2, // races for the love of it — he'll give you the room
      carColor: 0x8a8a82, // primer gray — he races for love, not paint
    };
  }

  // The peer race: the biggest bet on the board is the hardest man on it, at
  // every tier — in the crown era that's a maxed 'Cuda with a 5-star in it.
  if (crown) {
    const peer = roster[N_CARDS - 1];
    peer.carTier = 6;
    peer.bLvl = 3;
    peer.skill = 1.0;
    peer.parts = Object.fromEntries(PART_KEYS.map((k) => [k, 3])); // aiParts honors a pre-set build
  }

  roster.sort((a, b) => a.wager - b.wager || a.bLvl - b.bLvl);
  if (tier < 6) {
    const b = BOSSES[tier];
    roster.push({
      name: b.name, flavor: b.flavor,
      // The boss is the gate, and he is built like one (Jason, 2026-07-15:
      // "HARD TO BEAT... beat me with him"): next-tier car, every part maxed,
      // 5-star driver. First knob to soften him: pull parts back toward L2.
      carTier: tier + 1, skill: 1.0, bLvl: 3, wager: 0, boss: true,
      parts: Object.fromEntries(PART_KEYS.map((k) => [k, 3])),
      aggro: 1, // your car is on the hood: he will not give you an inch
      carColor: 0xff4fa3, // bosses are pink, always
    });
  }
  return roster;
}

export function aiParts(opp, player, rand = Math.random) {
  // The card's build level IS the promise: since straights went flat-out for
  // every skill, driver skill is worth <1 s/race — parts are the difficulty.
  // A fractional level becomes a mixed build (1.5 ≈ half the parts at L2), a
  // 20% per-part shortfall leaves some cars a carb short of their label, and
  // one tier of lesser iron buys one extra level (one tier ≈ one part level),
  // floored so lesser-iron draws never show up below player-tier stock pace.
  // Memoized: the card shows this build, so it has to be the one that races.
  if (opp.parts) return opp.parts;
  const deficit = opp.freebie ? 0 : player.carTier - opp.carTier;
  const lvl = (opp.bLvl ?? 0) + Math.max(0, deficit);
  const floor = Math.max(opp.crown ? 1 : 0, deficit);
  const base = Math.floor(lvl), part = lvl - base;
  const p = {};
  for (const k of PART_KEYS) {
    let v = base + (rand() < part ? 1 : 0);
    if (rand() < 0.2) v -= 1; // a part short — Donna never did finish that motor
    p[k] = Math.max(floor, Math.min(3, v));
  }
  opp.parts = p;
  return p;
}
