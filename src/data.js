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
// `flavor` is the card quote; `gloat` is their line on the losing results card
// when they beat you (Jason, 2026-07-16). Keep both in character.
export const STREET_RACERS = [
  { name: "Skeeter",            flavor: "Delivers pizzas in it. Swears the pepperoni smell adds horsepower.",
    gloat: "&ldquo;That's another delivery, hot and fresh. Thirty minutes or less &mdash; you were the 'or less.'&rdquo;" },
  { name: "Donna 'The Wrench'", flavor: "Rebuilt her motor in a night. Twice. Don't mention the second time.",
    gloat: "&ldquo;Motor's run sweet ever since the second rebuild. Want the name of my mechanic? It's me.&rdquo;" },
  { name: "Big Al",             flavor: "Drives like he's late for a buffet. Sometimes he is.",
    gloat: "&ldquo;Love to stay and rub it in, but the buffet closes at nine and I'm late for that too.&rdquo;" },
  { name: "Curbside Kenny",     flavor: "Has hit every curb on Route 9. The car remembers.",
    gloat: "&ldquo;Clipped two curbs and a mailbox back there and still had you by a street. Route 9 teaches you things.&rdquo;" },
  { name: "Peggy Sue",          flavor: "Radio louder than her engine. Barely.",
    gloat: "&ldquo;What? Sorry, hon, didn't catch the race &mdash; good song on.&rdquo;" },
  { name: "Slick Vinnie",       flavor: "Hair grease doubles as bearing grease. Waste not.",
    gloat: "&ldquo;One word, baby: grease. Okay, two words: more grease.&rdquo;" },
  { name: "Mad Marla",          flavor: "Got banned from the drive-in for doing donuts at the snack bar.",
    gloat: "&ldquo;I'd celebrate with donuts, but there's a court order. Consider yourself the donut.&rdquo;" },
  { name: "Two-Cent Tom",       flavor: "Bets small, brakes late, apologizes never.",
    gloat: "&ldquo;Small bet, big finish. And no, that wasn't an apology you just heard.&rdquo;" },
  { name: "Lugnut Lou",         flavor: "Missing three lug nuts and two front teeth. Still grinning.",
    gloat: "&ldquo;Still grinning! Down three lug nuts, up one race.&rdquo;" },
  { name: "Hairpin Hazel",      flavor: "Takes corners like they owe her money.",
    gloat: "&ldquo;The corners paid what they owed. So did you.&rdquo;" },
  { name: "Muffler Mike",       flavor: "Lost the muffler in '61 and calls it a tune. You'll hear him Tuesday.",
    gloat: "&ldquo;You'll hear me celebrating clear from your place. Tuesday, probably.&rdquo;" },
  { name: "Sunday-Driver Ruth", flavor: "Church at nine, quarter mile at ten. The Lord forgives; her gearbox doesn't.",
    gloat: "&ldquo;The Lord forgives, hon. Me and the gearbox are still thinking about it.&rdquo;" },
  { name: "Tommy Two-Jobs",     flavor: "Pumps gas by day, stocks shelves by night. Races in the gap.",
    gloat: "&ldquo;Squeezed that one in between shifts. Beating you's the only job I'd do for free.&rdquo;" },
  { name: "The Professor",      flavor: "Says racing is just applied physics. Loses like it's chemistry.",
    gloat: "&ldquo;Applied physics, friend. You were the control group.&rdquo;" },
  { name: "Birdie LaRue",       flavor: "Sings to the engine at red lights. Claims it sings back.",
    gloat: "&ldquo;She sang the whole last quarter mile. Did yours make any noise worth hearing?&rdquo;" },
  { name: "Half-Pint Hank",     flavor: "Sits on two phone books. Still looks down on your car.",
    gloat: "&ldquo;Phone books, two. Excuses, zero. You can look up to me while you pay up.&rdquo;" },
  { name: "Rosie Rivets",       flavor: "Built her car out of four other cars. None of them agreed to it.",
    gloat: "&ldquo;All four donor cars are real proud right now. First thing they've ever agreed on.&rdquo;" },
  { name: "Cousin Merle",       flavor: "Everybody's cousin. Nobody's friend after the flag drops.",
    gloat: "&ldquo;Nothing personal, cousin. Say hi to the family &mdash; whichever one we're from.&rdquo;" },
  { name: "Dice-Shaker Dave",   flavor: "Fuzzy dice, loaded. The car's the only honest thing about him.",
    gloat: "&ldquo;Dice said I'd win. Dice always say I'll win. Funny old dice.&rdquo;" },
  { name: "Grandma Ida",        flavor: "Raised six kids and a small-block. The kids turned out fine. The small-block turned out mean.",
    gloat: "&ldquo;I've seen scarier driving from the grandkids, and they're not allowed past the mailbox.&rdquo;" },
  { name: "Whistlin' Pete",     flavor: "Whistles through the corners. The pitch tells you how scared to be.",
    gloat: "&ldquo;Never whistled once out there. You never had me worried enough to pucker.&rdquo;" },
  { name: "Doc Molar",          flavor: "Retired dentist. Pulls gears like teeth — fast, clean, no anesthetic.",
    gloat: "&ldquo;There now, that didn't hurt a bit. The bill might sting some.&rdquo;" },
  { name: "Stacks Malone",      flavor: "Says he's got money riding on himself. Nobody's ever seen the money.",
    gloat: "&ldquo;Told you the money was real. It just wasn't mine till now.&rdquo;" },
  { name: "Jukebox Jimmy",      flavor: "One arm out the window, one song in his head, zero mirrors checked.",
    gloat: "&ldquo;Were you back there? Honest, I had a song going and the mirrors are decorative.&rdquo;" },
  { name: "Landslide Lenny",    flavor: "Won his car in a landslide. The election was for dogcatcher.",
    gloat: "&ldquo;A landslide! Again! First the dogcatcher thing, now this. Momentum, baby!&rdquo;" },
  { name: "Carhop Carla",       flavor: "Serves burgers at 30 mph. Serves losses considerably faster.",
    gloat: "&ldquo;Order up, hon! One humble pie, served fast, no substitutions.&rdquo;" },
  { name: "Preacher Boyd",      flavor: "Quotes scripture at the line. Mostly the parts about vengeance.",
    gloat: "&ldquo;'Vengeance is mine,' saith the Lord. He and I have an arrangement.&rdquo;" },
  { name: "Lucky Lucille",      flavor: "Found a four-leaf clover in '52. Been losing fair and square ever since.",
    gloat: "&ldquo;The clover finally kicked in! Twenty-four years! You've made an old superstition very happy.&rdquo;" },
  { name: "Nervous Norman",     flavor: "Checks his mirrors nine times at the line. Never once mid-race.",
    gloat: "&ldquo;Didn't check the mirrors once! ...Were you back there the whole time?&rdquo;" },
  { name: "Big Wanda",          flavor: "Arm-wrestles for pink slips when the racing's slow. Take the race.",
    gloat: "&ldquo;Count your blessings we settled it driving. Arm-wrestling's double or nothing on the elbow.&rdquo;" },
  { name: "Switchblade Sal",    flavor: "Combs his hair at the green light. Wins anyway. It's infuriating.",
    gloat: "&ldquo;Never even dropped the comb. I know. It's infuriating.&rdquo;" },
  { name: "Motor-Mouth Mabel",  flavor: "Never stops talking. Her exhaust note agrees with everything she says.",
    gloat: "&ldquo;&mdash;and coming out of turn three I says to myself, Mabel, he's STILL back there, and you were, and &mdash; oh, don't make that face, it's a good story.&rdquo;" },
  { name: "Radar Ray",          flavor: "Ex-traffic cop. Knows exactly how fast you're going. Envies it.",
    gloat: "&ldquo;Clocked you every mile of it. Never once worth pulling over.&rdquo;" },
  { name: "Tin-Can Tony",       flavor: "Body panels from soup cans, bumper from a church pew. Runs eleven flat.",
    gloat: "&ldquo;Beat by soup cans and a church pew! Somebody upstairs owed the pew a favor.&rdquo;" },
  { name: "Midnight Millie",    flavor: "Only races after dark. Says the stars keep score fairer than people.",
    gloat: "&ldquo;The stars kept the score, sugar, and they don't round in your favor.&rdquo;" },
  { name: "Yardstick Yates",    flavor: "Measures every win to the inch and rounds in his favor.",
    gloat: "&ldquo;By my measure you lost by a mile and a half. I rounded. In my favor. As is tradition.&rdquo;" },
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
// `gloat` is the winner's send-off on the losing results card (Jason,
// 2026-07-16 — every character gets one). Written money-free on purpose: no
// cash moves on a boss loss, so the flavor must never imply a handout.
export const BOSSES = [
  { name: "GREASY PETE",     flavor: "King of the burger lot. His Deuce has never lost to a Model A. Yet.",
    gloat: "Pete hangs your keys behind the counter, between the flyswatter and the employee of the month. &ldquo;Tough break, kid. Bus stop's past the burger lot &mdash; wave on your way by.&rdquo;" },
  { name: "THE UNDERTAKER",  flavor: "Drives a chopped Merc black as midnight. Measures you with his eyes.",
    gloat: "He folds your pink slip with the care of a man arranging lilies. &ldquo;My condolences. She'll get a beautiful service.&rdquo;" },
  { name: "MISS FIRECRACKER",flavor: "Two-tone Bel Air, zero patience. Beat her and the fins are yours.",
    gloat: "&ldquo;Aw, sugar.&rdquo; She fixes her lipstick in your mirror &mdash; her mirror now. &ldquo;Don't pout. Pink was never your color anyway.&rdquo;" },
  { name: "COLTRANE",        flavor: "Quiet man, loud GTO. Only races for keeps.",
    gloat: "Coltrane doesn't say a word. He never does. Pulling away in your car, he taps the horn twice. Somehow that's worse." },
  { name: "NIGHTSHADE",      flavor: "Nobody's seen the driver. The Charger just shows up when you're ready.",
    gloat: "The Charger's window never rolls down. It just idles beside you a long moment, in something that sounds an awful lot like laughter." },
  { name: "THE KING",        flavor: "Top of the ladder. His Hemi 'Cuda IS the crown. One race. Everything.",
    gloat: "&ldquo;Bad luck, kid. Better luck next time &mdash; there's always a next time. Ain't never a next crown.&rdquo; Your keys join a ring already heavy with them." },
];

// Enough to bolt on a few parts and still cover gas money — the first
// board is stock-slow either way, so the build starts in the garage, race one.
export const STARTING_MONEY = 1000;
export const SAVE_KEY = "streetrod86-save-v1";
