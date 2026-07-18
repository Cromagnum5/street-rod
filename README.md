# STREET ROD '86

A browser-based homage to the Commodore 64 / DOS classic *Street Rod*: relaxed
3D chase-cam driving, wrenching on old iron, and racing AI opponents for cash —
or for pink slips.

## Run it

Everything is local (Three.js is vendored in `lib/`), no build step. ES modules
need an HTTP server, so from the repo root:

```sh
python3 -m http.server 8000
```

then open <http://localhost:8000>. Any static server works.

## How to play

| Keys | Action |
|---|---|
| **Enter** | start / confirm / buy part |
| **↑↓ / WS** | garage: pick part &bull; race: throttle & brake |
| **←→ / AD** | opponent select: swipe cards &bull; race: steer |
| **Space** | garage → find a race |
| **Esc** | back out (in a race this forfeits — and forfeits the bet) |

**Mobile / touch controls (iOS Safari & Chrome, Android):**

| Gesture | Action |
|---|---|
| **Drag up** | throttle (proportional to distance) |
| **Drag down** | brake |
| **Drag left / right** | steer (proportional to distance) |

Pair a Bluetooth keyboard and the touch and keyboard inputs blend together seamlessly.

- **The Garage** — buy upgrades: engine, induction, exhaust, tires, gearbox.
  Every engine-side upgrade is audible: the sound is synthesized live from RPM,
  cylinder count, exhaust flow, and blower whine.
- **Cash races** — swipe through street racers of varying skill (★–★★★★★) and
  wager sizes. Win the bet, lose the bet. Going broke gets you a $0 "pride run"
  so you can always claw back.
- **Pink-slip bosses** — the pink card at the end of the deck. Beat the boss
  and their next-tier car is yours (your old ride is sold for cash). Lose and
  they take your keys — you restart in a rusty Model A from the junkyard.
- The ladder: Model A → Deuce Coupe → Merc Eight → Bel Air → GTO → Charger →
  Hemi 'Cuda. Beat THE KING and you hold the crown.

Progress autosaves to `localStorage`.

## Tech

- **Three.js** (vendored, `lib/three.module.js`) — rendering; cars are
  procedural low-poly meshes (`src/carmesh.js`), tracks are seeded random
  winding roads (`src/track.js`).
- **Web Audio API** (`src/audio.js`) — engine voices are synthesized on the
  fly: firing-frequency sawtooth stack + sub square, throttle-keyed exhaust
  noise, lowpass that opens with RPM and exhaust upgrades, turbo/supercharger
  whine. No audio files anywhere.
- Arcade physics (`src/physics.js`): traction-limited launch, drag-limited top
  speed, grip-capped cornering with speed scrub, automatic gearbox with
  audible shift cuts. Forgiving off-road, soft car-to-car contact.
- AI (`src/ai.js`): pure-pursuit steering, curvature-based corner speed,
  skill-scaled reaction time and a light rubber band.
