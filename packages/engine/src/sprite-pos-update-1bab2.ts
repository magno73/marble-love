/**
 * sprite-pos-update-1bab2.ts — replica `FUN_0001BAB2` (86 byte).
 *
 * "Sprite position-update with redraw-on-tile-change". Carica le 3 word
 * (x, y, z) da una struct passata sullo stack nei globals @ 0x400690..0x400695,
 * deriva i 5 campi del tile via `deriveSpriteFields` (= `FUN_0001BB50`), e
 * **se** le coord-tile (x>>3, y>>3) sono cambiate rispetto ai valori
 * precedenti chiama il heavy-renderer `FUN_0001CABA` (ridraw del tile).
 *
 * **Disasm 0x1BAB2..0x1BB07** (86 byte):
 *
 *   movem.l {D3 D2}, -(SP)               ; salva D2,D3 (8 byte)
 *   movea.l (0xc, SP), A1                ; A1 = arg long (struct ptr)
 *   move.w  (0x00400696).l, D3w          ; D3.w = OLD *0x400696 (= prev x>>3)
 *   move.w  (0x00400698).l, D2w          ; D2.w = OLD *0x400698 (= prev y>>3)
 *   lea     (0xc, A1), A0
 *   move.w  (A0), (0x00400690).l         ; *0x400690 = word @ A1+0xC  (new x)
 *   lea     (0x10, A1), A0
 *   move.w  (A0), (0x00400692).l         ; *0x400692 = word @ A1+0x10 (new y)
 *   lea     (0x14, A1), A0
 *   move.w  (A0), (0x00400694).l         ; *0x400694 = word @ A1+0x14 (new z?)
 *   jsr     0x0001bb50.l                 ; deriveSpriteFields (computes 696/698/...)
 *   cmp.w   (0x00400696).l, D3w          ; new x>>3 == old x>>3 ?
 *   bne.w   call_redraw                  ; mismatch → redraw
 *   cmp.w   (0x00400698).l, D2w          ; new y>>3 == old y>>3 ?
 *   beq.b   skip_redraw
 *   call_redraw:
 *     jsr   0x0001caba.l                 ; heavy tile-redraw sub
 *   skip_redraw:
 *     movem.l (SP)+, {D2 D3}
 *     rts
 *
 * **Semantica**: se il movimento sub-tile (delta < 8 px) non cambia la
 * posizione tile (x>>3, y>>3), evita il redraw. Solo se sposta lo sprite
 * di almeno una cella tile chiama il heavy renderer.
 *
 * **JSR esterne**:
 *   - `FUN_0001BB50` = `deriveSpriteFields` (sprite-derive.ts) — replicato
 *     bit-perfect, chiamato sempre.
 *   - `FUN_0001CABA` = heavy tile-redraw (NON ancora replicato) — chiamato
 *     solo se le tile-coords sono cambiate. Esposto come sub injection
 *     (`spritePosUpdate1BAB2Subs.fun_1CABA`); default no-op.
 *
 * Verifica bit-perfect via `cli/src/test-sprite-pos-update-1bab2-parity.ts`.
 */

import type { GameState } from "./state.js";
import { deriveSpriteFields } from "./sprite-derive.js";

/** Offsets globals (relative to workRam @ 0x400000). */
const POS_X_OFF = 0x690; // 0x400690 word
const POS_Y_OFF = 0x692; // 0x400692 word
const POS_Z_OFF = 0x694; // 0x400694 word
const TILE_X_OFF = 0x696; // 0x400696 word (= x asr 3) — overwritten by deriveSpriteFields
const TILE_Y_OFF = 0x698; // 0x400698 word (= y asr 3) — overwritten by deriveSpriteFields

/**
 * Stub injection per `FUN_0001CABA` (heavy tile-redraw). Default: no-op.
 *
 * `FUN_0001CABA` è un renderer pesante che legge `*0x400696/0x400698` e
 * aggiorna alpha-tilemap + altri buffer. Non ancora replicato bit-perfect:
 * la sub-injection consente al caller (es. il dispatcher root o test harness)
 * di iniettare un'implementazione, oppure di lasciarla no-op. Quando assente,
 * questo modulo si limita a aggiornare i globals 0x400690..0x40069F via
 * `deriveSpriteFields` e segnala il `redrawNeeded` nel return value.
 */
export interface SpritePosUpdate1BAB2Subs {
  /** Callback per `FUN_0001CABA` (heavy tile-redraw). Default: no-op. */
  fun_1CABA?: (state: GameState) => void;
}

/** Risultato della replica. */
export interface SpritePosUpdate1BAB2Result {
  /** True se le tile-coords sono cambiate → redraw triggered. */
  redrawNeeded: boolean;
  /** Tile X precedente (snapshot di *0x400696 prima del derive). */
  prevTileX: number;
  /** Tile Y precedente (snapshot di *0x400698 prima del derive). */
  prevTileY: number;
}

function readU16(state: GameState, off: number): number {
  return ((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0);
}

function writeU16(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}

/**
 * Replica bit-perfect di `FUN_0001BAB2`.
 *
 * @param state    GameState (modifica `workRam[0x690..0x6A3]` via
 *                 `deriveSpriteFields`).
 * @param argAddr  indirizzo assoluto della struct (m68k): vengono lette
 *                 3 word @ argAddr+0xC (x), argAddr+0x10 (y), argAddr+0x14 (z).
 * @param subs     stub injection. `subs.fun_1CABA(state)` chiamato solo se
 *                 le tile-coords (x>>3, y>>3) post-derive differiscono dalle
 *                 precedenti. Default: no-op.
 *
 * @returns `{ redrawNeeded, prevTileX, prevTileY }`. `redrawNeeded === true`
 *          quando il binario eseguirebbe la JSR a `FUN_0001CABA`.
 *
 * **Side effects** in `state.workRam`:
 *   - `0x690..0x691` (POS_X) = word @ struct+0xC (big-endian)
 *   - `0x692..0x693` (POS_Y) = word @ struct+0x10
 *   - `0x694..0x695` (POS_Z) = word @ struct+0x14
 *   - `0x696..0x6A3` overwritten by `deriveSpriteFields` (x&7, y&7, x>>3, y>>3,
 *     bge-flag).
 *   - eventuali side-effect di `subs.fun_1CABA` se invocato.
 */
export function spritePosUpdate1BAB2(
  state: GameState,
  argAddr: number,
  subs?: SpritePosUpdate1BAB2Subs,
): SpritePosUpdate1BAB2Result {
  const argOff = (argAddr - 0x400000) >>> 0;

  // Snapshot OLD tile coords (read BEFORE write to globals + derive).
  const prevTileX = readU16(state, TILE_X_OFF);
  const prevTileY = readU16(state, TILE_Y_OFF);

  // Write x/y/z words from struct@+0xC/+0x10/+0x14 → globals.
  const newX = readU16(state, argOff + 0xc);
  const newY = readU16(state, argOff + 0x10);
  const newZ = readU16(state, argOff + 0x14);
  writeU16(state, POS_X_OFF, newX);
  writeU16(state, POS_Y_OFF, newY);
  writeU16(state, POS_Z_OFF, newZ);

  // jsr deriveSpriteFields → recomputes 0x696/0x698/0x69E/0x6A0/0x6A2.
  deriveSpriteFields(state);

  // Compare new tile coords to old. The binario fa cmp.w che è word-compare
  // bit-exact: usiamo la representation 0..0xFFFF già storata in big-endian.
  const newTileX = readU16(state, TILE_X_OFF);
  const newTileY = readU16(state, TILE_Y_OFF);
  const redrawNeeded = newTileX !== prevTileX || newTileY !== prevTileY;

  if (redrawNeeded) {
    // jsr FUN_0001CABA (heavy redraw); via injection.
    subs?.fun_1CABA?.(state);
  }

  return { redrawNeeded, prevTileX, prevTileY };
}
