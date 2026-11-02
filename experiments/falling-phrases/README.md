# Falling Phrases baseline

This experiment is based on the playable application from
`mundu-algorithm-tuning` (source commit `20160f5`). It still shows the original
sample vocabulary and interface. Piano phrases, MIDI, audio, and notation have
not been added.

Run `./run.sh` here and open http://127.0.0.1:4175/ (or `./run.sh [port]`).
The server binds to localhost only. Refresh the page manually after source changes.
No installation or build is needed to run the browser app directly.

## Architecture & TypeScript Engine

- `physics.ts`: Authoritative TypeScript source containing the falling, kick,
  selection, unlock, and completion engine with strict typing.
- `physics.js`: Backwards-compatible UMD bundle compiled from `physics.ts`, loaded
  directly by `index.html` and Node test harnesses.
- `physics.reference.js`: Immutable copy of the original JavaScript implementation
  used for differential regression testing.
- `app.js`: Connects physics to animation frames, keyboard input, SVG rendering,
  and tuning.
- `index.html` and `style.css`: Existing interface.
- `repetitions.cjs`: Simulation utility and parameter sweep tool.

## Development & Build

Install dependencies and run scripts with npm:

```bash
npm run typecheck          # Run TypeScript type check (tsc --noEmit)
npm run build              # Compile physics.ts and regenerate UMD physics.js
npm test                   # Run all 90 tests (81 baseline + 9 differential)
npm run test:existing      # Run the 81 baseline tests
npm run test:differential  # Run the 9 differential tests against reference JS
npm run benchmark          # Run render attribute write microbenchmark
```
