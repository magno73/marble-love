# PRD — Marble Love Classic Renderer / Web Branch

## Project

Repository: `marble-love`

Branch to create/use:

```bash
git checkout main
git pull
git checkout -b ai/codex-classic-renderer
```

## Context

`marble-love` is a TypeScript reimplementation of Atari Marble Madness, validated against the original arcade binary/MAME through differential and bit-perfect testing.

The current project is strong on engine/parity work, but the web/renderer layer is still mostly a scaffold.

Current relevant files:

- `packages/engine/src/render.ts`
  - Exposes a neutral rendering adapter.
  - Currently defines simple `SpriteCommand`, `TileCommand`, `Frame`.
  - `buildFrame(_state)` currently returns an empty frame.

- `packages/web/src/renderer.ts`
  - PixiJS renderer adapter.
  - Currently draws a rotating placeholder rectangle.
  - Does not yet render real tiles, sprites, palette, HUD, or frame commands.

- `packages/web/src/rom-loader.ts`
  - Stub.
  - Accepts a local `marble.zip` file.
  - Currently returns empty `Uint8Array`s.

- `packages/web/src/main.ts`
  - Web app skeleton.
  - File picker -> extract ROM -> start PixiJS app -> tick engine -> renderer.draw(state).

Relevant docs:

- `docs/video-system.md`
- `docs/rom-layout.md`
- `README.md`
- `STATUS.md`
- `marble-love-prd-v0.2.md`

## High-level objective

Build the first safe version of the **classic renderer / web pipeline**.

This branch must prepare the visual rendering architecture without interfering with the bit-perfect engine work.

The goal is **not yet** to create a fully playable Marble Madness renderer from real ROM graphics.

The goal is to replace the current rotating rectangle placeholder with a structured PixiJS renderer that can draw an abstract classic arcade `Frame` containing:

- native resolution metadata;
- palette/color data;
- playfield/tile layer;
- motion objects/sprites;
- alpha/HUD layer;
- scroll values;
- synthetic fixture content.

## Product goal

At the end of this branch, the web app should be able to render a synthetic “classic arcade frame” using the same layer model as Atari System 1:

1. Playfield / tilemap layer
2. Motion object / sprite layer
3. Alpha / HUD overlay layer

The visual output may use generated colored rectangles or simple generated textures. It must not use copyrighted ROM assets.

This branch should create the rendering pipeline that later can be connected to real decoded ROM graphics and real engine RAM.

## Non-goals

Do **not** implement a full Marble Madness game.

Do **not** complete the engine.

Do **not** modify the bit-perfect logic.

Do **not** decode the entire real ROM graphics unless this can be done safely as a clearly isolated scaffold.

Do **not** include ROM files, screenshots, copyrighted assets, or extracted graphics.

Do **not** attempt a modern HD/remaster renderer yet.

Do **not** refactor unrelated code.

Do **not** change parity test logic.

## Critical constraints

### 1. Do not touch engine parity code

Forbidden files/directories, unless explicitly needed for type imports only:

- `packages/engine/src/rng.ts`
- `packages/engine/src/physics.ts`
- `packages/engine/src/ai.ts`
- `packages/engine/src/game-main-gate.ts`
- `packages/engine/src/game-state-machine.ts`
- `packages/engine/src/game-tick-timers.ts`
- `packages/engine/src/trackball-*`
- `packages/engine/src/palette-*`
- `packages/engine/src/sprite-pack.ts`
- `packages/engine/src/sprite-derive.ts`
- `packages/engine/src/sprite-coords.ts`
- `packages/engine/src/position-update.ts`
- `packages/engine/src/move-velocity.ts`
- `packages/cli/src/test-*-parity.ts`
- `harness/*`
- `oracle/*`

Allowed engine file:

- `packages/engine/src/render.ts`

Only modify `render.ts` to define a richer neutral `Frame` model and a safe placeholder `buildFrame()`.

### 2. Renderer must remain independent from game logic

The PixiJS renderer should draw whatever `Frame` it receives.

It must not infer gameplay rules.

It must not mutate `GameState`.

It must not implement collision, physics, AI, timer, RNG, or state machine logic.

### 3. No copyrighted data

Do not commit:

- ROM files;
- extracted sprites;
- extracted tiles;
- MAME screenshots;
- copyrighted pixel art;
- generated data derived from ROM content.

Synthetic fixtures are allowed.

### 4. Preserve determinism and simplicity

This project is parity-sensitive. Avoid hidden randomness in engine-adjacent code.

The synthetic demo frame may animate only through explicit frame counters or supplied values.

Do not introduce unnecessary abstractions.

Do not introduce global mutable renderer state outside PixiJS object pools/containers.

## Technical target

### Native resolution

Use Atari System 1 Marble Madness classic visible resolution:

```ts
width: 336
height: 240
refresh: approximately 59.92 fps
```

The renderer should support scaling to the browser window while preserving pixel-art behavior:

- `antialias: false`
- crisp scaling
- no smoothing by default
- centered viewport
- optional letterboxing

### Layer order

Render layers in this order:

```text
1. playfield / tilemap
2. motion objects / sprites
3. alpha / HUD
```

This should be represented explicitly in code.

### Frame model

Update `packages/engine/src/render.ts` to expose a richer but still simple model.

Suggested shape:

```ts
export interface FrameSize {
  width: number;
  height: number;
}

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface PaletteEntry {
  index: number;
  rgba: RgbaColor;
}

export interface TileCommand {
  tileIndex: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  paletteIndex: number;
  flipX?: boolean;
  flipY?: boolean;
  priority?: number;
}

export interface SpriteCommand {
  spriteIndex: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  paletteIndex: number;
  flipX?: boolean;
  flipY?: boolean;
  priority?: number;
  translucent?: boolean;
}

export interface AlphaCommand {
  tileIndex: number;
  x: number;
  y: number;
  paletteIndex: number;
  opaque?: boolean;
}

export interface Frame {
  nativeSize: FrameSize;
  scrollX: number;
  scrollY: number;
  palette: PaletteEntry[];
  playfield: TileCommand[];
  sprites: SpriteCommand[];
  alpha: AlphaCommand[];
  debugLabel?: string;
}
```

You may adjust this if the existing codebase suggests a better local style, but keep the model simple and neutral.

### `buildFrame(state)`

For now, `buildFrame(state)` should be safe.

Acceptable options:

1. Return an empty frame with native size and empty layers.
2. Return a tiny deterministic synthetic frame based on `state.clock.frame`.

Preferred:

- keep `buildFrame(state)` conservative;
- put synthetic demo frame generation in `packages/web/src/fixtures/classic-demo-frame.ts`;
- avoid making engine `buildFrame()` responsible for fake visuals.

## Implementation phases

## Phase A — Classic renderer skeleton with synthetic fixtures

This is the primary required phase.

### Required deliverables

1. Update `packages/engine/src/render.ts`
   - Define the richer neutral `Frame` model.
   - Keep engine pure: no PixiJS, DOM, browser APIs.
   - Keep `buildFrame(state)` safe and minimal.

2. Create a synthetic fixture frame in web package
   - Suggested file:
     - `packages/web/src/fixtures/classic-demo-frame.ts`
   - It should generate a test `Frame` with:
     - fake tile grid;
     - a few fake sprites;
     - fake alpha/HUD text/tile blocks;
     - simple palette entries;
     - scroll values.

3. Replace placeholder rectangle renderer
   - Update `packages/web/src/renderer.ts`.
   - Remove or isolate the rotating rectangle placeholder.
   - Implement a renderer that draws a supplied `Frame`.

4. Use PixiJS layers/containers
   - Suggested containers:
     - `playfieldLayer`
     - `spriteLayer`
     - `alphaLayer`
     - optional `viewport`

5. Implement simple drawing using generated graphics/textures
   - It is acceptable to draw tiles/sprites as rectangles for now.
   - Use palette colors from the `Frame` model.
   - Do not use real ROM art.

6. Update `packages/web/src/main.ts`
   - Wire renderer to either:
     - `render.buildFrame(state)`, or
     - synthetic fixture frame while real frame is empty.
   - Make this explicit and documented.
   - Prefer a debug/demo mode flag rather than pretending this is real game rendering.

7. Add documentation
   - Create:
     - `docs/classic-renderer.md`
   - Explain:
     - what is implemented;
     - what is synthetic;
     - how the frame model maps to Atari System 1 layers;
     - what remains for ROM decoding;
     - what remains for real engine integration.

### Phase A acceptance criteria

Must pass:

```bash
npm run typecheck
npm run test
npm run lint
npm run build
```

The web app must still run:

```bash
npm run dev --workspace @marble-love/web
```

Expected visual result:

- Browser opens.
- User can select a file as before, or the app can show a synthetic demo frame in development mode.
- The PixiJS canvas displays a fake classic-frame composition:
  - tile-like background;
  - sprite-like objects;
  - HUD-like overlay.
- The old rotating red rectangle is gone or isolated behind an explicit debug fallback.

Expected code result:

- `packages/engine/src/render.ts` remains DOM-free and PixiJS-free.
- `packages/web/src/renderer.ts` is a real frame renderer, not a one-off placeholder.
- No parity/game-logic files are changed.
- No copyrighted assets are committed.

## Phase B — ROM loader and graphics decoder scaffold

Only proceed to Phase B if Phase A is complete and all checks pass.

Phase B should be a scaffold, not a full risky implementation.

### Objective

Prepare the structure for reading a user-supplied `marble.zip` locally in the browser.

### Constraints

- Do not include ROM data.
- Do not upload ROM data anywhere.
- Do not hardcode derived copyrighted assets.
- Do not guess undocumented bit layouts.
- If details are uncertain, add explicit TODOs with references to `docs/rom-layout.md` and `docs/video-system.md`.

### Suggested dependency

If needed, use `fflate` for browser-side ZIP reading.

Add it only if actually used.

```bash
npm install fflate --workspace @marble-love/web
```

### Required deliverables

1. Update `packages/web/src/rom-loader.ts`
   - Read entries from a user-supplied ZIP.
   - Validate expected file names from `docs/rom-layout.md`.
   - Return structured byte arrays.
   - Produce helpful errors if required files are missing.

2. Define a typed graphics asset interface
   - Suggested file:
     - `packages/web/src/rom-graphics.ts`
   - The interface may include:
     - alpha bytes;
     - tile bytes;
     - sprite bytes;
     - PROM bytes;
     - decoded palette placeholder;
     - decoded tile/sprite placeholder.

3. Add minimal synthetic tests if the project test setup supports web package tests.
   - Use artificial byte arrays only.
   - Do not rely on real ROM files.

4. Document assumptions in `docs/classic-renderer.md`.

### Phase B acceptance criteria

Must pass:

```bash
npm run typecheck
npm run test
npm run lint
npm run build
```

ROM loader behavior:

- Given a ZIP with missing required files, it reports a clear error.
- Given a ZIP-like structure in tests with expected fake file names, it can extract bytes.
- It does not attempt to upload or persist files.
- It does not commit ROM data.

## Phase C — Real engine frame integration scaffold

Only proceed if Phase A and B are stable.

### Objective

Prepare `buildFrame(state)` to eventually read from:

- `state.spriteRam`
- `state.alphaRam`
- `state.colorRam`
- future playfield RAM / tilemap state

But do not fake correctness.

### Requirements

1. Add helper functions in `packages/engine/src/render.ts` or a new engine-local render helper file only if needed.
2. Keep all parsing conservative.
3. If playfield RAM is not currently in `GameState`, do not invent a full memory model.
4. Add TODOs for missing playfield RAM integration.
5. Add small unit tests only for deterministic byte parsing that is known from docs.

### Phase C acceptance criteria

- No game logic changed.
- No parity tests weakened.
- Frame extraction from known RAM regions is deterministic.
- All commands still pass.

## Preferred implementation order

Do this in order:

1. Inspect files and docs.
2. Create `docs/classic-renderer.md` with a short plan.
3. Implement Phase A.
4. Run all checks.
5. If checks pass and changes are small, optionally implement Phase B scaffold.
6. Do not proceed to Phase C unless Phase B is clean and low-risk.

## Files allowed to modify

Allowed:

```text
packages/engine/src/render.ts
packages/web/src/renderer.ts
packages/web/src/main.ts
packages/web/src/rom-loader.ts
packages/web/src/fixtures/*
packages/web/src/types/*
packages/web/src/rom-graphics.ts
docs/classic-renderer.md
packages/web/package.json
package-lock.json / bun.lock only if dependency is added
```

Allowed only if absolutely necessary:

```text
packages/engine/src/index.ts
packages/web/vite.config.ts
packages/web/index.html
```

Forbidden:

```text
packages/engine/src/rng.ts
packages/engine/src/physics.ts
packages/engine/src/ai.ts
packages/engine/src/game-main-gate.ts
packages/engine/src/game-state-machine.ts
packages/engine/src/game-tick-timers.ts
packages/engine/src/trackball-*.ts
packages/engine/src/palette-*.ts
packages/engine/src/sprite-*.ts
packages/engine/src/position-update.ts
packages/engine/src/move-velocity.ts
packages/cli/src/test-*-parity.ts
harness/*
oracle/*
roms/*
```

## Quality bar

Code should be:

- TypeScript strict-mode friendly;
- simple;
- deterministic;
- readable;
- consistent with existing project style;
- free of browser APIs inside `@marble-love/engine`;
- explicit about placeholders;
- explicit about TODOs.

Avoid:

- broad refactors;
- clever abstractions;
- hidden global state;
- rendering/game-logic coupling;
- “temporary” hacks that touch engine parity;
- fake claims of ROM correctness.

## Testing commands

Run these before final response:

```bash
npm run typecheck
npm run test
npm run lint
npm run build
```

Also run:

```bash
npm run dev --workspace @marble-love/web
```

If interactive browser verification is not possible, state that clearly and explain what was verified by build/typecheck.

## Final response required from Codex

At the end, provide:

1. Summary of what changed.
2. List of files changed.
3. Confirmation of commands run and results.
4. Clear statement of what is still fake/synthetic.
5. Clear statement of what the next step should be.
6. Any risks or TODOs.

## Important final reminder

This branch is a **visual pipeline branch**, not an engine/parity branch.

The correct outcome is:

```text
Engine remains stable
Renderer can draw abstract classic frames
Web app no longer relies on a rotating rectangle placeholder
Synthetic fixture proves layer ordering and scaling
Real ROM decoding remains isolated and documented
```

Do not compromise the bit-perfect reimplementation work.
