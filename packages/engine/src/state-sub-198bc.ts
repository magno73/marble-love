/**
 * state-sub-198bc.ts — replica `FUN_000198BC` (186 byte).
 *
 * "Entity move-and-validate retry loop". Caller dispatcher di
 * `FUN_0001973C` (single xref @ 0x000198AE). Tenta di muovere l'entity nella
 * sua direzione corrente (`entity[0x26]`); se la nuova posizione è invalida,
 * ripristina; se valida, ruota la direzione fino a 9 iterazioni cercando
 * direzioni alternative, e marca "stuck" (entity[0x26]=0x10, entity[0..7]=0)
 * se nessuna alternativa è valida o se cicla.
 *
 * **Disasm 0x198BC..0x19975** (186 byte):
 *
 *   movem.l {A2,D2..D6},-(SP)             ; salva A2,D2..D6 (24 byte)
 *   movea.l (0x1c,SP),A2                  ; A2 = arg (entity ptr)
 *   cmpi.b  #0x10,(0x26,A2)
 *   beq.w   end_restore_regs              ; if entity[0x26] == 0x10 → return
 *   move.l  (0xc,A2),D6                   ; D6 = entity[0xC..0xF] (orig x)
 *   move.l  (0x10,A2),D5                  ; D5 = entity[0x10..0x13] (orig y)
 *   cmpi.b  #0x7,(0x25,A2)
 *   bne.b   not_state7
 *   moveq   #0x1,D3                       ; state==7 → step = 1
 *   bra.b   call_subs
 * not_state7:
 *   moveq   #0x4,D3                       ; state!=7 → step = 4
 * call_subs:
 *   move.l  A2,-(SP)
 *   jsr     0x00019976.l                  ; FUN_19976: applyMoveVelocity(entity)
 *   move.l  A2,-(SP)
 *   jsr     0x0001937c.l                  ; FUN_1937C: validatePosition(entity)→D0
 *   tst.l   D0
 *   addq.l  #8,SP                         ; pop 2 args
 *   beq.w   end_pos_restore               ; if D0==0 (invalid) → restore pos, return
 *   move.b  (0x26,A2),D4b                 ; D4b = original direction
 *   subq.b  #4,(0x26,A2)                  ; entity[0x26] -= 4 (mod 256)
 *   clr.b   D2b                           ; D2b = iter counter (0..8)
 * loop:                                   ; @ 0x19906
 *   cmpi.b  #0x7,(0x25,A2)
 *   beq.b   apply                         ; state==7 → sempre apply
 *   move.b  D2b,D0b
 *   ext.w   D0w
 *   ext.l   D0
 *   moveq   #0x3,D1
 *   and.l   D1,D0
 *   bne.w   inc_iter                      ; if (D2 & 3) != 0 → skip apply
 * apply:                                  ; @ 0x1991C
 *   move.l  D6,(0xc,A2)                   ; restore entity[0xC..0xF] = orig x
 *   move.l  D5,(0x10,A2)                  ; restore entity[0x10..0x13] = orig y
 *   move.b  (0x26,A2),D0b
 *   add.b   D3b,D0b                       ; entity[0x26] += step (1 o 4)
 *   andi.b  #0xf,D0b                      ; & 0x0F (mask 4-bit)
 *   move.b  D0b,(0x26,A2)
 *   cmp.b   (0x26,A2),D4b
 *   beq.w   inc_iter                      ; if cycled back to orig → skip
 *   move.l  A2,-(SP)
 *   jsr     0x00019976.l                  ; FUN_19976(entity)
 *   move.l  A2,-(SP)
 *   jsr     0x0001937c.l                  ; FUN_1937C(entity) → D0
 *   tst.l   D0
 *   addq.l  #8,SP
 *   beq.w   end_pos_restore               ; if invalid → restore pos, return
 *   ; else fall through to inc_iter (NB: position NOT restored; entity moved!)
 * inc_iter:                               ; @ 0x19952
 *   addq.b  #1,D2b
 *   cmpi.b  #0x9,D2b
 *   bne.b   loop                          ; if D2 != 9 → loop
 *   ; D2 == 9: stuck — mark and clear long0/long1
 *   move.b  #0x10,(0x26,A2)               ; entity[0x26] = 0x10
 *   moveq   #0x0,D0
 *   move.l  D0,(0x4,A2)                   ; entity[0x4..0x7] = 0
 *   move.l  D0,(A2)                       ; entity[0x0..0x3] = 0
 * end_pos_restore:                        ; @ 0x19968
 *   move.l  D6,(0xc,A2)                   ; restore entity[0xC..0xF]
 *   move.l  D5,(0x10,A2)                  ; restore entity[0x10..0x13]
 * end_restore_regs:                       ; @ 0x19970
 *   movem.l (SP)+,{D2..D6,A2}
 *   rts
 *
 * **Semantica** (riassunto):
 *   - if entity[0x26] == 0x10 → no-op (return).
 *   - salva position originale (D6=long@0xC, D5=long@0x10).
 *   - step = (state==7) ? 1 : 4.
 *   - 1° tentativo: move + validate. Se invalido → ripristina pos, return.
 *   - 2°..9° tentativo (D2=0..8): in state==7 ogni iter; altrimenti solo
 *     iter con (D2 & 3) == 0 (= 0, 4, 8). Per ogni apply:
 *       - ripristina pos (D6/D5)
 *       - entity[0x26] = (entity[0x26] + step) & 0xF
 *       - se cycle (entity[0x26] == orig) → skip
 *       - else: move + validate. Se invalido → ripristina pos, return.
 *       - se valido: continua il loop (NB: la pos del move VALIDO viene
 *         **lasciata** in entity[0xC..0x13]; il loop continua a sovrascrivere)
 *   - se loop esaurisce (D2 == 9): stuck — entity[0x26]=0x10, entity[0..7]=0.
 *   - in TUTTI i path che escono dal loop (eccetto early return D0==0 1°
 *     tentativo): la posizione viene infine ripristinata a (D6,D5) prima del
 *     return.
 *
 * **JSR esterne** (sub injection):
 *   - `FUN_00019976` = `applyMoveVelocity` (move-velocity.ts) — replicato.
 *   - `FUN_0001937C` = `validatePosition` (proximity-check.ts) — replicato.
 *
 * **Caller noto** (1 xref): `FUN_0001973C` @ 0x000198AE.
 *
 * **Side effects** in `state.workRam` (entity @ argAddr):
 *   - `entity[0x26]`: scritto in molti path (counter wrap 4-bit, oppure 0x10).
 *   - `entity[0xC..0x13]`: scritto (move) e ripristinato a fine call salvo
 *     casi specifici (invalid first try restituisce con pos restored).
 *   - `entity[0x0..0x7]`: azzerati nel branch stuck (D2 == 9).
 *
 * **Quirk importante**: il branch `D2 == 9 → stuck` cade *attraverso* a
 * `end_pos_restore`, quindi anche nel caso stuck la posizione finale è quella
 * originale (D6,D5). NON resta la posizione "valida" dell'ultimo apply.
 *
 * Verifica bit-perfect via `packages/cli/src/test-state-sub-198bc-parity.ts`
 * (500 casi).
 */

import type { GameState } from "./state.js";

// ─── Entity offsets ──────────────────────────────────────────────────────

/** Long @ entity[0x00..0x03] (azzerato in branch stuck D2==9). */
export const ENTITY_LONG0_OFFSET = 0x00 as const;
/** Long @ entity[0x04..0x07] (azzerato in branch stuck D2==9). */
export const ENTITY_LONG1_OFFSET = 0x04 as const;
/** Long @ entity[0x0C..0x0F] (x position; salvato in D6, scritto da FUN_19976). */
export const ENTITY_POS_X_OFFSET = 0x0c as const;
/** Long @ entity[0x10..0x13] (y position; salvato in D5, scritto da FUN_19976). */
export const ENTITY_POS_Y_OFFSET = 0x10 as const;
/** Byte @ entity[0x25] (state byte; selettore step=1 vs step=4). */
export const ENTITY_STATE_OFFSET = 0x25 as const;
/** Byte @ entity[0x26] (direction/counter; rotato dal loop, marker 0x10 = stuck). */
export const ENTITY_COUNTER_OFFSET = 0x26 as const;

// ─── Costanti ────────────────────────────────────────────────────────────

/** Marker "stuck": se entity[0x26] == 0x10 al call → no-op. */
export const STUCK_MARKER = 0x10 as const;
/** State-byte che abilita step=1 (jitter fine). Altri stati → step=4. */
export const STATE_FINE_STEP = 0x07 as const;
/** Step di rotazione direzione per state==7 (jitter ±1 per iter). */
export const STEP_FINE = 0x01 as const;
/** Step di rotazione direzione per state!=7 (jitter ±4). */
export const STEP_COARSE = 0x04 as const;
/** Pre-decrement applicato a entity[0x26] prima del loop. */
export const COUNTER_PREDEC = 0x04 as const;
/** Massimo numero di iterazioni del loop (0..8 → 9 valori). */
export const MAX_ITER = 0x09 as const;
/** Maschera per il check "skippa apply" in state!=7: apply solo se (D2 & MASK) == 0. */
export const ITER_MASK = 0x03 as const;

// ─── Sub injection ───────────────────────────────────────────────────────

/**
 * Stub injection per le 2 JSR interne.
 *
 * `FUN_00019976` = `applyMoveVelocity` (move-velocity.ts): applica la velocità
 * corrispondente a `entity[0x26]` (direzione 0..15) sulla posizione
 * `entity[0xC..0x13]`. Side-effect su `entity[0x00..0x07]` (velocity cache).
 *
 * `FUN_0001937C` = `validatePosition` (proximity-check.ts): controlla se la
 * nuova posizione è libera; ritorna 1 se valida, 0 altrimenti.
 *
 * Default: `fun_19976` = no-op; `fun_1937c` = ritorna 0 (= invalid → early
 * return). Il caller deve iniettare implementazioni reali per behavior reale.
 */
export interface StateSub198BCSubs {
  /** Callback per `FUN_00019976` (move). Default: no-op. */
  fun_19976?: (state: GameState, entityAddr: number) => void;
  /**
   * Callback per `FUN_0001937C` (validate). Default: ritorna 0 (invalid).
   * Ritorna long u32; il binario fa `tst.l D0; beq` quindi 0 = invalid.
   */
  fun_1937c?: (state: GameState, entityAddr: number) => number;
}

// ─── Risultato ───────────────────────────────────────────────────────────

/** Esito globale del retry loop. */
export type Outcome =
  /** entity[0x26] == 0x10 al call: no-op completo (no JSR). */
  | "early_marker"
  /** 1° validate ritorna 0 (invalid): pos ripristinata, no loop, return. */
  | "first_invalid"
  /** Apply successivo invalida la pos: pos ripristinata, return. */
  | "loop_invalid"
  /** Loop esaurito (D2 raggiunge 9): stuck — pos ripristinata, marker set. */
  | "loop_exhausted_stuck"
  /**
   * Branch teorico mai raggiungibile in pratica: il loop **non può** uscire
   * con D2 < 9 senza entrare in un branch invalid (il fall-through dopo apply
   * va sempre a inc_iter). Incluso per completezza tipo.
   */
  | "loop_exited";

export interface StateSub198BCResult {
  /** Esito del retry loop. */
  outcome: Outcome;
  /**
   * Numero di iterazioni del loop completate (D2 finale, 0..9).
   * `0` per `early_marker`/`first_invalid`. `9` per `loop_exhausted_stuck`.
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
  /** Valore originale di entity[0x26] al call (saved D4b). `null` per `early_marker`. */
  originalDir: number | null;
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
 * Replica bit-perfect di `FUN_000198BC`.
 *
 * @param state       GameState (modifica `state.workRam[entity..entity+0x27]`).
 * @param entityAddr  indirizzo assoluto m68k della struct entity (es.
 *                    `0x401e00`). Convertito a offset `entityAddr - 0x400000`.
 * @param subs        injection. `subs.fun_19976` (move) e `subs.fun_1937c`
 *                    (validate). Default: no-op + return 0.
 *
 * @returns dettaglio dell'esecuzione (outcome, iter count, JSR count, dir).
 *
 * **Ordine delle scritture** (rilevante per parity vs binario):
 *   1. Test `entity[0x26] == 0x10` → early return.
 *   2. Save D6 = entity[0xC..0xF], D5 = entity[0x10..0x13].
 *   3. step = (entity[0x25] == 7) ? 1 : 4.
 *   4. Call `fun_19976(state, addr)` → `fun_1937c(state, addr)`.
 *   5. Se `fun_1937c` ritorna 0: scrivi D6→entity[0xC..0xF], D5→entity[0x10..0x13]; return.
 *   6. D4 = entity[0x26]; entity[0x26] -= 4 (mod 256); D2 = 0.
 *   7. Loop: per D2 = 0..8:
 *      - Se state==7 OR (D2 & 3)==0: apply
 *        - entity[0xC..0xF] = D6, entity[0x10..0x13] = D5
 *        - entity[0x26] = (entity[0x26] + step) & 0xF
 *        - Se entity[0x26] == D4: skip (continue)
 *        - Else: call fun_19976, fun_1937c. Se 0: restore D6/D5, return.
 *      - D2++.
 *   8. Se D2 == 9 (loop esaurito): entity[0x26] = 0x10, entity[0..7] = 0;
 *      poi restore D6→entity[0xC..0xF], D5→entity[0x10..0x13].
 */
export function stateSub198BC(
  state: GameState,
  entityAddr: number,
  subs?: StateSub198BCSubs,
): StateSub198BCResult {
  const off = (entityAddr - 0x400000) >>> 0;

  // ─── Early-out: entity[0x26] == 0x10 ────────────────────────────────────
  if (readByte(state, off + ENTITY_COUNTER_OFFSET) === STUCK_MARKER) {
    return {
      outcome: "early_marker",
      iters: 0,
      moveCalls: 0,
      validateCalls: 0,
      originalDir: null,
      finalCounter: STUCK_MARKER,
    };
  }

  // ─── Save position D6, D5 ───────────────────────────────────────────────
  const savedX = readLongBE(state, off + ENTITY_POS_X_OFFSET);
  const savedY = readLongBE(state, off + ENTITY_POS_Y_OFFSET);

  // ─── Compute step (D3) ──────────────────────────────────────────────────
  const stateByte = readByte(state, off + ENTITY_STATE_OFFSET);
  const step = stateByte === STATE_FINE_STEP ? STEP_FINE : STEP_COARSE;

  // ─── First attempt: move + validate ─────────────────────────────────────
  const fnMove =
    subs?.fun_19976 ??
    ((): void => {
      // no-op default
    });
  const fnValidate = subs?.fun_1937c ?? ((): number => 0);

  fnMove(state, entityAddr);
  let moveCalls = 1;
  const firstD0 = fnValidate(state, entityAddr) >>> 0;
  let validateCalls = 1;

  if (firstD0 === 0) {
    // Invalid first try: restore pos, return.
    writeLongBE(state, off + ENTITY_POS_X_OFFSET, savedX);
    writeLongBE(state, off + ENTITY_POS_Y_OFFSET, savedY);
    return {
      outcome: "first_invalid",
      iters: 0,
      moveCalls,
      validateCalls,
      originalDir: null,
      finalCounter: readByte(state, off + ENTITY_COUNTER_OFFSET),
    };
  }

  // ─── First valid: setup loop ────────────────────────────────────────────
  // D4b = entity[0x26]: salva direzione originale (PRIMA del subq).
  const d4 = readByte(state, off + ENTITY_COUNTER_OFFSET);
  // entity[0x26] -= 4 (byte sub mod 256).
  writeByte(
    state,
    off + ENTITY_COUNTER_OFFSET,
    (d4 - COUNTER_PREDEC) & 0xff,
  );

  // ─── Loop D2 = 0..8 ─────────────────────────────────────────────────────
  let d2 = 0;
  while (true) {
    // Determine if this iter applies.
    const applyThisIter =
      stateByte === STATE_FINE_STEP || (d2 & ITER_MASK) === 0;

    if (applyThisIter) {
      // Restore position to original (D6, D5).
      writeLongBE(state, off + ENTITY_POS_X_OFFSET, savedX);
      writeLongBE(state, off + ENTITY_POS_Y_OFFSET, savedY);

      // entity[0x26] = (entity[0x26] + step) & 0xF.
      const cur = readByte(state, off + ENTITY_COUNTER_OFFSET);
      const newDir = (cur + step) & 0x0f;
      writeByte(state, off + ENTITY_COUNTER_OFFSET, newDir);

      // If cycled back to original direction: skip apply.
      if (newDir !== d4) {
        // Apply: move + validate.
        fnMove(state, entityAddr);
        moveCalls++;
        const d0 = fnValidate(state, entityAddr) >>> 0;
        validateCalls++;

        if (d0 === 0) {
          // Invalid: restore pos, return.
          writeLongBE(state, off + ENTITY_POS_X_OFFSET, savedX);
          writeLongBE(state, off + ENTITY_POS_Y_OFFSET, savedY);
          return {
            outcome: "loop_invalid",
            iters: d2,
            moveCalls,
            validateCalls,
            originalDir: d4,
            finalCounter: readByte(state, off + ENTITY_COUNTER_OFFSET),
          };
        }
        // Valid: fall through to inc_iter.
      }
      // Cycled (newDir == d4): fall through to inc_iter.
    }

    // inc_iter: D2++; check D2 == 9.
    d2++;
    if (d2 === MAX_ITER) {
      // Loop exhausted: stuck. entity[0x26] = 0x10; entity[0..7] = 0.
      writeByte(state, off + ENTITY_COUNTER_OFFSET, STUCK_MARKER);
      writeLongBE(state, off + ENTITY_LONG1_OFFSET, 0);
      writeLongBE(state, off + ENTITY_LONG0_OFFSET, 0);
      // Then restore pos.
      writeLongBE(state, off + ENTITY_POS_X_OFFSET, savedX);
      writeLongBE(state, off + ENTITY_POS_Y_OFFSET, savedY);
      return {
        outcome: "loop_exhausted_stuck",
        iters: MAX_ITER,
        moveCalls,
        validateCalls,
        originalDir: d4,
        finalCounter: STUCK_MARKER,
      };
    }
    // Else: continue loop.
  }
}
