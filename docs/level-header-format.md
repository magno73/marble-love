# Level Header Format

Marble Madness stores each level descriptor in ROM and reaches it through a
six-entry pointer table. Marble Love decodes the fields that are exercised by
the current TypeScript engine and parity tests.

## Scope

This public note gives the stable shape of the descriptor. Full field evidence,
MAME tap details, overlap notes, and post-header tables are kept in
`docs/internal/technical/level-header-format.md`.

## Stable Constants

| Constant | Value | Meaning |
| --- | ---: | --- |
| `LEVEL_POINTER_TABLE_OFFSET` | `0x2be00` | ROM pointer table for the six level descriptors. |
| `LEVEL_COUNT` | `6` | Number of Marble Madness levels. |
| `LEVEL_HEADER_SIZE` | `0x2e` | Fixed descriptor header size. |
| `HEIGHT_RECORD_SIZE` | `8` | Legacy parser stride retained for compatibility views. |

## Descriptor Shape

The fixed header is followed by several different tables rather than a single
uniform geometry record:

- terrain row pointer table;
- sub-pattern pointer table;
- tile-line descriptor table;
- row-build script;
- RLE row-offset data.

The old `HeightRecord` name in some code is a compatibility artifact. The
verified format is consumer-backed: field names should be tied to the routines
that read them rather than inferred from visual terrain alone.

## Important Fields

| Offset | Meaning |
| --- | --- |
| `+0x00` | direct terrain record base pointer |
| `+0x04` | tile-word table pointer |
| `+0x08` | row-build bit-list pointer |
| `+0x0c` | RLE-compressed scroll-row source pointer |
| `+0x10` | Y scroll base |
| `+0x12` | Y scroll range / aerial delta |
| `+0x14..+0x16` | player initial packed positions in natural paths |
| `+0x18` | max tile bound |
| `+0x1a` | row-build entry count |
| `+0x1c` | tile-line descriptor table pointer |
| `+0x20` | sub-pattern pointer table |
| `+0x24` | binary-search end index |
| `+0x26` | binary-search base pointer |
| `+0x2a` | extra-byte table pointer |

The original code reuses part of the header for multiple consumers. Do not
"simplify" those overlaps unless a MAME/Ghidra-backed test proves the new
interpretation.
