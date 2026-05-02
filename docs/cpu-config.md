# CPU Config — Marble Madness

> **Status:** SKELETON. Phase 1 deliverable.

## CPU principale: Motorola 68010

| Parametro | Valore | Fonte |
|-----------|--------|-------|
| Clock | 7.159 MHz (1/2 master clock NTSC) | TBD da MAME |
| Bus dati | 16 bit | datasheet 68010 |
| Bus indirizzi | 24 bit | datasheet 68010 |
| Endianness | Big-endian | datasheet 68010 |

### Differenze chiave 68010 vs 68000 (importanti per replica)

- VBR (Vector Base Register): redirige la vector table
- MOVE from SR è privilegiata (era utente sul 68000)
- Loop mode su DBcc (ottimizzazione, irrilevante per parità)
- RTE con stack frame esteso

### Vector table layout

Vedi `hardware-map.md`. PC reset a vector 1, SSP a vector 0.

### IRQ sources

| Level | Source | Frequenza |
|-------|--------|-----------|
| TBD   | Vsync  | 60 Hz NTSC |
| TBD   | Scanline | TBD |
| TBD   | Sound 6502 | on-demand |

## CPU sound: MOS 6502

| Parametro | Valore | Fonte |
|-----------|--------|-------|
| Clock | TBD (~1.789 MHz?) | MAME atarisy1.cpp |
| Variante | NMOS 6502 standard | TBD |

## Audio chips

| Chip | Funzione |
|------|----------|
| POKEY | Effetti / noise |
| YM2151 | Musica |
| TMS5220 | Speech (se presente — Marble Madness ha la voce) |

PRD §10: chip-perfect emulation rimandata a V2. V1: stub silenzioso o sample
synthesis basic via Web Audio API.
