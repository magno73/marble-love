# Hardware Map — Atari System 1 / Marble Madness

> **Status:** SKELETON. Phase 1 deliverable. Da riempire leggendo
> `mame/src/mame/atari/atarisy1.cpp` (e header inclusi).

## Memory map del 68010

| Range (hex)             | Region           | RW | Note |
|-------------------------|------------------|----|------|
| `000000–07FFFF`?        | ROM program      | R  | Even/odd interleaved. TBD size esatta. |
| `800000–80xxxx`?        | Work RAM         | RW | TBD: 16K? 32K? Vedi `RAM_REGION` in atarisys1.cpp |
| `900000–...`?           | Sprite/Motion-Object RAM | RW | System 1 motion object hardware |
| `A00000–...`?           | Color RAM (palette) | RW | xRGB444 o simile, da confermare |
| `B00000–...`?           | MMIO             | RW | Input, sound mailbox, video control |

**TODO Phase 1:**
- [ ] Compilare la tabella esatta da `atarisys1.cpp` `address_map_constructor`
- [ ] Annotare ogni MMIO con la sua funzione (input port 1, sound write, ecc.)
- [ ] Verificare alpha layer separato (System 1 ha alpha overlay)

## Vector table del 68010

Da estrarre dai primi 0x400 byte della ROM program (interleaved).

| Vector | Offset | Significato |
|--------|--------|-------------|
| 0      | 0x000  | SSP (Supervisor Stack Pointer) iniziale |
| 1      | 0x004  | Reset PC |
| ...    | ...    | ... |

## Sound CPU 6502

- Clock: TBD (probabilmente 1.789 MHz)
- ROM: separata
- Comunicazione 68010 ↔ 6502: mailbox (vedi `docs/sound-system.md`)

## Video chip

- Tile size: 8×8 (tipico Atari System 1)
- Sprite (motion object) format: TBD
- Palette: TBD bit per pixel
- Resolution: 336×240 (System 1 standard, da verificare)

## Refresh / IRQ

- Vsync IRQ: 60 Hz (NTSC)
- Scanline IRQ: TBD (System 1 supporta interrupt per scanline)

## Riferimenti

- `mame/src/mame/atari/atarisy1.cpp`
- `mame/src/mame/atari/atarisy1.h`
- Atari System 1 hardware overview: cercare su `system16.com/marblemadness.html`

---

## Come usare questo file

Quando il differential harness diverge su un MMIO o RAM region, **questa è la
prima reference**. Se dice "TBD" → vai a riempirlo da MAME source prima di
implementare il fix.
