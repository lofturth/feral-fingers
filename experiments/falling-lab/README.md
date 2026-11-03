# Falling Lab

Falling Lab is a framework for spaced retrieval instruments and dynamic falling learning experiences.

Items ("cards") fall over time as forgetting occurs. Successful retrieval lifts items back toward mastery. An overall progress trace tracks systemic fluency across all items, unlocking new cards sequentially when earlier items demonstrate stable retention.

## Architecture

Falling Lab strictly separates three architectural responsibilities:

1. **Falling Core (`core/`)**: Domain-independent mathematical engine.
   - Manages card depths, asymptotic exponential settling (`15/s`), time-coordinate kicks (`reverseFallingTime`), lowest-depth scheduling, sequential threshold unlocking (`> 50%`), and session completion (`> 90%`).
   - Pure, deterministic, DOM-free state machine.
   - Authoritative source in `core/physics.ts`, compiled to UMD bundle `core/physics.js`.

2. **Falling View (`views/falling/`)**: Domain-independent visual renderer.
   - Renders the visual representation of falling cards, columns, thresholds (`50%` Unlock, `90%` Complete), grid lines, and cumulative progress history trace.
   - Zero-write attribute caching ensures high-performance 60fps animation frames.
   - Pure visual representation; completely unaware of musical notes, Spanish words, or input devices.

3. **Applications (`apps/`)**: Domain-specific content, inputs, evaluation, and foreground overlays.
   - **Music (`apps/music/`)**: Web MIDI and keyboard input, polyphonic synth audio, interactive stationary card overlay with notation/noteheads/letters, first-try evaluation, and live piano-roll diagnostics. Entry point: `apps/music/index.html`.
   - **Vocabulary (`apps/vocabulary/`)**: English-to-Spanish translation prompts, typing input, latency decay multiplier calculation, streak counters, and real-time kick graph. Entry point: `apps/vocabulary/index.html`.
   - **Generic Demonstration (`apps/generic/`)**: Content-neutral demonstration driving 5 abstract cards (`Card A` through `Card E`) directly through Falling Core and Falling View without any domain modules. Entry point: `apps/generic/index.html`.

## Directory Structure

```text
experiments/falling-lab/
├── index.html                 # Simple application launcher
├── core/
│   ├── physics.ts             # Authoritative TypeScript engine source
│   ├── physics.js             # Compiled UMD engine bundle (DOM-free)
│   └── physics.reference.js   # Immutable reference baseline for differential tests
├── views/
│   └── falling/
│       └── view.js            # Reusable Falling View renderer
├── shared/
│   └── app.js                 # Unified coordinator connecting Core, View, & Apps
├── apps/
│   ├── music/
│   │   ├── index.html         # Music application entrypoint
│   │   ├── app-music.js       # Musical application logic, audio, & MIDI
│   │   └── musical-view.js    # Stationary musical card overlay & diagnostics
│   ├── vocabulary/
│   │   ├── index.html         # Vocabulary application entrypoint
│   │   ├── app-vocabulary.js  # Vocabulary application logic & input handling
│   │   └── vocabulary-view.js # Prompt overlay, streak formatting, & kick graph
│   └── generic/
│       ├── index.html         # Generic demonstration entrypoint
│       └── app-generic.js     # Domain-free demonstration application
├── tests/                     # 139 automated tests across all components
├── scripts/
│   └── build.cjs              # Build script compiling TypeScript to UMD bundle
├── style.css                  # Shared stylesheet
├── package.json               # Package configuration & scripts
├── run.sh                     # Local web server runner
└── README.md                  # Complete architectural & operational guide
```

## Running Applications in the Browser

Start the local server using `run.sh`:

```bash
./run.sh 4185
```

Access the applications in your browser:

- **Application Launcher:** [http://127.0.0.1:4185/](http://127.0.0.1:4185/) (`/`)
- **Musical Instrument:** [http://127.0.0.1:4185/apps/music/](http://127.0.0.1:4185/apps/music/)
  - Play notes via connected Web MIDI keyboards or computer keyboard keys `1`, `2`, `3` (C4, D4, E4).
- **Vocabulary Instrument:** [http://127.0.0.1:4185/apps/vocabulary/](http://127.0.0.1:4185/apps/vocabulary/)
  - Type translated Spanish words to retrieve falling cards; press `Escape` to skip.
- **Generic Demonstration:** [http://127.0.0.1:4185/apps/generic/](http://127.0.0.1:4185/apps/generic/)
  - Click buttons to inspect pure Core and View mechanics (`Reward Selected (+25%)`, `Skip to Next`, `Tick 1s`, `Reset`).

The navigation switcher in each application header allows switching between launcher and application modes.

## Adding a New Application

You can create a new learning experience without touching `core/` or `views/`:

1. **Create an application directory** in `apps/my-app/` with:
   - `index.html`: Application entry point loading `../../core/physics.js` and `../../views/falling/view.js`.
   - `app-my-app.js`: Manages user input, evaluation criteria, and reward magnitudes.
   - (Optional) `my-app-view.js`: Renders foreground DOM overlays for domain-specific visual feedback.

2. **Instantiate Falling Core and Falling View**:
   ```javascript
   const session = MunduPhysics.createSession({
     cardCount: 10,
     cards: myItems.map((item, i) => ({ id: item.id || `card-${i}` }))
   });

   const field = FallingView.createField({
     chartId: 'chart',
     gridId: 'grid',
     barsId: 'bars',
     labelsId: 'labels',
     traceId: 'trace',
     traceLiveId: 'trace-live',
     tracePercentageId: 'trace-percentage',
     scoreId: 'score'
   });

   field.build(10);
   ```

3. **Drive the animation loop and deliver rewards**:
   - In your `requestAnimationFrame` loop, call `session.advance(dt)` and `field.render(session.getState(), dt)`.
   - On correct user action, calculate a reward multiplier (e.g., based on latency or correctness) and call `session.applyReward(multiplier)`.
   - On incorrect action or skip, call `session.skip()`.

## Development, Testing, and Building

Install dependencies:

```bash
npm install
```

Run test suite, typecheck, and build:

```bash
npm test          # Run all 139 automated tests
npm run typecheck # Run TypeScript compiler check (tsc --noEmit)
npm run build     # Compile core/physics.ts to dist/ and core/physics.js
```

Targeted test runners:
```bash
npm run test:engine       # Core physics, characterization, and differential tests
npm run test:view         # Falling View visual renderer tests
npm run test:apps         # Musical and vocabulary input isolation tests
npm run test:overlays     # Domain-specific overlay tests
npm run test:generic      # Generic demonstration tests
npm run test:differential # Parity tests against reference physics
```
