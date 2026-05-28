# ROM Layout

Marble Love targets the MAME `marble` set, also known as Marble Madness set 1 on
Atari System 1. Other Marble Madness ROM sets exist in MAME, but they are not the
default compatibility target for this repository.

The browser loader expects user-supplied ZIP files. ROM bytes are read locally
in the browser and are not uploaded by the application.

## Required ZIP Files

- `marble.zip`: Marble Madness game ROMs.
- `atarisy1.zip`: shared Atari System 1 motherboard ROMs and PROMs used by the
  MAME set.

Place them at:

```text
packages/web/public/roms/marble.zip
packages/web/public/roms/atarisy1.zip
```

## Main Regions

| Region | Contents | Notes |
| --- | --- | --- |
| `maincpu` | 68010 program ROM | 16-bit big-endian bus, assembled from even/odd 8-bit ROM chips. |
| `audiocpu` | 6502 sound program ROM | Provides the original sound driver used by the YM2151 and POKEY path. |
| `alpha` | Alphanumerics/HUD graphics | Shared System 1 motherboard tile ROM. |
| `tiles` | Playfield and motion-object graphics | Planar graphics data decoded in memory by the web renderer. |
| `proms` | Marble graphics lookup PROMs | Used for tile remap/color lookup behavior. |
| `motherbrd_proms` | System 1 motherboard PROMs | Shared board-level PROM data. |

## 68010 Interleaving

Atari System 1 stores the 68010 program as paired 8-bit ROM chips. MAME's
`ROM_LOAD16_BYTE` entries load even offsets as the high byte and odd offsets as
the low byte:

```text
word[15:8] = even_rom[i]
word[7:0]  = odd_rom[i]
```

Local ROM-prep tooling and the browser loader preserve that layout before any
Ghidra analysis or runtime comparison is performed.

## Validation

The loader validates expected file names, lengths, and CRC32 values before using
the ROM data. SHA1 values and exact MAME source references are kept in the
internal technical history at `docs/internal/technical/rom-layout.md`.

No ROM files, extracted graphics, extracted audio, or ROM-derived assets are
tracked in this repository.
