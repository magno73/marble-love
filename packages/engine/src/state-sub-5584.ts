/**
 * state-sub-5584.ts — replica `FUN_00005584` (132 bytes).
 *
 * "Scan & match" wrapper that stitches together 3 helpers:
 *   1. `FUN_0000540A`  — table-of-string-records walker (see state-sub-540a)
 *   2. `FUN_000053EA`  — read-byte-pair OR (`byte[ptr]|byte[ptr+1]`)
 *   3. `FUN_00005468`  — record-step (forward-walk with flag-update)
 *
 * The wrapper:
 *     `FUN_5468(curPtr, arg1_word, D4, arg4_word, arg4_word)` obtaining a
 *
 * **Disasm 0x5584..0x5604** (132 bytes):
 *
 *   0x5584:  movem.l {D6 D5 D4 D3 D2},-(SP)   ; preserve D2..D6 (20 bytes)
 *   0x5588:  move.l  (0x18,SP),D2             ; D2 = arg0 (long ptr)
 *   0x558c:  move.w  (0x1e,SP),D3w            ; D3w = arg1 (word)
 *   0x5590:  move.w  (0x22,SP),D1w            ; D1w = arg2 (word)
 *   0x5594:  move.l  D2,D6                    ; D6 = arg0 (save initial ptr)
 *   0x5596:  moveq   #0,D0
 *   0x5598:  move.w  D1w,D0w                  ; D0 = arg2 (zero-ext)
 *   0x559a:  move.l  D0,-(SP)                 ; push arg2 (long)
 *   0x559c:  move.l  D2,-(SP)                 ; push arg0 (long)
 *   0x559e:  jsr     0x540A.l                 ; D0 = FUN_540A(arg0, arg2)
 *   0x55a4:  move.l  D0,D5                    ; D5 = walked_ptr (or 0 sentinel)
 *   0x55a6:  move.l  D5,D2                    ; D2 = D5 (cur ptr)
 *   0x55a8:  move.l  D2,-(SP)                 ; push D2
 *   0x55aa:  jsr     0x53EA.l                 ; D0 = FUN_53EA(D2)
 *   0x55b0:  tst.l   D0
 *   0x55b2:  lea     (0xc,SP),SP              ; pop 12 bytes (cleanup 540A 8 + 53EA 4)
 *   0x55b6:  beq.w   0x5602                   ; if pair == 0 → exit (D0 = 0)
 *   0x55ba:  moveq   #3,D4                    ; D4 = 3 (loop start)
 *   0x55bc: loop_top:
 *   0x55bc:  moveq   #0,D0
 *   0x55be:  move.w  (0x2a,SP),D0w            ; D0 = arg4 word (caller_SP+0x12)
 *   0x55c2:  move.l  D0,-(SP)                 ; push arg4
 *   0x55c4:  moveq   #0,D0
 *   0x55c6:  move.w  (0x2a,SP),D0w            ; D0 = arg4 word (re-read; SP shifted)
 *                                              ;   the push just done has shifted
 *   0x55ca:  move.l  D0,-(SP)                 ; push arg4 (again)
 *   0x55cc:  moveq   #0,D0
 *   0x55ce:  move.w  D4w,D0w                  ; D0 = D4 (zero-ext)
 *   0x55d0:  move.l  D0,-(SP)                 ; push D4
 *   0x55d2:  moveq   #0,D0
 *   0x55d4:  move.w  D3w,D0w                  ; D0 = D3 (zero-ext)
 *   0x55d6:  move.l  D0,-(SP)                 ; push D3 (= arg1 word)
 *   0x55d8:  move.l  D2,-(SP)                 ; push D2 (= cur ptr)
 *   0x55da:  jsr     0x5468.l                 ; D0 = FUN_5468(D2, D3, D4, arg4, arg4)
 *   0x55e0:  move.l  D0,D2                    ; D2 = step_ptr (overwrite cur)
 *   0x55e2:  move.l  D2,-(SP)                 ; push D2
 *   0x55e4:  jsr     0x53EA.l                 ; D0 = FUN_53EA(D2)
 *   0x55ea:  tst.l   D0
 *   0x55ec:  lea     (0x18,SP),SP             ; pop 24 bytes (5468 args 20 + 53EA 4)
 *   0x55f0:  bne.b   0x55f4                   ; if D0 != 0 skip restore
 *   0x55f2:  move.l  D6,D2                    ; D2 = D6 (restore arg0 original)
 *   0x55f4:  cmp.l   D5,D2
 *   0x55f6:  beq.w   0x5602                   ; if D2 == D5 → exit
 *   0x55fa:  addq.w  #3,D4w                   ; D4 += 3
 *   0x55fc:  moveq   #0x12,D0
 *   0x55fe:  cmp.w   D4w,D0w                  ; cmp.w D4,D0 (= 0x12 - D4)
 *   0x5600:  bhi.b   0x55bc                   ; if 0x12 > D4 (unsigned) → loop
 *   0x5602:  movem.l (SP)+,{D2 D3 D4 D5 D6}   ; restore + rts (return D0 unchanged)
 *
 *   D0 at rts:
 *     - early-exit @ 0x55b6:  D0 = 0 (from failed 53EA)
 *     - exit @ 0x55f6 (cmp eq): D0 = latest 53EA result
 *     - exit @ loop completion: D0 = 53EA result from the D4=15 iteration
 *
 *   - Args: 5 long (4 word ext-l + 1 long ptr).
 *                    records (workRam-resident, range 0x40xxxx).
 *     `arg1` word  = forward-walk parameter, passed to FUN_5468 as arg2 word.
 *     `arg2` word  = number of records to scan in FUN_540A.
 *     `arg4` word  = byte/word parameter passed twice to FUN_5468 (callee arg3
 *                    byte and arg4 word).
 *   - Callee-saved: D2-D6 (preserved by movem.l in prologue/epilogue).
 *
 *
 * **Low-level fidelity notes**:
 *
 *   1. **Stack offset of `(0x2a, SP)`**: post-movem (5×4 = 20 bytes = 0x14) +
 *      ret addr (4) = 24 = 0x18. Caller_SP_args = SP + 0x18. Args structure:
 *      arg0 @ +0, arg1 @ +4 (word @ +6), arg2 @ +8 (word @ +0xa), arg3 @ +0xc
 *      (caller_SP_args + 0x12) = arg4 low word. Confirmed by the disassembly
 *      (see `0x5fe2: move.w (0x10070).l, D0w; ext.l D0; move.l D0,-(SP)`).
 *
 *      (= arg4 high word + 2 = STILL arg4 low word in BE). NO: + 4 on the SP
 *      means that (0x2a, SP) now points to arg4_low_word - 4.
 *      0x12 - 4 = caller_SP_args + 0xe = arg3 low word`!
 *      The stack now holds:
 *         (0, SP)        = D0 = arg4 long (just pushed)
 *         (4..0x17, SP)  = ret + saved D2..D6
 *         (0x18..., SP)  = caller args
 *         (0x18 + 4 = 0x1c, SP) = arg0
 *         (0x1c + 6 = 0x22, SP) = arg1 word
 *         (0x1c + 0xa = 0x26, SP) = arg2 word
 *         (0x1c + 0xe = 0x2a, SP) = arg3 word ✗
 *      Alternative: if callers pass arg3=0x0001 and arg4=ROM_word, and (0x2a, SP)
 *      re-check the arithmetic. Post-movem SP delta = 20. Push (0x55c2): SP
 *      delta = 24. (0x2a, SP) @ delta 24 = caller_SP + 0x2a - 0x18 (delta 24 -
 *
 *      caller_SP_pre_call. Caller_SP_pre_call - delta = current SP. Args are:
 *      - Pre-loop body, post-cleanup `lea (0xc,SP),SP`: delta = 20 (post-movem).
 *        be 24 (4 extra bytes). Source: RET ADDR. movem decrements SP after the
 *        return address is already on stack. Recount: post-prologue delta from caller_SP
 *        pre-jsr = 20 (movem) + 4 (ret) = 24. Args @ caller_SP + 0..0x13.
 *        N = 24 + 0x12 = 0x36? No, wrong here too.
 *
 *      Direct approach: the disassembly reads (0x18, SP) as arg0, and
 *      0x18 -> 0x1e = 6 bytes (= 2 words: arg0 long ends at +3, then 2 bytes
 *         (0x18, SP) = arg0 long start (length 4)  → @+0
 *         (0x1c, SP) = arg1 long start (length 4)  → word @+6
 *         (0x1e, SP) = arg1 word (low)
 *         (0x20, SP) = arg2 long start             → word @+0xa
 *         (0x22, SP) = arg2 word (low)
 *         (0x24, SP) = arg3 long start             → word @+0xe
 *         (0x28, SP) = arg4 long start             → word @+0x12
 *         (0x2a, SP) = arg4 word (low)
 *      ✓ Confirmed. Delta between caller_SP_args and SP post-movem = 0x18.
 *
 *      now points to `current_SP + 0x2a = caller_SP_args + 0x2a - 0x1c =
 *
 *      But wait, the caller @ 0x6002 pushes args RTL: arg4(@5fea), arg3(@5fec=
 *      `pea (0x1).w`), arg2(@5ff0..5ff6), arg1(@5ff8..5ffe), arg0(@6000).
 *         caller_SP_args + 0x10 = arg4 → low word @ +0x12
 *         caller_SP_args + 0x0c = arg3 → low word @ +0x0e
 *         caller_SP_args + 0x08 = arg2 → low word @ +0x0a
 *         caller_SP_args + 0x04 = arg1 → low word @ +0x06
 *         caller_SP_args + 0x00 = arg0
 *      ✓ Matches (0x2a, SP) = arg4 word, (0x26, SP) = arg3, etc.
 *
 *      (ROM, 1) as the last two args of FUN_5468.
 *
 *
 *   2.5 **Double confirmation via correct re-disasm**: at 0x55c2 the push lowers SP
 *      delta 0x18 → caller_SP + (0x2a - 0x18) = caller_SP + 0x12... wait,
 *      Retry: pre-push delta = 0x18. Post-push delta = 0x1c. (0x2a, SP) @
 *      delta 0x1c → caller_offset = 0x2a - 0x1c = 0x0e → arg3 word. ✓
 *         first push (0x55c2):  arg4 word (delta 0x18 → caller offset 0x12)
 *         second push (0x55ca): arg3 word (delta 0x1c → caller offset 0x0e)
 *         third push (0x55d0):   D4 (loop counter)
 *         fourth push (0x55d6):  D3 (arg1 word)
 *         fifth push (0x55d8):  D2 (cur ptr long)
 *      arg4 repeated.
 *
 *      Verify with FUN_5468's signature (link.w A6,-0xc):
 *         (0x8, A6)  = arg0 = ptr long       → D2 ✓
 *         (0xe, A6)  = arg1 word low         → D3 ✓
 *         (0x12, A6) = arg2 word low         → D4 ✓
 *         (0x17, A6) = arg3 byte (low byte of word low) → arg3 ✓ (= 1 in prod)
 *         (0x1a, A6) = arg4 word low         → arg4 ✓ (= ROM[0x10070])
 *      Perfect: the args are (D2, D3w, D4w, arg3w, arg4w).
 *
 *   3. **`movem.l {D6 D5 D4 D3 D2}, -(SP)` push order**: M68k `movem` preserves
 *         (0, SP) = D2  ; (4, SP) = D3  ; (8, SP) = D4  ; (0xc, SP) = D5  ; (0x10, SP) = D6
 *         (0x18, SP) = arg0 long
 *      Confirmed.
 *
 *
 *
 *
 *      C=0 AND Z=0 → unsigned higher → `D0w > D4w`. Loop while 0x12 > D4w.
 *
 *      here because D4 stays in word range.
 *
 *      - From 0x55b6 (early): D0 = 0 (53EA returned 0, so tst.l D0 made
 *        beq).
 *      - From 0x55f6 (cmp eq): D0 = latest 53EA result.
 *      - From full loop (D4=0x12): falls from 0x5600 to 0x5602, D0 = latest 53EA.
 *
 *      `move.w D6w,(-0x4,A6)` - D0 is not tested. Same for the other two
 *      call sites, which depend on FUN_5468 side effects more than the return.
 *
 *   - `0x5F0E` in FUN_5E00 — jsr 0x5584 (UNCONDITIONAL_CALL)
 *   - `0x6002` in FUN_5E00 — jsr 0x5584 (UNCONDITIONAL_CALL)
 *   - `0x6058` in FUN_5E00 — jsr 0x5584 (UNCONDITIONAL_CALL)
 *
 */

import type { GameState } from "./state.js";

// ─── Callback types ───────────────────────────────────────────────────────

/**
 * Signature of `FUN_0000540A` - table-of-records walker.
 *
 */
export type Sub5584Inner540A = (
  state: GameState,
  a2: number,
  d3Word: number,
) => number;

/**
 * Signature of `FUN_000053EA` - read-byte-pair OR.
 *
 * @param ptr    Absolute M68k pointer.
 * @returns      `(byte[ptr] | byte[ptr+1]) >>> 0`, range `0..0xFF`.
 */
export type Sub5584Inner53EA = (state: GameState, ptr: number) => number;

/**
 * Signature of `FUN_00005468` - record forward-step with flag update.
 *
 * @param d3Word   arg1 word: forward-walk parameter (= FUN_5584 arg1).
 * @param arg4Word arg4 word: parameter modified in-place by the callee.
 * @returns        unsigned long: post-step pointer, or 0 on internal early exit.
 */
export type Sub5584Inner5468 = (
  state: GameState,
  a2: number,
  d3Word: number,
  d2Word: number,
  arg3Word: number,
  arg4Word: number,
) => number;

// ─── Port ─────────────────────────────────────────────────────────────────

/**
 *
 * Calls FUN_540A once, then conditionally calls FUN_53EA plus FUN_5468/FUN_53EA.
 *
 * @param arg0Long  Absolute M68k pointer (long), typically in workRam.
 * @param arg1Word  Word param passed to 5468 as arg1.
 * @param arg2Word  Word param passed to 540A as d3 count.
 * @param arg3Word  Word param passed to 5468 as arg3 byte; production uses 1.
 * @param arg4Word  Word param passed to 5468 as arg4 word.
 *
 * @returns  long unsigned (D0 at rts):
 *            - 0 if the loop completes with D2 == D5 and 53EA returned 0.
 *            - non-zero if the loop exits on cmp-eq with 53EA != 0.
 *            - non-zero/zero depending on the last D4=15 iteration if the loop
 *
 *
 * 1. `D0 = arg2_word` zero-ext (moveq #0; move.w → D0 = 0x0000WWWW).
 * 2. FUN_540A receives `(arg0Long, D0)` as (long, pushed long).
 * 4. FUN_53EA(D2): `D0 = pair`. If 0 -> exit with D0 = 0.
 * 5. Loop body with D4 = 3, 6, 9, 12, 15:
 *    - FUN_5468(D2_pre, D3=arg1, D4, arg3, arg4) → D0
 *    - D2 = D0 (overwrite cur ptr)
 *    - FUN_53EA(D2) → D0 (new pair)
 *    - if D0 == 0: D2 = D6 (= arg0Long original)
 *    - if D2 == D5 (long eq): exit with D0 = current 53EA result
 *
 */
export function stateSub5584(
  state: GameState,
  arg0Long: number,
  arg1Word: number,
  arg2Word: number,
  arg3Word: number,
  arg4Word: number,
  inner540A: Sub5584Inner540A = () => 0,
  inner53EA: Sub5584Inner53EA = () => 0,
  inner5468: Sub5584Inner5468 = () => 0,
): number {
  // Normalize args (force unsigned long / word).
  const a0 = arg0Long >>> 0;
  const a1w = arg1Word & 0xffff;
  const a2w = arg2Word & 0xffff;
  const a3w = arg3Word & 0xffff;
  const a4w = arg4Word & 0xffff;

  // ─── Prologue: D2/D3/D1/D6 = a0/a1w/a2w/a0 ─────────────────────────────
  // Note: D3 = arg1, D1 = arg2 (see disasm). D2 = arg0 = D6 (save).
  const d6 = a0;

  // ─── jsr 540A(arg0, arg2_word_zext) → D5 ────────────────────────────────
  // D0 = a2w zero-ext to long. Pushed as long.
  const d5 = (inner540A(state, a0, a2w) >>> 0) >>> 0;

  // D2 = D5 (cur ptr).
  let d2 = d5;

  // ─── jsr 53EA(D2) → D0; if D0 == 0 → exit (D0 stays 0) ─────────────────
  let d0 = (inner53EA(state, d2) >>> 0) >>> 0;
  if (d0 === 0) {
    return 0 >>> 0;
  }

  // ─── Loop body @ 0x55bc..0x5600 ────────────────────────────────────────
  // D4 ∈ {3, 6, 9, 12, 15} (5 iter max). Loop while 0x12 > D4w (unsigned).
  for (let d4 = 3; d4 < 0x12; d4 += 3) {
    // jsr 5468(D2, D3=a1w, D4, arg3=a3w, arg4=a4w) → D0
    const stepPtr = (inner5468(state, d2, a1w, d4 & 0xffff, a3w, a4w) >>> 0) >>> 0;
    d2 = stepPtr;

    // jsr 53EA(D2) → D0
    d0 = (inner53EA(state, d2) >>> 0) >>> 0;

    // tst.l D0; bne skip_restore; restore D2 = D6
    if (d0 === 0) {
      d2 = d6;
    }

    // cmp.l D5, D2; beq exit
    if (d2 === d5) {
      return d0 >>> 0;
    }
    // else: addq.w #3, D4w; cmp 0x12 > D4 → loop or fall-through.
  }

  // At 0x5602 this falls through after `moveq #0x12, D0; cmp.w D4w, D0w; bhi`.
  // The movem epilogue does not touch D0, so return D0 = 0x12 (long).
  void state; // referenced for API consistency
  return 0x12 >>> 0;
}
