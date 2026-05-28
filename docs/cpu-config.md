# CPU Config - Marble Madness

> **Status:** Phase 1.
> **MAME ref:** `atarisy1.cpp:769-831` (`atarisy1` machine config) and
> `atarisy1.cpp:833-839` (`marble` overlay).

## Master Oscillator

The master XTAL is **14.318181 MHz** (4 x NTSC color subcarrier
3.579545 MHz). All derived clocks use integer dividers of this oscillator.
See `atarisy1.cpp:769-829` for the `14.318181_MHz_XTAL` uses.

## Main CPU: Motorola 68010

| Parameter | Value | Source |
| --- | --- | --- |
| Model | M68010 | `atarisy1.cpp:198` `#include "cpu/m68000/m68010.h"`, `atarisy1.cpp:772` `M68010(config, m_maincpu, ...)` |
| Clock | **7.159090 MHz** (= 14.318181/2) | `atarisy1.cpp:772` |
| Data bus | 16 bit | 68010 datasheet |
| Address bus | 24 bit | 68010 datasheet |
| Endianness | Big-endian | 68010 datasheet |

### 68010 Differences That Matter

- **VBR** (Vector Base Register, A7): the vector table is relocatable. The
  reset PC is always vector 1 of the active VBR; after reset, VBR is 0.
- **MOVE from SR** is privileged. It was user-mode on the 68000, but Atari
  System 1 runs the 68010 in supervisor mode, so the difference is usually
  invisible here.
- **DBcc loop mode** is a hardware optimization for tight loops. It matters for
  cycle timing, not for final state parity.
- **RTE extended stack frames**: after an exception, the 68010 places a frame
  format word on the stack. RTE inspects it while restoring state.

### Vector Table

The first 256 long-words (1 KB) are the vector table. Extract them from the
first `0x400` bytes of the interleaved program ROM. Key System 1 vectors:

| Vector | Offset | Meaning |
| --- | --- | --- |
| 0 | `0x000` | Initial SSP (Supervisor Stack Pointer) |
| 1 | `0x004` | Reset PC |
| 25 | `0x064` | IRQ Level 1 autovector, unused by System 1 |
| 26 | `0x068` | IRQ Level 2 joystick interrupt for ADC games |
| 27 | `0x06C` | IRQ Level 3 motion-object timer |
| 28 | `0x070` | IRQ Level 4 VBLANK |
| 30 | `0x078` | IRQ Level 6 sound CPU communications |
| 31 | `0x07C` | IRQ Level 7, unused |

See `atarisy1.cpp:138-143` for the interrupt map comments and
`atarisy1.cpp:751,811,821` for the corresponding input-line wiring.

### 68010 IRQ Sources

| Level | Source | Asserted by | Cleared by |
| --- | --- | --- | --- |
| 2 | Joystick ADC0809 EOC | `m_ajsint` input merger, `atarisy1.cpp:751`. Marble does not use ADC. | ADC write that re-arms `m_ajsint` |
| 3 | Motion-object timer | `int3_callback`, `atarisy1_v.cpp:370`. Only `atarisy1r_state`; Marble uses base `atarisy1_state`, where `update_timers` is a no-op. | `int3off_callback`, `atarisy1_v.cpp:362` |
| 4 | VBLANK | `m_screen->screen_vblank()` assert, `atarisy1.cpp:811` | `video_int_ack_w` write to `$8A0001`, `atarisy1.cpp:215` |
| 6 | Sound CPU communications | `m_mainlatch->data_pending_callback`, `atarisy1.cpp:821`, when the 6502 writes `$1810` | Read from `$FC0001` clears gen-latch pending |

For Marble Madness, the active 68010 IRQ sources are Level 4 (VBLANK) and
Level 6 (sound). IRQ2 and IRQ3 do not fire.

### Reset And Init

- `machine_reset()` in `atarisy1.cpp:226-232` calls `bankselect_w(0)`, clearing
  the bank and audio-control flags.
- `init_marble()` in `atarisy1.cpp:2617-2622` calls `init_slapstic()` and sets
  `m_trackball_type = 1`.
- The initial PC is the long-word at offset `0x004` in the motherboard BIOS
  (`136032.205.l13` + `136032.206.l12`, interleaved for TTL Rev 2).

## Sound CPU: MOS 6502

| Parameter | Value | Source |
| --- | --- | --- |
| Model | MOS 6502 (NMOS standard) | `atarisy1.cpp:199` `#include "cpu/m6502/m6502.h"`, `atarisy1.cpp:775` |
| Clock | **1.789773 MHz** (= 14.318181/8) | `atarisy1.cpp:775` |
| RAM | 4 KB at `$0000-$0FFF`, mirrored at `0x2000` | `atarisy1.cpp:445` |
| ROM | 48 KB at `$4000-$FFFF`; Marble uses 16 KB at `$8000-$FFFF` | `atarisy1.cpp:452` |

### 6502 IRQ Sources

| Line | Source |
| --- | --- |
| IRQ | YM2151 IRQ output, `atarisy1.cpp:824` |
| NMI | `m_soundlatch->data_pending_callback`, `atarisy1.cpp:817`, when the 68010 writes `$FE0001` |

## Audio Chips

| Chip | Clock | Source |
| --- | --- | --- |
| YM2151 music | 14.318181/4 = **3.579545 MHz** | `atarisy1.cpp:823` |
| POKEY effects | 14.318181/8 = **1.789773 MHz** | `atarisy1.cpp:828` |
| TMS5220C speech | 14.318181/2/11 ~= **651.7 kHz** | `atarisy1.cpp:758`. Marble does not call `add_speech`. |
| MOS 6522 VIA | 14.318181/8 = **1.789773 MHz** | `atarisy1.cpp:762`. Only used by `sound_ext_map`; Marble uses `sound_map`. |
| ADC0809 | 14.318181/16 = **894.886 kHz** | `atarisy1.cpp:739`. Not used by Marble. |

## Watchdog

- 8 vblanks, about 133 ms, trigger reset
  (`atarisy1.cpp:787` `WATCHDOG_TIMER(...).set_vblank_count(m_screen, 8)`).
- A strobe to `$880001` resets the watchdog.
- A bit-faithful runner must model watchdog writes; otherwise the original
  program can enter a reset loop.

## Game Identification

The motherboard BIOS reads byte `$01006E` to identify the inserted cartridge.
Values from `atarisy1.cpp:174-191`:

| Cartridge | Value at `$01006E` |
| --- | --- |
| Diagnostic | 255 |
| Peter Packrat | 000 |
| **Marble Madness** | **001** |
| Indy Temple | 002 |
| Road Runner | 003 |
| Reliefs/Off-Road | 004 |
| RoadBlasters | 005 |
