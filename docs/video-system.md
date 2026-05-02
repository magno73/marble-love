# Video System — Atari System 1

> **Status:** ✅ Phase 1.
> **MAME ref:** `atarisy1.cpp:769-831` (machine config), `atarisy1_v.cpp:1-655` (video logic), `atarimo.{cpp,h}` (motion objects).

## Layer (z-order, dal basso verso l'alto)

1. **Playfield** (tilemap scrollabile)
2. **Motion Objects** (sprite, depth-merged con priority bit)
3. **Alphanumerics** (overlay non-scrollato, per HUD/score/menu)

Render orchestration: `screen_update` `atarisy1_v.cpp:476-518`. Pseudocodice:
```
mob.draw_async(cliprect)         // sprites in bitmap separato
playfield.draw(screen, bitmap)   // tile background
for each dirty rect:             // merge sprites con priority
    if mo[x] != transparent:
        if mo[x] PRIORITY_HIGH and mo[x]&0x0F != 1:
            pf[x] = 0x300 + ((pf[x] & 0x0f) << 4) + (mo[x] & 0x0f)  // translucency
        else (LOW priority):
            if pf[x] & 0xf8 != 0 or not in priority_pens:
                pf[x] = mo[x]
alpha.draw(screen, bitmap, transparent_pen=0)  // HUD overlay
```

## Schermo (`atarisy1.cpp:804-811`)

- **Pixel clock**: 14.318181/2 ≈ 7.159 MHz.
- **Total H**: 456 pixel clocks (340 visible + 116 blanking H).
- **Visible H**: 0..335 → **336 px wide**.
- **Total V**: 262 scanlines (240 visible + 22 V-blank, NTSC).
- **Visible V**: 0..239 → **240 px tall**.
- **Refresh**: `7159090 / (456 * 262) ≈ 59.92 Hz`.
- **VBLANK**: durante scanlines 240..261 (~22 scanlines / 1.51 ms).
- VBLANK ASSERT IRQ4 al main CPU `atarisy1.cpp:811`. Cleared da write a `$8A0001` (`video_int_ack_w`).
- Attribute: `VIDEO_UPDATE_BEFORE_VBLANK` `atarisy1.cpp:805` — il render avviene **prima** del flag VBLANK, quindi MAME aggiorna il framebuffer per intero, poi parte il vblank IRQ.

## Playfield (background)

- **Size**: 64 × 64 tile (dimensione virtuale 512 × 512 px). Visibile: 336 × 240.
- **Tile**: 8 × 8 px.
- **TILEMAP** config `atarisy1.cpp:798`: `gfxdecode=2, 8x8, TILEMAP_SCAN_ROWS, 64x64`.
- **RAM**: `$A00000-$A01FFF` (8 KB, 2 byte/tile).
- **Scrolling**: H scroll a `$800000` (9 bit), V scroll a `$820000` (9 bit, + scanline-adjustment latching).
- **Bank select**: `$860001` bit 2 → `m_playfield_tile_bank` (0/1).

### Tile encoding (1 word per tile in playfield RAM)

| Bit  | Funzione |
|------|----------|
| 15   | Horizontal flip |
| 14-8 | Tile/palette select (7 bit, indicizza `m_playfield_lookup[]`) |
| 7-0  | Tile index 8 LSB |

Lookup function: `get_playfield_tile_info` `atarisy1_v.cpp:95-103`:
```c
data = playfield_RAM[tile_index]  // word
lookup = m_playfield_lookup[((data >> 8) & 0x7f) | (m_playfield_tile_bank << 7)]
gfxindex = (lookup >> 8) & 0xf
code = ((lookup & 0xff) << 8) | (data & 0xff)
color = 0x20 + (((lookup >> 12) & 15) << m_bank_color_shift[gfxindex])
flip_x = (data >> 15) & 1
```

`m_playfield_lookup` è popolato da `decode_gfx` durante `video_start()` (`atarisy1_v.cpp:146-179`), partendo dai 2 PROM `136033.118` (remap) e `136033.119` (color) — vedi `rom-layout.md`.

## Motion Objects (sprites)

Hardware specifico Atari ("MO" / "atarimo"). Vedi `atarimo.cpp` e `s_mob_config` `atarisy1_v.cpp:113-144`.

- **8 banchi × 64 entry × 4 word** = 2 KB per banco, 16 KB totali (di cui solo 4 KB visibili a `$A02000-$A02FFF`, gli altri 7 banchi accedibili via banking).
- **Bank select**: `$860001` bit 3-5 → `m_mob->set_bank((newselect >> 3) & 7)` `atarisy1_v.cpp:216`.
- **Linked list**: ogni entry punta alla successiva via word 3 bit 0-5 (link, max 64 entries). Il render walka da entry 0 finché non rivisita un nodo. Max **0x38 = 56** entries per scanline (`s_mob_config:124`).
- **Tile size**: 8 × 8 px, ma una entry può rappresentare un blocco multi-tile (Y tiles count + X tiles count → bounding rectangle).

### Entry layout (4 word)

| Word | Bit 15-12 | Bit 11-8 | Bit 7-4 | Bit 3-0 | Note |
|------|-----------|----------|---------|---------|------|
| 0    | XFlip(15) + Y position bits(14-5) | YPos | YPos | Y tiles-1 | YPos 9 bit signed (range -256..+255 effective) |
| 1    | Color (8 bit @ 15-8) | Color | Tile (LSB) | Tile (LSB) | 8 high bit color, 8 low bit tile |
| 2    | Priority(15) + X position(13-5) | XPos | XPos | X tiles-1 | XPos 9 bit |
| 3    | unused | unused | unused | Link(5-0) | Link a next entry |

Le maschere precise (in `s_mob_config`):
- link: `0x003f` @ word 3
- code: `0xffff` @ word 1 (intera, di cui 8+8 split)
- color: `0xff00` @ word 1
- X position: `0x3fe0` @ word 2
- Y position: `0x3fe0` @ word 0
- Y tiles-1: `0x000f` @ word 0
- X tiles-1: ~~bit~~ `0x000f` @ word 2 (implicito: il config dice `{0}` per X, MAME lo deriva)
- HFlip: `0x8000` @ word 0
- Priority: `0x8000` @ word 2

### Timer entries (IRQ3 trigger)

Word 1 == `0xffff` → entry "timer". Specifica un ypos (deriva da word 0 bit 5-13) a cui asserire IRQ3. **Solo per `atarisy1r_state`** (LSI cart 2/3/4 + cockpit, NON per Marble).

`update_timers` `atarisy1_v.cpp:411-466`:
```c
for entry in linked-list-walk-active-bank:
    if spriteram[entry+0x40] == 0xffff:  // timer
        data = spriteram[entry]
        vsize = (data & 0xf) + 1
        ypos = (256 - (data >> 5) - vsize*8 - 1) & 0x1ff
        if ypos better than current best:
            best = ypos
schedule int3_callback at scanline=best
```

🚨 Per Marble Madness questo non si applica (base class `atarisy1_state`, `update_timers` no-op).

### Priority merging

Vedi `screen_update` `atarisy1_v.cpp:495-518`. Logica:
- MO con priority bit alto: **traslucido** (palette `0x300+`, mix con playfield) — Marble usa questo per le ombre / area trasparente
- MO con priority bit basso: opaco, ma cede al playfield se `pf & 0xf8 != 0` o se il pen `pf & 0x07` è in `m_playfield_priority_pens` (configurato via `$840000`).

Translucency palette: `$B00600-$B007FF` (256 entries).

## Alphanumerics (HUD overlay)

- **Size**: 64 × 32 tile (512 × 256 px).
- **Tile**: 8 × 8 px, **2 bpp** (4 colori per palette).
- **RAM**: `$A03000-$A03FFF` (4 KB).
- **TILEMAP** config `atarisy1.cpp:799`: `64x32, transparent_pen=0`.
- **GFX layout**: `anlayout` `atarisy1.cpp:713-722`, 8x8 tiles, 2 bpp packed (planes at offset 0 and 4).
- **GFX ROM**: region "alpha" 8 KB, file `136032.104.f5` (motherboard BIOS, condivisa tra tutti i giochi System 1) — vedi `rom-layout.md`.

### Alpha tile encoding (1 word per tile)

| Bit   | Funzione |
|-------|----------|
| 13    | Opaque (force layer 0, no transparency) |
| 12-10 | Palette index (3 bit) |
| 9-0   | Tile index (10 bit, 0..1023) |

Lookup: `get_alpha_tile_info` `atarisy1_v.cpp:85-92`.

### Alpha bank select

`$860001` bit 0 → bank alpha (NON usato dal driver MAME `atarisy1_v.cpp:189-228`, ma documentato come hardware feature). Probabilmente residuo non utilizzato in Marble.

## Palette

- **Format**: IRGB 4-4-4-4 = **Intensity 4 bit, Red 4 bit, Green 4 bit, Blue 4 bit** = 16 bit per entry, 4096 colori effettivi (con intensity).
- **PALETTE config**: `palette_device::IRGB_4444, 1024 entries` `atarisy1.cpp:796`.
- **RAM**: `$B00000-$B007FF` = 2 KB / 2 bytes/entry = 1024 entries.
- **Sub-palette ranges** (`atarisy1.cpp:118-125`):
  - `B00000-B001FF`: Alphanumerics (256 entries)
  - `B00200-B003FF`: Motion objects (256 entries)
  - `B00400-B005FF`: Playfield (256 entries)
  - `B00600-B007FF`: Translucency (256 entries)

### Per-pixel encoding nella palette word

| Bit   | Funzione |
|-------|----------|
| 15-12 | Intensity (4 bit, 0=darkest, 15=brightest) |
| 11-8  | Red (4 bit) |
| 7-4   | Green (4 bit) |
| 3-0   | Blue (4 bit) |

Cita `atarisy1.cpp:119-122` per la tabella bit.

Conversione a sRGB approssimata (verificare in Phase 4 / 7 contro screenshot MAME):
```
R8 = clamp((R4 << 4 | R4) * I4 / 15, 0, 255)
G8 = clamp((G4 << 4 | G4) * I4 / 15, 0, 255)
B8 = clamp((B4 << 4 | B4) * I4 / 15, 0, 255)
```

## Watchdog & EEPROM

- **Watchdog reset**: write strobe a `$880001`. Timeout = 8 vblanks (`atarisy1.cpp:787`).
- **EEPROM** (2804, 1KB, 8-bit parallel): `$F00000-$F003FF` (`atarisy1.cpp:422 umask16(0x00ff)`). Lock automatico dopo write (`atarisy1.cpp:778 lock_after_write(true)`). Unlock via strobe a `$8C0001`.

## ROM grafica per Marble Madness

Vedi `rom-layout.md` per CRC32. Riassunto:
- **Alpha** (HUD): `136032.104.f5` (motherboard, 8 KB)
- **Tiles** (playfield + sprites): `136033.137-146` (bank 1, planes 0-4) + `136033.149/151/153` (bank 2, planes 0-2). Totale ~80 KB.
- **PROMs grafici**: `136033.118` (remap, 512 byte) + `136033.119` (color, 512 byte). Letti durante `video_start` per popolare `m_playfield_lookup`.

Le ROM tile sono in formato **planar**: ogni piano in un file separato. Decoder `objlayout_4bpp/5bpp/6bpp` a `atarisy1_v.cpp:44-75` definisce il bit-arrangement.

## Per il reimpl

Vedi `packages/engine/src/render.ts` per il layer astratto neutro (no DOM, no PixiJS). Il PixiJS adapter (`packages/web/src/renderer.ts`) traduce `Frame { tiles[], sprites[], scrollX, scrollY }` in PIXI.Sprite/PIXI.Container. Phase 7.

Per la **parità di stato**, importa solo che `spriteRam`, `playfieldRam`, `alphaRam`, `colorRam` riflettano bit-by-bit la RAM MAME. Il rendering *visuale* può divergere senza compromettere la parità del game state — la differenza si vede solo se il game state legge la color RAM (rare, ma possibile per effetti di animazione palette).
