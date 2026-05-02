# Sound System — comunicazione 68010 ↔ 6502

> **Status:** SKELETON. Phase 1 deliverable.

## Modello

Il 68010 (main) e il 6502 (sound) condividono una **shared memory mailbox** di
1-2 byte. Schema tipico:

- 68010 scrive un comando (1 byte) → genera IRQ al 6502
- 6502 legge il comando, esegue (POKEY/YM2151), scrive ack → genera IRQ al 68010
- Latenza: pochi tick

## Indirizzi MMIO

| Address (68010) | RW | Funzione |
|-----------------|----|----------|
| TBD             | W  | sound command |
| TBD             | R  | sound ack/status |

| Address (6502)  | RW | Funzione |
|-----------------|----|----------|
| TBD             | R  | command from main |
| TBD             | W  | ack to main |

## Lookup: comandi sound

| Comando (hex) | Effetto |
|---------------|---------|
| TBD           | TBD     |

Phase 4-5: catalogarli osservando le scritture del 68010 alla mailbox durante
gli scenari del curriculum (`level1_no_input`, ecc.).

## V1 implementation strategy

In `packages/engine/src/audio.ts`:
- Tracciare ogni write alla mailbox (per il diff vs MAME)
- Mappare i comandi noti a `AudioEvent` astratti
- `packages/web/src/` traduce `AudioEvent` in Web Audio API basic synth

V2: emulazione chip-perfect POKEY/YM2151. Vedi PRD §10 (rischio basso).
