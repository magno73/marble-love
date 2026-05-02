# ROM Layout — Marble Madness

> **Status:** SKELETON. Phase 1 deliverable.

## File ROM (formato MAME `marble.zip`)

Lista esatta dei file e loro scopo va estratta da `mame/src/mame/atari/atarisy1.cpp`
nella macro `ROM_START(marble)`. Tipicamente:

| File | Bus | Region | Note |
|------|-----|--------|------|
| `136033.xxx` | 68010 even | program (hi byte) | da interleavare con odd |
| `136033.xxy` | 68010 odd  | program (lo byte) | |
| `136033.xxz` | 6502       | sound program | non interleaved |
| `136033.xxa` | tile gfx   | playfield tiles | |
| `136033.xxb` | sprite gfx | motion objects | |
| `136033.xxc` | proms      | color/timing | |

Comando per ispezionare:

```bash
python3 tools/rom_prep.py --list --rom-zip roms/marble.zip
```

## Interleaving even/odd (68010)

Il bus dati del 68010 è 16 bit. Ogni word è composta da:
- byte even = bit 15..8 (hi)
- byte odd  = bit 7..0  (lo)

Le ROM sono dumpate come due chip 8-bit separati. Per Ghidra/static analysis
serve un blob unico interleaved big-endian:

```
out[2i]   = even[i]
out[2i+1] = odd[i]
```

`tools/rom_prep.py` fa questo. Output: `ghidra_project/marble_program.bin`.

## Hash di verifica

Da Phase 1, riempire con i CRC32/SHA1 esatti dalle macro `ROM_LOAD16_BYTE` di MAME:

| File | CRC32 | SHA1 |
|------|-------|------|
| `136033.xxx` | TBD | TBD |
| ...          | ... | ... |

Il differential harness deve **rifiutarsi di girare** se gli hash della ROM
fornita dall'utente non combaciano. Phase 3 acceptance.

## Variant

`atarisys1.cpp` definisce probabilmente:
- `marble`   — versione retail
- `marble2`, `marble3` — revision o region (Europe/Japan)

Marble Love target: **`marble`** (retail USA). Le altre varianti sono future.
