# Sound System — comunicazione 68010 ↔ 6502

> **Status:** ✅ Phase 1.
> **MAME ref:** `atarisy1.cpp` mailbox setup `:816-821`, sound map `:443-453`, port definitions `:481-499`.

## Topologia

```
   ┌──────────────────────┐                    ┌──────────────────────┐
   │       68010          │                    │        6502          │
   │   (main, 7.16 MHz)   │                    │   (sound, 1.79 MHz)  │
   └──────────────────────┘                    └──────────────────────┘
              │                                            │
              │ W: $FE0001 (sound command, 8-bit)          │
              │  → m_soundlatch                            │
              │  → assert NMI sul 6502                     │
              ├────────────────────────────────────────────┤
              │                                            │ R: $1810
              │                                            │  ← m_soundlatch
              │                                            │
              │ R: $FC0001 (sound response, 8-bit)         │
              │  ← m_mainlatch                             │
              │  ← assert IRQ6 sul 68010                   │
              ├────────────────────────────────────────────┤
              │                                            │ W: $1810
              │                                            │  → m_mainlatch
```

## Mailbox 68010 → 6502 (sound command)

- 68010 scrive 1 byte a **`$FE0001`** (`main_map_noslapstic` `atarisy1.cpp:428`).
- Il `generic_latch_8` `m_soundlatch` segna pending.
- Il pending generato genera **NMI sul 6502** (`atarisy1.cpp:817 m_soundlatch->data_pending_callback().set_inputline(m_audiocpu, m6502_device::NMI_LINE)`).
- Il 6502 legge a **`$1810`** (`atarisy1.cpp:447`), il che fa `acknowledge` automatico (clear pending). NMI si rilascia.
- Side effect: `atarisy1.cpp:818` triggera anche `perfect_quantum(100us)` per garantire che il 6502 vede l'NMI nei 100us successivi (sincronizzazione master CPU).

Stato pending visibile da entrambi i CPU:
- 68010: read di `$F60000` bit 7 = `m_soundlatch.pending_r()` (`atarisy1.cpp:489`)
- 6502: read di `$1820` bit 3 = `m_soundlatch.pending_r()` (`atarisy1.cpp:496`)

## Mailbox 6502 → 68010 (sound response)

- 6502 scrive 1 byte a **`$1810`** (`atarisy1.cpp:448 m_mainlatch->write`).
- Il `generic_latch_8` `m_mainlatch` segna pending.
- Asserta **IRQ6 sul 68010** (`atarisy1.cpp:821 m_mainlatch->data_pending_callback().set_inputline(m_maincpu, M68K_IRQ_6)`).
- Il 68010 legge a **`$FC0001`** (`atarisy1.cpp:427`), che acknowledgea (clear pending + clear IRQ).

Stato pending visibile da entrambi:
- 6502: read di `$1820` bit 4 = `m_mainlatch.pending_r()` (`atarisy1.cpp:497`)
- 68010: solo via `$FC0001` (la lettura è destructive)

## Soundlatch reset

Quando il main CPU mette il sound CPU in reset (bit 7 di `$860001` = 0), oltre al reset:
- `m_outlatch->clear_w()` chiamato (`atarisy1.cpp:201`)
- `m_mainlatch->acknowledge_w()` chiamato (`atarisy1.cpp:205`) → forza clear della pending response anche se non letta
- VIA reset (per giochi con speech)

Vedi `bankselect_w` `atarisy1_v.cpp:189-228`.

## Comandi sound (catalog da fare in Phase 4-5)

I valori di sound command per Marble Madness sono codificati nel ROM del 6502 (`136033.421` + `136033.422`, 16 KB). Vanno catalogati osservando le scritture del 68010 a `$FE0001` durante gli scenari del curriculum (`level1_no_input`, `level1_basic_movement`).

Tracking a runtime:
- `oracle/mame_dumper.lua` può registrare ogni write a `$FE0001` come parte di `audioEvents[]` nel trace
- `packages/engine/src/audio.ts` espone `AudioEvent` astratti che il pacchetto `web` traduce a Web Audio API

| Comando (hex) | Effetto inferito | Note |
|---------------|------------------|------|
| TBD | TBD | Da catalogare in Phase 4-5 leggendo il 6502 ROM in Ghidra |

## V1 implementation strategy (PRD §10)

In `packages/engine/src/audio.ts`:
- Tracciare ogni write alla mailbox $FE0001 (per il diff vs MAME)
- Mappare i comandi noti a `AudioEvent` astratti (`marble_roll`, `marble_jump`, `enemy_hit`, ...)
- `packages/web/src/` traduce `AudioEvent` in Web Audio API basic synth (sample synthesis)

V2: emulazione chip-perfect POKEY/YM2151. Per Marble Madness niente TMS5220 (no speech).

## YM2151 specifico

- Clock 3.579545 MHz (`atarisy1.cpp:823`).
- IRQ output del YM2151 → IRQ del 6502 (`atarisy1.cpp:824`). Quando il YM2151 ha bisogno di servizio (timer interno), il 6502 lo gestisce.
- Reset del YM2151 controllato dal LS259 bit 0 (`atarisy1.cpp:781 m_outlatch->q_out_cb<0>().set("ymsnd", FUNC(ym2151_device::reset_w))`). Il 6502 scrive `$1820` bit 0 per fare reset al YM2151.

## POKEY specifico

- Clock 1.789773 MHz (`atarisy1.cpp:828`).
- Indirizzato a `$1870-$187F` sul 6502 (mirror `$2780`).
- Genera effetti sonori (rumble della biglia su Marble Madness, splash dei nemici, ecc.).

## TMS5220C (speech)

- **NON usato in Marble Madness** (non viene chiamato `add_speech` nel `marble()` machine config).
- Quindi: niente VIA 6522, niente TMS5220, niente speech. Le voci "Marble Madness" iconiche sono **digitalizzate via POKEY/YM2151 sample**, NON via TMS5220.
- Per Indy Temple/Roadrunner/RoadBlasters/Reliefs sì.
