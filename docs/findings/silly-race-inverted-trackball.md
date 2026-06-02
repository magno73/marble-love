# Finding: the Silly Race inverts the trackball with a single add/subtract flip

> Verified: 2026-06-02 against the disassembly of `FUN_00025DF6` and the
> `trackball-apply` port (`trackball-apply.test.ts`, 4/4).
> Impact: explains the Silly Race's inverted marble response down to one branch.

## TL;DR

The routine that applies the trackball delta to the marble's position
(`FUN_00025DF6`) **subtracts** the (scaled) delta from the position on every
level **except** game mode 4, where it **adds** it instead. Game mode 4 is the
**Silly Race** (mode = level − 1, so mode 4 = level 5). Adding rather than
subtracting the same delta flips the marble's response on both axes — i.e. the
Silly Race's "the marble fights you" feel is one `+` where every other level has
a `−`.

## Background

Trackball input is accumulated into two signed words at `0x4006A4` (X) and
`0x4006A6` (Y) each frame. `FUN_00025DF6` reads those deltas, optionally boosts
them (`|delta| >= 0xC` → `delta <<= 2`), shifts the result left by 11 to reach
the position's fixed-point scale, and applies it to the marble's X/Y position
longs.

The game's per-mode state byte lives at `0x400394` and equals `level − 1`:

| mode | level | name |
|---|---|---|
| 0 | 1 | Practice |
| 1 | 2 | Beginner |
| 2 | 3 | Intermediate |
| 3 | 4 | Aerobic |
| **4** | **5** | **Silly Race** |
| 5 | 6 | Ultimate |

## The observation

In `FUN_00025DF6` the final apply is conditional on that mode byte:

```
if (*0x400394 == 4)  pos += (delta << 11)     // Silly Race
else                 pos -= (delta << 11)     // every other level
```

(See `packages/engine/src/trackball-apply.ts`, the `gameState === 4` branch.)

Both the X and the Y application take the same branch, so on the Silly Race the
marble moves *opposite* to the trackball on both axes relative to every other
level. There is no separate "reverse" flag, no per-axis special case, and no
table — the entire gimmick is the choice between `add` and `sub` at this one
site, selected by the level number.

## Why it is there

The Silly Race is Marble Madness's gag level. Reading the code, its
"silliness" on the input side is exactly this inversion: the same physics and
the same trackball pipeline as the other levels, with the final position update
sign-flipped for mode 4 only. The original disassembly comment for this branch
reads "ADD (compensate)"; the observable effect is an inverted marble response
for the Silly Race.

## How to verify

- **In code / tests:** `npx vitest run packages/engine/test/trackball-apply.test.ts`
  exercises the apply routine; the `gameState === 4` branch is the add path.
- **By hand:** boot the Silly Race (`?autoLoad=1&startLevel=5`) and a normal
  level, and compare the marble's response to the same trackball motion — it is
  inverted on level 5.

## Reflections

This is not a hardware secret like the
[slapstic prefetch side-channel](slapstic-prefetch-side-channel.md); it is a
game-design detail. But it is a good example of what a function-by-function port
buys you: a recognizable, decades-old gameplay quirk reduces to a single,
pin-pointable branch keyed on the level number, and the parity test makes the
claim checkable rather than anecdotal.

## References

- `packages/engine/src/trackball-apply.ts` — `FUN_00025DF6` port; the
  `gameState === 4` add path vs the default subtract path.
- `packages/engine/test/trackball-apply.test.ts` — parity tests (4/4).
- Mode byte `0x400394 = level − 1`; also gates the Silly Race creature
  collision (`FUN_0001924E`).
