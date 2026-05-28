# Input MMIO Map

This document summarizes the input registers used by the browser play and oracle
replay paths. It focuses on Marble Madness, not every Atari System 1 game.

## 68010 Inputs

| Address | Meaning | Notes |
| --- | --- | --- |
| `0xf20001` | P1 rotated trackball X byte | MAME derives this from the raw P1 trackball axes. |
| `0xf20003` | P1 rotated trackball Y byte | Paired with the X read above. |
| `0xf20005` | P2 rotated trackball X byte | Same path for player 2. |
| `0xf20007` | P2 rotated trackball Y byte | Same path for player 2. |
| `0xf60001` | Switch byte | Active-low START1/START2 bits, self-test, VBLANK, and sound-command-pending state. |

The MAME Lua taps can report even bus addresses for byte handlers. The
TypeScript input replay layer canonicalizes those reads to the low-byte
addresses above.

## Coin Inputs

Coin/service inputs live on the 6502 sound side at `0x1820`. The default browser
boot flow routes coin insertion through the same high-level input flow used by
the game, while oracle captures can expose the sound-CPU read stream separately.

## Manual Capture

For hard-to-reach browser bugs, record an input movie in MAME first, then replay
it through the existing Lua capture scripts. The generated JSON should stay in
`oracle/scenarios/` only when it is a deliberate fixture; scratch captures belong
under `/tmp/marble-love/<task>/`.

Detailed historical capture notes remain in
`docs/internal/technical/input-mmio-map.md`.
