/**
 * sub-19692.ts — replica `FUN_00019692` (164 byte).
 *
 * "Entity move-and-validate retry loop (heavy update)". Variante di
 * `FUN_000198BC` (state-sub-198bc.ts) usata in case 0 di `FUN_0001960E`
 * (entity RNG-driven resampler). Chiamata sempre in coda da
 * `FUN_1960E(entity)` dopo il resample di `entity[0x26]`.
 *
 * Le **differenze** chiave da `FUN_198BC`:
 *   1. **NO pre-decrement** di `entity[0x26]` (manca `subq.b #4,(0x26,A2)`).
 *   2. **NO save di direzione originale** in D4 (manca `move.b (0x26,A2),D4b`).
 *   3. **NO cycle-back check** (manca `cmp.b (0x26,A2),D4b; beq`).
 *   4. **Max iter = 0xC** (12) anziché 0x9 (9).
 *
 * Quindi il loop applica `entity[0x26] += step` in ogni iterazione (con mask
 * 4-bit) e tenta il move; non si ferma quando il counter cicla.
 *
 * **Disasm 0x19692..0x1973A** (164 byte):
 *
 *   movem.l  {A2,D5,D4,D3,D2},-(SP)         ; salva A2, D2..D5 (20 byte)
 *   movea.l  (0x18,SP),A2                   ; A2 = arg (entity ptr)
 *   cmpi.b   #0x10,(0x26,A2)
 *   beq.w    0x19736                        ; if entity[0x26] == 0x10 → return
 *   move.l   (0xc,A2),D5                    ; D5 = entity[0xC..0xF] (saved X)
 *   move.l   (0x10,A2),D4                   ; D4 = entity[0x10..0x13] (saved Y)
 *   cmpi.b   #0x7,(0x25,A2)
 *   bne.b    0x196b8
 *   moveq    #0x1,D3                        ; state == 7 → step = 1
 *   bra.b    0x196ba
 *   moveq    #0x4,D3                        ; else → step = 4
 *
 *   ; first attempt: move + validate
 *   move.l   A2,-(SP)
 *   jsr      0x00019976.l                   ; FUN_19976(entity)
 *   move.l   A2,-(SP)
 *   jsr      0x0001937c.l                   ; FUN_1937C(entity) → D0
 *   tst.l    D0
 *   addq.l   #8,SP
 *   beq.w    0x1972e                        ; D0 == 0 (libera/skip) → restore pos, return
 *
 *   clr.b    D2b                            ; D2 = 0 (iter counter, NO pre-dec di entity[0x26])
 *
 *   ; loop @ 0x196d4: iter D2 = 0..0xB
 *   cmpi.b   #0x7,(0x25,A2)
 *   beq.w    0x196ea                        ; state == 7 → sempre apply
 *   move.b   D2b,D0b
 *   ext.w    D0w
 *   ext.l    D0
 *   moveq    #0x3,D1
 *   and.l    D1,D0
 *   bne.b    0x19718                        ; (D2 & 3) != 0 → skip apply, inc_iter
 *
 *   ; apply @ 0x196ea: restore pos, advance dir, move+validate
 *   move.l   D5,(0xc,A2)                    ; entity[0xC..0xF] = saved X
 *   move.l   D4,(0x10,A2)                   ; entity[0x10..0x13] = saved Y
 *   move.b   (0x26,A2),D0b
 *   add.b    D3b,D0b                        ; D0.b = entity[0x26] + step
 *   andi.b   #0xf,D0b                       ; & 0xF (4-bit mask)
 *   move.b   D0b,(0x26,A2)                  ; entity[0x26] = D0.b
 *   ; NB: NESSUN check "cycled back to orig" come in FUN_198BC.
 *   move.l   A2,-(SP)
 *   jsr      0x00019976.l                   ; move
 *   move.l   A2,-(SP)
 *   jsr      0x0001937c.l                   ; validate → D0
 *   tst.l    D0
 *   addq.l   #8,SP
 *   beq.w    0x1972e                        ; D0 == 0 → restore pos, return
 *
 *   ; inc_iter @ 0x19718:
 *   addq.b   #0x1,D2b
 *   cmpi.b   #0xc,D2b                       ; max iter = 12 (NOT 9 come 198BC)
 *   bne.b    0x196d4                        ; loop
 *
 *   ; stuck: D2 == 0xC. Mark entity stuck.
 *   move.b   #0x10,(0x26,A2)                ; entity[0x26] = 0x10
 *   moveq    #0,D0
 *   move.l   D0,(0x4,A2)                    ; entity[4..7] = 0
 *   move.l   D0,(A2)                        ; entity[0..3] = 0
 *
 *   ; restore pos and return (fall-through @ 0x1972e)
 *   move.l   D5,(0xc,A2)
 *   move.l   D4,(0x10,A2)
 *   movem.l  (SP)+,{D2,D3,D4,D5,A2}
 *   rts
 *
 * **Semantica** (riassunto):
 *   - if entity[0x26] == 0x10 → no-op (return).
 *   - Salva pos originale.
 *   - 1° tentativo: move + validate. Se validate == 0 → restore pos, return.
 *   - 2°..12° tentativo (D2 = 0..0xB): in state==7 ogni iter; altrimenti solo
 *     (D2 & 3) == 0 (iter 0, 4, 8). Per ogni apply:
 *       - restore pos (D5, D4)
 *       - entity[0x26] = (entity[0x26] + step) & 0xF
 *       - move + validate. Se 0 → restore pos, return.
 *   - Se D2 == 0xC: stuck → entity[0x26] = 0x10, entity[0..7] = 0, restore pos.
 *
 * **Quirk**: La pos VIENE SEMPRE ripristinata all'uscita (anche nel caso
 * stuck o se un apply intermedio ha mosso l'entity). Solo l'ultimo
 * apply-valid lascia la pos modificata transitoriamente nel loop, ma la coda
 * `0x1972e` ripristina comunque (D5,D4).
 *
 * **Caller**: `FUN_0001960E` @ 0x00019682 (single xref, fine funzione).
 *
 * **JSR esterne** (sub-injection):
 *   - `FUN_00019976` = `sub19976` (sub-19976.ts) — replica diretta.
 *   - `FUN_0001937C` = `sub1937C` (sub-1937c.ts) — replica diretta.
 *
 * Verifica bit-perfect via `packages/cli/src/test-sub-19692-parity.ts`.
 */

import type { GameState } from "./state.js";

// ─── Entity offsets ──────────────────────────────────────────────────────

/** Long @ entity[0x00..0x03] (azzerato in branch stuck D2==0xC). */
export const ENTITY_VEL_X_OFFSET = 0x00 as const;
/** Long @ entity[0x04..0x07] (azzerato in branch stuck D2==0xC). */
export const ENTITY_VEL_Y_OFFSET = 0x04 as const;
/** Long @ entity[0x0C..0x0F] (x position; saved in D5). */
export const ENTITY_POS_X_OFFSET = 0x0c as const;
/** Long @ entity[0x10..0x13] (y position; saved in D4). */
export const ENTITY_POS_Y_OFFSET = 0x10 as const;
/** Byte @ entity[0x25] (state byte; selettore step=1 vs step=4). */
export const ENTITY_STATE_OFFSET = 0x25 as const;
/** Byte @ entity[0x26] (direction; loop counter; marker 0x10 = stuck). */
export const ENTITY_COUNTER_OFFSET = 0x26 as const;

// ─── Costanti ────────────────────────────────────────────────────────────

/** Marker "stuck": se entity[0x26] == 0x10 → no-op. */
export const STUCK_MARKER = 0x10 as const;
/** State-byte che abilita step=1 (jitter fine). */
export const STATE_FINE_STEP = 0x07 as const;
/** Step per state==7. */
export const STEP_FINE = 0x01 as const;
/** Step per state!=7. */
export const STEP_COARSE = 0x04 as const;
/** Massimo numero di iterazioni del loop (0..0xB → 12 valori). */
export const MAX_ITER = 0x0c as const;
/** Maschera per il check "skippa apply" in state!=7 ((D2 & MASK) == 0 → apply). */
export const ITER_MASK = 0x03 as const;

// ─── Sub injection ───────────────────────────────────────────────────────

/**
 * Stub injection per le 2 JSR interne (`FUN_19976` move, `FUN_1937C` validate).
 *
 * Default: `fun_19976` = no-op; `fun_1937c` = ritorna 0 (= "libera/skip" per
 * il binario, che fa `tst.l D0; beq` → exit). Il caller deve iniettare le
 * implementazioni reali (`sub19976AsInjection`, `sub1937CAsInjection`).
 */
export interface Sub19692Subs {
  /** Callback per `FUN_00019976` (move). Default: no-op. */
  fun_19976?: (state: GameState, entityAddr: number) => void;
  /**
   * Callback per `FUN_0001937C` (validate). Default: ritorna 0 (= "libera",
   * che nel binario fa `beq` → early exit con pos restored).
   */
  fun_1937c?: (state: GameState, entityAddr: number) => number;
}

// ─── Risultato ───────────────────────────────────────────────────────────

/** Esito globale del retry loop. */
export type Sub19692Outcome =
  /** entity[0x26] == 0x10 al call: no-op completo (no JSR). */
  | "early_marker"
  /** 1° validate ritorna 0: pos ripristinata, no loop, return. */
  | "first_blocked"
  /** Apply nel loop ritorna 0: pos ripristinata, return. */
  | "loop_blocked"
  /** Loop esaurito (D2 == 0xC): stuck — pos ripristinata, marker set. */
  | "loop_exhausted_stuck";

export interface Sub19692Result {
  /** Esito del retry loop. */
  outcome: Sub19692Outcome;
  /**
   * Numero di iterazioni del loop completate (D2 finale, 0..0xC).
   * `0` per `early_marker`/`first_blocked`. `0xC` per `loop_exhausted_stuck`.
   */
  iters: number;
  /**
   * Numero di chiamate a `fun_19976` durante l'esecuzione (incluso il primo
   * tentativo). `0` per `early_marker`.
   */
  moveCalls: number;
  /**
   * Numero di chiamate a `fun_1937c` durante l'esecuzione (= moveCalls;
   * sempre paired). `0` per `early_marker`.
   */
  validateCalls: number;
  /** Valore finale di entity[0x26] post-call. */
  finalCounter: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function readByte(state: GameState, off: number): number {
  return (state.workRam[off] ?? 0) & 0xff;
}

function writeByte(state: GameState, off: number, v: number): void {
  state.workRam[off] = v & 0xff;
}

function readLongBE(state: GameState, off: number): number {
  return (
    ((state.workRam[off] ?? 0) << 24) |
    ((state.workRam[off + 1] ?? 0) << 16) |
    ((state.workRam[off + 2] ?? 0) << 8) |
    (state.workRam[off + 3] ?? 0)
  ) >>> 0;
}

function writeLongBE(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 24) & 0xff;
  state.workRam[off + 1] = (v >>> 16) & 0xff;
  state.workRam[off + 2] = (v >>> 8) & 0xff;
  state.workRam[off + 3] = v & 0xff;
}

// ─── Replica ─────────────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00019692`.
 *
 * @param state       GameState (modifica `state.workRam[entity..entity+0x27]`).
 * @param entityAddr  indirizzo assoluto m68k della struct entity (es. 0x401E00).
 *                    Convertito a offset `entityAddr - 0x400000`.
 * @param subs        injection. `subs.fun_19976` (move) e `subs.fun_1937c`
 *                    (validate). Default: no-op + return 0 (= early exit).
 *
 * @returns dettaglio dell'esecuzione (outcome, iter count, JSR count).
 *
 * **Ordine delle scritture** (rilevante per parity vs binario):
 *   1. Test `entity[0x26] == 0x10` → early return.
 *   2. Save D5 = entity[0xC..0xF], D4 = entity[0x10..0x13].
 *   3. step = (entity[0x25] == 7) ? 1 : 4.
 *   4. Call fun_19976; call fun_1937c.
 *   5. Se fun_1937c == 0: restore D5/D4, return ("first_blocked").
 *   6. D2 = 0. Loop:
 *      - Se state==7 OR (D2 & 3) == 0: apply
 *        - entity[0xC..0xF] = D5, entity[0x10..0x13] = D4
 *        - entity[0x26] = (entity[0x26] + step) & 0xF
 *        - Call fun_19976, fun_1937c. Se 0: restore D5/D4, return ("loop_blocked").
 *      - D2++; se D2 == 0xC → stuck.
 *   7. Stuck: entity[0x26] = 0x10, entity[0..7] = 0; restore D5/D4.
 */
export function sub19692(
  state: GameState,
  entityAddr: number,
  subs?: Sub19692Subs,
): Sub19692Result {
  const off = (entityAddr - 0x400000) >>> 0;

  // ─── Early-out: entity[0x26] == 0x10 ────────────────────────────────────
  if (readByte(state, off + ENTITY_COUNTER_OFFSET) === STUCK_MARKER) {
    return {
      outcome: "early_marker",
      iters: 0,
      moveCalls: 0,
      validateCalls: 0,
      finalCounter: STUCK_MARKER,
    };
  }

  // ─── Save position D5, D4 ───────────────────────────────────────────────
  const savedX = readLongBE(state, off + ENTITY_POS_X_OFFSET);
  const savedY = readLongBE(state, off + ENTITY_POS_Y_OFFSET);

  // ─── Compute step (D3) ──────────────────────────────────────────────────
  const stateByte = readByte(state, off + ENTITY_STATE_OFFSET);
  const step = stateByte === STATE_FINE_STEP ? STEP_FINE : STEP_COARSE;

  // ─── Setup sub injection con default ────────────────────────────────────
  const fnMove =
    subs?.fun_19976 ??
    ((): void => {
      /* no-op */
    });
  const fnValidate = subs?.fun_1937c ?? ((): number => 0);

  // ─── First attempt: move + validate ─────────────────────────────────────
  fnMove(state, entityAddr);
  let moveCalls = 1;
  const firstD0 = fnValidate(state, entityAddr) >>> 0;
  let validateCalls = 1;

  if (firstD0 === 0) {
    // "libera" (= D0 == 0): restore pos e return.
    writeLongBE(state, off + ENTITY_POS_X_OFFSET, savedX);
    writeLongBE(state, off + ENTITY_POS_Y_OFFSET, savedY);
    return {
      outcome: "first_blocked",
      iters: 0,
      moveCalls,
      validateCalls,
      finalCounter: readByte(state, off + ENTITY_COUNTER_OFFSET),
    };
  }

  // ─── Loop D2 = 0..0xB ───────────────────────────────────────────────────
  let d2 = 0;
  while (true) {
    const applyThisIter =
      stateByte === STATE_FINE_STEP || (d2 & ITER_MASK) === 0;

    if (applyThisIter) {
      // Restore pos to saved (D5, D4).
      writeLongBE(state, off + ENTITY_POS_X_OFFSET, savedX);
      writeLongBE(state, off + ENTITY_POS_Y_OFFSET, savedY);

      // entity[0x26] = (entity[0x26] + step) & 0xF.
      const cur = readByte(state, off + ENTITY_COUNTER_OFFSET);
      const newDir = (cur + step) & 0x0f;
      writeByte(state, off + ENTITY_COUNTER_OFFSET, newDir);

      // NB: NO cycle-back check (FUN_198BC ha questa, FUN_19692 NO).
      // Apply move + validate.
      fnMove(state, entityAddr);
      moveCalls++;
      const d0 = fnValidate(state, entityAddr) >>> 0;
      validateCalls++;

      if (d0 === 0) {
        // "libera" → restore pos e return.
        writeLongBE(state, off + ENTITY_POS_X_OFFSET, savedX);
        writeLongBE(state, off + ENTITY_POS_Y_OFFSET, savedY);
        return {
          outcome: "loop_blocked",
          iters: d2,
          moveCalls,
          validateCalls,
          finalCounter: readByte(state, off + ENTITY_COUNTER_OFFSET),
        };
      }
      // d0 != 0 → fall through to inc_iter (pos resta del move ma sarà
      // restored alla fine se loop esaurisce).
    }

    // inc_iter: D2++; check D2 == 0xC.
    d2++;
    if (d2 === MAX_ITER) {
      // Loop exhausted: stuck. entity[0x26] = 0x10; entity[0..7] = 0.
      writeByte(state, off + ENTITY_COUNTER_OFFSET, STUCK_MARKER);
      writeLongBE(state, off + ENTITY_VEL_Y_OFFSET, 0);
      writeLongBE(state, off + ENTITY_VEL_X_OFFSET, 0);
      // Restore pos.
      writeLongBE(state, off + ENTITY_POS_X_OFFSET, savedX);
      writeLongBE(state, off + ENTITY_POS_Y_OFFSET, savedY);
      return {
        outcome: "loop_exhausted_stuck",
        iters: MAX_ITER,
        moveCalls,
        validateCalls,
        finalCounter: STUCK_MARKER,
      };
    }
  }
}
