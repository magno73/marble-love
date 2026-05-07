/**
 * object-scan-dispatch-251de.ts — replica `FUN_000251DE` (478 byte,
 * 0x251DE..0x253BC).
 *
 * "Object scan + step + endgame detector + state-2 respawn" wrapper chiamato
 * dal main-loop dispatcher (xref 0x10FD4 in FUN_00010FCE). Itera sull'array
 * di object struct (`0x400018`, stride `0xE2`, count = `*0x400396`), per ogni
 * obj:
 *
 *   1. Skip se `obj+0x18.b == 0` (slot vuoto). Conta come state-2 (D2++).
 *   2. Se `obj+0x6A.w > 400 (0x190)` (signed-irrelevant, cmpi.w) chiama
 *      `FUN_2822E` (no arg, callback `fun_2822E`).
 *   3. Esegui `FUN_253EC(obj)` (object-step inner).
 *   4. Re-leggi `obj+0x18.b`:
 *        - se `== 2` → D2++, skip
 *        - se `== 3` → D3++, skip
 *        - altrimenti, gate: count == 2 (i.e. `*0x400396 == 2`).
 *          Se NO: skip.
 *          Se SÌ: ulteriori filtri sulla coord X = `obj+0x20.w` (segnato),
 *          su `obj+0x36.b` e su `obj+0x1A.b`. Se passano:
 *            → "respawn block" (vedi sotto).
 *
 * Il "respawn block" (0x252A2..0x2536C) replica fedelmente le scritture
 * dirette di `FUN_2591A` (object-init) inline + 4 jsr addizionali e altre
 * scritture, terminato da:
 *   - `obj+0x6A.w -= 5` (signed)
 *   - se `< 0`: `obj+0x6A.w = 1`, `obj+0x6C.b = 0`, `obj+0x6E.b = 0`
 *   - `soundCommand(0x3C)`
 *   - `obj+0x5A long = 0`
 *   - `obj+0x1A.b = 4`
 *   - `obj+0xD2.w += 1` (16-bit wrap)
 *   - `obj+0x57.b = 0x65`
 *   - `FUN_285B0(obj, 0x0000000F)`
 *
 * **Endgame detector** (post-loop):
 *   - Se `D3 == count`  → all-state-3.
 *   - Else if `D3 != 0 && D2 == count - 1` → near-all-state-2/3.
 *   - In entrambi i casi: se `*0x400390.w != 1` → set `*0x400390.w = 3`.
 *
 * **Disasm 0x251DE..0x253BC** (vedi `/tmp/marble-cand/0251DE.txt`).
 *
 * **Sub-jsr esterne (5)**:
 *   - 0x1BBAA  `objectCharcodeBroadcast1BBAA(state, rom)` — chiamato 1 volta
 *              prima del loop (no arg via stack, ma il modulo usa
 *              `*0x400394`, `*0x400396`, ecc.).
 *   - 0x2822E  `FUN_2822E()` — chiamato per gate `obj+0x6A.w > 400` (non
 *              modellato, default no-op).
 *   - 0x253EC  `FUN_253EC(obj)` — object-step inner per ogni obj. Callback
 *              obbligatoria (ma default no-op).
 *   - 0x17934  `FUN_17934(obj)` — chiamato dentro respawn block (default
 *              no-op).
 *   - 0x1BAB2  `spritePosUpdate1BAB2(obj)` — chiamato dentro respawn block.
 *   - 0x1CC62  `spriteProject1CC62(0)` — long ret in D0 → obj+0x14.
 *   - 0x1B9CC  `FUN_1B9CC(obj, 0)` — chiamato dentro respawn block.
 *   - 0x158AC  `soundCommand(0x3C)` — chiamato dentro respawn block.
 *   - 0x285B0  `FUN_285B0(obj, 0x0F)` — chiamato dentro respawn block.
 *
 * **Modellazione bit-perfect** delle sottigliezze M68k:
 *
 *   1. **`addq.b #1` su D2/D3**: incrementa solo low byte. Per count ≤ 127
 *      (caso reale: max ~22 obj data layout workRam) il byte non wrappa,
 *      ma replichiamo `& 0xFF` per safety.
 *
 *   2. **`ext.w; ext.l` su byte D2/D3**: sign-extend byte → word → long.
 *      Per byte ≤ 0x7F equivalente a unsigned. Replichiamo via guardia
 *      `(b & 0x80) ? b - 0x100 : b`.
 *
 *   3. **`cmpi.w #0x190`** su `obj+0x6A`: confronto signed word. Word in
 *      memoria letto big-endian, sign-ext per branch.
 *
 *   4. **`andi.w #-1, D0w`** dopo `move.w (0x20,A2),D0w`: AND con 0xFFFF
 *      (no-op valore, set CCR). Replichiamo solo per documentazione.
 *
 *   5. **`cmpi.w #0xEC; ble`** seguito da level-check (`*0x400394 == 4`).
 *      Logica: skip respawn se X (signed) > 0xEC AND level != 4. Poi se X
 *      (signed) >= -8 AND level != 4: skip respawn. Equivalente:
 *      respawn richiede `(-8 < X <= 0xEC) OR level == 4`.
 *      Implementiamo testualmente le 2 branch separate per fedeltà.
 *
 *   6. **`asl.l #16, D1` con globals @ 0x400462/0x400466**: replicato come
 *      `(g << 16) >>> 0` (big-endian long). Identico a `objectInit2591A`.
 *
 *   7. **`pea (0x3C).l`** vs **`pea (0xF).w`**: il primo pusha long 0x3C,
 *      il secondo pusha 0xF sign-extended a long. Per 0x0F bit alto = 0,
 *      sign-ext = 0x0000000F. Replicato come int32.
 *
 *   8. **`subq.w #5,(0x6A,A2)` con `bge`**: il flag N è settato sul risultato
 *      signed word. Replichiamo via sign-extension.
 *
 *   9. **`addq.w #1,(0xD2,A2)`**: 16-bit wrap.
 *
 *  10. **State machine global @ 0x400390**: `cmp.w (0x00400390).l, D0w` con
 *      D0=1 → confronto solo word low. Set `*0x400390.w = 3` (write word).
 *
 * **Caller noto**: `FUN_00010FCE` @ 0x10FD4 (UNCONDITIONAL_CALL).
 *
 * Verifica bit-perfect via `cli/src/test-object-scan-dispatch-251de-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

/** Base assoluta della work RAM (0x400000 nel bus M68k). */
const WORK_RAM_BASE = 0x00400000;
/** Limite superiore esclusivo workRam (0x400000 + 0x2000). */
const WORK_RAM_END = 0x00402000;

/** Indirizzo entry-point del binario (per parity tests / cross-ref). */
export const OBJECT_SCAN_DISPATCH_251DE_ADDR = 0x000251de as const;

/** Globals usati. */
export const GLOBAL_OBJ_BASE_ADDR = 0x00400018 as const;
export const GLOBAL_OBJ_COUNT_ADDR = 0x00400396 as const;
export const GLOBAL_LEVEL_IDX_ADDR = 0x00400394 as const;
export const GLOBAL_GS_FLAG_ADDR = 0x00400390 as const;
export const GLOBAL_SHIFT_X_ADDR = 0x00400462 as const;
export const GLOBAL_SHIFT_Y_ADDR = 0x00400466 as const;
export const GLOBAL_BYTE_472_ADDR = 0x00400472 as const;
export const GLOBAL_TILE_X_ADDR = 0x00400696 as const;
export const GLOBAL_TILE_Y_ADDR = 0x00400698 as const;

/** Stride tra object struct adiacenti. */
export const OBJ_STRIDE = 0xe2 as const;

/** Indirizzi delle 9 sub-jsr nell'ordine di chiamata possibile. */
export const OBJECT_SCAN_DISPATCH_251DE_SUB_ADDRS = [
  0x0001bbaa, // objectCharcodeBroadcast1BBAA — pre-loop
  0x0002822e, // FUN_2822E — gate obj+0x6A.w > 400
  0x000253ec, // FUN_253EC(obj) — object-step inner
  0x00017934, // FUN_17934(obj) — pre-init helper
  0x0001bab2, // FUN_1BAB2(obj) — sprite pos update
  0x0001cc62, // FUN_1CC62(0)  — sprite project, ret long
  0x0001b9cc, // FUN_1B9CC(obj, 0)
  0x000158ac, // FUN_158AC(0x3C) — sound command
  0x000285b0, // FUN_285B0(obj, 0x0F)
] as const;

/** Bag delle sub-jsr (default: tutti no-op tranne `fun_1CC62` ritorna 0). */
export interface ObjectScanDispatch251DESubs {
  /**
   * `FUN_1BBAA(state, rom)` — object-charcode broadcast (pre-loop, 1 volta).
   * Default no-op.
   */
  fun_1BBAA?: (state: GameState, rom: RomImage) => void;
  /**
   * `FUN_2822E()` — chiamato per ogni obj con `obj+0x6A.w > 400`. No arg.
   * Default no-op.
   */
  fun_2822E?: (state: GameState) => void;
  /**
   * `FUN_253EC(objPtr)` — object-step inner, chiamato per ogni obj non-vuoto.
   * Default no-op.
   */
  fun_253EC?: (state: GameState, objPtr: number) => void;
  /**
   * `FUN_17934(objPtr)` — pre-init helper nel respawn block. Default no-op.
   */
  fun_17934?: (state: GameState, objPtr: number) => void;
  /**
   * `FUN_1BAB2(objPtr)` — sprite pos update nel respawn block. Default no-op.
   */
  fun_1BAB2?: (state: GameState, objPtr: number) => void;
  /**
   * `FUN_1CC62(zero)` — sprite project: ritorna long → obj+0x14. Default 0.
   */
  fun_1CC62?: (state: GameState, argZero: number) => number;
  /**
   * `FUN_1B9CC(objPtr, flagLong)` — chiamato con flagLong=0. Default no-op.
   */
  fun_1B9CC?: (state: GameState, objPtr: number, flagLong: number) => void;
  /**
   * `FUN_158AC(cmd)` — sound command sender. Chiamato 1 volta nel respawn
   * block con `cmd=0x3C`. Default no-op.
   */
  soundCommand?: (state: GameState, cmd: number) => void;
  /**
   * `FUN_285B0(objPtr, modeLong)` — chiamato nel respawn block con
   * `modeLong=0x0000000F`. Default no-op.
   */
  fun_285B0?: (state: GameState, objPtr: number, modeLong: number) => void;
}

// ─── Helper interni: read/write su workRam (BE M68k) ─────────────────────

/** Read big-endian long da workRam (assoluto M68k). 0 se fuori range. */
function readU32BE(workRam: Uint8Array, addrAbs: number): number {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 3 >= WORK_RAM_END) return 0;
  const off = a - WORK_RAM_BASE;
  return (
    (((workRam[off] ?? 0) << 24) |
      ((workRam[off + 1] ?? 0) << 16) |
      ((workRam[off + 2] ?? 0) << 8) |
      (workRam[off + 3] ?? 0)) >>>
    0
  );
}

/** Read big-endian word da workRam. 0 se fuori range. */
function readU16BE(workRam: Uint8Array, addrAbs: number): number {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 1 >= WORK_RAM_END) return 0;
  const off = a - WORK_RAM_BASE;
  return (((workRam[off] ?? 0) << 8) | (workRam[off + 1] ?? 0)) & 0xffff;
}

/** Read byte da workRam. 0 se fuori range. */
function readU8(workRam: Uint8Array, addrAbs: number): number {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_END) return 0;
  return (workRam[a - WORK_RAM_BASE] ?? 0) & 0xff;
}

/** Write big-endian long su workRam. No-op se fuori range. */
function writeU32BE(workRam: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 3 >= WORK_RAM_END) return;
  const off = a - WORK_RAM_BASE;
  const v = value >>> 0;
  workRam[off] = (v >>> 24) & 0xff;
  workRam[off + 1] = (v >>> 16) & 0xff;
  workRam[off + 2] = (v >>> 8) & 0xff;
  workRam[off + 3] = v & 0xff;
}

/** Write big-endian word su workRam. No-op se fuori range. */
function writeU16BE(workRam: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 1 >= WORK_RAM_END) return;
  const off = a - WORK_RAM_BASE;
  const v = value & 0xffff;
  workRam[off] = (v >>> 8) & 0xff;
  workRam[off + 1] = v & 0xff;
}

/** Write byte su workRam. No-op se fuori range. */
function writeU8(workRam: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_END) return;
  workRam[a - WORK_RAM_BASE] = value & 0xff;
}

/** Sign-extend word (16-bit) → signed int. */
function sext16(w: number): number {
  const v = w & 0xffff;
  return v & 0x8000 ? v - 0x10000 : v;
}

// ─── Implementation ──────────────────────────────────────────────────────

/**
 * Replica `FUN_000251DE` — object scan + step + endgame detector.
 *
 * @param state  GameState (`workRam` mutato in-place; varie scritture su
 *               obj struct + globals @ 0x400390/0x400696/0x400698).
 * @param rom    RomImage richiesta da `fun_1BBAA` (può essere stub se la
 *               callback è no-op).
 * @param subs   Bag delle 9 sub-jsr; default: tutte no-op tranne `fun_1CC62`
 *               che ritorna 0 (compatibile con stub `moveq #0,D0;rts` lato
 *               binario).
 */
export function objectScanDispatch251DE(
  state: GameState,
  rom: RomImage,
  subs: ObjectScanDispatch251DESubs = {},
): void {
  const wr = state.workRam;

  // ── 0x251E2: A3 = 0x400396 (count) — chiamiamo objectCharcodeBroadcast1BBAA.
  subs.fun_1BBAA?.(state, rom);

  // ── 0x251EE..0x251F0: D2 = 0, D3 = 0 (counters). 0x251F8: D4 = 0 (idx).
  let d2 = 0; // state-2 / empty counter (byte)
  let d3 = 0; // state-3 counter (byte)
  let d4 = 0; // outer index (byte)

  // ── 0x251F2: A2 = 0x400018 (obj base).
  let a2 = GLOBAL_OBJ_BASE_ADDR; // current obj ptr

  // Loop test (bra to 0x2537C → cmp.w D4, count).
  // Read count once per iter from *0x400396 (binary re-reads each loop check).
  while (true) {
    // 0x2537C..0x25382: byte D4 → ext.w → cmp.w (A3).
    // (ext.w byte 0..127 → 0..127; byte 128..255 → -128..-1.)
    const d4w = (d4 & 0x80) !== 0 ? (d4 & 0xff) - 0x100 : d4 & 0xff;
    const countW = readU16BE(wr, GLOBAL_OBJ_COUNT_ADDR);
    const countS = sext16(countW);
    if (d4w === countS) break; // loop end (bne to body, fall-through to post)
    // (NB: bne in binario = exit loop quando equal. Fall-through = post-loop.)

    // ─── 0x251FE..0x25204: tst.b (0x18,A2); if 0: D2++; bra next ──────
    const state18 = readU8(wr, a2 + 0x18);
    if (state18 === 0) {
      d2 = (d2 + 1) & 0xff;
      // goto next
    } else {
      // 0x2520A: cmpi.w #0x190, (0x6a,A2); ble skip; else FUN_2822E()
      const w6a = readU16BE(wr, a2 + 0x6a);
      const w6aS = sext16(w6a);
      // cmpi.w #0x190 con dst (0x6a,A2): set CCR su (dst - 0x190).
      // ble = N|Z|V branch — equivalente a `dst <= 0x190` signed.
      // bne (skip jsr) when ble fails → dst > 0x190 (signed).
      if (w6aS > 0x190) {
        subs.fun_2822E?.(state);
      }

      // 0x25218..0x25220: jsr FUN_253EC(A2); cmpi.b #2, (0x18,A2)
      subs.fun_253EC?.(state, a2);

      const stateAfter = readU8(wr, a2 + 0x18);
      if (stateAfter === 0x02) {
        // 0x2522A..0x2522C: D2++, skip
        d2 = (d2 + 1) & 0xff;
      } else if (stateAfter === 0x03) {
        // 0x25238..0x2523A: D3++, skip
        d3 = (d3 + 1) & 0xff;
      } else {
        // 0x2523E..0x25242: gate "count == 2" (i.e. 2 == *0x400396)
        // moveq #2, D0; cmp.w (A3), D0w; bne skip
        // (bne if D0(=2) != count) → skip if count != 2
        const countNow = readU16BE(wr, GLOBAL_OBJ_COUNT_ADDR) & 0xffff;
        if ((countNow & 0xffff) === 2) {
          // 0x25246..0x2524E: D0w = (0x20,A2); andi.w #-1; cmpi.w #0xEC, D0w
          // ble (X ≤ 0xEC signed) → 0x25260 (lower-bound check).
          // bgt (X > 0xEC) → 0x25254: cmp.w level==4; bne 0x2527C (proceed)
          //                            else fall-through to 0x25260.
          //
          // 0x25260..0x2526C: D1=-8; cmp.w D0w,D1w; ble next.
          //   ble (D1 ≤ D0 signed) = -8 ≤ X → goto next (skip).
          //   bgt (D1 > D0) = X < -8 → 0x25270.
          // 0x25270..0x25278: cmp.w level==4; bne next; else fall-through 2527C.
          //
          // Net: proceed (reach 0x2527C) iff:
          //   (X > 0xEC AND level != 4) OR (X < -8 AND level == 4).
          const x20S = sext16(readU16BE(wr, a2 + 0x20));
          const lvl = readU16BE(wr, GLOBAL_LEVEL_IDX_ADDR) & 0xffff;
          const proceedToFilter =
            (x20S > 0xec && lvl !== 4) || (x20S < -8 && lvl === 4);

          if (proceedToFilter) {
            // 0x2527C: cmpi.b #2, (0x36,A2); beq skip
            const b36 = readU8(wr, a2 + 0x36);
            if (b36 !== 0x02) {
              // 0x25286..0x2529E: filter su (0x1A,A2):
              // tst.b (0x1a,A2); beq RESET (0x252a2)
              // cmpi.b #1, (0x1a,A2); beq RESET
              // cmpi.b #5, (0x1a,A2); bne skip
              const b1a = readU8(wr, a2 + 0x1a);
              if (b1a === 0 || b1a === 1 || b1a === 5) {
                respawnBlock(state, a2, subs);
              }
              // else: skip (bne)
            }
            // else: skip
          }
          // else: skip (proceedToFilter false)
        }
        // else: count != 2 → skip
      }
    }

    // 0x25370..0x2537A: A2 += 0xE2; D4++.
    a2 = (a2 + OBJ_STRIDE) >>> 0;
    d4 = (d4 + 1) & 0xff;
  }

  // ── 0x25386..0x253AC: post-loop endgame detector ─────────────────────
  // move.b D3b, D0b; ext.w; cmp.w (A3), D0w; beq SET_FLAG (0x253A4)
  const d3w = (d3 & 0x80) !== 0 ? (d3 & 0xff) - 0x100 : d3 & 0xff;
  const countFinal = readU16BE(wr, GLOBAL_OBJ_COUNT_ADDR);
  const countFinalS = sext16(countFinal);

  let setFlag = false;
  if (d3w === countFinalS) {
    // beq SET_FLAG
    setFlag = true;
  } else if (d3 !== 0) {
    // tst.b D3b; beq epilogue
    // move.b D2b, D0b; ext.w; ext.l; D1 = count word ext.l; D1 -= 1;
    // cmp.l D1, D0; bne epilogue. else: fall through SET_FLAG.
    const d2W = (d2 & 0x80) !== 0 ? (d2 & 0xff) - 0x100 : d2 & 0xff;
    const d2Long = d2W; // ext.l su signed word identico a signed int
    const d1Long = countFinalS - 1;
    if (d2Long === d1Long) {
      setFlag = true;
    }
  }

  if (setFlag) {
    // 0x253A4..0x253B4: moveq #1, D0; cmp.w (0x400390).l, D0w
    // beq epilogue (i.e. if global == 1, skip). Else move.w #3, (0x400390).l
    const g390 = readU16BE(wr, GLOBAL_GS_FLAG_ADDR);
    if ((g390 & 0xffff) !== 1) {
      writeU16BE(wr, GLOBAL_GS_FLAG_ADDR, 3);
    }
  }
}

/**
 * Replica del "respawn block" 0x252A2..0x2536C — inline bit-perfect
 * dell'inizializzatore oggetto + tail ad hoc (sub 5 e sound). Mantenuto
 * separato per leggibilità e perché ricalca scritture identiche a
 * `objectInit2591A` (vedi `object-init-2591a.ts`) con l'ordine binario.
 */
function respawnBlock(
  state: GameState,
  a2: number,
  subs: ObjectScanDispatch251DESubs,
): void {
  const wr = state.workRam;

  // 0x252A2..0x252A4: jsr FUN_17934(A2)
  subs.fun_17934?.(state, a2);

  // 0x252AA..0x252B4: A2[+0xC] = (*0x400462) << 16
  const g462 = readU32BE(wr, GLOBAL_SHIFT_X_ADDR);
  const shifted462 = (g462 << 16) >>> 0;
  writeU32BE(wr, a2 + 0x0c, shifted462);

  // 0x252B8..0x252C2: A2[+0x10] = (*0x400466) << 16
  const g466 = readU32BE(wr, GLOBAL_SHIFT_Y_ADDR);
  const shifted466 = (g466 << 16) >>> 0;
  writeU32BE(wr, a2 + 0x10, shifted466);

  // 0x252C6..0x252CE: globals @ 0x400698, 0x400696 ← 0xFFFF (word).
  // moveq #-1, D0 → 0xFFFFFFFF; move.w D0w → low word = 0xFFFF.
  writeU16BE(wr, GLOBAL_TILE_Y_ADDR, 0xffff);
  writeU16BE(wr, GLOBAL_TILE_X_ADDR, 0xffff);

  // 0x252D4..0x252D6: jsr FUN_1BAB2(A2)
  subs.fun_1BAB2?.(state, a2);

  // 0x252DC..0x252E4: A2[+0x14] = FUN_1CC62(0)
  const fun1CC62Ret = (subs.fun_1CC62?.(state, 0) ?? 0) >>> 0;
  writeU32BE(wr, a2 + 0x14, fun1CC62Ret);

  // 0x252E8: A2[+0x1B] = (*0x400472).b
  const g472 = readU8(wr, GLOBAL_BYTE_472_ADDR);
  writeU8(wr, a2 + 0x1b, g472);

  // 0x252F0..0x252FC: A2[+0x8], A2[+0x4], A2[+0x0] ← 0 (long).
  writeU32BE(wr, a2 + 0x08, 0);
  writeU32BE(wr, a2 + 0x04, 0);
  writeU32BE(wr, a2 + 0x00, 0);

  // 0x252FE..0x25304: clr.b D0b; move.b D0b,(0x57,A2); move.b D0b,(0x56,A2)
  writeU8(wr, a2 + 0x57, 0);
  writeU8(wr, a2 + 0x56, 0);

  // 0x25308..0x2530C: clr.b (0x36,A2); clr.b (0x58,A2)
  writeU8(wr, a2 + 0x36, 0);
  writeU8(wr, a2 + 0x58, 0);

  // 0x25310..0x25316: A2[+0x26], A2[+0x22] ← 0 (long)
  writeU32BE(wr, a2 + 0x26, 0);
  writeU32BE(wr, a2 + 0x22, 0);

  // 0x2531A..0x2531E: jsr FUN_1B9CC(A2, 0)
  subs.fun_1B9CC?.(state, a2, 0);

  // 0x25324..0x2533C: subq.w #5, (0x6A,A2); tst.w; lea ...; bge skip;
  //                   move.w #1, (0x6A,A2); clr.b (0x6C,A2); clr.b (0x6E,A2)
  const w6a = readU16BE(wr, a2 + 0x6a);
  const w6aNew = (w6a - 5) & 0xffff;
  writeU16BE(wr, a2 + 0x6a, w6aNew);
  // bge: branch if N==0 (signed >= 0). Tst.w sets N from word sign bit.
  const w6aNewS = sext16(w6aNew);
  if (w6aNewS < 0) {
    writeU16BE(wr, a2 + 0x6a, 1);
    writeU8(wr, a2 + 0x6c, 0);
    writeU8(wr, a2 + 0x6e, 0);
  }

  // 0x25340..0x25346: pea (0x3C).l; jsr FUN_158AC → soundCommand(0x3C)
  subs.soundCommand?.(state, 0x3c);

  // 0x2534C: clr.l (0x5A,A2)
  writeU32BE(wr, a2 + 0x5a, 0);

  // 0x25350: move.b #0x4, (0x1A,A2)
  writeU8(wr, a2 + 0x1a, 0x04);

  // 0x25356: addq.w #1, (0xD2,A2)  (16-bit wrap)
  const wD2 = readU16BE(wr, a2 + 0xd2);
  writeU16BE(wr, a2 + 0xd2, (wD2 + 1) & 0xffff);

  // 0x2535A: move.b #0x65, (0x57,A2)
  writeU8(wr, a2 + 0x57, 0x65);

  // 0x25360..0x25366: pea (0xF).w (sign-ext to 0x0F long); move.l A2,-(SP);
  //                   jsr FUN_285B0(A2, 0xF)
  subs.fun_285B0?.(state, a2, 0x0000000f);
}
