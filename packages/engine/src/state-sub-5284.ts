/**
 * state-sub-5284.ts — replica `FUN_00005284` (30 byte) + helper `FUN_000052A2`.
 *
 * Busy-wait loop: invoca il sound chip writer, attende un breve delay, fa pet
 * al watchdog, controlla due bitmap di status flags long-BE in work RAM, e
 * loop finché entrambe sono zero. Quando entrambe le bitmap sono `0`, la
 * funzione fa **tail-call** a `FUN_00004F38` (state machine head).
 *
 * **Disasm 0x5284..0x52A1** (30 byte):
 *
 *   0x5284  jsr    0x00004DCC.l       ; sound chip writer (FUN_4DCC). No args.
 *                                     ;   Side effect: addq.l #1,(0x00401FF8).l
 *                                     ;   come prima istruzione (counter long-BE).
 *                                     ;   Resto della sub interagisce col chip
 *                                     ;   YM2151 via MMIO 0xF00001 — stub-injectabile.
 *   0x528A  move.l #0x1A0A,D0         ; D0 = 0x1A0A = 6666 (delay seed)
 *   0x5290  subq.l #1,D0              ; D0--
 *   0x5292  bne.b  0x5290             ; loop finché D0 != 0
 *                                     ;   At exit: D0 == 0 (long).
 *   0x5294  move.w D0w,(0x00880000).l ; write 0 (word) al watchdog reset latch.
 *                                     ;   In MAME è uno strobe (qualsiasi write
 *                                     ;   resetta il watchdog timer del System1
 *                                     ;   board — vedi atarisy1.cpp). Nessun
 *                                     ;   effetto sulla RAM.
 *   0x529A  bsr.b  0x52A2             ; chiama FUN_52A2 (status check helper)
 *                                     ;   Ritorna D0=0/Z=1 se entrambi flags == 0,
 *                                     ;   altrimenti D0=1/Z=0.
 *   0x529C  bne.b  0x5284             ; if D0 != 0 → loop back to 0x5284
 *   0x529E  bra.w  0x00004F38         ; tail-call FUN_4F38 (state machine entry)
 *
 * **FUN_000052A2** (10 byte, helper inline):
 *
 *   0x52A2  move.l (0x00401F76).l,D0  ; D0 = secondary flags long-BE
 *   0x52A8  or.l   (0x00401F5E).l,D0  ; D0 |= primary flags long-BE
 *   0x52AE  beq.b  0x52B2             ; if D0 == 0 → fall through con D0=0, Z=1
 *   0x52B0  moveq  #1,D0              ; else D0=1
 *   0x52B2  rts                       ; Z flag riflette D0 (Z=1 ⇔ D0==0)
 *
 * **Convenzione caller** (verificata sui 2 callsite reali, entrambi `bra.w`
 * dentro `FUN_4F38` @ 0x50E8 e @ 0x51FC):
 *   - Nessun argomento esplicito (no stack push, no register setup).
 *   - Stato richiesto: i due long-BE in workRam (`0x401F76`, `0x401F5E`)
 *     devono essere `0` PERCHÉ il loop esca. Se entrambi sono ≠ 0 all'entry,
 *     il binario originale esegue un loop infinito (bus reset via watchdog
 *     scaduto, ma il watchdog viene petato a ogni iter → vero infinito).
 *     In pratica i caller (`FUN_4F38`) chiamano questa sub solo in punti del
 *     flusso dove un IRQ (vblank/sound) prima o poi azzererà i flags. La
 *     replica TS, non avendo un IRQ source, esce dopo `1` iterazione del body
 *     (lo state in entry deve essere zero, oppure l'IRQ source deve essere
 *     iniettato come callback `irq` che azzera i flags).
 *
 * **Side effects su workRam** (path "ok" = flags zero al check):
 *   - FUN_4DCC default: `*0x401FF8 += 1` (long-BE), wrap mod 2^32.
 *   - Watchdog write: nessuno (strobe MMIO).
 *   - FUN_52A2: pure read.
 *
 * **Side effects su workRam** (path "loop" = flags non-zero al check):
 *   - FUN_4DCC chiamato N volte → counter +N.
 *   - Watchdog: N strobe.
 *
 * **Tail-call `bra.w 0x4F38`**: il binario non `rts` — passa direttamente a
 * FUN_4F38 (entry point della state machine sound/EEPROM/init). Nella replica
 * TS modeliamo questo come callback iniettabile `fun_4f38` (default no-op) che
 * il caller può fornire per chainare l'esecuzione. Default: la funzione
 * ritorna void e il caller TS è responsabile di chiamare il successivo.
 *
 * **Note bit-perfect M68k**:
 *   1. **Delay loop `subq.l #1,D0; bne`**: 6666 iterazioni esatte per
 *      decrementare D0 da 0x1A0A a 0. Non simulato in TS (non ha effetti
 *      RAM); la replica si limita a "consumare il tempo" via no-op. Il valore
 *      iniziale 0x1A0A è esposto come costante per eventuali test di timing.
 *   2. **`move.w D0w,(0x880000).l`**: scrive 0 (word) al watchdog. Nessuna
 *      RAM mutata (è uno strobe MMIO). Modellato come no-op.
 *   3. **`bne.b 0x5284`**: branch al body (loop completo, riparte da jsr 4DCC).
 *      Test su Z flag dal D0 ritornato da FUN_52A2: D0=0 → exit, D0=1 → loop.
 *   4. **`bra.w 0x4F38`**: tail-call (no rts).
 *
 * Verifica bit-perfect via `packages/cli/src/test-state-sub-5284-parity.ts`.
 *
 * **Xrefs** (4 ref):
 *   - 0x50E8 in FUN_4F38: bra.w 0x5284 (path "init phase 1 done")
 *   - 0x51FC in FUN_4F38: bra.w 0x5284 (path "init phase 2 done")
 *   - 0x529C in FUN_5284: bne.b 0x5284 (self loop)
 *   - Entry point (esterno, non chiamato direttamente da altri caller).
 */

import type { GameState } from "./state.js";

/** Indirizzo assoluto del long-BE "primary status flags" (= STATUS_FLAGS_OFF). */
export const PRIMARY_FLAGS_ADDR = 0x00401f5e as const;

/** Indirizzo assoluto del long-BE "secondary status flags". */
export const SECONDARY_FLAGS_ADDR = 0x00401f76 as const;

/** Indirizzo MMIO watchdog reset (write strobe, qualsiasi write reseta il timer). */
export const WATCHDOG_ADDR = 0x00880000 as const;

/** Valore iniziale del delay loop `move.l #0x1A0A,D0`. 6666 decimal. */
export const DELAY_LOOP_SEED = 0x1a0a as const;

/** Offset workRam del long-BE `0x401FF8` (counter incrementato da FUN_4DCC). */
const SND_TICK_COUNTER_OFF = 0x1ff8;

/** Offset workRam dei due flag long-BE da check (relativi a base 0x400000). */
const PRIMARY_FLAGS_OFF = 0x1f5e;
const SECONDARY_FLAGS_OFF = 0x1f76;

/**
 * Cap di sicurezza sulle iterazioni del loop esterno. Il binario originale
 * loopa "forever" finché un IRQ azzera i flags; in TS senza IRQ source
 * vogliamo un cap deterministico per non bloccare mai il chiamante. Default
 * 1 (l'esecuzione realistica è sempre 1 iter quando i flags sono zero
 * all'entry, che è la convenzione caller verificata).
 */
export const DEFAULT_MAX_ITERATIONS = 1 as const;

/**
 * Subs iniettabili: il `FUN_4DCC` (sound chip writer) e il `FUN_4F38` (state
 * machine head, target del tail-call finale). Entrambi opzionali: il default
 * di `fun_4dcc` replica la prima istruzione deterministica del binario reale
 * (`addq.l #1, (0x00401FF8).l`); `fun_4f38` default è no-op.
 */
export interface StateSub5284Subs {
  /**
   * `FUN_00004DCC` — sound chip writer. No args, no return.
   * Default: incrementa long-BE @ `0x401FF8` (mod 2^32).
   */
  fun_4dcc?: (state: GameState) => void;
  /**
   * `FUN_00004F38` — state machine head (tail-call target). No args, no return
   * (in TS non possiamo davvero "tail call"; il callback viene chiamato dopo
   * il loop). Default: no-op.
   */
  fun_4f38?: (state: GameState) => void;
  /**
   * Hook chiamato a ogni iterazione PRIMA del check flags. Permette ai test
   * di simulare un IRQ che azzera i flags dopo `N` iterazioni. Default: no-op.
   * Riceve l'indice di iterazione (0-based).
   */
  irq?: (state: GameState, iter: number) => void;
}

/**
 * Replica `FUN_000052A2` — status flags OR check.
 *
 * Esposta per testabilità isolata. Pure read.
 *
 * @param state  GameState (workRam letto: `0x1F5E` long-BE e `0x1F76` long-BE).
 * @returns      `0` se entrambi i long-BE sono zero, `1` altrimenti. Replica
 *               esatta del valore D0 ritornato dal binario (0 oppure 1).
 */
export function fun52A2(state: GameState): number {
  const r = state.workRam;
  const primary =
    (((r[PRIMARY_FLAGS_OFF] ?? 0) << 24) |
      ((r[PRIMARY_FLAGS_OFF + 1] ?? 0) << 16) |
      ((r[PRIMARY_FLAGS_OFF + 2] ?? 0) << 8) |
      (r[PRIMARY_FLAGS_OFF + 3] ?? 0)) >>>
    0;
  const secondary =
    (((r[SECONDARY_FLAGS_OFF] ?? 0) << 24) |
      ((r[SECONDARY_FLAGS_OFF + 1] ?? 0) << 16) |
      ((r[SECONDARY_FLAGS_OFF + 2] ?? 0) << 8) |
      (r[SECONDARY_FLAGS_OFF + 3] ?? 0)) >>>
    0;
  // beq.b 0x52B2 → fall through con D0=0; altrimenti moveq #1,D0.
  return (primary | secondary) === 0 ? 0 : 1;
}

/** Default impl di `FUN_4DCC`: replica `addq.l #1,(0x00401FF8).l` long-BE. */
function defaultFun4DCC(state: GameState): void {
  const r = state.workRam;
  let cnt =
    (((r[SND_TICK_COUNTER_OFF] ?? 0) << 24) |
      ((r[SND_TICK_COUNTER_OFF + 1] ?? 0) << 16) |
      ((r[SND_TICK_COUNTER_OFF + 2] ?? 0) << 8) |
      (r[SND_TICK_COUNTER_OFF + 3] ?? 0)) >>>
    0;
  cnt = (cnt + 1) >>> 0;
  r[SND_TICK_COUNTER_OFF] = (cnt >>> 24) & 0xff;
  r[SND_TICK_COUNTER_OFF + 1] = (cnt >>> 16) & 0xff;
  r[SND_TICK_COUNTER_OFF + 2] = (cnt >>> 8) & 0xff;
  r[SND_TICK_COUNTER_OFF + 3] = cnt & 0xff;
}

/**
 * Risultato dell'esecuzione di `stateSub5284`.
 *
 * - `iterations`     numero di iterazioni del loop body eseguite (sempre ≥ 1
 *                    perché il body precede il check, e il binario stesso
 *                    esegue almeno una iter).
 * - `flagsCleared`   `true` se all'uscita del loop entrambi i flag sono zero
 *                    (path "ok", il binario fa tail-call a 4F38). `false` se
 *                    ci siamo arresi al cap di iterazioni (path "stuck").
 */
export interface StateSub5284Result {
  iterations: number;
  flagsCleared: boolean;
}

/**
 * Replica `FUN_00005284` — sound writer + watchdog pet + status flags wait
 * loop, con tail-call finale a `FUN_00004F38`.
 *
 * Ogni iterazione esegue (in ordine):
 *   1. `fun_4dcc(state)` — sound chip writer (default: incrementa `0x401FF8`).
 *   2. delay loop M68k (modellato come no-op; non ha effetti su workRam).
 *   3. write strobe al watchdog @ `0x880000` (modellato come no-op; è MMIO).
 *   4. `irq(state, iter)` hook (default no-op; permette ai test di azzerare
 *      i flags per emulare un sound IRQ).
 *   5. `fun52A2(state)` check: se ritorna 0 (entrambi i long-BE flags zero),
 *      esci dal loop e fai tail-call a `fun_4f38`. Altrimenti torna a (1).
 *
 * @param state    GameState (workRam mutata da `fun_4dcc` di default; flag
 *                 long-BE @ `0x401F5E` e `0x401F76` letti per il check;
 *                 nessun'altra mutazione interna).
 * @param subs     Subs opzionali: `fun_4dcc`, `fun_4f38`, `irq`.
 * @param maxIter  Cap iterazioni (default `1`). Tipicamente i caller reali
 *                 entrano con flags=0 e basta una iter; i test possono
 *                 alzare il cap per simulare il loop fino al clear via `irq`.
 *
 * @returns        `{iterations, flagsCleared}`. Se `flagsCleared` è `true`,
 *                 `fun_4f38` è già stato chiamato (tail-call simulato).
 *                 Se `false`, abbiamo esaurito `maxIter` senza vedere flags=0
 *                 e `fun_4f38` NON è stato chiamato (replica del comportamento
 *                 di "loop infinito" del binario originale, ma con uscita
 *                 deterministica).
 *
 * **Bit-perfect notes**:
 *   - L'ordine `fun_4dcc → delay → watchdog → fun52A2` è esattamente quello
 *     del binario (nessun riordino).
 *   - Il delay e il watchdog non producono side effects su workRam, quindi
 *     vengono modellati come no-op (nessuna scrittura, nessuna mutazione
 *     osservabile dallo state TS).
 *   - Per `maxIter=1` con flags=0 entry, esegue 1 iter, vede flags=0, chiama
 *     `fun_4f38`, ritorna `{iterations:1, flagsCleared:true}`. Questo è il
 *     path "happy" verificato vs binary nel parity test.
 */
export function stateSub5284(
  state: GameState,
  subs?: StateSub5284Subs,
  maxIter: number = DEFAULT_MAX_ITERATIONS,
): StateSub5284Result {
  const dccImpl = subs?.fun_4dcc ?? defaultFun4DCC;
  const f4f38 = subs?.fun_4f38;
  const irqHook = subs?.irq;

  // Cap minimo: il binario esegue SEMPRE ≥ 1 iter (loop body prima del check).
  const cap = maxIter < 1 ? 1 : maxIter | 0;

  let iter = 0;
  for (; iter < cap; iter++) {
    // 1. jsr 0x4DCC — sound chip writer.
    dccImpl(state);

    // 2. Delay loop: subq.l #1,D0 / bne (6666 iter). No-op in TS (nessun
    //    effetto su workRam — D0 è solo register, non viene mai esposto).
    //    Lasciato esplicito per documentazione (DELAY_LOOP_SEED esportato).

    // 3. move.w D0w,(0x880000).l — watchdog strobe. No-op in TS (MMIO write
    //    strobe; nessuna RAM mutata).

    // Hook IRQ (test): permette di azzerare i flags dopo N iter.
    if (irqHook !== undefined) {
      irqHook(state, iter);
    }

    // 4. bsr 0x52A2 — status check. Se entrambi flags zero → exit loop.
    if (fun52A2(state) === 0) {
      // 5. bra.w 0x4F38 — tail-call (modellato come callback).
      if (f4f38 !== undefined) {
        f4f38(state);
      }
      return { iterations: iter + 1, flagsCleared: true };
    }
    // bne.b 0x5284 — loop body again.
  }

  // Cap raggiunto: i flags sono ancora set. Il binario originale farebbe loop
  // infinito (con watchdog petato a ogni iter, quindi davvero infinito). In
  // TS ritorniamo `flagsCleared:false` senza chiamare `fun_4f38` per evitare
  // di propagare un side-effect su un path che il binario non avrebbe mai
  // raggiunto in produzione.
  return { iterations: iter, flagsCleared: false };
}
