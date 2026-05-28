# Visual Pixel-Match Diagnostics

Branch: `feature/visual-pixel-match`. Iterazioni iter1 → iter18 documentate
in `STATUS.md`. Questo doc raccoglie le diagnostiche di pixel-perfect
match vs MAME oracle.

## Setup oracle

```bash
# Genera state dump + screenshot @ frame 2400
MARBLE_DUMP_TARGET_FRAME=2400 \
MARBLE_SNAP_PATH=/tmp/mame_snap.png \
MARBLE_DUMP_OUT=/tmp/mame_state.json \
mame marble -window -nothrottle -skip_gameinfo -seconds_to_run 41 \
     -rompath /Users/magnus-bot/Code/marble-love/roms \
     -autoboot_script /tmp/mame_screen.lua

cp /tmp/mame_state.json packages/web/public/mame_state.json
```

## Differenze residue identificate

### 1. Sfondo nero invece di bands blu

MAME sample `y=0..40 x=0..336` sample mostra mix di:
- (0,0,0) nero (margins)
- (9,9,9), (12,12,12), (47,47,47), (67,67,67) grigi vari
- (0,0,254) blu intenso sparso

Mio TS al stesso pixel = nero.

**Ipotesi**: MAME mostra il pen=0 dei tile come palette[0x200] = (0,0,0)
ma in altri pixel mostra colori non zero. Cioè i tile background non
sono "tutti pen=0" ma hanno mix di pen 0..N. Mio TS produce pen sbagliato.

### 2. Marble color: bianco vs viola

MAME marble center (152, 144) = (254,254,254) bianco intenso, gradient
verso (47,47,47) ai bordi.

Quei colori match palette range 0x220-0x22C (= playfield grigi) NON 0x110+
(MO range).

Mio TS sprite paletteIndex = 0x22 → palette[0x110+pen] = magenta+rosso+marrone.

**Ipotesi A**: la marble in MAME è renderizzata come **PLAYFIELD TILE**
dynamic (CPU re-writes tilemap entries each frame). Mio TS la prende
da motion-object linked list invece.

**Ipotesi B**: MAME applica `palette->set_indirect_color` che remappa MO
palette indices ad altre zones.

**Ipotesi C**: la `m_mob` ha "color_lookup" diverso da quello che ho
calcolato. atari_motion_objects driver-specific.

### 3. Calcolo palette confermato bit-perfect MAME

Per pixel (168, 50) MAME = (135,135,135):
- TS pen=7 bank=1 bpp=5 paletteIndex=0x40 → finalPalIdx 0x207
- pal[0x207] = (135,135,135) ✓ MATCH (confermato dal probe palette range 0x200+)

Per pixel (100, 80) MAME = (0,90,135):
- pal[0x22E] = (0,90,135) → finalPalIdx 0x22E = paletteIndex * 8 + pen
- 0x22E = 0x44*8 + 6 → paletteIndex = 0x44, pen = 6

Mio TS per quel pixel: paletteIndex = 0x40 + (lookup.color << 2)
- Per ottenere 0x44: lookup.color = 1
- Mio probe: lookup[lookupIdx].color = 0 (NON 1)

**Conclusione**: il `lookup.color` mio TS è SBAGLIATO per alcuni tile.
Possibilmente per via di:
- m_playfield_tile_bank settato a 1 in MAME (e m_bankselect interpretato diversamente)
- PROM lookup index shifted di 0x80 in MAME

### 4. MO+PF priority merge non implementato

MAME `screen_update`:
```cpp
m_mob->iterate_dirty_rects(cliprect, [](const rectangle &rect) {
  for (int y = rect.top(); y <= rect.bottom(); y++) {
    uint16_t const *mo = &mobitmap.pix(y);
    uint16_t *pf = &bitmap.pix(y);
    for (int x = rect.left(); x <= rect.right(); x++) {
      if (mo[x] != 0xffff) {
        if (mo[x] & PRIORITY_MASK) {
          if ((mo[x] & 0x0f) != 1)
            pf[x] = 0x300 + ((pf[x] & 0x0f) << 4) + (mo[x] & 0x0f);
        } else {
          if ((pf[x] & 0xf8) != 0 || !(m_playfield_priority_pens & (1 << (pf[x] & 0x07))))
            pf[x] = mo[x];
        }
      }
    }
  });
```

Mio renderer fa solo `playfield draw + sprite draw + alpha draw` senza
priority blending. Le zone con MO sopra PF non hanno la translucency
mapping `palette[0x300 + (pf<<4) + mo]` applicata.

### 5. Per-scanline yscroll trick

MAME `yscroll_w`:
```cpp
int adjusted_scroll = newscroll;
if (scanline <= visible.bottom())
  adjusted_scroll -= (scanline + 1);
m_playfield_tilemap->set_scrolly(0, adjusted_scroll);
m_yscroll_reset_timer->adjust(time_until_pos(0), newscroll);
```

Mio TS applica scroll fisso per tutto il frame. Per gameplay accurate
serve simulare le N write yscroll per scanline.

## Stato pixel match

Frame 2400 oracle vs iter18:
- Pixel-perfect (delta < 10/255): **11.3%** (9128/80640)
- Partial (delta < 50/255): **33%**
- Layout: ✅ piattaforme, marble, spike, acid pools nelle stesse posizioni
- HUD: ✅ "SCORE 220 / 51 / 1 COIN PER PLAY / © 1984 ATARI GAMES" leggibile
- Palette regions correctly mapped (Alpha 0x000, MO 0x100, Playfield 0x200, Translucency 0x300)

Per arrivare a 100% pixel-perfect serve:
1. Replicare priority merge MO+PF di `screen_update`
2. Implementare per-scanline yscroll trick
3. Risolvere il `lookup.color` discrepancy (probabile m_playfield_tile_bank dinamico)
4. Handle palette indirection se presente

