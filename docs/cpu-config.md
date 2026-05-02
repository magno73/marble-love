# CPU Config — Marble Madness

> **Status:** ✅ Phase 1.
> **MAME ref:** `atarisy1.cpp:769-831` (`atarisy1` machine config) + `atarisy1.cpp:833-839` (`marble` overlay).

## Master oscillator

Master XTAL: **14.318181 MHz** (4 × NTSC color subcarrier 3.579545 MHz). Tutti i clock derivati da divider integer di questo XTAL. Cita `atarisy1.cpp:769-829` (tutte le occorrenze di `14.318181_MHz_XTAL`).

## CPU principale: Motorola 68010

| Parametro | Valore | Fonte |
|-----------|--------|-------|
| Modello | M68010 | `atarisy1.cpp:198` `#include "cpu/m68000/m68010.h"`, `atarisy1.cpp:772` `M68010(config, m_maincpu, ...)` |
| Clock | **7.159090 MHz** (= 14.318181/2) | `atarisy1.cpp:772` |
| Bus dati | 16 bit | datasheet 68010 |
| Bus indirizzi | 24 bit | datasheet 68010 |
| Endianness | Big-endian | datasheet 68010 |

### Differenze 68010 vs 68000 importanti per il reimpl

- **VBR** (Vector Base Register, A7): vector table redirezionabile. Il reset PC sta sempre al vector 1 della VBR corrente; quando reset il VBR è a 0.
- **MOVE from SR** è privilegiata (era utente sul 68000) — il 68010 di Atari System 1 gira in supervisor mode, quindi questa differenza è di solito invisibile.
- **Loop mode su DBcc**: ottimizzazione hardware che velocizza loop stretti. Irrilevante per parità di stato (i tick CPU sono accelerati ma il risultato è identico).
- **RTE con stack frame esteso**: dopo un'eccezione, il 68010 mette uno *frame format word* in cima allo stack, RTE lo ispeziona per sapere come restorare. Da rispettare nella replica del exception handling.

### Vector table (layout standard 68000/68010)

I primi 256 long-word (1 KB) sono la vector table. Da estrarre dai primi 0x400 byte del program ROM (interleaved). Vector chiave per System 1:

| Vector | Offset | Significato |
|--------|--------|-------------|
| 0      | `0x000` | SSP iniziale (Supervisor Stack Pointer) |
| 1      | `0x004` | Reset PC |
| 25     | `0x064` | **IRQ Level 1** (autovector, non usato da System 1) |
| 26     | `0x068` | **IRQ Level 2** = joystick interrupt (solo per giochi con ADC) |
| 27     | `0x06C` | **IRQ Level 3** = sprite-based (motion object timer) |
| 28     | `0x070` | **IRQ Level 4** = VBLANK |
| 30     | `0x078` | **IRQ Level 6** = sound CPU comms |
| 31     | `0x07C` | **IRQ Level 7** (non usato) |

Cita `atarisy1.cpp:138-143` per la mappa interrupt commentata e `atarisy1.cpp:751,811,821` per le set_inputline corrispondenti.

### IRQ sources del 68010

| Level | Source                          | Asserta da | Cleara da |
|-------|---------------------------------|------------|-----------|
| 2     | Joystick (ADC0809 EOC)          | `m_ajsint` (input_merger) `atarisy1.cpp:751`. **Marble: NON usato** (no ADC). | scrittura ADC che ri-arma `m_ajsint` |
| 3     | Sprite-based (MO timer)         | `int3_callback` `atarisy1_v.cpp:370`. Solo classe `atarisy1r_state` (LSI cart 2/3/4 + cockpit). **Marble: NO** (usa base `atarisy1_state`, `update_timers` è no-op). | `int3off_callback` `atarisy1_v.cpp:362` (1 scan_period dopo) |
| 4     | VBLANK                          | `m_screen->screen_vblank()` ASSERT `atarisy1.cpp:811` | `video_int_ack_w` `atarisy1.cpp:215` (write a `$8A0001`) |
| 6     | Sound CPU comms                 | `m_mainlatch->data_pending_callback` `atarisy1.cpp:821` (quando il 6502 scrive a `$1810`) | lettura `$FC0001` (gen_latch read clears pending) |

🚨 **Per Marble Madness, gli unici IRQ attivi sul 68010 sono Level 4 (VBLANK) e Level 6 (sound).** IRQ2 e IRQ3 non si attivano mai.

### Reset & init

- `machine_reset()` `atarisy1.cpp:226-232` chiama `bankselect_w(0)` (clear di tutti i flag di bank/audio control).
- `init_marble()` `atarisy1.cpp:2617-2622` chiama `init_slapstic()` (configura 4 banchi a `0x80000` step `0x2000`) e setta `m_trackball_type = 1`.
- Il PC iniziale è il long-word a offset `0x004` della BIOS della motherboard (`136032.205.l13` + `136032.206.l12` interleaved per la TTL Rev 2).

## CPU sound: MOS 6502

| Parametro | Valore | Fonte |
|-----------|--------|-------|
| Modello | MOS 6502 (NMOS standard) | `atarisy1.cpp:199` `#include "cpu/m6502/m6502.h"`, `atarisy1.cpp:775` |
| Clock | **1.789773 MHz** (= 14.318181/8) | `atarisy1.cpp:775` |
| RAM | 4 KB @ `$0000-$0FFF` (mirror `0x2000`) | `atarisy1.cpp:445` |
| ROM | 48 KB @ `$4000-$FFFF` (per marble: 16 KB @ `$8000-$FFFF`) | `atarisy1.cpp:452` |

### IRQ sources del 6502

| Linea | Source                          |
|-------|---------------------------------|
| IRQ   | YM2151 IRQ output `atarisy1.cpp:824` |
| NMI   | `m_soundlatch->data_pending_callback` `atarisy1.cpp:817` (quando il 68010 scrive a `$FE0001`) |

## Audio chips (V1: stub silenzioso, V2: chip-perfect)

| Chip | Clock | Fonte |
|------|-------|-------|
| YM2151 (musica) | 14.318181/4 = **3.579545 MHz** | `atarisy1.cpp:823` |
| POKEY (effetti) | 14.318181/8 = **1.789773 MHz** | `atarisy1.cpp:828` |
| TMS5220C (speech) | 14.318181/2/11 ≈ **651.7 kHz** (variabile) | `atarisy1.cpp:758`. **Solo per Indy Temple/Roadrunner/RoadBlasters/Reliefs1, NON per marble** (non chiama `add_speech`). |
| MOS 6522 VIA | 14.318181/8 = **1.789773 MHz** | `atarisy1.cpp:762`. Anche questa solo se `sound_ext_map` (Marble usa `sound_map`, no VIA). |
| ADC0809 | 14.318181/16 = **894.886 kHz** | `atarisy1.cpp:739`. Non usata da Marble. |

PRD §10: chip-perfect emulation rimandata a V2. V1: stub silenzioso o sample synthesis basic via Web Audio API.

## Watchdog

- 8 vblanks (= ~133 ms) di inattività → reset (`atarisy1.cpp:787` `WATCHDOG_TIMER(...).set_vblank_count(m_screen, 8)`).
- Strobe a `$880001` resetta il watchdog. Il main loop del 68010 deve fare il poke regolarmente.
- Per il reimpl bit-perfect questo è importante: se il marble-runner non emula i write watchdog, il binario originale potrebbe entrare in reset loop.

## Identificazione gioco (motherboard probe)

Il main BIOS (motherboard) legge il byte a `$01006E` per riconoscere quale cartridge è inserita. Valori da `atarisy1.cpp:174-191`:

| Cartridge       | Valore a `$01006E` |
|-----------------|--------------------|
| Diagnostic      | 255 |
| Peter Packrat   | 000 |
| **Marble Madness** | **001** ✓ |
| Indy Temple     | 002 |
| Road Runner     | 003 |
| Reliefs/Off-Road| 004 |
| RoadBlasters    | 005 |
