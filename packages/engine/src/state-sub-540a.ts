/**
 * state-sub-540a.ts — `FUN_0000540A` replica (94 bytes, up to `rts` @ 0x5466).
 *
 *
 * **Disasm 0x540A..0x5466** (94 bytes / 0x5C):
 *
 *   0x540A:  movem.l {A2 D3 D2},-(SP)        ; preserve D2,D3,A2
 *   0x540E:  movea.l (0x10,SP),A2            ; A2 = arg1 (long ptr)
 *   0x5412:  move.w  (0x16,SP),D3w           ; D3w = arg2 (word count)
 *   0x5416:  bra.b   0x544A                  ; jump to outer-loop test
 *
 *   0x5418: outer_body:
 *   0x5418:    move.l A2,-(SP)
 *   0x541A:    jsr    0x53EA.l                ; D0 = byte[A2] | byte[A2+1]
 *   0x5420:    tst.l  D0
 *   0x5422:    addq.l #4,SP
 *   0x5424:    beq.w  0x544E                  ; if pair==00 → exit_path (no decrement)
 *   0x5428:    moveq  #1,D2                   ; D2 = 1
 *   0x542A:    move.b (A2),D0b                 ; D0b = byte[A2] (HEADER) — only low byte!
 *                                              ;   D0 high 24 bits remain from FUN_53EA
 *                                              ;   but are 0x000000 (output range 0..0xFF)
 *   0x542C:    lsr.b  #4,D0b                  ; D0b = header >> 4 (high nibble)
 *   0x542E:    addq.b #1,D0b                  ; D0b += 1
 *   0x5430:    move.b (A2)+,D1b               ; D1b = header; A2++
 *   0x5432:    andi.b #0xF,D1b                ; D1b = header & 0xF (low nibble)
 *   0x5436:    sub.b  D1b,D0b                 ; D0b = ((hdr>>4)+1) - (hdr&0xF)  byte sub
 *   0x5438:    asl.l  D0,D2                   ; D2 = 1 << (D0 mod 64)  (M68k asl.l)
 *                                              ;   or 0xF2..0xFF (negative byte sub). The
 *   0x543A:    move.w D2w,D0w                 ; D0w = D2w (low word of D2)
 *   0x543C:    bra.b  0x5444                  ; jump to inner-loop test
 *
 *   0x543E: inner_body:
 *   0x543E:    tst.b  (A2)+                   ; A2++; sets Z flag on byte
 *                                              ; after post-increment
 *   0x5444: tst.w  D0w
 *   0x5446: bge.b  0x543E                     ; if D0w >= 0 (signed) -> inner_body
 *
 *   0x5448:    subq.w #1,D3w                  ; D3w--
 *   0x544A: tst.w  D3w
 *   0x544C: bne.b  0x5418                     ; if D3w != 0 → outer_body
 *
 *   0x544E: exit_path:
 *   0x544E:    move.l A2,-(SP)
 *   0x5450:    jsr    0x53EA.l                ; D0 = byte[A2] | byte[A2+1]
 *   0x5456:    tst.l  D0
 *   0x5458:    addq.l #4,SP
 *   0x545A:    bne.b  0x5460
 *   0x545C:    moveq  #0,D0                   ; return 0  (pair==0 → end of table)
 *   0x545E:    bra.b  0x5462
 *   0x5460:    move.l A2,D0                   ; return A2 (advanced pointer)
 *   0x5462:    movem.l (SP)+,{D2 D3 A2}
 *   0x5466:    rts
 *
 * **FUN_0000053EA (callee, 32 byte)**:
 *
 *   move.l D2,-(SP)
 *   movea.l (0x8,SP),A0          ; A0 = arg ptr
 *   moveq  #0,D1
 *   move.b (A0),D1b              ; D1 = byte[A0]
 *   moveq  #0,D0
 *   move.b (A0)+,D0b             ; D0 = byte[A0]; A0++
 *   movea.l A0,A1                ; A1 = A0+1
 *   addq.l #1,A0                 ; A0 = A0+2
 *   moveq  #0,D2
 *   move.b (A1),D2b              ; D2 = byte[A1] = byte[A0_orig+1]
 *   or.l   D2,D0                 ; D0 = byte[A0_0] | byte[A0_0+1]
 *   or.l   D0,D1                 ; D1 = byte[A0_0] | byte[A0_0+1]
 *   move.l D1,D0
 *   move.l (SP)+,D2
 *
 *     of records to scan.
 *   - D2, D3, A2 callee-saved (preserved/restored by movem.l).
 *
 *
 *
 *   1. **`move.b (A2),D0b` with D0 high bits from FUN_53EA**: output of
 *      subsequent ops modify ONLY the low byte. `lsr.b`, `addq.b`, `sub.b` operate
 *
 *   2. **`asl.l Dn,Dm` semantics**: count = `Dn & 63`. For shift count >= 32,
 *
 *      D2 & 0xFFFF.
 *
 *   4. **`tst.w D0w; bge.b ...`**: bge checks the signed N flag. D0w as signed
 *      word is negative when bit 15 is set. For D2 count=15 (`1<<15 = 0x8000`),
 *      D0w is negative. For count=14, D0w = 16384 positive, so the loop body
 *      executes 16385 times as D0w decrements to -1. For count=16
 *      (`0x10000` & 0xFFFF = 0), D0w = 0, bge passes, the body runs once, then
 *      D0w becomes -1 and exits.
 *
 *
 *   6. **Outer test `subq.w #1,D3w; tst.w D3w; bne ...`**: equivalent to
 *      `tst.w D3w` pre-decrement. D3=0 -> 0 iterations; D3=1 -> 1 iteration
 *      (body, decrement, then test fails and exits). D3=0xFFFF -> 65535
 *      iterations (potentially huge).
 *
 *
 *
 */

import type { GameState } from "./state.js";

const WORK_RAM_BASE = 0x400000;
/** Exclusive upper WORK RAM limit (0x400000 + 0x2000). */
const WORK_RAM_END = 0x402000;

/**
 * Internal helper: port of `FUN_0000053EA` (read-byte-pair OR).
 *
 *
 *               consistent with `r[idx] ?? 0` elsewhere in the codebase.
 * @returns      `(byte[ptr] | byte[ptr+1]) >>> 0`, range `0..0xFF`.
 */
export function fun53EA(state: GameState, ptr: number): number {
  const r = state.workRam;
  const ptrU = ptr >>> 0;
  const off0 = (ptrU - WORK_RAM_BASE) >>> 0;
  const off1 = (ptrU + 1 - WORK_RAM_BASE) >>> 0;
  const b0 =
    ptrU >= WORK_RAM_BASE && ptrU < WORK_RAM_END
      ? (r[off0] ?? 0) & 0xff
      : 0;
  const b1 =
    ptrU + 1 >= WORK_RAM_BASE && ptrU + 1 < WORK_RAM_END
      ? (r[off1] ?? 0) & 0xff
      : 0;
  return (b0 | b1) >>> 0;
}

/**
 *
 *
 */
export type StateSub540AResult = number;

/**
 * Port of `FUN_0000540A` - table-of-string-records walker.
 *
 * See the disassembly and semantics in the module header.
 *
 * @param a2     Absolute M68k pointer (long). Points to the head of a record
 *               (header byte + string-list). Known callers pass workRam
 *               addresses (`0x400000..0x401FFF`); out-of-range reads match the
 *               rest of the codebase by returning 0.
 *
 *               post-walk `A2` (unsigned 32-bit M68k address).
 *
 *   - byte sub wrap: `((hdr>>4)+1 - (hdr&0xF)) & 0xFF` → range
 *     `[0..16] ∪ [0xF2..0xFF]`.
 *   - asl.l count mod 64: per byte 0xF2..0xFF → count 50..63 → result 0.
 *   - asl.l count >= 32: result 0 (the bits "shift out" of the long).
 *   - tst.w D0w bge: signed-word test; D0w = 0x8000 → negative → skip body.
 *
 * **Safety guards** for pathological input (large D3, header that produces
 */
export function stateSub540A(
  state: GameState,
  a2: number,
  d3: number,
): StateSub540AResult {
  const r = state.workRam;
  let a2Cur = a2 >>> 0;
  let d3w = d3 & 0xffff;

  // Inline helper: read absolute M68k byte → workRam offset.
  const read8 = (addr: number): number => {
    const a = addr >>> 0;
    if (a < WORK_RAM_BASE || a >= WORK_RAM_END) return 0;
    return (r[a - WORK_RAM_BASE] ?? 0) & 0xff;
  };

  // ── Outer loop ────────────────────────────────────────────────────────
  // M68k path: bra 0x544A; tst.w D3w; bne → 0x5418 (body); else fallthrough.
  let outerSafety = 0x10000; // max 65536 iter (matches D3w word range)
  while (d3w !== 0 && outerSafety-- > 0) {
    // body @ 0x5418

    // 0x541A: jsr 53EA — D0 = byte[A2] | byte[A2+1]
    // 0x5424: beq.w 0x544E — early-exit if pair==0
    if (fun53EA(state, a2Cur) === 0) {
      return 0 >>> 0;
    }

    const hdr = read8(a2Cur);
    a2Cur = (a2Cur + 1) >>> 0; // move.b (A2)+,D1b → A2++

    const hi = (hdr >>> 4) & 0xf;
    const lo = hdr & 0xf;
    // byte sub: ((hi+1) - lo) modulo 256 (high bits of D0 are 0).
    const shiftByte = ((hi + 1 - lo) & 0xff) >>> 0;
    // D0 long = 0x000000 | shiftByte. asl.l count = D0 & 63 = shiftByte & 63.
    const shiftCount = shiftByte & 0x3f;
    // D2 = 1 << shiftCount. For shiftCount >= 32 → 0.
    let d2Long: number;
    if (shiftCount >= 32) {
      d2Long = 0;
    } else {
      d2Long = ((1 << shiftCount) >>> 0) >>> 0;
    }
    // 0x543A: move.w D2w,D0w → D0w = D2 & 0xFFFF (D0 high word stays 0).
    let d0w = d2Long & 0xffff; // unsigned word

    // 0x543C: bra 0x5444 — first check is tst.w D0w, bge.
    // bge tests signed: 0x8000..0xFFFF (signed -32768..-1) → fall through.
    // 0x0000..0x7FFF (signed 0..32767) → branch to body.
    let innerSafety = 0x10000; // max 65536 inner iter
    while (innerSafety-- > 0) {
      // bge: if (signedWord(d0w) >= 0) execute body else exit.
      const d0wSigned = d0w >= 0x8000 ? d0w - 0x10000 : d0w;
      if (d0wSigned < 0) break;

      // inner body @ 0x543E: tst.b (A2)+; bne 0x543E — skip null-terminated string.
      let strSafety = 0x10000; // max 65536 byte per string
      while (strSafety-- > 0) {
        const b = read8(a2Cur);
        a2Cur = (a2Cur + 1) >>> 0;
        if (b === 0) break;
      }

      // 0x5442: subq.w #1,D0w → D0w-- (word decrement, wrap mod 65536)
      d0w = (d0w - 1) & 0xffff;
    }

    // 0x5448: subq.w #1,D3w
    d3w = (d3w - 1) & 0xffff;
    // 0x544A: tst.w D3w; bne 0x5418 — loop condition tested top.
  }

  // ── exit_path @ 0x544E ────────────────────────────────────────────────
  // jsr 53EA; if pair==0 return 0 else return A2.
  const finalPair = fun53EA(state, a2Cur);
  if (finalPair === 0) return 0 >>> 0;
  return a2Cur >>> 0;
}
