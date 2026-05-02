# Hardware Map — Atari System 1 / Marble Madness

> **Status:** ✅ Phase 1 (riempito da `mame/src/mame/atari/atarisy1.cpp`).
> **MAME ref:** versione master corrente (clone shallow `/tmp/mame-src/mame/`), file principale 2705 righe, ~30 KB di codice + 700 righe in `atarisy1_v.cpp`.

## Memory map del 68010 (`atarisys1.cpp:80-143` + `address_map main_map_noslapstic` @ `atarisys1.cpp:405-429`)

Tutto in big-endian, bus dati 16 bit, indirizzi 24 bit.

| Range (hex)         | Region                         | RW   | Note |
|---------------------|--------------------------------|------|------|
| `000000-07FFFF`     | Program ROM                    | R    | 512 KB. Contiene BIOS motherboard (16 KB) + cartridge program. |
| `080000-087FFF`     | **Slapstic-protected ROM**     | R    | 32 KB visibili (4 banchi × 8 KB), bank-switched dal chip slapstic 103 (per marble). MMIO `mirror(0x6000)` a `atarisys1.cpp:434`. |
| `2E0000-2E0001`     | Sprite interrupt state         | R    | bit 7 = `m_scanline_int_state` (IRQ3 in flight). Funzione `int3state_r` `atarisy1_v.cpp:394`. |
| `400000-401FFF`     | Program RAM                    | RW   | **8 KB** main work RAM del 68010. È qui che vivono game state, RNG seed, marble pos/vel, score, lives, level data, ecc. |
| `800000-800001`     | Playfield X scroll             | W    | 9 bit (`xxxxxxxxx`). `xscroll_w` `atarisy1_v.cpp:258`. |
| `820000-820001`     | Playfield Y scroll             | W    | 9 bit. `yscroll_w` `atarisy1_v.cpp:289`. Latched + scanline-adjusted. |
| `840000-840001`     | Playfield priority color mask  | W    | 8 bit. `priority_w` `atarisy1_v.cpp:238`. |
| `860001`            | **Audio/video control**        | W    | 8 bit (registro fondamentale, vedi sotto). `bankselect_w` `atarisy1_v.cpp:189`. |
| `880001`            | Watchdog reset                 | W    | strobe |
| `8A0001`            | VBLANK IRQ acknowledge         | W    | strobe. Funzione `video_int_ack_w` `atarisy1.cpp:215` → clear IRQ4. |
| `8C0001`            | EEPROM unlock                  | W    | strobe |
| `900000-9FFFFF`     | Cartridge external RAM/ROM     | RW   | **1 MB** RAM. Per Marble Madness è qui che probabilmente sta il level data espanso e working buffer pesanti. |
| `A00000-A01FFF`     | Playfield RAM (64×64 tiles)    | RW   | 8 KB. Layout per word: bit 15 = HFlip, bit 8-14 = tile/palette select (7 bit), bit 0-7 = tile index 8 LSB. |
| `A02000-A02FFF`     | **Motion Object (sprite) RAM** | RW   | 4 KB. **8 banchi × 64 entry × 4 word**. Bank attivo selezionato da `860001` bit 3-5. Layout per entry @ word 0/64/128/192 (vedi `s_mob_config` a `atarisy1_v.cpp:113-144`). |
| `A03000-A03FFF`     | Alphanumerics RAM (HUD overlay) | RW  | 4 KB. 64×32 tiles 8×8 px. Bit 13 = opaque, bit 10-12 = palette idx (3 bit), bit 0-9 = tile index. |
| `B00000-B007FF`     | Palette RAM (1024 entries)     | RW   | Format **IRGB 4-4-4-4** (`palette_device::IRGB_4444` `atarisy1.cpp:796`). 4 sub-palette: |
| ` ├─ B00000-B001FF` |   Alphanumerics palette        |      | 256 entries × 2 byte |
| ` ├─ B00200-B003FF` |   Motion object palette        |      | 256 entries × 2 byte |
| ` ├─ B00400-B005FF` |   Playfield palette            |      | 256 entries × 2 byte |
| ` └─ B00600-B007FF` |   Translucency palette         |      | 256 entries × 2 byte |
| `F00000-F003FF`     | EEPROM (2804, parallel 8-bit)  | RW   | 1 KB. `umask16(0x00ff)` — solo low byte. Lock automatico dopo write (`lock_after_write(true)` `atarisy1.cpp:778`). |
| `F20000-F20007`     | Trackball/Analog inputs        | R    | Marble: trackball ruotato 45° (vedi sotto). `trakball_r` `atarisy1.cpp:281`. 4 porte 8-bit: P1X, P1Y, P2X, P2Y. |
| `F40000-F4001F`     | Joystick / ADC                 | RW   | Per giochi con joystick (Indy, Peter Pak); Marble lascia inutilizzato. R = `adc_r`, W = `adc_w` + IRQ enable. |
| `F60000-F60003`     | Switch inputs                  | R    | 16 bit: bit 7 = sound command pending, bit 6 = self-test, bit 4 = VBLANK live, bit 0-1 = START1/START2. Vedi `INPUT_PORTS_START(marble)` `atarisy1.cpp:481-499`. |
| `F80001`            | Sound command write (alt)      | W    | usato solo da roadbls2 |
| `FC0001`            | Sound response read            | R    | da `m_mainlatch` (gen_latch_8). |
| `FE0001`            | **Sound command write**        | W    | a `m_soundlatch` → genera NMI sul 6502. |

### Registro Audio/Video Control @ `860001` (8 bit, write-only)

| Bit | Funzione |
|-----|----------|
| 7   | Sound CPU reset (active-low quando bit=0; il sound CPU è in reset) |
| 6   | Trackball test |
| 5-3 | **Motion Object RAM bank select** (3 bit → 0-7) |
| 2   | Playfield tile bank select (0/1) |
| 1   | Trackball resolution & test LED |
| 0   | Alphanumerics tile bank select (0/1) |

Cita `atarisys1.cpp:90-96` per la mappa dei bit.

## Memory map del 6502 (sound CPU) (`atarisys1.cpp:148-167` + `sound_map` @ `atarisys1.cpp:443-453`)

| Range (hex)         | Region                      | RW   | Note |
|---------------------|-----------------------------|------|------|
| `0000-0FFF`         | RAM                         | RW   | 4 KB, mirror `0x2000` |
| `1000-100F`         | M6522 VIA (cartridge)       | RW   | mirror `0x27F0`. Per Indy/RoadBlasters/Roadrunner; Marble **non** include `sound_ext_map`, quindi VIA 6522 non collegata. |
| `1800-1801`         | YM2151                      | RW   | mirror `0x278E`. Musica. |
| `1810`              | Sound command read / response write | RW | mirror `0x278F`. R = comando dal 68010, W = risposta al 68010. |
| `1820`              | Status / coin input         | R    | bit 7 = self-test, bit 4 = response buf full, bit 3 = command buf full, bit 2-0 = coins (service/L/R). |
| `1820-1827`         | LS259 output latch          | W    | bit-addressable. bit 0 = YM2151 reset, bit 4-5 = LED, bit 6 = coin counter R, bit 7 = coin counter L. |
| `1870-187F`         | POKEY                       | RW   | mirror `0x2780`. Effetti / noise. |
| `4000-FFFF`         | Program ROM                 | R    | 48 KB. Per marble: `136033.421` @ `0x8000` + `136033.422` @ `0xC000` (16 KB totali, vedi `rom-layout.md`). |

## I/O critici per Marble Madness

### Trackball ruotato 45° (`atarisy1.cpp:281-319`)

```c
if (m_trackball_type == 1) {  // marble
    // posx, posy = letture dirette dei port IN0/IN1 (P1) o IN2/IN3 (P2)
    m_cur[player][0] = posx + posy;
    m_cur[player][1] = posx - posy;
}
result = m_cur[player][which];
```

Quando il 68010 fa `MOVE.B $F20000, ...` legge `m_cur[0][0] = posx + posy` (rotazione 45°). Le 4 porte $F20000/2/4/6 sono: P1 even/odd → `(posx+posy)`/`(posx-posy)`; P2 stessa logica. **`init_marble`** imposta `m_trackball_type = 1` (`atarisys1.cpp:2621`).

Per il reimpl: la fisica originale gira sui valori già ruotati. Il trackball delta browser deve essere **prima ruotato** (sx ↔ sy), poi passato al 68010.

### Switch port `F60000` (`atarisy1.cpp:481-490`)

| Bit | Funzione |
|-----|----------|
| 0   | START1 (active low) |
| 1   | START2 (active low) |
| 4   | VBLANK live (custom callback) |
| 6   | Self-test (DIP / coin door) |
| 7   | Sound command pending (gen_latch pending_r del soundlatch) |

I coin (COIN1/2/3) sono letti dal **6502** (via $1820), **non** dal 68010. Decisione hardware Atari.

## Slapstic chip 103

- Chip Atari custom anti-pirateria per bank switching.
- Configurato a `atarisy1.cpp:836-839`:
  ```c
  SLAPSTIC(config, m_slapstic, 103);
  m_slapstic->set_range(m_maincpu, AS_PROGRAM, 0x80000, 0x87fff, 0);
  ```
- 4 banchi × 8 KB. Switch tra banchi monitorando letture a indirizzi specifici (state machine).
- `init_slapstic` `atarisys1.cpp:2612` → `configure_entries(0, 4, base+0x80000, 0x2000)`.

🚨 **Phase 2 dependency**: per il reimpl bit-perfect serve **replicare** la state machine dello slapstic 103. Vedi `mame/src/mame/atari/slapstic.cpp` (file 200+ righe) e `slapstic.html` di Aaron Giles (linkato in `slapstic.h:9`).

## Sprite RAM layout (`atarisy1_v.cpp:113-144` `s_mob_config`)

8 banchi × 64 entry × 4 word = 2048 byte per banco.

Per ogni entry (offset relativo all'inizio del banco):

| Word | Bit mask          | Significato |
|------|-------------------|-------------|
| 0    | `0x8000`          | X flip |
| 0    | `0x3fe0`          | Y position (9 bit, range 256→ -255 effective) |
| 0    | `0x000f`          | Number of Y tiles - 1 (1..16) |
| 64   | `0xff00`          | Color (palette select, 8 bit) |
| 64   | `0x00ff`          | Tile index 8 LSB |
| 128  | `0x3fe0`          | X position (9 bit) |
| 128  | `0x8000`          | Priority |
| 192  | `0x003f`          | Link to next object (linked list dei visible sprites) |

**Linked list**: il render walk parte da entry 0, segue `link` finché non rivisita. Max 0x38 = 56 visite per scanline (`s_mob_config:124`).

**Timer entries**: word 1 == `0xffff` indica un'entry "timer", che genera IRQ3 a uno specifico ypos (vedi `atarisy1_v.cpp:411-466 update_timers` per `atarisys1r_state`, ma il base `atarisy1_state` ha `update_timers` no-op `:407-409`).

Per Marble Madness: classe base `atarisy1_state`, NON `atarisy1r_state`, → IRQ3 disabilitato (LSI rev). Confermato da `GAME(...marble..., atarisy1_state, init_marble, ...)` `atarisys1.cpp:2671-2675`.

## Schermata e scrolling

- Viewport: **336 × 240 px** (NTSC, da `atarisys1.cpp:808` `set_raw(14.318181_MHz/2, 456, 0, 336, 262, 0, 240)`).
- Refresh: ~59.92 Hz NTSC.
- VBLANK → IRQ4 ASSERT al main CPU (`atarisys1.cpp:811`).
- Scroll Y latched + adjusted per scanline: vedi `yscroll_w` `atarisy1_v.cpp:289-312` e `reset_yscroll_callback`.

---

## Come usare questo file

Quando il differential harness diverge su un MMIO o RAM region: questa è la **prima reference**. Ogni claim cita il file MAME e la riga; verificare prima di implementare un fix.

Vedi anche:
- `cpu-config.md` — clock, vector table, IRQ
- `sound-system.md` — comunicazione 68010↔6502
- `video-system.md` — palette, tile, render order
- `rom-layout.md` — file ROM e CRC32
