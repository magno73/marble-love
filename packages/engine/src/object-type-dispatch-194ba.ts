/**
 * object-type-dispatch-194ba.ts — `FUN_000194BA` replica (132 bytes).
 *
 *
 * **Disasm 0x194BA..0x1953E** (132 byte):
 *
 *   move.l   A2,-(SP)                    ; save A2 (callee-saved)
 *   movea.l  (0x8,SP),A2                 ; A2 = obj struct ptr (arg long)
 *   move.b   (0x1A,A2),D0b               ; D0.b = obj[0x1A] (kind byte)
 *   ext.w    D0w                         ; sign-extend → word
 *   ext.l    D0                          ; sign-extend → long
 *   movea.l  D0,A0                       ; A0 = signed kind
 *   cmpa.w   #0x0,A0
 *   blt.w    0x1953A                     ; kind < 0 → epilog (no-op)
 *   bgt.b    0x194D6                     ; kind > 0 → next compare
 *   bra.b    0x194E6                     ; kind == 0 → case 0
 *   cmpa.w   #0x1,A0
 *   bne.b    0x194DE                     ; not 1 → next compare
 *   bra.b    0x194FA                     ; kind == 1 → case 1
 *   cmpa.w   #0x2,A0
 *   bne.b    0x1953A                     ; not 2 → epilog (no-op)
 *   bra.b    0x1950E                     ; kind == 2 → case 2
 *
 *   ; case 0 @ 0x194E6:
 *   move.l   A2,-(SP)                    ; push obj (arg per FUN_1960E)
 *   jsr      0x0001960E.l                ; FUN_1960E(obj)
 *   move.l   A2,-(SP)                    ; push obj (arg per FUN_1953E)
 *   jsr      0x0001953E.l                ; FUN_1953E(obj)
 *   addq.l   #8,SP                       ; pop both long args
 *   bra.b    0x1953A                     ; epilog
 *
 *   ; case 1 @ 0x194FA:
 *   move.l   A2,-(SP)                    ; push obj
 *   jsr      0x0001973C.l                ; FUN_1973C(obj)
 *   move.l   A2,-(SP)                    ; push obj
 *   jsr      0x0001953E.l                ; FUN_1953E(obj)
 *   addq.l   #8,SP                       ; pop both
 *   bra.b    0x1953A                     ; epilog
 *
 *   ; case 2 @ 0x1950E:
 *   cmpi.b   #0x7,(0x25,A2)              ; obj[0x25] == 7 ?
 *   bne.b    0x19520
 *   move.l   #0x21F8A,(0x1C,A2)          ; obj[0x1C..0x1F] = 0x00021F8A
 *   bra.b    0x1953A
 *   cmpi.b   #0x8,(0x25,A2)              ; obj[0x25] == 8 ?
 *   bne.b    0x19532
 *   move.l   #0x21A62,(0x1C,A2)          ; obj[0x1C..0x1F] = 0x00021A62
 *   bra.b    0x1953A
 *   move.l   #0x21EFE,(0x1C,A2)          ; default: 0x00021EFE
 *
 *   ; epilog @ 0x1953A:
 *   movea.l  (SP)+,A2                    ; restore A2
 *   rts
 *
 * **Side effects**:
 *   - Solo case 2 modifies `state.workRam` direttamente (4 byte BE @
 *     `obj+0x1C..0x1F`).
 *   - Case 0/1 are delegated entirely to JSRs (no-op if subs are absent).
 *
 *   - `FUN_0001960E` — case-0 helper (sub-type 0).
 *   - `FUN_0001973C` — case-1 helper (sub-type 1).
 *   - `FUN_0001953E` — finalizer comune a case 0 e 1.
 *
 * **Caller xrefs (6)**:
 *   - `FUN_00018FFA @ 0x190AE`
 *   - `FUN_0001924E @ 0x192F2`
 *   - `FUN_0001912C @ 0x191D6, 0x191FC, 0x19228`
 *
 */

import type { GameState } from "./state.js";

export const KIND_OFFSET = 0x1a as const;
export const SUBTYPE_OFFSET = 0x25 as const;
export const FN_PTR_OFFSET = 0x1c as const;

export const CALLEE_FUN_1960E = 0x0001960e as const;
export const CALLEE_FUN_1973C = 0x0001973c as const;
export const CALLEE_FUN_1953E = 0x0001953e as const;

/** Long pointer per `obj[0x25] == 7` (case 2). */
export const FN_PTR_KIND2_SUB7 = 0x00021f8a as const;
/** Long pointer per `obj[0x25] == 8` (case 2). */
export const FN_PTR_KIND2_SUB8 = 0x00021a62 as const;
/** Long pointer of default per case 2 (sub-type non 7 e non 8). */
export const FN_PTR_KIND2_DEFAULT = 0x00021efe as const;

/**
 * Stub injection per le 3 JSR esterne (case 0 e 1).
 *
 *
 * Default: all no-op (matching `rts` patch in the parity test).
 */
export interface ObjectTypeDispatch194BASubs {
  fun_1960e?: (objAddr: number, state: GameState) => void;
  fun_1973c?: (objAddr: number, state: GameState) => void;
  /**
   * `FUN_0001953E(obj)` — finalizer comune a case 0 e 1.
   */
  fun_1953e?: (objAddr: number, state: GameState) => void;
}

/** Descrittore of the branch eseguito (per inspection/test). */
export type DispatchBranch =
  | "skip"
  | "case0"    // kind == 0 → fun_1960e + fun_1953e
  | "case1"    // kind == 1 → fun_1973c + fun_1953e
  | "case2";   // kind == 2 → set obj[0x1C..0x1F] basato su obj[0x25]

export interface ObjectTypeDispatch194BAResult {
  /** Branch eseguito (vedi `DispatchBranch`). */
  branch: DispatchBranch;
  fnPtrWritten: number | null;
}

function writeU32BE(state: GameState, off: number, v: number): void {
  const x = v >>> 0;
  state.workRam[off] = (x >>> 24) & 0xff;
  state.workRam[off + 1] = (x >>> 16) & 0xff;
  state.workRam[off + 2] = (x >>> 8) & 0xff;
  state.workRam[off + 3] = x & 0xff;
}

/**
 *
 * @param state    GameState. Modified only in case 2 (4 BE bytes @
 *                 `objAddr - 0x400000 + 0x1C`).
 *                 2 bytes: `obj+0x1A` (kind) and, only in case 2, `obj+0x25`.
 * @param subs     stub injection for the 3 JSRs (case 0/1). Default: no-op.
 *
 * @returns `{ branch, fnPtrWritten }`. If `branch === "skip"`, the dispatcher
 *
 */
export function objectTypeDispatch194BA(
  state: GameState,
  objAddr: number,
  subs?: ObjectTypeDispatch194BASubs,
): ObjectTypeDispatch194BAResult {
  const objOff = (objAddr - 0x400000) >>> 0;
  const r = state.workRam;

  // move.b (0x1A,A2),D0b ; ext.w ; ext.l -> signed byte interpreted as long.
  const kindByte = (r[objOff + KIND_OFFSET] ?? 0) & 0xff;
  const kind = kindByte & 0x80 ? kindByte - 0x100 : kindByte;

  if (kind === 0) {
    // case 0: jsr FUN_1960E(obj) ; jsr FUN_1953E(obj)
    subs?.fun_1960e?.(objAddr >>> 0, state);
    subs?.fun_1953e?.(objAddr >>> 0, state);
    return { branch: "case0", fnPtrWritten: null };
  }

  if (kind === 1) {
    // case 1: jsr FUN_1973C(obj) ; jsr FUN_1953E(obj)
    subs?.fun_1973c?.(objAddr >>> 0, state);
    subs?.fun_1953e?.(objAddr >>> 0, state);
    return { branch: "case1", fnPtrWritten: null };
  }

  if (kind === 2) {
    // case 2: dispatch su obj[0x25] → write obj[0x1C..0x1F] long BE.
    const subType = (r[objOff + SUBTYPE_OFFSET] ?? 0) & 0xff;
    let fnPtr: number;
    if (subType === 0x07) {
      fnPtr = FN_PTR_KIND2_SUB7;
    } else if (subType === 0x08) {
      fnPtr = FN_PTR_KIND2_SUB8;
    } else {
      fnPtr = FN_PTR_KIND2_DEFAULT;
    }
    writeU32BE(state, objOff + FN_PTR_OFFSET, fnPtr);
    return { branch: "case2", fnPtrWritten: fnPtr >>> 0 };
  }

  // kind < 0 or kind >= 3 → no-op (epilog).
  return { branch: "skip", fnPtrWritten: null };
}
