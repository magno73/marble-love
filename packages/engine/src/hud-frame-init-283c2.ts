/**
 * hud-frame-init-283c2.ts — replica `FUN_000283C2` (166 byte, 0 args, 0 ret).
 *
 * Helper "HUD score-frame initializer": esegue due loop separati sull'alpha
 * tilemap @ 0xA03000.
 *
 *   1. **Loop1** (D2 byte = 0..0x1d, 30 iterazioni — una per riga):
 *      Per ogni `row`:
 *        - `addr = getAlphaTileAddr(col=0, row=row)` (=`FUN_000037E4`)
 *        - scrive 6× word `0x3400` su alpha RAM:
 *            3 word a `addr+0..5`,
 *            3 word a `addr+0x4e..0x53` (= +39 word offset, lato destro)
 *      Effetto: cancella le bordo sinistro (3 col) e destro (3 col @ off 39)
 *      di tutte le 30 righe del HUD overlay con il "blank tile" 0x3400.
 *
 *   2. **Loop2** (D2 byte = 0..D3-1, dove D3 = 0x0C in 1-player o
 *      0x18 in 2-player — selezionato dal word @ 0x400396):
 *      Per ogni step legge una tripletta da 3 ROM table parallele e chiama
 *      `setAlphaTile` (= `FUN_00003784`):
 *        - col  = ROM word @ A2 (low byte) — A2 base 0x23C2C (1P) o 0x23CA4 (2P)
 *        - row  = ROM word @ A3 (low byte) — A3 base 0x23C44 sempre
 *        - data = ROM word @ D4           — D4 base 0x23C74 sempre
 *        - mask = 0x1C00 costante
 *      Effetto: disegna un "frame" (cornice) attorno all'area score del HUD.
 *      Il pattern (col, row) traccia un rettangolo arrotondato 5×4 cell.
 *
 * **Disasm 0x283C2..0x28467** (166 byte, 0xA6):
 *
 *   ; ── Loop1: cancella bordi alpha tilemap ────────────────────────────
 *   000283C2  movem.l {A3 A2 D4 D3 D2},-(SP)    ; salva 20 byte
 *   000283C6  clr.b   D2b                       ; D2 = 0 (loop counter byte)
 *   L1_BODY:
 *   000283C8  move.b  D2b,D0b                   ; D0 = sext_l(D2 byte)
 *   000283CA  ext.w   D0w
 *   000283CC  ext.l   D0
 *   000283CE  move.l  D0,-(SP)                  ; arg2 (row) = sext_l(D2)
 *   000283D0  clr.l   -(SP)                     ; arg1 (col) = 0
 *   000283D2  jsr     0x000037E4.l              ; A2 = getAlphaTileAddr(0, D2)
 *                                                ;     = via jmp 0x224 (long
 *                                                ;       trampoline)
 *   000283D8  movea.l D0,A2                     ; A2 = returned alpha-RAM ptr
 *   000283DA  move.l  A2,D1
 *   000283DC  moveq   0x4E,D0
 *   000283DE  add.l   D0,D1
 *   000283E0  movea.l D1,A3                     ; A3 = A2 + 0x4E (byte offset)
 *   000283E2  move.w  #0x3400,(A2)+             ; *(A2 + 0) = 0x3400; A2 += 2
 *   000283E6  move.w  #0x3400,(A2)+             ; *(A2 + 2) = 0x3400; A2 += 2
 *   000283EA  move.w  #0x3400,(A2)+             ; *(A2 + 4) = 0x3400; A2 += 2
 *   000283EE  move.w  #0x3400,(A3)+             ; *(A2 + 0x4E) = 0x3400
 *   000283F2  move.w  #0x3400,(A3)+             ; *(A2 + 0x50) = 0x3400
 *   000283F6  move.w  #0x3400,(A3)+             ; *(A2 + 0x52) = 0x3400
 *   000283FA  addq.l  0x8,SP                    ; cleanup 2 long arg
 *   000283FC  addq.b  0x1,D2b                   ; D2++
 *   000283FE  cmpi.b  #0x1E,D2b                 ; 30?
 *   00028402  bne.b   L1_BODY                   ; loop fino a D2 == 30
 *
 *   ; ── Loop2 setup: select 1P vs 2P via word @ 0x400396 ───────────────
 *   00028404  movea.l #0x23C44,A3               ; A3 = ROM "rows" table
 *   0002840A  move.l  #0x23C74,D4               ; D4 = ROM "data" table
 *   00028410  moveq   0x1,D0                    ; D0 = 1
 *   00028412  cmp.w   (0x00400396).l,D0w        ; 1-player?
 *   00028418  bne.b   IS_2P                     ; if not 1P → 2P branch
 *   0002841A  movea.l #0x23C2C,A2               ; A2 = ROM "cols" 1P table
 *   00028420  moveq   0x0C,D3                   ; D3 = 12 (count 1P)
 *   00028422  bra.b   L2_INIT
 *   IS_2P:
 *   00028424  movea.l #0x23CA4,A2               ; A2 = ROM "cols" 2P table
 *   0002842A  moveq   0x18,D3                   ; D3 = 24 (count 2P)
 *   L2_INIT:
 *   0002842C  clr.b   D2b                       ; D2 = 0 (loop counter)
 *   0002842E  bra.b   L2_CHECK
 *   L2_BODY:
 *   00028430  pea     (0x1C00).w                ; push arg4 (mask) = 0x1C00
 *   00028434  movea.l D4,A0
 *   00028436  addq.l  0x2,D4                    ; D4 += 2 (next data word)
 *   00028438  move.w  (A0),D0w                  ; D0 = data word
 *   0002843A  ext.l   D0
 *   0002843C  move.l  D0,-(SP)                  ; push arg3 (data) sext_l
 *   0002843E  movea.l A3,A0
 *   00028440  addq.l  0x2,A3                    ; A3 += 2 (next row word)
 *   00028442  move.w  (A0),D0w                  ; D0 = row word
 *   00028444  ext.l   D0
 *   00028446  move.l  D0,-(SP)                  ; push arg2 (row) sext_l
 *   00028448  movea.l A2,A0
 *   0002844A  addq.l  0x2,A2                    ; A2 += 2 (next col word)
 *   0002844C  move.w  (A0),D0w                  ; D0 = col word
 *   0002844E  ext.l   D0
 *   00028450  move.l  D0,-(SP)                  ; push arg1 (col) sext_l
 *   00028452  jsr     0x00003784.l              ; setAlphaTile(col, row, data, mask)
 *                                                ;   via jmp 0x218 trampoline
 *   00028458  lea     (0x10,SP),SP              ; cleanup 4 long arg
 *   0002845C  addq.b  0x1,D2b                   ; D2++
 *   L2_CHECK:
 *   0002845E  cmp.b   D3b,D2b                   ; D2 == D3?
 *   00028460  bne.b   L2_BODY                   ; loop fino a D2 == D3
 *
 *   ; ── Epilogo ────────────────────────────────────────────────────────
 *   00028462  movem.l (SP)+,{D2 D3 D4 A2 A3}    ; restore 20 byte
 *   00028466  rts
 *
 * **ROM tables** (word big-endian, low byte usato come col/row):
 *   0x23C2C (12 word): cols 1-player frame   = 0x0013 0x0014 0x0015 0x0016
 *                                              0x0017 0x0017 0x0017 0x0017
 *                                              0x0016 0x0015 0x0014 0x0013
 *   0x23CA4 (24 word): cols 2-player frame   = top 12 + bottom 12
 *                       = 0x000D 0x000E 0x000F 0x0010 0x0011 0x0011 0x0011
 *                         0x0011 0x0010 0x000F 0x000E 0x000D
 *                         0x0019 0x001A 0x001B 0x001C 0x001D 0x001D 0x001D
 *                         0x001D 0x001C 0x001B 0x001A 0x0019
 *   0x23C44 (24 word): rows                  = 0,0,0,0,0,1,2,3,3,3,3,3
 *                                              0,0,0,0,0,0,0,1,2,3,3,3
 *   0x23C74 (24 word): data                  = 0x5F,0x5F,0x5F,0x5F,0xFF,
 *                                              0xDF,0xDF,0x1B,0x5E,0x5E,
 *                                              0x5E,0x5E (×2 ripetuto)
 *
 * **Caller** (xref):
 *   - `FUN_00010504` @ 0x00010524 — primo init (boot/level start).
 *   - `FUN_00010504` @ 0x00010920 — secondo init nello stesso caller.
 *   In entrambi i siti la chiamata è SENZA argomenti (0 args, 0 ret).
 *
 * **JSR sub injection**: la funzione chiama 2 helper esterni nel binario:
 *   - `getAlphaTileAddr` (FUN_37E4) — calcola pointer alpha RAM da (col, row)
 *     leggendo rotation flag @ workRam[0x1F42] e ROM lookup @ 0x72A4.
 *   - `setAlphaTile`     (FUN_3784) — scrive word in alpha RAM da
 *     (col_byte, row_byte, data_word, mask_word).
 * Entrambi sono già verificati bit-perfect in `alpha-tilemap.ts` /
 * `string-format.ts`. Li chiamiamo direttamente — non serve callback bag.
 *
 * **Effetti diretti del modulo** (assumendo rotation flag e workRam ROM
 * lookup coerenti):
 *   1. `state.alphaRam[..]` mutato in 30 × 12 byte = 360 byte da Loop1
 *      (col 0..2 e col 39..41 di 30 righe, in non-rotated layout).
 *   2. `state.alphaRam[..]` mutato da 12 (1P) o 24 (2P) chiamate setAlphaTile
 *      del Loop2, che disegnano il frame attorno alla score area.
 *   3. Nessun side effect su `state.workRam` (la funzione legge solo
 *      `workRam[0x396]` per 1P/2P split, e `workRam[0x1F42]` indirettamente
 *      via `getAlphaTileAddr`).
 *
 * **Verifica bit-perfect** via
 * `packages/cli/src/test-hud-frame-init-283c2-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { getAlphaTileAddr } from "./alpha-tilemap.js";
import { setAlphaTile } from "./string-format.js";

// ─── Address constants ───────────────────────────────────────────────────

/** Offset binario della funzione (per cross-reference). */
export const FUN_283C2_ADDR = 0x000283c2 as const;

/** Workram offset del word "player count" letto per 1P/2P split (assoluto
 *  0x400396 → workRam offset 0x396). 1 = single player, 2 = two players. */
export const PLAYER_COUNT_OFF = 0x396 as const;

/** Numero di iterazioni del Loop1 (30 = righe alpha tilemap). */
export const LOOP1_ROW_COUNT = 0x1e as const;

/** Word di clear utilizzato in Loop1 (0x3400 = "blank" alpha tile attr). */
export const LOOP1_CLEAR_WORD = 0x3400 as const;

/** Offset (in BYTE) tra il primo word write e il secondo gruppo di 3 word
 *  in Loop1. Il binario calcola `A3 = A2 + 0x4E` con `add.l #0x4E, D1`. */
export const LOOP1_RIGHT_OFF = 0x4e as const;

/** Numero di word writes per gruppo (sinistro o destro) in Loop1. */
export const LOOP1_GROUP_WORDS = 3 as const;

/** ROM address del table "cols" 1-player (12 word). */
export const ROM_COLS_1P = 0x00023c2c as const;

/** ROM address del table "rows" (24 word, condiviso 1P/2P). */
export const ROM_ROWS = 0x00023c44 as const;

/** ROM address del table "data" (24 word, condiviso 1P/2P). */
export const ROM_DATA = 0x00023c74 as const;

/** ROM address del table "cols" 2-player (24 word). */
export const ROM_COLS_2P = 0x00023ca4 as const;

/** Numero di iterazioni del Loop2 in modalità 1-player. */
export const LOOP2_COUNT_1P = 0x0c as const;

/** Numero di iterazioni del Loop2 in modalità 2-player. */
export const LOOP2_COUNT_2P = 0x18 as const;

/** Mask word costante passato come arg4 a setAlphaTile in Loop2. */
export const LOOP2_MASK = 0x1c00 as const;

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Legge il word big-endian player-count da `state.workRam[0x396..0x397]`. */
function readPlayerCount(state: GameState): number {
  const r = state.workRam;
  return (
    (((r[PLAYER_COUNT_OFF] ?? 0) << 8) | (r[PLAYER_COUNT_OFF + 1] ?? 0)) &
    0xffff
  );
}

/**
 * Legge un word ROM big-endian.
 * Replica le `move.w (A0),D0w` del binario: 16-bit unsigned, big-endian.
 */
function readRomWordBE(rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  const p = rom.program;
  return (((p[a] ?? 0) << 8) | (p[a + 1] ?? 0)) & 0xffff;
}

/**
 * Scrive un word big-endian in `state.alphaRam` all'offset byte `off` (relativo
 * alla base 0xA03000). Gli offset fuori dai 4 KB allocati vengono ignorati
 * (no-op): replica il behaviour della unified memory layout dell'oracle, dove
 * scritture fuori dall'alpha RAM finiscono in altre regioni RAM-mapped che
 * non osserviamo qui.
 */
function writeAlphaWordBE(state: GameState, off: number, value: number): void {
  const v = value & 0xffff;
  const a = off | 0;
  if (a >= 0 && a + 1 < state.alphaRam.length) {
    state.alphaRam[a] = (v >>> 8) & 0xff;
    state.alphaRam[a + 1] = v & 0xff;
  }
}

// ─── Funzione principale ────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_000283C2`.
 *
 * Esegue Loop1 (clear bordi alpha tilemap, 30 righe) seguito da Loop2
 * (draw frame score area, 12 o 24 tile in base a 1P/2P).
 *
 * **Side effects**:
 *   - `state.alphaRam[..]` mutato (vedi disasm sopra).
 *   - `state.workRam` letto solo (offset 0x396 + offset 0x1F42 via
 *     `getAlphaTileAddr`).
 *   - `rom.program` letto solo (tables a 0x23C2C, 0x23C44, 0x23C74,
 *     0x23CA4 e lookup ROM 0x72A4 via `getAlphaTileAddr`).
 *
 * @param state GameState (alpha RAM mutata, work RAM solo letta).
 * @param rom   ROM image (tables + alpha-pointer lookup).
 */
export function hudFrameInit283C2(state: GameState, rom: RomImage): void {
  // ─── Loop1: clear left+right border words per ogni riga 0..29 ─────────
  for (let row = 0; row < LOOP1_ROW_COUNT; row++) {
    // Replica `move.b D2b,D0b; ext.w D0w; ext.l D0; move.l D0,-(SP); clr.l -(SP); jsr 0x37E4`.
    // arg1 (col) = 0; arg2 (row) = sext_l(row byte). row in [0, 30) è
    // sempre positivo come byte unsigned; sext.b → long positivo identità.
    const rowByte = row & 0xff;
    const baseAddr = getAlphaTileAddr(state, rom, 0, rowByte);
    // baseAddr è long unsigned. Il binario lo mette in A2 e scrive con
    // `move.w (A2)+`. La memory layout reale ha alpha RAM @ 0xA03000;
    // calcoliamo offset relativo. Se baseAddr < 0xA03000 (caso degenere
    // con shift count negativo o overflow) il write va in altre regioni:
    // la logica è gestita da writeAlphaWordBE come no-op.
    let leftOff = (baseAddr - 0xa03000) | 0;
    let rightOff = (leftOff + LOOP1_RIGHT_OFF) | 0;
    for (let i = 0; i < LOOP1_GROUP_WORDS; i++) {
      writeAlphaWordBE(state, leftOff, LOOP1_CLEAR_WORD);
      leftOff = (leftOff + 2) | 0;
      writeAlphaWordBE(state, rightOff, LOOP1_CLEAR_WORD);
      rightOff = (rightOff + 2) | 0;
    }
    // Nota: il binario fa 3× write a (A2)+ THEN 3× write a (A3)+ — non
    // interleaved. Il risultato sulla memoria è identico (alpha RAM è
    // lineare, no aliasing tra i due gruppi finché LOOP1_RIGHT_OFF >=
    // 2*LOOP1_GROUP_WORDS = 6 byte. 0x4E >> 6 → safe).
  }

  // ─── Loop2 setup: select tables + count basato su player count ─────────
  const playerCount = readPlayerCount(state);
  // Il binario fa `cmp.w (0x400396).l, D0w` con D0=1: branch "1P" se eguale.
  // bne.b → "diverso da 1" prende il path 2P. Quindi solo count==1 è 1P.
  const is1P = playerCount === 1;
  const colsBase = is1P ? ROM_COLS_1P : ROM_COLS_2P;
  const loopCount = is1P ? LOOP2_COUNT_1P : LOOP2_COUNT_2P;

  // ─── Loop2 body: 12 o 24 chiamate setAlphaTile ──────────────────────────
  for (let i = 0; i < loopCount; i++) {
    const colWord = readRomWordBE(rom, colsBase + i * 2);
    const rowWord = readRomWordBE(rom, ROM_ROWS + i * 2);
    const dataWord = readRomWordBE(rom, ROM_DATA + i * 2);
    // setAlphaTile firma: (state, rom, arg1Byte=col, arg2Byte=row,
    // arg3Word=data, arg4Word=mask). Il binario passa long sext_l del
    // word, ma setAlphaTile usa solo il low byte (per col/row) o il word
    // intero (per data/mask). Compatibile.
    const colByte = colWord & 0xff;
    const rowByte = rowWord & 0xff;
    setAlphaTile(state, rom, colByte, rowByte, dataWord, LOOP2_MASK);
  }
}

/**
 * Re-export del simbolo come "FUN_000283C2" per mappatura esplicita
 * binario→TS (segue convenzione `obj-dirty-dispatch-28624.ts`).
 */
export { hudFrameInit283C2 as FUN_000283C2 };
