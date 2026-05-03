/**
 * game-main-gate.ts — replica del root game-logic `FUN_00028972`.
 *
 * Funzione "main gate" eseguita ogni frame all'inizio della pipeline.
 * Si occupa di:
 *
 *   1. **Debounce input** (sub `FUN_2893C` replicato inline): legge il
 *      byte MMIO @ `0xF60001` e aggiorna 3 byte di stato:
 *        - `*0x4003A8` = previous sample (per debounce)
 *        - `*0x4003AA` = stable bits (set se `prev & curr`, clear se `prev | curr`==0)
 *        - `*0x4003AC` = falling-edge bits (bit che sono passati 1→0)
 *
 *   2. **Block A**: se bit 0 di `*0x4003AC` set + `*0x400390 == 1` +
 *      gateCheck(1) ≠ 0 → setta `*0x400396 = 1`, `*0x400390 = 5`. Clear
 *      bit 0 di `*0x4003AC`.
 *
 *   3. **Block B**: identico a Block A ma per bit 1, count=2.
 *
 *   4. **MMIO check `0xF60001` bit 6**: se set → early exit (Block C
 *      skippato). Tipicamente questo bit è "EEPROM ready" o simile.
 *
 *   5. **Block C** (se MMIO bit 6 = 0):
 *      - condizione di pause/hang se `*0x4003AA` ha bit 0 e bit 1 set
 *      - jsr `FUN_28D02(1)` se bit 0 di `*0x4003AA` non è set
 *      - **Spin loop** sul binario in attesa di MMIO bit 6 (in TS:
 *        skippato — assumiamo che l'EEPROM/hardware sia ready)
 *      - per i primi 2 oggetti: se obj.state in {1,3+} e timerOuter <
 *        360, incrementa timerOuter di 60 (clamp a 360)
 *      - se bit 0 di `*0x4003AA` non set → `FUN_28D02(0)`
 *      - `*0x4003B2 = 0x40`
 *
 * Strategia di replica per testabilità:
 *   - L'MMIO input è passato come parametro (`mmioInput`) invece che
 *     letto da hardware: deterministic.
 *   - `gateCheck` e `controlCallback` sono opzionali — sostituiscono
 *     `FUN_01CC` e `FUN_28D02` rispettivamente. In differential testing
 *     il binario viene patched: `FUN_01CC` → `moveq #1, D0; rts` e
 *     `FUN_28D02` → `rts`.
 *   - **Hang detection**: se la condizione di pause si verifica
 *     (entrambi bit 0 e bit 1 di `*0x4003AA` set), il flag
 *     `state.hangRequested` viene settato. Il game loop deve gestirlo.
 *     Il binario va in spin infinito (`bra .`).
 *
 * **Verificato bit-perfect** vs `FUN_00028972` (con FUN_01CC e FUN_28D02
 * patched, MMIO bit 6 = 1) tramite `cli/src/test-game-main-gate-parity.ts`.
 */

import type { GameState } from "./state.js";

// ─── Address constants (workRam offsets) ─────────────────────────────────

/** Byte: previous MMIO input sample (assoluto 0x4003A8). */
export const PREV_INPUT_OFF = 0x3a8 as const;
/** Byte: debounced stable input bits (assoluto 0x4003AA). */
export const DEBOUNCED_INPUT_OFF = 0x3aa as const;
/** Byte: falling-edge trigger flags (assoluto 0x4003AC). */
export const FALLING_EDGES_OFF = 0x3ac as const;

/** Word: game state @ 0x400390 (anche definito in game-tick-timers). */
export const GAME_STATE_WORD_OFF = 0x390 as const;
/** Word: object count @ 0x400396. */
export const OBJECT_COUNT_OFF = 0x396 as const;
/** Byte: control flag @ 0x4003B2 (set a 0x40 alla fine di Block C). */
export const CONTROL_BYTE_OFF = 0x3b2 as const;

/** Object base + per-obj field offsets (replicano game-tick-timers.ts). */
const OBJECTS_BASE_OFF = 0x18;
const OBJECT_STRIDE = 0xe2;
const OBJ_STATE_OFF = 0x18;
const OBJ_TIMER_OUTER_OFF = 0x6a; // word

const TIMER_INCREMENT = 0x3c; // 60
const TIMER_CLAMP = 0x168; // 360

/** MMIO byte 0xF60001 bit mask: bit 6 = "hardware ready / skip Block C". */
const MMIO_READY_BIT = 0x40;

// ─── Sub-replica: FUN_2893C debounce ─────────────────────────────────────

/**
 * Replica `FUN_0002893C` — debounce + falling-edge detect su MMIO input.
 *
 * Logica (per byte di stato, 8 bit indipendenti):
 *   prev := *0x4003A8 (sample precedente)
 *   curr := mmioByte (sample corrente)
 *   newDebounced := (oldDebounced | (prev & curr)) & (prev | curr)
 *   *0x4003A8 := curr   (save next prev)
 *   *0x4003AA := newDebounced
 *   *0x4003AC |= (newDebounced ^ oldDebounced) & oldDebounced
 *                 ; bit che sono passati 1→0 (falling edge)
 *
 * Verificato indirettamente via differential test di FUN_28972.
 */
export function debounceInput(state: GameState, mmioByte: number): void {
  const r = state.workRam;
  const prev = r[PREV_INPUT_OFF] ?? 0;
  const oldDebounced = r[DEBOUNCED_INPUT_OFF] ?? 0;
  const curr = mmioByte & 0xff;

  // (prev & curr) → bits stable HIGH per 2 sample → set in stato
  // (prev | curr) → bits HIGH in almeno uno → mantieni; altrimenti clear
  let newDebounced = (oldDebounced | (prev & curr)) & (prev | curr);
  newDebounced &= 0xff;

  r[DEBOUNCED_INPUT_OFF] = newDebounced;
  r[PREV_INPUT_OFF] = curr;

  // Falling edges: bit che sono cambiati E erano 1 → ora 0
  const falling = ((newDebounced ^ oldDebounced) & oldDebounced) & 0xff;
  r[FALLING_EDGES_OFF] = ((r[FALLING_EDGES_OFF] ?? 0) | falling) & 0xff;
}

// ─── Block helper: A o B ─────────────────────────────────────────────────

function processGateBlock(
  state: GameState,
  bitNum: 0 | 1,
  countValue: number,
  gateCheck?: (arg: number) => number,
): void {
  const r = state.workRam;
  const fallingByte = r[FALLING_EDGES_OFF] ?? 0;
  // btst #N, (A4) — branch if bit clear (beq)
  if ((fallingByte & (1 << bitNum)) === 0) return;

  // cmp.w #1, *A3 — branch if not equal (bne)
  const gameStateWord =
    ((r[GAME_STATE_WORD_OFF] ?? 0) << 8) | (r[GAME_STATE_WORD_OFF + 1] ?? 0);
  if (gameStateWord !== 1) return;

  // andi.b #-2 (per bit 0) o #-3 (per bit 1) — clear the bit
  r[FALLING_EDGES_OFF] = (fallingByte & ~(1 << bitNum)) & 0xff;

  // gateCheck (FUN_01CC): se ritorna 0 → skip
  const result = gateCheck ? gateCheck(countValue) : 0;
  if (result === 0) return;

  // Commit: count word = countValue, game state = 5
  r[OBJECT_COUNT_OFF] = 0;
  r[OBJECT_COUNT_OFF + 1] = countValue;
  r[GAME_STATE_WORD_OFF] = 0;
  r[GAME_STATE_WORD_OFF + 1] = 5;
}

// ─── Main function: replica FUN_28972 ────────────────────────────────────

export interface GameMainGateOptions {
  /** Valore byte @ MMIO 0xF60001 (input controller debounced source). */
  mmioInput: number;
  /**
   * Stub di `FUN_01CC` (= jmp `FUN_472A`). Riceve l'arg long, ritorna long.
   * Se omesso → ritorna 0 (Block A/B no-op).
   */
  gateCheck?: (arg: number) => number;
  /**
   * Stub di `FUN_28D02`. Riceve l'arg long.
   * Se omesso → no-op.
   */
  controlCallback?: (arg: number) => void;
}

/**
 * Flag opzionale settato sullo state se la pause-hang condition viene
 * raggiunta (entrambi bit 0+1 di *0x4003AA set). Nel binario equivale a
 * `bra .` infinito; in TS, il game loop deve interrompere il processing.
 */
export interface GameStateWithHang extends GameState {
  hangRequested?: boolean;
}

/**
 * Replica `FUN_00028972` — main gate del game loop.
 *
 * Vedi header del file per overview completa.
 */
export function gameMainGate(state: GameState, opts: GameMainGateOptions): void {
  const r = state.workRam;

  // Step 1: debounce input MMIO
  debounceInput(state, opts.mmioInput);

  // Step 2: Block A (bit 0, count=1)
  processGateBlock(state, 0, 1, opts.gateCheck);

  // Step 3: Block B (bit 1, count=2)
  processGateBlock(state, 1, 2, opts.gateCheck);

  // Step 4: MMIO bit 6 check (early exit)
  if ((opts.mmioInput & MMIO_READY_BIT) !== 0) {
    return;
  }

  // ─── Block C: pause logic + timer increment ─────────────────────────
  const debouncedByte = r[DEBOUNCED_INPUT_OFF] ?? 0;
  const bit0Set = (debouncedByte & 0x01) !== 0;
  const bit1Set = (debouncedByte & 0x02) !== 0;

  // Hang detection: bit 0 AND bit 1 set di *0x4003AA → fatal pause (bra .)
  if (bit0Set && bit1Set) {
    (state as GameStateWithHang).hangRequested = true;
    return;
  }

  // skip_c2 / skip_c3 logic:
  //   if bit 0 of *0x4003AA NOT set: jsr FUN_28D02(1)
  //   poi (sempre): jsr FUN_10110 (mask interrupts), wait_loop, ...
  if (!bit0Set) {
    if (opts.controlCallback) opts.controlCallback(1);
  }

  // Spin loop sul binario @ 0x28A1A: skipped in TS (assumiamo hardware ready).

  // Timer increment loop (per i primi 2 oggetti)
  for (let i = 0; i < 2; i++) {
    const objOff = OBJECTS_BASE_OFF + i * OBJECT_STRIDE;
    const stateByte = r[objOff + OBJ_STATE_OFF] ?? 0;
    // tst.b *(A0+0x18); beq skip   — skip se state == 0
    if (stateByte === 0) continue;
    // cmpi.b #2, ...; beq skip      — skip se state == 2
    if (stateByte === 2) continue;

    // *(obj+0x6A) += 60 (word add)
    const oldOuter =
      ((r[objOff + OBJ_TIMER_OUTER_OFF] ?? 0) << 8) |
      (r[objOff + OBJ_TIMER_OUTER_OFF + 1] ?? 0);
    let newOuter = (oldOuter + TIMER_INCREMENT) & 0xffff;
    // cmpi.w #0x168, ...; ble skip
    // ble after cmp(#0x168, value): branches if 0x168 - value <= 0 signed,
    // i.e., if value >= 0x168 signed. In quel caso skip clamp.
    // Dunque clamp solo se value < 0x168 signed... no aspetta.
    //
    // Re-read: cmpi.w #0x168, (0x6a,A0); ble.b skip
    // cmpi.w computes (0x6a,A0) - 0x168 (cmpi: dest - src). ble: signed <= 0.
    // So branch (skip clamp) if (timer - 0x168) <= 0 signed = timer <= 0x168.
    // Don't branch (clamp) if timer > 0x168.
    // Wait, that contradicts. Let me re-check cmpi semantics.
    //
    // CMPI #imm, <ea>: subtracts imm from <ea>, sets flags. Flags reflect
    // <ea> - imm. So result is timer - 0x168. ble: if N or Z, i.e., result <= 0.
    // So branch if timer <= 0x168. Don't branch (= clamp) if timer > 0x168.
    //
    // We've already added 60 → newOuter. Check if newOuter > 0x168 signed.
    const newOuterSigned = newOuter & 0x8000 ? newOuter - 0x10000 : newOuter;
    if (newOuterSigned > TIMER_CLAMP) {
      newOuter = TIMER_CLAMP;
    }
    r[objOff + OBJ_TIMER_OUTER_OFF] = (newOuter >>> 8) & 0xff;
    r[objOff + OBJ_TIMER_OUTER_OFF + 1] = newOuter & 0xff;
  }

  // Final: if bit 0 of *0x4003AA NOT set: jsr FUN_28D02(0)
  if (!bit0Set) {
    if (opts.controlCallback) opts.controlCallback(0);
  }

  // *0x4003B2 = 0x40
  r[CONTROL_BYTE_OFF] = 0x40;
}
