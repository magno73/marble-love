# Classic Renderer Plan

> Living plan for branch `ai/codex-classic-renderer`.
> Source PRD: `docs/classic-renderer-prd.md`.

## Branch Goal

Build the first safe classic renderer and web visual pipeline without touching
engine parity logic. The branch should prove that the web app can render an
abstract Atari System 1-style frame with explicit playfield, motion object, and
alpha/HUD layers.

## Ground Rules

- Keep `@marble-love/engine` pure: no DOM, PixiJS, browser APIs, ROM assets, or
  synthetic art generation inside engine code.
- Do not modify parity-sensitive engine, CLI, harness, or oracle files.
- Use synthetic fixture graphics only until ROM graphics decoding is isolated.
- Keep rendering data-driven: PixiJS draws the `Frame` it receives and does not
  infer gameplay rules or mutate `GameState`.
- Run the PRD verification commands after each substantial phase and record any
  pre-existing blockers here.

## Phase A — Classic Renderer Skeleton

Status: implemented.

Completed:

- Expanded `packages/engine/src/render.ts` with neutral frame metadata, palette,
  playfield, sprite, and alpha command types.
- Kept `buildFrame(state)` conservative and empty.
- Added `packages/web/src/fixtures/classic-demo-frame.ts` for deterministic
  synthetic demo frames.
- Replaced the rotating rectangle placeholder with a PixiJS frame renderer using
  explicit playfield, sprite, and alpha containers.
- Wired development mode to render the synthetic fixture explicitly.
- Added `docs/classic-renderer.md` as the renderer README.

Verification so far:

- `npm run test`: passed.
- `npm run typecheck --workspace @marble-love/engine`: passed.
- `npm run typecheck --workspace @marble-love/web`: passed.
- Focused ESLint on changed TypeScript files: passed.
- `npm run build --workspace @marble-love/web`: passed.
- `npm run dev --workspace @marble-love/web`: Vite launched at
  `http://localhost:5173/`.

Known root-level blockers, not introduced by this branch:

- `npm run typecheck` and root `npm run build` fail in existing CLI parity test
  files such as `packages/cli/src/test-slot-search-parity.ts`.
- `npm run lint` fails before file linting because the configured
  `oracle/**/*.ts` argument is ignored by the current ESLint setup.

## Phase B — ROM Loader And Graphics Scaffold

Status: implemented.

Completed:

- Added browser-side ZIP extraction for user-supplied `marble.zip` using
  `fflate`.
- Added support for split MAME-style input by merging multiple selected ZIPs
  such as `marble.zip` plus `atarisy1.zip` in memory.
- Validates expected file names from `docs/rom-layout.md` and reports all
  missing required entries in one error.
- Validates CRC32 values from `docs/rom-layout.md` by default.
- Added splash status/error UI for ROM validation.
- Added in-memory alpha ROM decoding using the documented MAME `anlayout`
  values: 8x8, 2 bpp, plane offsets 0/4, row stride 16 bits.
- Wired decoded alpha glyphs into the Pixi renderer for `Frame.alpha` commands,
  with the previous synthetic block-glyph fallback still available.
- Converted decoded alpha glyphs to in-memory Pixi textures and draw them
  through a small sprite pool.
- After a valid ROM load, the web app displays the explicit demo frame with
  decoded alpha glyphs available to the renderer. This remains a demo frame
  until real engine video RAM is wired.
- Split graphics PROM bytes into raw remap/color tables without interpreting
  final lookup behavior yet.
- Assembles raw `RomImage` byte regions for program, sound, tiles/sprites, and
  graphics PROMs.
- Added `packages/web/src/rom-graphics.ts` with typed raw containers and
  explicit `not-decoded` placeholders.
- Added `packages/web/test/rom-loader.test.ts` using artificial ZIP data only.

Verification:

- `npm run typecheck --workspace @marble-love/web`: passed.
- `npm run test`: passed with web ROM-loader tests included.
- Focused ESLint on changed source files: passed.
- `npm run build --workspace @marble-love/web`: passed.
- Local smoke test with user-provided `marble.zip` + `atarisy1.zip`: passed with
  CRC32 validation enabled and 512 alpha glyphs decoded in memory; no ROM bytes
  copied into the repo.

Constraints:

- Do not commit ROM bytes, decoded graphics, screenshots, or derived assets.
- Do not upload or persist user ROM data.
- Do not guess undocumented bit layouts; document TODOs with references.

## Phase C — Real Engine Frame Integration Scaffold

Status: partially implemented.

Completed:

- Added deterministic IRGB 4-4-4-4 palette conversion from `state.colorRam`.
- Added deterministic alpha/HUD command extraction from `state.alphaRam` using
  the documented System 1 alpha word layout.
- Added deterministic playfield RAM word field extraction without wiring
  playfield RAM into `GameState`.
- Updated `buildFrame(state)` to include palette and alpha scaffolds while
  leaving playfield and sprite command arrays empty.
- Added `packages/engine/test/render.test.ts` for palette and alpha parsing.

Constraints:

- Do not invent playfield RAM before it exists in `GameState`.
- Do not change game logic, parity tests, RNG, physics, AI, or state-machine
  code.
- Do not parse `spriteRam` linked lists yet; motion object priority/translucency
  behavior needs a narrower implementation pass against `docs/video-system.md`.

Verification:

- `npm run typecheck --workspace @marble-love/engine`: passed.
- `npm run test -- packages/engine/test/render.test.ts`: passed.
- `npx eslint packages/engine/src/render.ts`: passed.

## Current Definition Of Done

- Engine remains stable and pure.
- Web renderer draws abstract classic frames in correct layer order.
- Development mode shows a synthetic classic-frame composition.
- Real ROM decoding remains isolated and documented.
- Root verification blockers are either fixed outside forbidden files or clearly
  documented as pre-existing.
