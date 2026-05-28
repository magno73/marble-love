# Hardware Map

Marble Madness runs on Atari System 1 hardware. Marble Love models only the
parts needed by the TypeScript reimplementation, browser renderer, audio path,
and oracle comparisons.

## Main CPU

- Motorola 68010, 16-bit big-endian data bus.
- Program ROM and slapstic-protected cartridge ROM.
- Work RAM at `0x400000..0x401fff`.
- Cartridge external RAM/ROM window at `0x900000..0x9fffff`.
- Playfield, motion-object, alphanumerics, and palette RAM in the `0xa00000`
  and `0xb00000` ranges.
- Trackball and switch input MMIO near `0xf20000` and `0xf60000`.
- Sound command write at `0xfe0001`; sound response read at `0xfc0001`.

## Sound CPU

- 6502A.
- RAM at `0x0000..0x0fff`.
- YM2151 at `0x1800..0x1801`.
- Main/sound command latch at `0x1810`.
- Coin/status input at `0x1820`.
- POKEY at `0x1870..0x187f`.
- Program ROM from the Marble sound ROMs in the `0x8000` and `0xc000` ranges.

## Video Hardware

- Visible screen: 336 x 240.
- Refresh: approximately 59.92 Hz.
- Draw layers: playfield, motion objects, then alphanumerics/HUD.
- Palette format: IRGB 4-4-4-4.
- Motion-object RAM is banked through the audio/video control register.

## Inputs

Marble Madness uses a rotated trackball path in MAME. The hardware combines raw
trackball axes into the values read by the 68010. Coin inputs are read by the
6502 sound CPU rather than directly by the main 68010.

## References

This public summary is intentionally short. Detailed address tables, source-line
citations, and historical notes are kept in:

- `docs/internal/technical/hardware-map.md`
- `docs/input-mmio-map.md`
- `docs/video-system.md`
- `docs/sound-system.md`
