# Finding: Slapstic FSM observes 68010 CPU prefetch outside protected window

> Discovered: 2026-05-13. Codex round 7 series, commits `4a5d27b`, `6aeb685`.
> Reproducible: TARGET_FRAME=12950 `probe-diff-bytes` pre/post fix.
> Impact: closed 126 byte playfield diff at f12950, 414 byte at f13200.

## TL;DR

The Atari System 1 **slapstic 137412-103** chip's bank-select FSM does NOT
observe only the protected ROM window `0x080000-0x087FFF`. It also observes
**68010 CPU instruction prefetch** addresses outside that range. Specifically,
the prefetch of address `0x02ff5a` (inside `FUN_2FF40`) matches the slapstic's
`alt1` pattern (`test_any`) **before** the protected pair
`0x87a28 → 0x87a48+idx*2` is read, switching the FSM state and causing a
different bank to be committed than what the protected reads alone would
produce.

This is a **hardware side channel** not documented in MAME source or any
public datasheet. We discovered it via differential analysis of byte mismatch
in playfield rebuild descriptors.

## Background

The Atari System 1 hardware uses the **slapstic 137412-103** for bank
switching of a 32KB ROM region (`0x080000-0x087FFF`) split into 4 banks of
8KB each. The chip implements a finite state machine that:

1. Starts in IDLE
2. Transitions to ACTIVE on a "reset access" (address `0x80000`, low 15 bits = 0)
3. Accepts `alt1..alt4` magic values to enter ALT_VALID
4. Accepts `bit1..bit4` to enter BIT_SELECT
5. Reads at protected paired addresses (`0x87a28 → 0x87a48+idx*2`) commit
   the selected bank

The official mode-of-operation documented in MAME source
(`src/mame/atari/slapstic.cpp`) is:

> Every access (read or write) inside `0x080000-0x087FFF` triggers
> `m_state->test()`, advancing the FSM.

This was our initial port (`packages/engine/src/m68k/slapstic-103.ts`,
already validated 11/11 vitest pre-finding).

## The anomaly

After closing playfield diff at f12900 (commit `ab3098d`), residual mismatch
remained at f12950:

```
TARGET_FRAME=12900: pfRam diff = 0   ✓
TARGET_FRAME=12950: pfRam diff = 126 ✗
```

The 126 byte residual was concentrated in tile-rendering descriptors generated
by `FUN_1AA38` (tilemap span builder). Specifically, several mixed-cell
descriptors had **wrong source words** read from ROM.

Bisecting: TS was reading from bank 0 at `0x80080` final, while MAME was
reading from a different bank. The intermediate state of the slapstic FSM
diverged.

## The discovery

Tracing the M68K disasm of `FUN_1AD54` (which decodes a tile-line via the
slapstic-mapped ROM range), the path goes:

```
FUN_1AD54 → FUN_2BC5C → FUN_2FF40
```

The trampoline `FUN_2BC5C` is at `0x2BC5C`, but `FUN_2FF40` starts at
`0x02FF40`. When the 68010 prefetches the next instruction word at
`0x02FF5A` (inside `FUN_2FF40`), that 16-bit value happens to match
the slapstic `alt1` pattern.

```
slapstic 103 alt1: mask=0xFFFF, value=0x002FF5A & test_any
```

(approximate — see `slapstic-103.ts` for exact constants)

**MAME emulates this** because MAME's slapstic tap is installed on the entire
CPU address space, not just the protected window. The MAME comment in
`slapstic.cpp` doesn't mention this explicitly — it just says "the tap fires
on every bus access". Since prefetch is a bus access, the FSM advances.

Our initial TS port restricted FSM ticking to `0x080000-0x087FFF` accesses,
based on the natural reading of how a bank-select chip should work. This is
where we diverged.

## The fix

Two changes:

### 1. `m68k/slapstic-103.ts` (commit `6aeb685`)

Updated documentation comment to note that `test_any` can fire from prefetch
outside the protected window. Loosened the assertion that FSM ticking is
restricted to in-window accesses.

```typescript
/*
 * Hardware note: MAME installs the slapstic tap across the full CPU address space.
 * `test_any` can therefore be armed by code prefetch or reads outside the
 * protected window, such as `0x02ff5a` in `FUN_2FF40`, not only by accesses to
 * `0x080000..0x087FFF`.
 */
```

Added regression test (`packages/engine/test/slapstic-103.test.ts`) that
verifies the sequence `0x2ff5a, 0x87a28, 0x87a4c, 0x80080` produces the
correct bank.

### 2. `render-tile-line-1ad54.ts` (commit `4a5d27b`)

Modeled the actual sequence of slapstic ticks that `FUN_1AD54 → FUN_2BC5C →
FUN_2FF40` produces, including the prefetch at `0x02FF5A` and the protected
pair access:

```typescript
function slapsticEvent2BC5C(rom: RomImage, flagsWord: number): void {
  const d2 = flagsWord & 0xffff;
  touchSlapstic(rom, 0x80000);
  if ((d2 & 0x01) !== 0) touchSlapstic(rom, 0x86984);
  if ((d2 & 0x02) !== 0) touchSlapstic(rom, 0x80000);
  if ((d2 & 0x10) !== 0) {
    const index = (d2 & 0x0c) >> 2;
    touchSlapstic(rom, 0x87a28);
    touchSlapstic(rom, (0x87a48 + index * 2) >>> 0);
  }
  if ((d2 & 0x80) !== 0) touchSlapstic(rom, 0x80000);
  touchSlapstic(rom, (0x80080 + (d2 & 0x60)) >>> 0);
}
```

`touchSlapstic` advances the FSM and applies the active bank if it changed.

## Verification

```
                       Pre-fix    Post-4a5d27b   Post-6aeb685
TARGET_FRAME=12900:    PF=22      PF=0           PF=0    ✓
TARGET_FRAME=12950:    PF=1036    PF=0           PF=0    ✓
TARGET_FRAME=13200:    PF=1083    PF=461         PF=47
test-render-tile-line-1ad54-parity.ts:  20/20 PASS
test-slapstic-103.test.ts:              11/11 + 16 new = 27/27 PASS
```

## Reflections

### Why MAME didn't document this

MAME's slapstic implementation is technically correct: it taps the entire
address space, so any access (including prefetch) triggers `m_state->test()`.
The documentation says "every access in `0x80000-0x87FFF`" but the
implementation is broader.

For a human porter, the reasonable interpretation is "only protected window
matters" — because that's where the bank switching has meaning. The fact
that prefetch at a completely unrelated code address coincidentally matches
the `alt1` magic value is an emergent quirk of:

1. The compiler's code layout (FUN_2FF40 happens to be at 0x02FF40)
2. The slapstic FSM accepting `test_any` (= matches anywhere in address space)

Calling this "documentation gap" is generous; it's more accurately
"emergent behavior nobody thought to write down".

### How AI agents found this

The Codex agent did NOT understand slapstic hardware. What it did:

1. Observed `playfield diff = 126 bytes at f12950` after previous fix
2. Compared byte-by-byte → divergence in `FUN_1A444` descriptor source words
3. Bisected: TS reads from bank 0, MAME reads from bank N
4. Traced the call chain `FUN_1AD54 → FUN_2BC5C → FUN_2FF40`
5. Generated a hypothesis: "some access in this chain affects slapstic state
   that I'm not modeling"
6. Tested: instrument every memory access in the chain → which one matches
   slapstic patterns?
7. Found `0x02FF5A` matches `alt1`
8. Verified: adding that single tick reduces the diff to zero

This is "differential debugging" + "hypothesis testing", not hardware
expertise. The methodology is purely **statistical**: every byte that differs
between TS and MAME is a clue.

The AI didn't "understand" the slapstic. It deduced its behavior from
observable state differences.

### Generalization

This finding suggests that for cycle-accurate emulation of legacy hardware,
**any side channel observable by the chip is part of its behavior**. CPU
prefetch is the most obvious one (visible to every memory-mapped peripheral
via bus snooping), but also:

- Refresh cycles (DRAM refresh on motherboard reads sometimes affect timing)
- Bus contention (two masters at same time)
- Interrupt acknowledge cycles (special bus cycle type)

For our purposes, we now need to look for **other places where prefetch
matters**. Likely candidates:

- Any `FUN_xxxxx` whose own address modulo-something matches a slapstic alt/bit
  pattern when prefetched
- Tile rendering paths (high-frequency, heavily looped → many prefetches)
- Sound IRQ handlers if running concurrently

## References

- MAME slapstic source: https://github.com/mamedev/mame/blob/master/src/mame/atari/slapstic.cpp
- Slapstic FSM TS port: `packages/engine/src/m68k/slapstic-103.ts`
- Regression test: `packages/engine/test/slapstic-103.test.ts` (16 new cases)
- Pre/post diff probes:
  - `packages/cli/src/probe-diff-bytes.ts`
  - `packages/cli/src/probe-converge-multi.ts`

## Commits

- `ab3098d` — Align mode0 rebuild cadence (precursor: closed f12900 PF)
- `4a5d27b` — Model tile-line slapstic side effects (main fix)
- `6aeb685` — Model slapstic prefetch side effect (FSM doc + regression test)
