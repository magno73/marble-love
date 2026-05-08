/**
 * object-init-2591a.ts — replica `FUN_0002591A` (154 byte, 0x2591A..0x259B4).
 *
 * "Object initializer" wrapper chiamato come una entry-state da uno scheduler
 * (caller noto: 0x25C34 — branch interno di un dispatcher state-machine).
 * Riceve un puntatore oggetto (long sullo stack), orchestra 6 sub-jsr e
 * scrive direttamente 12 campi della struct oggetto + 2 globals @ 0x400696/
 * 0x400698 (sentinel "force redraw" per la successiva chiamata a
 * `spritePosUpdate1BAB2`).
 *
 * **Disasm 0x2591A..0x259B4** (154 byte / 0x9A, 1 arg long sullo stack = `objPtr`):
 *
 *   0x2591A:  move.l  A2,-(SP)                       ; preserve A2
 *   0x2591C:  movea.l (0x8,SP),A2                    ; A2 = arg long (objPtr)
 *
 *   0x25920:  move.l  A2,-(SP)
 *   0x25922:  jsr     0x000262B2.l                   ; FUN_262B2(A2) — heavy init
 *
 *   0x25928:  move.l  (0x00400462).l,D1              ; D1 = *0x400462 (long)
 *   0x2592E:  moveq   #0x10,D0                       ; D0 = 16
 *   0x25930:  asl.l   D0,D1                          ; D1 <<= 16 (low word→high word)
 *   0x25932:  move.l  D1,(0xC,A2)                    ; A2[+0xC] = D1 (long)
 *
 *   0x25936:  move.l  (0x00400466).l,D1              ; D1 = *0x400466 (long)
 *   0x2593C:  moveq   #0x10,D0
 *   0x2593E:  asl.l   D0,D1                          ; D1 <<= 16
 *   0x25940:  move.l  D1,(0x10,A2)                   ; A2[+0x10] = D1 (long)
 *
 *   0x25944:  moveq   #-0x1,D0                       ; D0 = 0xFFFFFFFF
 *   0x25946:  move.w  D0w,(0x00400698).l             ; *0x400698.w = 0xFFFF
 *   0x2594C:  move.w  D0w,(0x00400696).l             ; *0x400696.w = 0xFFFF
 *
 *   0x25952:  move.l  A2,-(SP)
 *   0x25954:  jsr     0x0001BAB2.l                   ; FUN_1BAB2(A2) — sprite-pos-update
 *                                                     ;   (NB: addq.l #4,SP NON qui;
 *                                                     ;    cleanup cumulativo via lea)
 *
 *   0x2595A:  clr.l   -(SP)                          ; push 0 (long)
 *   0x2595C:  jsr     0x0001CC62.l                   ; FUN_1CC62(0) — long ret in D0
 *   0x25962:  move.l  D0,(0x14,A2)                   ; A2[+0x14] = D0 (long)
 *
 *   0x25966:  move.b  (0x00400472).l,(0x1B,A2)       ; A2[+0x1B] = *0x400472.b
 *
 *   0x2596E:  moveq   #0x0,D1
 *   0x25970:  move.l  D1,(0x8,A2)                    ; A2[+0x8] = 0 (long)
 *   0x25974:  move.l  D1,D0
 *   0x25976:  move.l  D0,(0x4,A2)                    ; A2[+0x4] = 0 (long)
 *   0x2597A:  move.l  D0,(A2)                        ; A2[+0x0] = 0 (long)
 *
 *   0x2597C:  clr.b   (0x56,A2)                      ; A2[+0x56].b = 0
 *   0x25980:  clr.b   (0x36,A2)                      ; A2[+0x36].b = 0
 *   0x25984:  clr.b   (0x58,A2)                      ; A2[+0x58].b = 0
 *
 *   0x25988:  moveq   #0x0,D1
 *   0x2598A:  move.l  D1,(0x26,A2)                   ; A2[+0x26] = 0 (long)
 *   0x2598E:  move.l  D1,(0x22,A2)                   ; A2[+0x22] = 0 (long)
 *
 *   0x25992:  move.l  A2,-(SP)
 *   0x25994:  jsr     0x00025B40.l                   ; FUN_25B40(A2) — clears A2+0x74..
 *
 *   0x2599A:  clr.l   -(SP)                          ; push 0 (long)
 *   0x2599C:  move.l  A2,-(SP)
 *   0x2599E:  jsr     0x0001B9CC.l                   ; FUN_1B9CC(A2, 0)
 *
 *   0x259A4:  move.l  A2,-(SP)
 *   0x259A6:  jsr     0x00013966.l                   ; FUN_13966(A2)
 *
 *   0x259AC:  lea     (0x1C,SP),SP                   ; pop 28 byte (7 long pushed)
 *   0x259B0:  movea.l (SP)+,A2                       ; restore A2
 *   0x259B2:  rts
 *
 * **Stack accounting**: i 7 push (4 byte ciascuno) sono:
 *   1. A2          @ 0x25920 (per FUN_262B2)
 *   2. A2          @ 0x25952 (per FUN_1BAB2)
 *   3. 0 long      @ 0x2595A (per FUN_1CC62)
 *   4. A2          @ 0x25992 (per FUN_25B40)
 *   5. 0 long      @ 0x2599A (per FUN_1B9CC, secondo arg)
 *   6. A2          @ 0x2599C (per FUN_1B9CC, primo arg)
 *   7. A2          @ 0x259A4 (per FUN_13966)
 * Cleanup cumulativo: `lea (0x1C,SP),SP` = +28 (= 7×4) byte. ✓
 *
 * **Side effects diretti su A2** (12 campi):
 *   - A2[+0x00..03]  long  ← 0
 *   - A2[+0x04..07]  long  ← 0
 *   - A2[+0x08..0B]  long  ← 0
 *   - A2[+0x0C..0F]  long  ← (*0x400462) << 16   (low word in high word)
 *   - A2[+0x10..13]  long  ← (*0x400466) << 16
 *   - A2[+0x14..17]  long  ← FUN_1CC62(0)        (D0 ret)
 *   - A2[+0x1B]      byte  ← (*0x400472).b
 *   - A2[+0x22..25]  long  ← 0
 *   - A2[+0x26..29]  long  ← 0
 *   - A2[+0x36]      byte  ← 0
 *   - A2[+0x56]      byte  ← 0
 *   - A2[+0x58]      byte  ← 0
 *
 * **Side effects su globals** (2):
 *   - *0x400696.w  ← 0xFFFF  (sentinel "tile X invalido" per FUN_1BAB2)
 *   - *0x400698.w  ← 0xFFFF  (sentinel "tile Y invalido" per FUN_1BAB2)
 *
 * **Modellazione bit-perfect** delle sottigliezze M68k:
 *
 *   1. **`asl.l D0,D1` con D0=16**: count = D0 & 63 = 16. D1 long shifted left
 *      by 16 → low word → high word, low word zero. Per JS usiamo
 *      `(d1 << 16) >>> 0` che produce esattamente lo stesso pattern
 *      (modulo 32 bit unsigned).
 *
 *   2. **`moveq #-0x1,D0; move.w D0w,addr`**: D0 = sign-extend(-1) =
 *      0xFFFFFFFF. `move.w` scrive solo low word = 0xFFFF.
 *
 *   3. **Big-endian word/long writes**: tutti i `move.l` e `move.w` scrivono
 *      in BE, replicato byte-by-byte qui.
 *
 *   4. **JSR esterne (5 sub)**: FUN_262B2, FUN_1BAB2, FUN_1CC62, FUN_25B40,
 *      FUN_1B9CC, FUN_13966 NON sono modellate qui — esposte come stub
 *      injection via `ObjectInit2591ASubs` (default no-op). Il differential
 *      test patcha tutte e 6 a stub deterministico (`rts` o `moveq #0,D0;rts`)
 *      per isolare la parità delle scritture dirette di FUN_2591A.
 *
 *   5. **Ordine delle scritture**: il binario fa le 5 scritture su A2 PRIMA
 *      di FUN_1BAB2 (offsets 0xC, 0x10), poi sentinel globals, poi DOPO
 *      FUN_1BAB2 fa le altre. Replichiamo identico ordine così che callback
 *      di FUN_1BAB2 (se presenti) vedano A2[0xC] e A2[0x10] aggiornati ma
 *      A2[0x14], A2[0x1B], A2[0..B], A2[0x22..29], A2[0x36/0x56/0x58]
 *      ancora pre-call.
 *
 * **Caller noto** (1, da xref 0x25C34): branch interno di uno scheduler
 * state-machine in zona 0x25BE0..0x25C70 (caller pusha A2, addq.l #4 dopo).
 * Pattern cdecl standard.
 *
 * Verifica bit-perfect via `cli/src/test-object-init-2591a-parity.ts`.
 */

import type { GameState } from "./state.js";
import { spriteHelper1B9CC } from "./sprite-helper-1b9cc.js";

/** Base assoluta della work RAM (0x400000 nel bus M68k). */
const WORK_RAM_BASE = 0x400000;
/** Limite superiore esclusivo workRam (0x400000 + 0x2000). */
const WORK_RAM_END = 0x402000;

/** Offsets globals letti/scritti da FUN_2591A (relativi a workRam). */
const GLOBAL_400462_OFF = 0x462; // long, letto (shift-source X)
const GLOBAL_400466_OFF = 0x466; // long, letto (shift-source Y)
const GLOBAL_400472_OFF = 0x472; // byte, letto (per A2+0x1B)
const GLOBAL_400696_OFF = 0x696; // word, scritto = 0xFFFF
const GLOBAL_400698_OFF = 0x698; // word, scritto = 0xFFFF

/** Indirizzo entry-point del binario (per parity tests / cross-ref). */
export const OBJECT_INIT_2591A_ADDR = 0x0002591a as const;

/** Offsets delle scritture dirette su A2 (per test e introspezione). */
export const OBJECT_INIT_2591A_FIELDS = {
  /** Long ← 0. */
  zeroLongAt00: 0x00,
  /** Long ← 0. */
  zeroLongAt04: 0x04,
  /** Long ← 0. */
  zeroLongAt08: 0x08,
  /** Long ← (*0x400462) << 16. */
  shiftXAt0C: 0x0c,
  /** Long ← (*0x400466) << 16. */
  shiftYAt10: 0x10,
  /** Long ← FUN_1CC62(0) return value. */
  fun1CC62RetAt14: 0x14,
  /** Byte ← (*0x400472).b. */
  byteFrom472At1B: 0x1b,
  /** Long ← 0. */
  zeroLongAt22: 0x22,
  /** Long ← 0. */
  zeroLongAt26: 0x26,
  /** Byte ← 0. */
  zeroByteAt36: 0x36,
  /** Byte ← 0. */
  zeroByteAt56: 0x56,
  /** Byte ← 0. */
  zeroByteAt58: 0x58,
} as const;

/** Indirizzi delle 6 sub-jsr nell'ordine di chiamata. */
export const OBJECT_INIT_2591A_SUB_ADDRS = [
  0x000262b2, // FUN_262B2(A2) — heavy init helper
  0x0001bab2, // FUN_1BAB2(A2) — spritePosUpdate1BAB2
  0x0001cc62, // FUN_1CC62(0)  — returns long in D0 (→ A2[0x14])
  0x00025b40, // FUN_25B40(A2) — clears A2+0x74..0xA3 (24 word + 1 byte @ +0xCA)
  0x0001b9cc, // FUN_1B9CC(A2, 0)
  0x00013966, // FUN_13966(A2)
] as const;

/**
 * Bag delle 6 sub-jsr orchestrate da `FUN_0002591A`. Ogni callback è
 * opzionale (default no-op) per consentire test isolati o iniezione di
 * stub. Ordine di chiamata identico al binario.
 */
export interface ObjectInit2591ASubs {
  /**
   * `FUN_262B2(objPtr)` — heavy initialization helper (legge state-machine
   * globals @ 0x400394, dispatcha via tabella @ 0x1EF1A, scrive in A2 e
   * altrove). Default no-op.
   */
  fun_262B2?: (state: GameState, objPtr: number) => void;
  /**
   * `FUN_1BAB2(objPtr)` — sprite-position-update + redraw-on-tile-change
   * (replicato bit-perfect in `sprite-pos-update-1bab2.ts`). Default no-op.
   *
   * Nota: chiamato DOPO che FUN_2591A ha scritto A2[0xC]/A2[0x10] (shift-pos)
   * e i sentinel @ 0x400696/0x400698 = 0xFFFF (forza redraw).
   */
  fun_1BAB2?: (state: GameState, objPtr: number) => void;
  /**
   * `FUN_1CC62(zero)` — ritorna un long in D0 che viene scritto in A2[+0x14].
   * L'argomento (long 0) è pushato dal caller come push pre-jsr. Il return
   * value reale dipende da fattori di stato (workRam @ 0x4006A0..0x4006A6,
   * A1=0x401C28). Default ritorna 0.
   */
  fun_1CC62?: (state: GameState, argZero: number) => number;
  /**
   * `FUN_25B40(objPtr)` — clears array fields:
   *   - A2[+0xCA]      byte ← 0
   *   - A2[+0x74+i*2]  word ← (tableA[i] << 11), i = 0..7
   *   - A2[+0x84+i*2]  word ← (tableB[i] << 11), i = 0..7
   *   - A2[+0x94+i*2]  word ← 0,                  i = 0..7
   * dove `tableA` @ ROM 0x1D3F4 e `tableB` @ ROM 0x1D3FC. Default no-op
   * (i campi 0x74..0xA3 e 0xCA NON vengono toccati dal modulo TS direttamente).
   */
  fun_25B40?: (state: GameState, objPtr: number) => void;
  /**
   * `FUN_1B9CC(objPtr, flagLong)` — heavy. Chiamato qui con flagLong=0.
   * Non modellato: default no-op.
   */
  fun_1B9CC?: (state: GameState, objPtr: number, flagLong: number) => void;
  /**
   * `FUN_13966(objPtr)` — dispatch su `*0x400394` + check campo @ +0x1B
   * dell'oggetto. Non modellato: default no-op.
   */
  fun_13966?: (state: GameState, objPtr: number) => void;
}

// ─── Helper interno: read/write namespace su workRam (BE M68k) ────────────

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

/** Write big-endian long su workRam (assoluto M68k). No-op se fuori range. */
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

/** Write big-endian word su workRam (assoluto M68k). No-op se fuori range. */
function writeU16BE(workRam: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 1 >= WORK_RAM_END) return;
  const off = a - WORK_RAM_BASE;
  const v = value & 0xffff;
  workRam[off] = (v >>> 8) & 0xff;
  workRam[off + 1] = v & 0xff;
}

/** Read byte da workRam (assoluto M68k). 0 se fuori range. */
function readU8(workRam: Uint8Array, addrAbs: number): number {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_END) return 0;
  return (workRam[a - WORK_RAM_BASE] ?? 0) & 0xff;
}

/** Write byte su workRam (assoluto M68k). No-op se fuori range. */
function writeU8(workRam: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_END) return;
  workRam[a - WORK_RAM_BASE] = value & 0xff;
}

/**
 * Replica `FUN_0002591A` — object initializer.
 *
 * Vedi disasm e semantica nell'header del file. Le 6 sub-jsr sono esposte
 * via `subs` (default no-op); le 12 scritture dirette su A2 e le 2 scritture
 * sui globals @ 0x400696/0x400698 sono replicate bit-perfect.
 *
 * @param state   GameState corrente (`workRam` mutato in-place).
 * @param objPtr  Puntatore assoluto M68k all'oggetto (es. `0x004012XX`).
 *                Deve cadere all'interno della work RAM e lasciare almeno
 *                0x59 byte disponibili (campo più alto: A2+0x58).
 * @param subs    Bag di callback per le 6 sub-jsr. Default: tutte no-op,
 *                tranne `fun_1CC62` che ritorna 0.
 */
export function objectInit2591A(
  state: GameState,
  objPtr: number,
  subs: ObjectInit2591ASubs = {},
): void {
  const wr = state.workRam;
  const objAbs = objPtr >>> 0;
  const objOff = (objAbs - WORK_RAM_BASE) >>> 0;

  // Guard: se objPtr fuori workRam, le scritture sono no-op (handled by
  // writeU8/U16/U32). Le sub injection ricevono comunque objAbs originale.

  // 0x25920..0x25922: FUN_262B2(A2)
  subs.fun_262B2?.(state, objAbs);

  // 0x25928..0x25932: A2[+0xC] = (*0x400462) << 16
  const g462 = readU32BE(wr, WORK_RAM_BASE + GLOBAL_400462_OFF);
  // asl.l #16: low word → high word, low word zero. Wrap @ 32 bit unsigned.
  const shifted462 = (g462 << 16) >>> 0;
  // Big-endian write a A2+0xC.
  if (
    objAbs >= WORK_RAM_BASE &&
    objAbs + 0x0c + 3 < WORK_RAM_END
  ) {
    wr[objOff + 0x0c + 0] = (shifted462 >>> 24) & 0xff;
    wr[objOff + 0x0c + 1] = (shifted462 >>> 16) & 0xff;
    wr[objOff + 0x0c + 2] = (shifted462 >>> 8) & 0xff;
    wr[objOff + 0x0c + 3] = shifted462 & 0xff;
  }

  // 0x25936..0x25940: A2[+0x10] = (*0x400466) << 16
  const g466 = readU32BE(wr, WORK_RAM_BASE + GLOBAL_400466_OFF);
  const shifted466 = (g466 << 16) >>> 0;
  if (
    objAbs >= WORK_RAM_BASE &&
    objAbs + 0x10 + 3 < WORK_RAM_END
  ) {
    wr[objOff + 0x10 + 0] = (shifted466 >>> 24) & 0xff;
    wr[objOff + 0x10 + 1] = (shifted466 >>> 16) & 0xff;
    wr[objOff + 0x10 + 2] = (shifted466 >>> 8) & 0xff;
    wr[objOff + 0x10 + 3] = shifted466 & 0xff;
  }

  // 0x25944..0x2594C: globals @ 0x400696 e 0x400698 ← 0xFFFF (word).
  // moveq #-1, D0 → D0=0xFFFFFFFF; move.w D0w → low word = 0xFFFF.
  writeU16BE(wr, WORK_RAM_BASE + GLOBAL_400698_OFF, 0xffff);
  writeU16BE(wr, WORK_RAM_BASE + GLOBAL_400696_OFF, 0xffff);

  // 0x25952..0x25954: FUN_1BAB2(A2)
  subs.fun_1BAB2?.(state, objAbs);

  // 0x2595A..0x25962: A2[+0x14] = FUN_1CC62(0)
  const fun1CC62Ret = (subs.fun_1CC62?.(state, 0) ?? 0) >>> 0;
  if (
    objAbs >= WORK_RAM_BASE &&
    objAbs + 0x14 + 3 < WORK_RAM_END
  ) {
    wr[objOff + 0x14 + 0] = (fun1CC62Ret >>> 24) & 0xff;
    wr[objOff + 0x14 + 1] = (fun1CC62Ret >>> 16) & 0xff;
    wr[objOff + 0x14 + 2] = (fun1CC62Ret >>> 8) & 0xff;
    wr[objOff + 0x14 + 3] = fun1CC62Ret & 0xff;
  }

  // 0x25966: A2[+0x1B] = (*0x400472).b
  const g472 = readU8(wr, WORK_RAM_BASE + GLOBAL_400472_OFF);
  writeU8(wr, objAbs + 0x1b, g472);

  // 0x2596E..0x2597A: A2[+0x8], A2[+0x4], A2[+0x0] ← 0 (long)
  writeU32BE(wr, objAbs + 0x08, 0);
  writeU32BE(wr, objAbs + 0x04, 0);
  writeU32BE(wr, objAbs + 0x00, 0);

  // 0x2597C..0x25984: bytes @ +0x56, +0x36, +0x58 ← 0
  writeU8(wr, objAbs + 0x56, 0);
  writeU8(wr, objAbs + 0x36, 0);
  writeU8(wr, objAbs + 0x58, 0);

  // 0x25988..0x2598E: A2[+0x26], A2[+0x22] ← 0 (long)
  writeU32BE(wr, objAbs + 0x26, 0);
  writeU32BE(wr, objAbs + 0x22, 0);

  // 0x25992..0x25994: FUN_25B40(A2)
  subs.fun_25B40?.(state, objAbs);

  // 0x2599A..0x2599E: FUN_1B9CC(A2, 0)
  (subs.fun_1B9CC ?? spriteHelper1B9CC)(state, objAbs, 0);

  // 0x259A4..0x259A6: FUN_13966(A2)
  subs.fun_13966?.(state, objAbs);

  // 0x259AC..0x259B2: lea +0x1C, SP; movea.l (SP)+, A2; rts → no return value.
}
