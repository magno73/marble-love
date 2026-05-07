/**
 * state-sub-18a88.ts — replica `FUN_00018A88` (586 byte).
 *
 * "End-of-game per-player score-summary HUD". Iterando l'array di entity
 * @ `0x400018` (stride `0xE2`, count `*0x400396`), per ogni entity con
 * `entity[0x18] == 3` compone una schermata di riepilogo:
 *
 *   1. Init particelle decorative via `FUN_00018CD2(count=0x1C, mode=-1)`.
 *      → Effettua 1 chiamata a inizio funzione (pre-loop).
 *   2. Incrementa il counter byte `*0x004003F0` (vblank tick — 1 hit qui +
 *      altri 3 dentro al body per ciascuna entity matchata).
 *   3. Per ciascuna entity i ∈ [0..count): se `entity[0x18] != 3` → skip.
 *      Altrimenti:
 *      a. `*0x400658 += 1` (counter dei "summary screen" mostrati).
 *      b. `FUN_00028C7E(0)` — clear alpha tilemap from row 0.
 *      c. `*0x4003F0 += 1`.
 *      d. Render header strings: due `FUN_2572` (renderStringChain) verso
 *         alpha tilemap, con `attr` ∈ {0x1000, 0x1400} swappati a seconda
 *         di `entity[0x19]` (player id). Stringhe sorgente in ROM:
 *           - `0x22B0A` (entry struct ptr, attr = D5 = 0x1400 se p1 else 0x1000)
 *           - `0x22AAA` (entry struct ptr, attr = D6 = 0x1000 se p1 else 0x1400)
 *      e. SE `count == 2` (2-player): renderizza la "TAG" con
 *         `FUN_000286B0(romPtr=*(0x1EEF0+i*4), col=0xC, tickOff=5,
 *                       attr=0x2000 se i==0 else 0x2400)`.
 *      f. Score formatting con `FUN_00028E3C` (renderStringHelper, 6-arg):
 *         - clamp `entity[0x6A].w` a 0x63 (99) → "minute" o counter A
 *         - clamp `entity[0xD2].w` a 0x14 (20) → "seconds" o counter B
 *         - mostra D4 finale = 20000 + counterA*1000 - counterB*1000
 *           con count-down progressivo (vedi step h).
 *         Param fissi (4 args costanti):
 *           - `(D5, 2, 0xF, 0xA, 1, counterA_clamped)`  [score line 1]
 *           - `(D6, 5, 0xF, 0x21, 0, counterA*1000)`     [score line 1, val]
 *           - `(D5, 2, 0x11, 0xC, 0, counterB_clamped)` [score line 2]
 *           - `(D6, 5, 0x11, 0x21, 0, counterB*1000)`    [score line 2, val]
 *           - `(D6, 6, 0x13, 0x20, 0, D4)`              [total - initial]
 *      g. `*0x4003F0 += 1`.
 *      h. Render "BONUS" labels: due `FUN_2572` (renderString) verso
 *         alpha tilemap, attr = D5 (player col):
 *           - `0x22AF2` (label "BONUS")
 *           - `0x22AFE` (label "TIME")
 *      i. **Count-down loop** (`D2 = 0xFA = 250`): finché `D4 > 0`:
 *           - `D4 -= 250`
 *           - `FUN_00028608(entityPtr, 250)` (addToObjectAccumAndFlag —
 *             aggiorna `entity[0xBC..0xBF] += 250` e setta bit
 *             `(1 << entity[0x19])` in `*0x40039C`).
 *           - `FUN_00028E3C(D6, 6, 0x13, 0x20, 0, D4)` — refresh display.
 *           - `FUN_00028EB2(*entity[0xBC..0xBF], 7, 0x18, 0x17, 0, D5)` —
 *             format-and-render del nuovo accumulator.
 *           - `FUN_00028DB8(2)` (waitVblankStateGated, count=2).
 *      j. Dopo l'uscita del count-down: `FUN_00028DB8(0x5A)` (90 vblank).
 *
 * **Disasm 0x18A88..0x18CD1** (586 byte) — vedi cache @
 * `/tmp/marble-cand/018A88.txt`. Punti chiave:
 *   - 0x18A88: prologue movem (D2..D7,A2..A4) = 9 long = 0x24 byte saved
 *   - 0x18A8C: A3 = 0x28E3C (renderStringHelper, jsr (A3) ×N)
 *   - 0x18A92: A4 = 0x4003F0 (vblank tick counter)
 *   - 0x18A98..0x18AA8: jsr FUN_18CD2, addq counter, A2 = 0x400018, D3=0
 *   - 0x18AB4: bra.w loop_test (D3 vs count word)
 *   - 0x18AB8..0x18CB1: loop body (gated da entity[0x18] == 3)
 *   - 0x18CB2: A2 += 0xE2, D3 += 1 (next entity)
 *   - 0x18CBE: D3.b ext.w; cmp.w (0x400396).l, D0w; bne loop body
 *   - 0x18CCC: epilogue movem
 *
 * **JSR esterne** (tutte iniettabili via `StateSub18A88Subs`):
 *   - `FUN_00018CD2` (particleInit18CD2): 1 call all'ingresso.
 *   - `FUN_00028C7E` (clearAlphaTilesFromIndex): 1 call per entity matchata.
 *   - `FUN_00000200` (= jmp 0x3520, renderStringChain via 0x200): 4 call
 *     per entity matchata (2 header + 2 BONUS labels).
 *   - `FUN_00000142` (= jmp 0x2572, renderStringChain via 0x142): 1 call
 *     per entity matchata (header strings #2).
 *
 *     **Convenzione 0x200 vs 0x142**: il binario distingue in base alla
 *     ROM trampoline — `0x142 → FUN_2572` e `0x200 → FUN_3520` (vedi
 *     `mo-screen-init-1a286.ts` per dettaglio). Entrambe sono esposte
 *     come `renderString` callback con (strPtr, attr).
 *
 *   - `FUN_000286B0` (renderStringEntry286B0): 0 o 1 call per entity
 *     matchata (gated da `count == 2`).
 *   - `FUN_00028E3C` (renderStringHelper, 6-arg): 3 + N call per entity
 *     matchata (3 fissi + N dipendente da D4 count-down).
 *   - `FUN_00028608` (addToObjectAccumAndFlag): N call per entity
 *     matchata (= numero di iterazioni del count-down).
 *   - `FUN_00028EB2` (formatAndRender28EB2, 6-arg): N call per entity
 *     matchata (= numero di iterazioni del count-down).
 *   - `FUN_00028DB8` (waitVblankStateGated): N+1 call per entity
 *     matchata (N iter del count-down + 1 al termine con count=0x5A).
 *
 * **Caller noto** (1 xref): `FUN_0001101E` @ 0x11404 (main-loop-init-1101e).
 *
 * **Side effects diretti** in `state.workRam`:
 *   - `*0x4003F0` (byte): incrementato 1 + 3*N volte (N = entity matched).
 *   - `*0x400658` (byte): incrementato N volte.
 *   Tutti gli altri side effects sono delegati alle sub-call iniettabili.
 *
 * Verifica bit-perfect via `cli/src/test-state-sub-18a88-parity.ts` (500
 * casi).
 */

import type { GameState } from "./state.js";

// ─── Address constants (workRam offsets relativi a 0x400000) ─────────────

/** WORK RAM base assoluta. */
export const WORK_RAM_BASE = 0x00400000 as const;

/** Object array base (`0x400018`). Stride `0xE2`. */
export const OBJ_BASE_ADDR = 0x00400018 as const;
/** Stride object struct. */
export const OBJ_STRIDE = 0xe2 as const;

/** Word: `*0x400396` object count. */
export const OBJ_COUNT_ADDR = 0x00400396 as const;
/** Offset di OBJ_COUNT_ADDR in `state.workRam`. */
export const OBJ_COUNT_OFF = 0x396 as const;

/** Byte: `*0x4003F0` vblank tick counter (incrementato a vari punti). */
export const VBLANK_TICK_COUNTER_ADDR = 0x004003f0 as const;
/** Offset di VBLANK_TICK_COUNTER_ADDR in `state.workRam`. */
export const VBLANK_TICK_COUNTER_OFF = 0x3f0 as const;

/** Byte: `*0x400658` summary-shown counter (incrementato per entity matchata). */
export const SUMMARY_COUNTER_ADDR = 0x00400658 as const;
/** Offset di SUMMARY_COUNTER_ADDR in `state.workRam`. */
export const SUMMARY_COUNTER_OFF = 0x658 as const;

/** Object field: `(0x18,A2)` selettore branch (matcha 3 → render). */
export const OBJ_STATE_OFF = 0x18 as const;
/** Object field: `(0x19,A2)` player id (0/1) — sceglie palette D5/D6. */
export const OBJ_PLAYER_ID_OFF = 0x19 as const;
/** Object field: `(0x6A,A2)` word "counter A" (clamp 99). */
export const OBJ_COUNTER_A_OFF = 0x6a as const;
/** Object field: `(0xD2,A2)` word "counter B" (clamp 20). */
export const OBJ_COUNTER_B_OFF = 0xd2 as const;
/** Object field: `(0xBC,A2)` long accumulator (passato a FUN_28EB2). */
export const OBJ_ACCUM_LONG_OFF = 0xbc as const;

/** Valore `obj[0x18]` che attiva il rendering del summary. */
export const OBJ_TRIGGER_STATE = 0x03 as const;

// ─── Costanti di rendering ───────────────────────────────────────────────

/** Stringa ROM #1 (header). Indirizzo assoluto m68k (program area). */
export const ROM_HEADER_STRING_1 = 0x00022b0a as const;
/** Stringa ROM #2 (header). */
export const ROM_HEADER_STRING_2 = 0x00022aaa as const;
/** Stringa ROM "BONUS" label. */
export const ROM_LABEL_BONUS = 0x00022af2 as const;
/** Stringa ROM "TIME" label. */
export const ROM_LABEL_TIME = 0x00022afe as const;
/** ROM table di pointer-string per "TAG" 2-player (`0x1EEF0 + i*4`). */
export const ROM_TAG_TABLE = 0x0001eef0 as const;

/** Attr palette word per player 1 / "primary". */
export const ATTR_PRIMARY = 0x1400 as const;
/** Attr palette word per player 2 / "secondary". */
export const ATTR_SECONDARY = 0x1000 as const;
/** Tag attr "primary" (count==2 path, i==0). */
export const TAG_ATTR_PRIMARY = 0x2000 as const;
/** Tag attr "secondary" (count==2 path, i>0). */
export const TAG_ATTR_SECONDARY = 0x2400 as const;

/** Limite per clamp counterA (`(0x6A,A2)` → 99 max). */
export const COUNTER_A_CLAMP = 0x63 as const;
/** Limite per clamp counterB (`(0xD2,A2)` → 20 max). */
export const COUNTER_B_CLAMP = 0x14 as const;

/** Init D4 prima del count-down (= 20000 = 0x4E20). */
export const D4_INIT = 0x4e20 as const;
/** Step di decremento del count-down (= 250 = 0xFA). */
export const D4_STEP = 0xfa as const;
/** Moltiplicatore signed per D4 (counter * 1000). */
export const SCORE_MULTIPLIER = 0x3e8 as const;

/** Argomento per particleInit18CD2 (count). */
export const PARTICLE_INIT_COUNT = 0x1c as const;
/** Argomento per particleInit18CD2 (mode = LSB di -1 = 0xFF). */
export const PARTICLE_INIT_MODE = 0xff as const;

/** Argomento per waitVblankStateGated dentro count-down. */
export const COUNTDOWN_WAIT_TICKS = 0x02 as const;
/** Argomento per waitVblankStateGated dopo count-down (post-screen pause). */
export const POSTSCREEN_WAIT_TICKS = 0x5a as const;

// ─── Sub injection ───────────────────────────────────────────────────────

/**
 * Bag delle 8 sub-jsr orchestrate da `FUN_00018A88`. Tutte le callback sono
 * opzionali (default no-op). Ordine di chiamata identico al binario. La
 * replica di per sé NON tocca `state.workRam` se non per i 2 byte counter
 * `*0x4003F0` e `*0x400658` (descritti sopra).
 *
 * Le firme rispecchiano gli arg long pushati nello stesso ordine letto dal
 * sub-callee (RTL push order del binario).
 */
export interface StateSub18A88Subs {
  /**
   * `FUN_00018CD2` (particleInit18CD2). Args (matching binario, 2 long):
   *   - `count`: arg1 LSB (0x1C in questa funzione).
   *   - `mode` : arg2 LSB (0xFF in questa funzione).
   *
   * Default: no-op.
   */
  particleInit?: (state: GameState, count: number, mode: number) => void;

  /**
   * `FUN_00028C7E` (clearAlphaTilesFromIndex). Args (1 long):
   *   - `startRow`: 0 (clear da row 0).
   *
   * Default: no-op.
   */
  clearAlphaTiles?: (state: GameState, startRow: number) => void;

  /**
   * `FUN_2572` via trampoline `0x142` (renderStringChain). Args (2 long):
   *   - `entryPtr`: long, pointer-to-pointer alla stringa ROM o struct.
   *   - `attrLong`: low word usata come palette/attr.
   *
   * Default: no-op.
   */
  renderStringVia142?: (
    state: GameState,
    entryPtr: number,
    attrLong: number,
  ) => void;

  /**
   * `FUN_3520` via trampoline `0x200` (renderString variant). Args (2 long):
   *   - `entryPtr`: long, pointer-to-pointer alla stringa ROM o struct.
   *   - `attrLong`: low word usata come palette/attr.
   *
   * Default: no-op.
   */
  renderStringVia200?: (
    state: GameState,
    entryPtr: number,
    attrLong: number,
  ) => void;

  /**
   * `FUN_000286B0` (renderStringEntry286B0). Args (4 long):
   *   - `arg1Long`: ROM ptr-to-ptr (lookup table @ 0x1EEF0 + i*4).
   *   - `arg2Long`: col (0xC).
   *   - `arg3Long`: tickOff (5).
   *   - `arg4Long`: attr (0x2000 o 0x2400).
   *
   * Default: no-op. Invocata SOLO se `count == 2`.
   */
  renderTag?: (
    state: GameState,
    arg1Long: number,
    arg2Long: number,
    arg3Long: number,
    arg4Long: number,
  ) => void;

  /**
   * `FUN_00028E3C` (renderStringHelper, 6-arg). Args (6 long):
   *   - `arg1Long..arg6Long`: long pushati nell'ordine del binario (RTL).
   *
   * Default: no-op. Invocata 3 + N volte per entity matchata.
   */
  renderStringHelper?: (
    state: GameState,
    arg1Long: number,
    arg2Long: number,
    arg3Long: number,
    arg4Long: number,
    arg5Long: number,
    arg6Long: number,
  ) => void;

  /**
   * `FUN_00028608` (addToObjectAccumAndFlag). Args (2 long):
   *   - `objPtr`  : long, pointer all'entity corrente.
   *   - `value`  : long, increment (= 250 in questa funzione).
   *
   * Default: no-op. Invocata N volte (count-down).
   */
  addToObjectAccum?: (state: GameState, objPtr: number, value: number) => void;

  /**
   * `FUN_00028EB2` (formatAndRender28EB2, 6-arg). Args (6 long).
   *   Default: no-op. Invocata N volte (count-down).
   */
  formatAndRender?: (
    state: GameState,
    arg1Long: number,
    arg2Long: number,
    arg3Long: number,
    arg4Long: number,
    arg5Long: number,
    arg6Long: number,
  ) => void;

  /**
   * `FUN_00028DB8` (waitVblankStateGated). Args (1 long, low word usato):
   *   - `countWord`: 2 (count-down) o 0x5A (post-screen).
   *
   * Default: no-op. Invocata N + 1 volte (N count-down + 1 finale).
   */
  waitVblankStateGated?: (state: GameState, countWord: number) => void;
}

// ─── Risultato ───────────────────────────────────────────────────────────

/** Per-entity dettaglio della run. */
export interface StateSub18A88EntityDetail {
  /** Indice dell'entity nell'object array. */
  index: number;
  /** Indirizzo assoluto dell'entity (= OBJ_BASE_ADDR + index * OBJ_STRIDE). */
  entityAddr: number;
  /** True se `entity[0x18] == 3` (cioè summary mostrato). */
  triggered: boolean;
  /** Player id letto da `entity[0x19]` (0/1). */
  playerId: number;
  /** D5 (palette per "primary" line). */
  attrD5: number;
  /** D6 (palette per "secondary" line). */
  attrD6: number;
  /** counter A clamp result (`min(entity[0x6A], 99)`). */
  counterA: number;
  /** counter B clamp result (`min(entity[0xD2], 20)`). */
  counterB: number;
  /** D4 iniziale (= 20000 + counterA*1000 - counterB*1000, signed). */
  d4Initial: number;
  /** Numero di iterazioni del count-down (= ceil(d4Initial / 250) se > 0). */
  countdownIterations: number;
  /** Numero di chiamate a `subs.renderTag` (0 o 1). */
  renderTagCalls: number;
}

export interface StateSub18A88Result {
  /** Numero di entity processate dal loop (= count word). */
  entityCount: number;
  /** Numero di entity con `entity[0x18] == 3` (i.e. summary rendered). */
  matchedCount: number;
  /** Dettaglio per entity matchata (in ordine di iterazione). */
  matched: StateSub18A88EntityDetail[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function readByte(state: GameState, off: number): number {
  return (state.workRam[off] ?? 0) & 0xff;
}

function writeByte(state: GameState, off: number, v: number): void {
  state.workRam[off] = v & 0xff;
}

function readWordBE(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff
  );
}

function readLongBE(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>>
    0
  );
}

/** Sign-extend di una word (16 bit, signed) in long (32 bit unsigned-rep). */
function extLowWordToLong(value: number): number {
  const w = value & 0xffff;
  return (w & 0x8000) !== 0 ? (w | 0xffff0000) >>> 0 : w >>> 0;
}

/** Converte un long unsigned 32-bit a signed JS number. */
function asSignedLong(v: number): number {
  const u = v >>> 0;
  return u >= 0x80000000 ? u - 0x100000000 : u;
}

/** Replica `muls.w #0x3E8, D2` → D2.l = sext_w(D2.lo) * 1000 (signed). */
function mulsW1000(wordValue: number): number {
  const w = wordValue & 0xffff;
  const signed = w & 0x8000 ? w - 0x10000 : w;
  return (signed * SCORE_MULTIPLIER) | 0; // signed 32-bit
}

// ─── Replica ─────────────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00018A88`.
 *
 * @param state  GameState (modifica direttamente solo `workRam[0x3F0]`
 *               e `workRam[0x658]`; tutto il resto è delegato alle 8 sub
 *               iniettabili).
 * @param subs   sub injection (default: tutte no-op).
 *
 * @returns Dettaglio per entity matchata + counters globali.
 *
 * **Ordine delle scritture / sub-call** (rilevante per parity):
 *   1. `subs.particleInit(state, 0x1C, 0xFF)`.
 *   2. `workRam[0x3F0] += 1`.
 *   3. Per i in [0..count):
 *      Se entity[0x18] != 3 → next_iteration.
 *      Altrimenti:
 *        a. `workRam[0x658] += 1`
 *        b. `subs.clearAlphaTiles(state, 0)`
 *        c. `workRam[0x3F0] += 1`
 *        d. Determina (D5,D6) da entity[0x19]:
 *           - se entity[0x19] != 0 → D5 = 0x1400, D6 = 0x1000 (jitter
 *             tra i due `tst.b (0x19,A2)` consecutivi: il binario fa
 *             beq.b → 0x1000 / non-beq → 0x1400 sul PRIMO; e l'opposto
 *             sul SECONDO; D5 e D6 finiscono sempre opposti).
 *           - se entity[0x19] == 0 → D5 = 0x1000, D6 = 0x1400.
 *        e. `subs.renderStringVia200(state, 0x22B0A, ext_l(D5))`.
 *        f. `subs.renderStringVia142(state, 0x22AAA, ext_l(D6))`.
 *        g. Se count == 2:
 *             tagAttr = i == 0 ? 0x2000 : 0x2400
 *             romPtr = ROM_TAG_TABLE + i*4 (long ptr in ROM)
 *             `subs.renderTag(state, romPtr, 0xC, 5, tagAttr)`.
 *        h. counterA = min(entity[0x6A].w (signed), 99); ma se
 *           entity[0x6A].w (signed) >= 99 (D0w bge.w D2w fails) → keep.
 *           NOTA: D0=99, cmp.w D2w,D0w; bge è "if D0 >= D2 → keep D2".
 *           Quindi se D2(score) > 99 → D2 = 99 (clamp).
 *        i. `subs.renderStringHelper(state, ext_l(D5), 2, 0xF, 0xA, 1, ext_l(counterA))`
 *        j. `subs.renderStringHelper(state, ext_l(D6), 5, 0xF, 0x21, 0, sext_l(counterA)*1000)`
 *        k. D4 = 20000 + counterA * 1000
 *        l. `workRam[0x3F0] += 1`
 *        m. counterB = min(entity[0xD2].w, 20)
 *        n. `subs.renderStringHelper(state, ext_l(D5), 2, 0x11, 0xC, 0, ext_l(counterB))`
 *        o. `subs.renderStringHelper(state, ext_l(D6), 5, 0x11, 0x21, 0, sext_l(counterB)*1000)`
 *        p. D4 -= counterB * 1000
 *        q. `subs.renderStringHelper(state, ext_l(D6), 6, 0x13, 0x20, 0, D4)` (display total)
 *        r. `workRam[0x3F0] += 1`
 *        s. `subs.renderStringVia200(state, 0x22AF2, ext_l(D5))`
 *        t. `subs.renderStringVia200(state, 0x22AFE, ext_l(D5))`
 *        u. **Count-down loop**: while D4 > 0 (signed):
 *             D4 -= 250
 *             `subs.addToObjectAccum(state, entityAddr, 250)`
 *             `subs.renderStringHelper(state, ext_l(D6), 6, 0x13, 0x20, 0, D4)`
 *             `subs.formatAndRender(state, entity[0xBC..0xBF],
 *                                   7, 0x18, 0x17, 0, ext_l(D5))`
 *             `subs.waitVblankStateGated(state, 2)`
 *           NOTA: la prima iterazione viene eseguita SE D4 > 0
 *           (`tst.l D4; ble exit`), e in tal caso fa subito `D4 -= 250`,
 *           quindi può andare anche in negativo per D4 < 250.
 *        v. `subs.waitVblankStateGated(state, 0x5A)` (post-screen wait).
 */
export function stateSub18A88(
  state: GameState,
  subs: StateSub18A88Subs = {},
): StateSub18A88Result {
  // ─── Step 1: particleInit(0x1C, 0xFF) ─────────────────────────────────
  subs.particleInit?.(state, PARTICLE_INIT_COUNT, PARTICLE_INIT_MODE);

  // ─── Step 2: workRam[0x3F0] += 1 ──────────────────────────────────────
  writeByte(
    state,
    VBLANK_TICK_COUNTER_OFF,
    (readByte(state, VBLANK_TICK_COUNTER_OFF) + 1) & 0xff,
  );

  // ─── Step 3: per-entity loop ──────────────────────────────────────────
  const count = readWordBE(state, OBJ_COUNT_OFF);
  const result: StateSub18A88Result = {
    entityCount: count,
    matchedCount: 0,
    matched: [],
  };

  let entityAddr = OBJ_BASE_ADDR >>> 0;
  for (let i = 0; i < count; i++, entityAddr = (entityAddr + OBJ_STRIDE) >>> 0) {
    const entityOff = entityAddr - WORK_RAM_BASE;
    const stateByte = readByte(state, entityOff + OBJ_STATE_OFF);
    if (stateByte !== OBJ_TRIGGER_STATE) continue;

    // a. workRam[0x658] += 1
    writeByte(
      state,
      SUMMARY_COUNTER_OFF,
      (readByte(state, SUMMARY_COUNTER_OFF) + 1) & 0xff,
    );

    // b. clearAlphaTiles(0)
    subs.clearAlphaTiles?.(state, 0);

    // c. workRam[0x3F0] += 1
    writeByte(
      state,
      VBLANK_TICK_COUNTER_OFF,
      (readByte(state, VBLANK_TICK_COUNTER_OFF) + 1) & 0xff,
    );

    // d. determine D5 / D6 da entity[0x19]
    // Disasm:
    //   tst.b (0x19,A2)  → beq.b 0x18ae2 ⇒ D0=0x1000   (zero)
    //                       altrimenti   ⇒ D0=0x1400
    //   move D0,D5
    //   tst.b (0x19,A2)  → beq.b 0x18af8 ⇒ D0=0x1400   (zero)
    //                       altrimenti   ⇒ D0=0x1000
    //   move D0,D6
    // Quindi D5 e D6 sono sempre opposti.
    const playerByte = readByte(state, entityOff + OBJ_PLAYER_ID_OFF);
    const isP1 = playerByte === 0;
    const d5 = isP1 ? ATTR_SECONDARY : ATTR_PRIMARY; // 0x1000 if p1 else 0x1400
    const d6 = isP1 ? ATTR_PRIMARY : ATTR_SECONDARY; // 0x1400 if p1 else 0x1000

    // e. renderStringVia200(0x22B0A, ext_l(D5))
    subs.renderStringVia200?.(state, ROM_HEADER_STRING_1, extLowWordToLong(d5));

    // f. renderStringVia142(0x22AAA, ext_l(D6))
    subs.renderStringVia142?.(state, ROM_HEADER_STRING_2, extLowWordToLong(d6));

    // g. Se count == 2: render TAG
    let renderTagCalls = 0;
    if (count === 2) {
      const tagAttr = i === 0 ? TAG_ATTR_PRIMARY : TAG_ATTR_SECONDARY;
      const romPtrSlot = (ROM_TAG_TABLE + i * 4) >>> 0;
      // arg1 = romPtrSlot (long), arg2 = col (0xC), arg3 = tickOff (5),
      // arg4 = tagAttr (low word)
      // NOTA: ordine push in disasm 0x18B44..0x18B5C:
      //   move.l D0,-(SP)            ; D0 = 0x2000 o 0x2400 (tagAttr)
      //   pea (0x5).w                ; tickOff
      //   pea (0xc).w                ; col
      //   move.l (0,A0,D0*1),-(SP)   ; romPtrSlot
      //   jsr 0x286b0
      // FUN_286B0 firma: (arg1=ptr-to-ptr, arg2=col, arg3=tickOff, arg4=attr).
      // L'ordine push RTL → arg1 letto da SP+8 = romPtrSlot ✓.
      subs.renderTag?.(
        state,
        romPtrSlot,
        0x0c,
        0x05,
        extLowWordToLong(tagAttr),
      );
      renderTagCalls = 1;
    }

    // h. counterA = clamp(entity[0x6A].w signed, max 99)
    // Disasm:
    //   move.w (0x6A,A2),D2w
    //   moveq #0x63,D0
    //   cmp.w D2w,D0w
    //   bge.b 0x18b7c    ; if D0 (=99) >= D2 → keep D2
    //   moveq #0x63,D2   ; else D2 = 99
    // Quindi: se score > 99 → 99. Altrimenti keep (negative anche).
    const counterARawW = readWordBE(state, entityOff + OBJ_COUNTER_A_OFF);
    const counterARawSigned = counterARawW & 0x8000 ? counterARawW - 0x10000 : counterARawW;
    const counterA =
      counterARawSigned > COUNTER_A_CLAMP ? COUNTER_A_CLAMP : counterARawSigned;

    // i. renderStringHelper(D5, 2, 0xF, 0xA, 1, ext_l(counterA))
    subs.renderStringHelper?.(
      state,
      extLowWordToLong(d5),
      0x02,
      0x0f,
      0x0a,
      0x01,
      extLowWordToLong(counterA & 0xffff),
    );

    // j. counterA * 1000 (signed, replicating muls.w #0x3E8 then push as long)
    const counterAScaled = mulsW1000(counterA & 0xffff);
    subs.renderStringHelper?.(
      state,
      extLowWordToLong(d6),
      0x05,
      0x0f,
      0x21,
      0x00,
      counterAScaled >>> 0,
    );

    // k. D4 = 20000 + counterA * 1000 (signed 32-bit)
    let d4 = (D4_INIT + counterAScaled) | 0;

    // l. workRam[0x3F0] += 1
    writeByte(
      state,
      VBLANK_TICK_COUNTER_OFF,
      (readByte(state, VBLANK_TICK_COUNTER_OFF) + 1) & 0xff,
    );

    // m. counterB = clamp(entity[0xD2].w signed, max 20)
    const counterBRawW = readWordBE(state, entityOff + OBJ_COUNTER_B_OFF);
    const counterBRawSigned = counterBRawW & 0x8000 ? counterBRawW - 0x10000 : counterBRawW;
    const counterB =
      counterBRawSigned > COUNTER_B_CLAMP ? COUNTER_B_CLAMP : counterBRawSigned;

    // n. renderStringHelper(D5, 2, 0x11, 0xC, 0, ext_l(counterB))
    subs.renderStringHelper?.(
      state,
      extLowWordToLong(d5),
      0x02,
      0x11,
      0x0c,
      0x00,
      extLowWordToLong(counterB & 0xffff),
    );

    // o. counterB * 1000
    const counterBScaled = mulsW1000(counterB & 0xffff);
    subs.renderStringHelper?.(
      state,
      extLowWordToLong(d6),
      0x05,
      0x11,
      0x21,
      0x00,
      counterBScaled >>> 0,
    );

    // p. D4 -= counterB * 1000
    d4 = (d4 - counterBScaled) | 0;

    // q. renderStringHelper(D6, 6, 0x13, 0x20, 0, D4)
    subs.renderStringHelper?.(
      state,
      extLowWordToLong(d6),
      0x06,
      0x13,
      0x20,
      0x00,
      d4 >>> 0,
    );

    // r. workRam[0x3F0] += 1
    writeByte(
      state,
      VBLANK_TICK_COUNTER_OFF,
      (readByte(state, VBLANK_TICK_COUNTER_OFF) + 1) & 0xff,
    );

    // s. renderStringVia200(0x22AF2, ext_l(D5))
    subs.renderStringVia200?.(state, ROM_LABEL_BONUS, extLowWordToLong(d5));
    // t. renderStringVia200(0x22AFE, ext_l(D5))
    subs.renderStringVia200?.(state, ROM_LABEL_TIME, extLowWordToLong(d5));

    const d4Initial = d4;

    // u. count-down loop: while D4 > 0 (signed): decrement by 250 and render
    let countdownIterations = 0;
    while (asSignedLong(d4 >>> 0) > 0) {
      d4 = (d4 - D4_STEP) | 0;
      countdownIterations++;

      // FUN_28608(entityAddr, 250) → addToObjectAccumAndFlag
      subs.addToObjectAccum?.(state, entityAddr, D4_STEP);

      // FUN_28E3C(D6, 6, 0x13, 0x20, 0, D4) — refresh display total
      subs.renderStringHelper?.(
        state,
        extLowWordToLong(d6),
        0x06,
        0x13,
        0x20,
        0x00,
        d4 >>> 0,
      );

      // FUN_28EB2(*entity[0xBC..0xBF], 7, 0x18, 0x17, 0, ext_l(D5))
      const accumLong = readLongBE(state, entityOff + OBJ_ACCUM_LONG_OFF);
      subs.formatAndRender?.(
        state,
        accumLong >>> 0,
        0x07,
        0x18,
        0x17,
        0x00,
        extLowWordToLong(d5),
      );

      // FUN_28DB8(2)
      subs.waitVblankStateGated?.(state, COUNTDOWN_WAIT_TICKS);
    }

    // v. waitVblankStateGated(0x5A) — post-screen pause
    subs.waitVblankStateGated?.(state, POSTSCREEN_WAIT_TICKS);

    result.matched.push({
      index: i,
      entityAddr,
      triggered: true,
      playerId: playerByte,
      attrD5: d5,
      attrD6: d6,
      counterA,
      counterB,
      d4Initial,
      countdownIterations,
      renderTagCalls,
    });
    result.matchedCount++;
  }

  return result;
}

/** Re-export del simbolo come "FUN_00018A88" per cross-reference. */
export { stateSub18A88 as FUN_00018A88 };
