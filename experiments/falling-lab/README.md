# Falling Lab

Falling Lab is a framework for spaced retrieval instruments and dynamic falling learning experiences.

Items ("cards") fall over time as forgetting occurs. Successful retrieval lifts items back toward mastery. An overall progress trace tracks systemic fluency across all items, unlocking new cards sequentially when earlier items demonstrate stable retention.

## Architecture

- **Core (`core/physics.ts`)** is the domain-independent session engine. The generated `physics.js` is used by the existing browser apps. A session can opt in to stable selection with `createSession({ holdSelection: true })`: time advances keep the active card, while rewards and skips select the next card. The default retains continuous lowest-card selection.
- **App-owned field views** live in `apps/vocabulary/view/` and `apps/generic/view/`.
- **Vocabulary** uses its own field and vocabulary overlay. **Generic** demonstrates Core with its own field. Vocabulary coordination lives in `apps/vocabulary/coordinator.js`.
- **Piano Trainer** contains `cards/` for the reusable React piano card and evaluator, `midi/` for input and recording, and `card-lab/` as their standalone development application. A trainer app and its view have not been implemented.

```text
core/physics.ts
apps/
├── vocabulary/{app-vocabulary.js,view/{falling-field.js,vocabulary-overlay.js}}
├── generic/{app-generic.js,view/falling-field.js}
└── piano-trainer/{cards/,midi/,card-lab/}
```

## Running Applications in the Browser

Start the local server using `run.sh`:

```bash
./run.sh 4185
```

Access the applications in your browser:

- **Application Launcher:** [http://127.0.0.1:4185/](http://127.0.0.1:4185/) (`/`)
- **Vocabulary Instrument:** [http://127.0.0.1:4185/apps/vocabulary/](http://127.0.0.1:4185/apps/vocabulary/)
  - Type translated Spanish words to retrieve falling cards; press `Escape` to skip.
- **Generic Demonstration:** [http://127.0.0.1:4185/apps/generic/](http://127.0.0.1:4185/apps/generic/)
  - Click buttons to inspect pure Core and View mechanics (`Reward Selected (+25%)`, `Skip to Next`, `Tick 1s`, `Reset`).

The navigation switcher in each application header allows switching between launcher and application modes.

## Piano Card Lab

From `apps/piano-trainer/card-lab/`, run `npm install` and `npm run dev`, then open `http://127.0.0.1:5187/apps/piano-trainer/card-lab/`. HMR is disabled; refresh manually after changes. `npm run build` checks TypeScript and builds the lab. The lab uses the app-owned piano card, MIDI input and phrase evaluator.

## Adding a New Application

Give the application its own view and input logic, and load `core/physics.js` for the shared session engine. The existing generic application demonstrates creating a session, advancing it and rendering its state. The app decides how user interactions map to rewards or skips.

## Development, Testing, and Building

Install dependencies:

```bash
npm install
```

Run test suite, typecheck, and build:

```bash
npm test          # Run all existing automated tests
npm run typecheck # Run TypeScript compiler check (tsc --noEmit)
npm run build     # Compile core/physics.ts to dist/ and core/physics.js
```

Targeted test runners:
```bash
npm run test:engine       # Core physics, characterization, and differential tests
npm run test:view         # Falling View visual renderer tests
npm run test:apps         # Vocabulary input tests
npm run test:overlays     # Domain-specific overlay tests
npm run test:generic      # Generic demonstration tests
npm run test:differential # Parity tests against reference physics
```
