# ROM Layout — Marble Madness

> **Status:** ✅ Phase 1.
> **MAME ref:** `atarisy1.cpp:1003-1046` `ROM_START(marble)`, `:945-973` macro motherboard.

## Versioni di Marble Madness

`atarisy1.cpp:2671-2675` definisce 5 set:

| `gh` rom name | Cartridge | Note |
|---------------|-----------|------|
| `marble`      | TTL set 1 | **Target Marble Love** ✓ (default in `atarisy1.cpp:2671`) |
| `marble2`     | TTL set 2 | Versione con .401-.404 (program ROMs raggruppate in 32KB chunk) |
| `marble3`     | TTL set 3 | Mix .201/.202/.403/.204 |
| `marble4`     | TTL set 4 | .323/.324/.225-.230 |
| `marble5`     | LSI set   | LSI cartridge, .201-.204 (più moderno hardware) |

**Per Marble Love target esclusivamente `marble` (set 1).** Le altre varianti possono essere supportate in futuro come V2.

## File ROM richiesti per `marble.zip`

### CPU 68010 program (`maincpu` region, 0x88000 byte)

#### Motherboard BIOS (16 KB, even+odd interleaved a 0x00000-0x07FFF)

`atarisy1.cpp:951-960` definisce 3 sub-BIOS, default `ttl` Rev 2:

| File              | Offset | Length | CRC32      | SHA1 |
|-------------------|--------|--------|------------|------|
| `136032.205.l13`  | 0x00000 | 0x4000 | `88d0be26` | `d124045eccc562ff0423b23a240e27ad740fa0c9` |
| `136032.206.l12`  | 0x00001 | 0x4000 | `3c79ef05` | `20fdca7131478e1ee12691bdafd2d5bb74cbd16f` |

Sub-BIOS alternativi (TTL Rev 1 e LSI) vedi `atarisy1.cpp:955-960` — `marble.zip` standard MAME usa `ttl` (Rev 2) di default.

#### Cartridge program (Marble-specific, 80 KB a 0x10000-0x2FFFF + 32 KB slapstic a 0x80000-0x87FFF)

| File              | Offset  | Length | CRC32      | SHA1 |
|-------------------|---------|--------|------------|------|
| `136033.623`      | 0x10000 | 0x4000 | `284ed2e9` | `a24d2fd587dffcc8536ef28fcbcf5c964a6b67a9` |
| `136033.624`      | 0x10001 | 0x4000 | `d541b021` | `978b1565da746f7389eaf7646604990fb28d47ed` |
| `136033.625`      | 0x18000 | 0x4000 | `563755c7` | `a444b72ff4cdecee3b9dd7e636d658c31ecc186c` |
| `136033.626`      | 0x18001 | 0x4000 | `860feeb3` | `d6059c1fe13f28ada27f6586215a16e2117e3ecd` |
| `136033.627`      | 0x20000 | 0x4000 | `d1dbd439` | `cefc0fa9c71512c961272fcf0f9c069f1396468e` |
| `136033.628`      | 0x20001 | 0x4000 | `957d6801` | `b007d9e45a1442ab1c9ec1463f9f46ea85fb0659` |
| `136033.229`      | 0x28000 | 0x4000 | `c81d5c14` | `0464ea183685de83e797b9d946b4acc409f4c451` |
| `136033.630`      | 0x28001 | 0x4000 | `687a09f7` | `95e31acf29cd8d51beefa9b0e4acd92b81980c2f` |
| `136033.107`      | 0x80000 | 0x4000 | `f3b8745b` | `4754eac5e6d8547b3ee00f3f48eaa560eb403862` |
| `136033.108`      | 0x80001 | 0x4000 | `e51eecaa` | `37d51a9e9cb33d1156d02a312ac8e202a18d7c20` |

I file `.107`/`.108` (slapstic-protected ROM) sono comuni a tutti i set di Marble Madness.

### CPU 6502 sound (`audiocpu` region, 0x10000 byte)

| File              | Offset  | Length | CRC32      | SHA1 |
|-------------------|---------|--------|------------|------|
| `136033.421`      | 0x8000  | 0x4000 | `78153dc3` | `d4e68226b87df8834dc3d6daa9d683f17896c32e` |
| `136033.422`      | 0xc000  | 0x4000 | `2e66300e` | `49acb9443c5d2c1016cde7f489deab2575dd82ca` |

### Alphanumerics tiles (`alpha` region, 0x2000 byte)

`atarisy1.cpp:962-965` (motherboard BIOS, condiviso):

| File              | Offset | Length | CRC32      | SHA1 |
|-------------------|--------|--------|------------|------|
| `136032.104.f5`   | 0x0000 | 0x2000 | `7a29dc07` | `72ba464da01bd6d3a91b8d9997d5ac14b6f47aad` |

### Tile graphics (`tiles` region, 0x100000 byte, ROMREGION_INVERT | ROMREGION_ERASEFF)

| File              | Offset  | Length | CRC32      | Note |
|-------------------|---------|--------|------------|------|
| `136033.137`      | 0x00000 | 0x4000 | `7a45f5c1` | bank 1, plane 0 (low half) |
| `136033.138`      | 0x04000 | 0x4000 | `7e954a88` | bank 1, plane 0 (high half) |
| `136033.139`      | 0x10000 | 0x4000 | `1eb1bb5f` | bank 1, plane 1 (low) |
| `136033.140`      | 0x14000 | 0x4000 | `8a82467b` | bank 1, plane 1 (high) |
| `136033.141`      | 0x20000 | 0x4000 | `52448965` | bank 1, plane 2 (low) |
| `136033.142`      | 0x24000 | 0x4000 | `b4a70e4f` | bank 1, plane 2 (high) |
| `136033.143`      | 0x30000 | 0x4000 | `7156e449` | bank 1, plane 3 (low) |
| `136033.144`      | 0x34000 | 0x4000 | `4c3e4c79` | bank 1, plane 3 (high) |
| `136033.145`      | 0x40000 | 0x4000 | `9062be7f` | bank 1, plane 4 (low) |
| `136033.146`      | 0x44000 | 0x4000 | `14566dca` | bank 1, plane 4 (high) |
| `136033.149`      | 0x84000 | 0x4000 | `b6658f06` | bank 2, plane 0 |
| `136033.151`      | 0x94000 | 0x4000 | `84ee1c80` | bank 2, plane 1 |
| `136033.153`      | 0xa4000 | 0x4000 | `daa02926` | bank 2, plane 2 |

Marble Madness usa: bank 1 con 5 piani (32 colori), bank 2 con 3 piani (8 colori).

### PROMs grafici (`proms` region, 0x400 byte)

`atarisy1.cpp:1040-1045`:

| File              | Offset | Length | CRC32      | Note |
|-------------------|--------|--------|------------|------|
| `136033.118`      | 0x000  | 0x200  | `2101b0ed` | tile remap PROM |
| `136033.119`      | 0x200  | 0x200  | `19f6e767` | tile color PROM |

### Motherboard PROMs (`motherbrd_proms` region, 0x201 byte)

`atarisy1.cpp:967-973` (solo TTL motherboard):

| File              | Length | CRC32      | Note |
|-------------------|--------|------------|------|
| `136032.101.e3`   | 0x100  | `7e84972a` | (TTL) |
| `136032.102.e5`   | 0x100  | `ebf1e0ae` | (TTL) |
| `136032.103.f7`   | 0xeb   | `92d6a0b4` | N82S153 (TTL) |

## Interleaving even/odd (68010, bus 16-bit)

Il bus dati del 68010 è 16 bit, ma le ROM sono dumpate come 8-bit chip. Per blob unico big-endian:

```
out[2*i + 0] = even_rom[i]   (byte hi del word)
out[2*i + 1] = odd_rom[i]    (byte lo del word)
```

Ogni macro `ROM_LOAD16_BYTE` ha `offset` even/odd (`offset` pari = even, `offset` dispari = odd). Esempio per Marble:

- `136033.623` @ 0x10000 (offset even) — byte hi
- `136033.624` @ 0x10001 (offset odd)  — byte lo
- → al run-time MAME interleava i due in `maincpu` region a `0x10000-0x17FFF`

`tools/rom_prep.py` automatizza questo per Ghidra (vedi `DEFAULT_PAIRS` in `tools/rom_prep.py`).

## Hash di verifica

Il differential harness deve **rifiutarsi di girare** se gli hash della ROM fornita dall'utente non combaciano. Phase 3 acceptance.

CRC32 dei singoli file sopra. SHA1 sopra. Per il blob interleaved, calcolare CRC32 dopo prep:
```bash
python3 tools/rom_prep.py --rom-zip roms/marble.zip --out /tmp/m.bin
crc32 /tmp/m.bin   # deve essere stabile
```

## Slapstic 103 (chip protezione)

I file `136033.107` + `136033.108` (slapstic-protected ROM, 32 KB interleaved a `0x80000`) sono accessibili dal 68010 solo attraverso lo state machine dello slapstic 103. Vedi `mame/src/mame/atari/slapstic.cpp` per l'algoritmo.

🚨 Phase 2 dependency: per il reimpl bit-perfect serve replicare lo state machine dello slapstic 103.

## Variant note

I file `136033.107`/`136033.108` (slapstic ROM) sono **identici** in `marble`, `marble2`, `marble3`, `marble4`, `marble5`. Le differenze tra set sono solo nei file di program ROM cartridge (`.6xx`/`.4xx`/`.2xx`/`.3xx`).
