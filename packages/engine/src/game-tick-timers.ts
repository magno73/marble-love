/**
 * game-tick-timers.ts — replica del root game-logic `FUN_00028A96`.
 *
 * Funzione "tick di tutti i timer di gioco" eseguita ogni frame:
 *   1. **Per-object loop**: per ogni oggetto attivo, tick del cascading
 *      timer interno (offset +0x6A, struct 5 byte). Su scadenza:
 *        - reset timer + obj state → 2
 *        - palette FX a `0xB0001E` o `0xB00016` (in base a obj +0x19)
 *      Se il timer ha solo "cascated" (bit 1 senza bit 0), gestione
 *      condizionale del valore corrente del contatore.
 *      Tutte le iterazioni con bit 1 set → chiamano l'HUD updater FUN_286EE.
 *
 *   2. **Re-pass se almeno un timer è scaduto** (`anyExpired == true`):
 *      - `*0x400390 = 4`
 *      - per ogni obj con state==1 && type!=6: gestione del timer in base
 *        al suo valore corrente (caso == 0 vs < 5 vs >= 5)
 *
 *   3. **Global timer @ 0x40039E** (5 byte struct identica a quella obj):
 *      - tick + dispatch su flags
 *      - se cascade && global_timer < 11 && *0x400390 == 2 → HUD update
 *
 * Strategia di replica per testabilità:
 *   - L'HUD updater `FUN_286EE` è opzionale (`hudCallback`). Per default
 *     no-op.
 *   - In differential testing, il binario viene patched: `FUN_286EE` →
 *     immediate `rts` (bytes 0x4E75) per evitare side effect HUD.
 *   - Il confronto verifica workRam (oggetti + global timer + game state
 *     word) e colorRam (palette FX bytes).
 *
 * **Verificato bit-perfect** vs `FUN_00028A96` (con FUN_286EE NOPped).
 */

import type { GameState } from "./state.js";
import { tickCascadingTimer } from "./timer-cascade.js";

// ─── Address constants (workRam offsets) ─────────────────────────────────

/** Base degli object structs (assoluto 0x400018). */
export const OBJECTS_BASE_OFF = 0x18 as const;
/** Stride tra object struct adiacenti. */
export const OBJECT_STRIDE = 0xe2 as const;
/** Word: numero di oggetti attivi (assoluto 0x400396). */
export const OBJECT_COUNT_OFF = 0x396 as const;
/** Word: game state byte (assoluto 0x400390). */
export const GAME_STATE_WORD_OFF = 0x390 as const;
/** Struct global timer (5 byte, assoluto 0x40039E). */
export const GLOBAL_TIMER_OFF = 0x39e as const;

// Per-object field offsets (relative al base dell'obj struct)
const OBJ_STATE_OFF = 0x18; // byte: state machine
const OBJ_FLAG_OFF = 0x19; // byte: controlla quale palette FX
const OBJ_TYPE_OFF = 0x1a; // byte: type (8 = skip)
const OBJ_TIMER_OFF = 0x6a; // 5 byte cascading timer struct
const OBJ_FLAG71_OFF = 0x71; // byte: post-tick flag

// ─── Color RAM palette FX values ─────────────────────────────────────────

/** Color RAM offset (assoluto 0xB0001E) — scritto se obj +0x19 != 0. */
const COLORRAM_FX_A_OFF = 0x1e;
/** Color RAM offset (assoluto 0xB00016) — scritto se obj +0x19 == 0. */
const COLORRAM_FX_B_OFF = 0x16;
/** Word value: -0x5100 in two's complement = 0xAF00. */
const FX_A_VALUE = 0xaf00;
/** Word value: -0xFF1 in two's complement = 0xF00F. */
const FX_B_VALUE = 0xf00f;

/**
 * Callback per HUD updater (`FUN_286EE`). Riceve il pointer al timer
 * struct (= obj+0x6A oppure 0x40039E) e l'indice da mostrare. Se
 * omesso, no-op.
 */
export type HudCallback = (timerPtr: number, idx: number) => void;

function writeColorRamWord(state: GameState, off: number, value: number): void {
  state.colorRam[off] = (value >>> 8) & 0xff;
  state.colorRam[off + 1] = value & 0xff;
}

function readObjTimerWordSigned(state: GameState, objOff: number): number {
  const w =
    ((state.workRam[objOff + OBJ_TIMER_OFF] ?? 0) << 8) |
    (state.workRam[objOff + OBJ_TIMER_OFF + 1] ?? 0);
  // sign-extend 16 → 32
  return w & 0x8000 ? w - 0x10000 : w;
}

function applyPaletteFx(state: GameState, objOff: number): void {
  // Disasm:
  //   tst.b *(A2+0x19); beq else; *0xB0001E.w = -0x5100; bra ...
  //   else: *0xB00016.w = -0xFF1
  if ((state.workRam[objOff + OBJ_FLAG_OFF] ?? 0) !== 0) {
    writeColorRamWord(state, COLORRAM_FX_A_OFF, FX_A_VALUE);
  } else {
    writeColorRamWord(state, COLORRAM_FX_B_OFF, FX_B_VALUE);
  }
}

/**
 * Replica `FUN_00028A96` — tick di tutti i timer di gioco.
 *
 * Vedi header del file per overview. Operazione complessa che itera
 * `*0x400396` oggetti, ticka il loro cascading timer e fa dispatch
 * complesso sui flag, poi gestisce un global timer separato.
 *
 * @param state        GameState
 * @param hudCallback  Opzionale: invocato per ogni iterazione che
 *                     richiede HUD update (sostituisce `FUN_286EE`).
 *                     Riceve `(timerPtr, idx)` con `timerPtr` =
 *                     obj+0x6A o 0x40039E, e `idx` calcolato come
 *                     `count + i - 1` (o 3 per global timer).
 */
export function gameTickTimers(state: GameState, hudCallback?: HudCallback): void {
  const r = state.workRam;

  // count = word @ 0x400396
  const count =
    ((r[OBJECT_COUNT_OFF] ?? 0) << 8) | (r[OBJECT_COUNT_OFF + 1] ?? 0);

  // ─── Block 1: per-object timer tick + dispatch ────────────────────────
  let anyExpired = false;

  // Loop: D2 byte counter compared to *0x400396 word (signed via sext.w).
  // In pratica count è piccolo (< 128) e questo equivale a "count iterazioni".
  for (let i = 0; i < count; i++) {
    const objOff = OBJECTS_BASE_OFF + i * OBJECT_STRIDE;
    const timerAbs = (0x400000 + objOff + OBJ_TIMER_OFF) >>> 0;

    let callHud = false;

    // Skip whole iteration body if obj type == 8 (ma comunque chiama HUD)
    if ((r[objOff + OBJ_TYPE_OFF] ?? 0) === 8) {
      callHud = true;
    } else {
      const flags = tickCascadingTimer(state, timerAbs);

      // Bit 0: timer fully wrapped (outer cascade)
      if (flags & 1) {
        r[objOff + OBJ_STATE_OFF] = 2;
        anyExpired = true;
        // Reset timer struct: word @ +0x6A = 0, byte @ +0x6C = 0, byte @ +0x6E = 0xFF
        r[objOff + OBJ_TIMER_OFF] = 0;
        r[objOff + OBJ_TIMER_OFF + 1] = 0;
        r[objOff + OBJ_TIMER_OFF + 0x02] = 0;
        r[objOff + OBJ_TIMER_OFF + 0x04] = 0xff;
        r[objOff + OBJ_FLAG71_OFF] = 0xff;
        applyPaletteFx(state, objOff);
        // fall through to check bit 1
      }

      // Bit 1: cascade triggered (medium counter wrapped)
      if (flags & 2) {
        callHud = true;
        const timerW = readObjTimerWordSigned(state, objOff);
        if (timerW === 4) {
          // *A2.+0x71 = 0 (clear flag), then HUD call
          r[objOff + OBJ_FLAG71_OFF] = 0;
        } else if (timerW > 5) {
          // *A2.+0x71 = 0xFF, palette FX, then HUD call
          r[objOff + OBJ_FLAG71_OFF] = 0xff;
          applyPaletteFx(state, objOff);
        }
        // else (*A3 in {-INF..3, 5}): no field update, just HUD call
      }
      // (bit 1 not set AND bit 0 may or not be set): no HUD call
    }

    if (callHud && hudCallback) {
      // idx = sext_l(*0x400396 word) + sext_l(D2 byte) - 1
      const idx = (count + i - 1) | 0;
      hudCallback((0x400000 + objOff + OBJ_TIMER_OFF) >>> 0, idx);
    }
  }

  // ─── Block 2: re-pass se almeno un timer è scaduto ────────────────────
  if (anyExpired) {
    // *0x400390.w = 4
    r[GAME_STATE_WORD_OFF] = 0;
    r[GAME_STATE_WORD_OFF + 1] = 4;

    for (let i = 0; i < count; i++) {
      const objOff = OBJECTS_BASE_OFF + i * OBJECT_STRIDE;
      // if obj.state != 1: skip
      if ((r[objOff + OBJ_STATE_OFF] ?? 0) !== 1) continue;
      // if obj.type == 6: skip
      if ((r[objOff + OBJ_TYPE_OFF] ?? 0) === 6) continue;

      const timerW = readObjTimerWordSigned(state, objOff);
      if (timerW === 0) {
        // Reset timer + state, NO HUD call
        r[objOff + OBJ_STATE_OFF] = 2;
        r[objOff + OBJ_TIMER_OFF] = 0;
        r[objOff + OBJ_TIMER_OFF + 1] = 0;
        r[objOff + OBJ_TIMER_OFF + 0x02] = 0;
        r[objOff + OBJ_TIMER_OFF + 0x04] = 0xff;
      } else if (timerW < 5) {
        // *(obj+0x6A) = 5 (word), poi HUD call
        // (Caso: timer in {-INF..-1, 1..4})
        r[objOff + OBJ_TIMER_OFF] = 0;
        r[objOff + OBJ_TIMER_OFF + 1] = 5;
        if (hudCallback) {
          const idx = (count + i - 1) | 0;
          hudCallback((0x400000 + objOff + OBJ_TIMER_OFF) >>> 0, idx);
        }
      }
      // timerW >= 5: skip (no action)
    }
  }

  // ─── Block 3: global timer @ 0x40039E ─────────────────────────────────
  const globalTimerAbs = (0x400000 + GLOBAL_TIMER_OFF) >>> 0;
  const flagsG = tickCascadingTimer(state, globalTimerAbs);

  if (flagsG & 1) {
    // *(0x40039E+4) = 0xFF
    r[GLOBAL_TIMER_OFF + 0x04] = 0xff;
  }

  if (flagsG & 2) {
    const globalTimerWord =
      ((r[GLOBAL_TIMER_OFF] ?? 0) << 8) | (r[GLOBAL_TIMER_OFF + 1] ?? 0);
    const globalTimerSigned =
      globalTimerWord & 0x8000 ? globalTimerWord - 0x10000 : globalTimerWord;
    const gameStateWord =
      ((r[GAME_STATE_WORD_OFF] ?? 0) << 8) | (r[GAME_STATE_WORD_OFF + 1] ?? 0);
    // condizione: global_timer < 11 (signed) && *0x400390 == 2
    if (globalTimerSigned < 11 && gameStateWord === 2) {
      if (hudCallback) {
        hudCallback(globalTimerAbs, 3);
      }
    }
  }
}
