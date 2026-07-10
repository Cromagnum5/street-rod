// Static game data: car tiers, upgrade parts, opponent flavor.

// Car tiers — the pink-slip ladder. Physics numbers are arcade-tuned, not sim-accurate.
//  power  W      engine power (before part multipliers)
//  mass   kg
//  drag   N·s²/m² lumped aero drag coefficient
//  grip   m/s²   max lateral acceleration (before tire multiplier)
//  susp           base suspension softness — old buggy-sprung cars wallow more
//  cyl            cylinders (drives the sound fundamental)
export const CAR_TIERS = [
  {
    id: 0, name: "1929 Ford Model A", short: "Model A",
    power: 52000, mass: 980, drag: 1.25, grip: 6.2, susp: 1.30, cyl: 4, gears: 3,
    style: "prewar", color: 0x6e5b3e, accent: 0x2a2a2a, value: 200,
  },
  {
    id: 1, name: "1932 Ford Deuce Coupe", short: "Deuce Coupe",
    power: 78000, mass: 1020, drag: 1.05, grip: 6.9, susp: 1.22, cyl: 8, gears: 3,
    style: "prewar", color: 0x8a1f1f, accent: 0x111111, value: 450,
  },
  {
    id: 2, name: "1949 Mercury Eight", short: "Merc Eight",
    power: 105000, mass: 1500, drag: 0.85, grip: 7.4, susp: 1.15, cyl: 8, gears: 3,
    style: "fifties", color: 0x2c3a52, accent: 0x1a1a1a, value: 800,
  },
  {
    id: 3, name: "1957 Chevy Bel Air", short: "Bel Air",
    power: 140000, mass: 1560, drag: 0.75, grip: 7.9, susp: 1.08, cyl: 8, gears: 4,
    style: "fifties", color: 0x39b7b2, accent: 0xf5f2e8, fins: true, value: 1400,
  },
  {
    id: 4, name: "1964 Pontiac GTO", short: "GTO",
    power: 185000, mass: 1580, drag: 0.62, grip: 8.5, susp: 0.95, cyl: 8, gears: 4,
    style: "muscle", color: 0x27408b, accent: 0x0e0e0e, value: 2200,
  },
  {
    id: 5, name: "1969 Dodge Charger", short: "Charger",
    power: 235000, mass: 1620, drag: 0.55, grip: 9.0, susp: 0.90, cyl: 8, gears: 4,
    style: "muscle", color: 0x1c1c1c, accent: 0xd35400, value: 3200,
  },
  {
    id: 6, name: "1970 Hemi 'Cuda", short: "Hemi 'Cuda",
    power: 290000, mass: 1560, drag: 0.50, grip: 9.6, susp: 0.85, cyl: 8, gears: 5,
    style: "muscle", color: 0xb0d312, accent: 0x111111, value: 5000,
  },
];

// Upgrade parts. Each category has levels; level 0 is stock (free).
// mult applies to the stat listed in `affects`. sound* fields shape the synth.
export const PARTS = {
  engine: {
    label: "ENGINE",
    affects: "power",
    levels: [
      { n: "Stock Motor",      mult: 1.00, price: 0 },
      { n: "Hot Cam + Carb",   mult: 1.18, price: 300 },
      { n: "Performance V8",   mult: 1.42, price: 850 },
      { n: "Full Race Motor",  mult: 1.72, price: 2000 },
    ],
  },
  induction: {
    label: "INDUCTION",
    affects: "power",
    levels: [
      { n: "Stock Intake",     mult: 1.00, price: 0,    whine: 0 },
      { n: "Twin Carbs",       mult: 1.10, price: 350,  whine: 0 },
      { n: "Turbocharger",     mult: 1.24, price: 1100, whine: 0.6 },
      { n: "Supercharger",     mult: 1.42, price: 2400, whine: 1.0 },
    ],
  },
  exhaust: {
    label: "EXHAUST",
    affects: "power",
    levels: [
      { n: "Stock Pipes",      mult: 1.00, price: 0,   bright: 0.0 },
      { n: "Glasspacks",       mult: 1.05, price: 180, bright: 0.35 },
      { n: "Headers + Duals",  mult: 1.11, price: 500, bright: 0.7 },
      { n: "Open Headers",     mult: 1.18, price: 1200, bright: 1.0 },
    ],
  },
  tires: {
    label: "TIRES",
    affects: "grip",
    levels: [
      { n: "Worn Bias-Ply",    mult: 1.00, price: 0 },
      { n: "Street Radials",   mult: 1.13, price: 220 },
      { n: "Wide Grippers",    mult: 1.27, price: 600 },
      { n: "Racing Slicks",    mult: 1.45, price: 1400 },
    ],
  },
  suspension: {
    label: "SUSPENSION",
    affects: "handling",
    levels: [
      { n: "Sagging Leaf Springs", price: 0,    softness: 1.00 },
      { n: "Heavy-Duty Shocks",    price: 250,  softness: 0.62 },
      { n: "Sway Bars + Lowered",  price: 700,  softness: 0.36 },
      { n: "Full Race Suspension", price: 1600, softness: 0.16 },
    ],
  },
  gearbox: {
    label: "GEARBOX",
    affects: "shift",
    levels: [
      { n: "Stock 3-Speed",    mult: 1.00, price: 0,    shiftTime: 0.45 },
      { n: "4-Speed Automatic", mult: 1.06, price: 300,  shiftTime: 0.32, minGears: 4 },
      { n: "Close-Ratio Box",  mult: 1.12, price: 800,  shiftTime: 0.22 },
      { n: "Race Box",         mult: 1.18, price: 1800, shiftTime: 0.12 },
    ],
  },
};

export const PART_KEYS = Object.keys(PARTS);

// Regular street racers (non-boss). skill 0..1-ish, scaled by player tier.
export const STREET_RACERS = [
  { name: "Skeeter",            flavor: "Delivers pizzas in it. Swears the pepperoni smell adds horsepower." },
  { name: "Donna 'The Wrench'", flavor: "Rebuilt her motor in a night. Twice. Don't mention the second time." },
  { name: "Big Al",             flavor: "Drives like he's late for a buffet. Sometimes he is." },
  { name: "Curbside Kenny",     flavor: "Has hit every curb on Route 9. The car remembers." },
  { name: "Peggy Sue",          flavor: "Radio louder than her engine. Barely." },
  { name: "Slick Vinnie",       flavor: "Hair grease doubles as bearing grease. Waste not." },
  { name: "Mad Marla",          flavor: "Got banned from the drive-in for doing donuts at the snack bar." },
  { name: "Two-Cent Tom",       flavor: "Bets small, brakes late, apologizes never." },
  { name: "Lugnut Lou",         flavor: "Missing three lug nuts and two front teeth. Still grinning." },
  { name: "Hairpin Hazel",      flavor: "Takes corners like they owe her money." },
];

// Boss ladder — index i is the boss you beat to win the tier i+1 car.
export const BOSSES = [
  { name: "GREASY PETE",     flavor: "King of the burger lot. His Deuce has never lost to a Model A. Yet." },
  { name: "THE UNDERTAKER",  flavor: "Drives a chopped Merc black as midnight. Measures you with his eyes." },
  { name: "MISS FIRECRACKER",flavor: "Two-tone Bel Air, zero patience. Beat her and the fins are yours." },
  { name: "COLTRANE",        flavor: "Quiet man, loud GTO. Only races for keeps." },
  { name: "NIGHTSHADE",      flavor: "Nobody's seen the driver. The Charger just shows up when you're ready." },
  { name: "THE KING",        flavor: "Top of the ladder. His Hemi 'Cuda IS the crown. One race. Everything." },
];

export const STARTING_MONEY = 350;
export const SAVE_KEY = "streetrod86-save-v1";
