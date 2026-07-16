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
// Prices are Model A money in even $100s (economy.js scales by tier and keeps
// the rounding); the full build is $5,900 — about a dozen races' winnings.
export const PARTS = {
  engine: {
    label: "ENGINE",
    affects: "power",
    levels: [
      { n: "Stock Motor",      mult: 1.00, price: 0 },
      { n: "Hot Cam + Carb",   mult: 1.18, price: 100 },
      { n: "Performance V8",   mult: 1.42, price: 300 },
      { n: "Full Race Motor",  mult: 1.72, price: 700 },
    ],
  },
  induction: {
    label: "INDUCTION",
    affects: "power",
    levels: [
      { n: "Stock Intake",     mult: 1.00, price: 0,   whine: 0 },
      { n: "Twin Carbs",       mult: 1.10, price: 100, whine: 0 },
      { n: "Turbocharger",     mult: 1.24, price: 400, whine: 0.6 },
      { n: "Supercharger",     mult: 1.42, price: 800, whine: 1.0 },
    ],
  },
  exhaust: {
    label: "EXHAUST",
    affects: "power",
    levels: [
      { n: "Stock Pipes",      mult: 1.00, price: 0,   bright: 0.0 },
      { n: "Glasspacks",       mult: 1.05, price: 100, bright: 0.35 },
      { n: "Headers + Duals",  mult: 1.11, price: 200, bright: 0.7 },
      { n: "Open Headers",     mult: 1.18, price: 400, bright: 1.0 },
    ],
  },
  tires: {
    label: "TIRES",
    affects: "grip",
    levels: [
      { n: "Worn Bias-Ply",    mult: 1.00, price: 0 },
      { n: "Street Radials",   mult: 1.13, price: 100 },
      { n: "Wide Grippers",    mult: 1.27, price: 200 },
      { n: "Racing Slicks",    mult: 1.45, price: 500 },
    ],
  },
  suspension: {
    label: "SUSPENSION",
    affects: "handling",
    levels: [
      { n: "Sagging Leaf Springs", price: 0,   softness: 1.00 },
      { n: "Heavy-Duty Shocks",    price: 100, softness: 0.62 },
      { n: "Sway Bars + Lowered",  price: 200, softness: 0.36 },
      { n: "Full Race Suspension", price: 600, softness: 0.16 },
    ],
  },
  gearbox: {
    label: "GEARBOX",
    affects: "shift",
    levels: [
      { n: "Stock 3-Speed",    mult: 1.00, price: 0,   shiftTime: 0.45 },
      { n: "4-Speed Automatic", mult: 1.06, price: 100, shiftTime: 0.32, minGears: 4 },
      { n: "Close-Ratio Box",  mult: 1.12, price: 300, shiftTime: 0.22 },
      { n: "Race Box",         mult: 1.18, price: 700, shiftTime: 0.12 },
    ],
  },
};

export const PART_KEYS = Object.keys(PARTS);

// Regular street racers (non-boss). The board deals a dozen of these a visit,
// so the pool stays deep — nobody wants to race the same six faces all career.
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
  { name: "Muffler Mike",       flavor: "Lost the muffler in '61 and calls it a tune. You'll hear him Tuesday." },
  { name: "Sunday-Driver Ruth", flavor: "Church at nine, quarter mile at ten. The Lord forgives; her gearbox doesn't." },
  { name: "Tommy Two-Jobs",     flavor: "Pumps gas by day, stocks shelves by night. Races in the gap." },
  { name: "The Professor",      flavor: "Says racing is just applied physics. Loses like it's chemistry." },
  { name: "Birdie LaRue",       flavor: "Sings to the engine at red lights. Claims it sings back." },
  { name: "Half-Pint Hank",     flavor: "Sits on two phone books. Still looks down on your car." },
  { name: "Rosie Rivets",       flavor: "Built her car out of four other cars. None of them agreed to it." },
  { name: "Cousin Merle",       flavor: "Everybody's cousin. Nobody's friend after the flag drops." },
  { name: "Dice-Shaker Dave",   flavor: "Fuzzy dice, loaded. The car's the only honest thing about him." },
  { name: "Grandma Ida",        flavor: "Raised six kids and a small-block. The kids turned out fine. The small-block turned out mean." },
  { name: "Whistlin' Pete",     flavor: "Whistles through the corners. The pitch tells you how scared to be." },
  { name: "Doc Molar",          flavor: "Retired dentist. Pulls gears like teeth — fast, clean, no anesthetic." },
  { name: "Stacks Malone",      flavor: "Says he's got money riding on himself. Nobody's ever seen the money." },
  { name: "Jukebox Jimmy",      flavor: "One arm out the window, one song in his head, zero mirrors checked." },
  { name: "Landslide Lenny",    flavor: "Won his car in a landslide. The election was for dogcatcher." },
  { name: "Carhop Carla",       flavor: "Serves burgers at 30 mph. Serves losses considerably faster." },
  { name: "Preacher Boyd",      flavor: "Quotes scripture at the line. Mostly the parts about vengeance." },
  { name: "Lucky Lucille",      flavor: "Found a four-leaf clover in '52. Been losing fair and square ever since." },
  { name: "Nervous Norman",     flavor: "Checks his mirrors nine times at the line. Never once mid-race." },
  { name: "Big Wanda",          flavor: "Arm-wrestles for pink slips when the racing's slow. Take the race." },
  { name: "Switchblade Sal",    flavor: "Combs his hair at the green light. Wins anyway. It's infuriating." },
  { name: "Motor-Mouth Mabel",  flavor: "Never stops talking. Her exhaust note agrees with everything she says." },
  { name: "Radar Ray",          flavor: "Ex-traffic cop. Knows exactly how fast you're going. Envies it." },
  { name: "Tin-Can Tony",       flavor: "Body panels from soup cans, bumper from a church pew. Runs eleven flat." },
  { name: "Midnight Millie",    flavor: "Only races after dark. Says the stars keep score fairer than people." },
  { name: "Yardstick Yates",    flavor: "Measures every win to the inch and rounds in his favor." },
];

// Street-racer paint colors, dealt out so no two cars in a roster match —
// which means at least a dozen of them, one per card.
// Period lot colors only — pink is reserved for bosses.
export const RACER_COLORS = [
  0xc23b22, // regal red
  0xe8b23a, // butterscotch gold
  0x3f6fae, // nassau blue
  0x4e8f4e, // highland green
  0xe8e4d8, // wimbledon white
  0x7d3fa8, // plum crazy purple
  0xf07f2e, // hugger orange
  0x9aa2ab, // sterling silver
  0x9fc0a8, // surf green
  0x6e222e, // royal burgundy
  0xa8663c, // copper poly
  0x20304e, // midnight blue
  0xd9c66a, // daytona yellow
  0x54606c, // gunmetal gray
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

// Enough to bolt on a few parts and still cover gas money — the first
// board is stock-slow either way, so the build starts in the garage, race one.
export const STARTING_MONEY = 1000;
export const SAVE_KEY = "streetrod86-save-v1";
