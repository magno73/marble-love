/**
 * object-type-dispatch-194ba.ts — replica `FUN_000194BA` (132 byte).
 *
 * "Object type-dispatch by entry[0x1A]". Carica un byte sign-extended da
 * `obj+0x1A` e branch su {0, 1, 2}. Per case 0/1 chiama 2 JSR consecutivi
 * (helper + finalizer); per case 2 imposta un puntatore funzione nel campo
 * `obj+0x1C` selezionato sulla base di `obj+0x25` (sub-type/state). Per
 * tutti gli altri valori (negativi o >= 3) il dispatcher è no-op.
 *
 * **Disasm 0x194BA..0x1953E** (132 byte):
 *
 *   move.l   A2,-(SP)                    ; salva A2 (callee-saved)
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
 *   addq.l   #8,SP                       ; pop entrambi gli arg long
 *   bra.b    0x1953A                     ; epilog
 *
 *   ; case 1 @ 0x194FA:
 *   move.l   A2,-(SP)                    ; push obj
 *   jsr      0x0001973C.l                ; FUN_1973C(obj)
 *   move.l   A2,-(SP)                    ; push obj
 *   jsr      0x0001953E.l                ; FUN_1953E(obj)
 *   addq.l   #8,SP                       ; pop entrambi
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
 *   - Solo case 2 modifica `state.workRam` direttamente (4 byte BE @
 *     `obj+0x1C..0x1F`).
 *   - Case 0/1 sono delegati interamente alle JSR (no-op se subs assente).
 *
 * **JSR esterne** (NON ancora replicate, esposte via sub-injection):
 *   - `FUN_0001960E` — case-0 helper (sub-type 0).
 *   - `FUN_0001973C` — case-1 helper (sub-type 1).
 *   - `FUN_0001953E` — finalizer comune a case 0 e 1.
 *
 * **Caller xrefs (6)**:
 *   - `FUN_00018FFA @ 0x190AE`
 *   - `FUN_0001924E @ 0x192F2`
 *   - `FUN_0001912C @ 0x191D6, 0x191FC, 0x19228`
 *
 * Verifica bit-perfect via `cli/src/test-object-type-dispatch-194ba-parity.ts`.
 */

import type { GameState } from "./state.js";

/** Offset del byte "kind" letto come signed (`obj+0x1A`). */
export const KIND_OFFSET = 0x1a as const;
/** Offset del byte "sub-type" usato in case 2 (`obj+0x25`). */
export const SUBTYPE_OFFSET = 0x25 as const;
/** Offset del campo "function pointer" scritto in case 2 (`obj+0x1C`, long BE). */
export const FN_PTR_OFFSET = 0x1c as const;

/** Indirizzo (m68k absolute) del FUN_1960E (case-0 helper). */
export const CALLEE_FUN_1960E = 0x0001960e as const;
/** Indirizzo (m68k absolute) del FUN_1973C (case-1 helper). */
export const CALLEE_FUN_1973C = 0x0001973c as const;
/** Indirizzo (m68k absolute) del FUN_1953E (finalizer case 0+1). */
export const CALLEE_FUN_1953E = 0x0001953e as const;

/** Long pointer per `obj[0x25] == 7` (case 2). */
export const FN_PTR_KIND2_SUB7 = 0x00021f8a as const;
/** Long pointer per `obj[0x25] == 8` (case 2). */
export const FN_PTR_KIND2_SUB8 = 0x00021a62 as const;
/** Long pointer di default per case 2 (sub-type non 7 e non 8). */
export const FN_PTR_KIND2_DEFAULT = 0x00021efe as const;

/**
 * Stub injection per le 3 JSR esterne (case 0 e 1).
 *
 * Ogni callback riceve l'indirizzo absolute della struct obj (`objAddr`,
 * u32) e il `state`. Il binario passa l'argomento come long (= ptr 32-bit)
 * sullo stack, quindi `objAddr` riflette esattamente il valore pushato.
 *
 * Default: tutte no-op (matching `rts` patch nel parity test).
 */
export interface ObjectTypeDispatch194BASubs {
  /** `FUN_0001960E(obj)` — case 0 helper (chiamato per `kind == 0`). */
  fun_1960e?: (objAddr: number, state: GameState) => void;
  /** `FUN_0001973C(obj)` — case 1 helper (chiamato per `kind == 1`). */
  fun_1973c?: (objAddr: number, state: GameState) => void;
  /**
   * `FUN_0001953E(obj)` — finalizer comune a case 0 e 1.
   * Chiamato DOPO `fun_1960e` (case 0) o `fun_1973c` (case 1).
   */
  fun_1953e?: (objAddr: number, state: GameState) => void;
}

/** Descrittore del branch eseguito (per inspection/test). */
export type DispatchBranch =
  | "skip"      // kind < 0 oppure kind >= 3 (tutto il range non gestito)
  | "case0"    // kind == 0 → fun_1960e + fun_1953e
  | "case1"    // kind == 1 → fun_1973c + fun_1953e
  | "case2";   // kind == 2 → set obj[0x1C..0x1F] basato su obj[0x25]

/** Risultato della replica. */
export interface ObjectTypeDispatch194BAResult {
  /** Branch eseguito (vedi `DispatchBranch`). */
  branch: DispatchBranch;
  /** Valore long scritto a `obj+0x1C` se branch == "case2", altrimenti null. */
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
 * Replica bit-perfect di `FUN_000194BA`.
 *
 * @param state    GameState. Modificato solo in case 2 (4 byte BE @
 *                 `objAddr - 0x400000 + 0x1C`).
 * @param objAddr  indirizzo absolute (m68k) della struct obj. Vengono lette
 *                 2 byte: `obj+0x1A` (kind) e — solo case 2 — `obj+0x25`.
 * @param subs     stub injection per le 3 JSR (case 0/1). Default: no-op.
 *
 * @returns `{ branch, fnPtrWritten }`. Se `branch === "skip"` il dispatcher
 *          è stato no-op (kind negativo o >= 3). `fnPtrWritten` non-null
 *          solo in case 2 e riflette il valore long scritto a `obj+0x1C`.
 *
 * **Bit-perfect notes**:
 *   - Il `cmpa.w #N,A0` confronta solo i bit bassi 16 (signed word). Per
 *     kind in [0, 1, 2] la semantica è identica al confronto signed byte;
 *     non esistono valori tale che `byte != kind ma word == kind`.
 *   - Nessun ordine osservabile per i side-effect TS oltre alle 2 callback
 *     consecutive (case 0/1), che vengono chiamate **nell'ordine** del
 *     binario: prima il case-specific helper, poi il finalizer comune.
 *   - In case 2, `obj+0x1C` è scritto come big-endian 32-bit (move.l).
 */
export function objectTypeDispatch194BA(
  state: GameState,
  objAddr: number,
  subs?: ObjectTypeDispatch194BASubs,
): ObjectTypeDispatch194BAResult {
  const objOff = (objAddr - 0x400000) >>> 0;
  const r = state.workRam;

  // move.b (0x1A,A2),D0b ; ext.w ; ext.l → signed-byte interpretato come long.
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

  // kind < 0 oppure kind >= 3 → no-op (epilog).
  return { branch: "skip", fnPtrWritten: null };
}
