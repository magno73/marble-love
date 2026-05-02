# Prompt — Phase 1: studio driver MAME atarisys1

**Per Claude Code (autonomo, supervisionato).**

## Contesto

Stai lavorando su Marble Love (vedi `marble-love-prd-v0.2.md`). Phase 0 ha creato lo scaffold. Ora serve documentazione completa di come MAME emula Atari System 1 / Marble Madness, perché senza questo non si può scrivere il bus né il dispatch MMIO del reimpl.

## Input

- `mame/src/mame/atari/atarisy1.cpp` (clona MAME read-only o leggi via web fetch)
- Header inclusi (`atarisy1.h`, file di motion-object/playfield helpers)
- `marble-love-prd-v0.2.md` per allineamento sul cosa serve

## Output (riempire i SKELETON in `docs/`)

- [ ] `docs/hardware-map.md`: memory map COMPLETA con range esatti
- [ ] `docs/cpu-config.md`: clock 68010 + 6502, vector table, IRQ sources
- [ ] `docs/sound-system.md`: indirizzi mailbox 68010 ↔ 6502
- [ ] `docs/video-system.md`: tile/sprite/palette/scrolling specs
- [ ] `docs/rom-layout.md`: tabella file marble.zip con CRC32 esatti

## Vincoli

- NON copiare codice MAME (è GPL, noi MIT). Leggere e parafrasare.
- Citare sempre `atarisys1.cpp:NNN` quando si afferma un valore.
- Se un valore è ambiguo (es. "TBD da datasheet"), lasciarlo TBD ma escalation in `STATUS.md`.

## Test di accettazione

Apri un MMIO a caso del 68010 in MAME (es. `move.w $b00006, d0`). Devi poter dire:
1. Cos'è quell'indirizzo (input port? sound? video reg?)
2. In che bit è codificato cosa
**senza** riaprire il source MAME.

## Side effects

- Aggiorna `STATUS.md`: spunta i checkbox di Phase 1, marca Phase 1 come ✅
- Commit: `phase-1: mame driver hardware map`
- Non aprire ancora la Phase 2 senza approvazione manuale (Ghidra va installato a parte).
