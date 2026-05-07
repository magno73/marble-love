/**
 * format-and-render-28eb2.ts — replica `FUN_00028EB2` (118 byte, 6 long arg).
 *
 * Wrapper "format value into scratch buffer + (optional trim) + render-to-alpha"
 * a 6 args. È il "fratello a 6 args" di `FUN_00028E00` (4 args, hex-only) e
 * comparte le stesse leaf di rendering, ma:
 *   - usa `*(0x40041E)` come buffer-end pointer (vs `*(0x400436)` per 28E00).
 *   - delega il formatting numerico a `FUN_00003874` (decimal/hex/binary,
 *     selezionato dal byte di formato in arg2.l) invece che al solo hex.
 *   - quando `arg2.lowByte == 2` (selettore di stato) chiama `FUN_00028F28`
 *     (`trimTrailingSpace`) sul buffer prima del render.
 *   - delega il render a `FUN_00028FA0` (entry @ 0x40041C, 3 args dinamici)
 *     invece che `FUN_00028FDE` (entry @ 0x400434, 2 args + attr cabled).
 *
 * **Disasm 0x28EB2..0x28F27** (118 byte, 6 long arg):
 *
 *   00028EB2  movem.l {D3 D2},-(SP)        ; salva 8 byte (D2,D3 callee-save)
 *   00028EB6  move.l  (0xC,SP),D1          ; D1   = arg1Long  (long, value/ptr)
 *   00028EBA  move.w  (0x12,SP),D2w        ; D2.w = arg2.lo word (state-selector)
 *   00028EBE  move.w  (0x16,SP),D3w        ; D3.w = arg3.lo word (col)
 *   00028EC2  move.w  (0x1E,SP),D0w        ; D0.w = arg5.lo word (width/maxLen)
 *   00028EC6  ext.l   D0
 *   00028EC8  move.l  D0,-(SP)             ; push sext_l(arg5.w)         (#5 → FUN_3874)
 *   00028ECA  move.w  D2w,D0w
 *   00028ECC  ext.l   D0
 *   00028ECE  move.l  D0,-(SP)             ; push sext_l(arg2.w)         (#4 → FUN_3874)
 *   00028ED0  pea     (0x64).w             ; push 0x64 long ('d')        (#3 → FUN_3874)
 *   00028ED4  move.l  (0x40041E).l,-(SP)   ; push *(0x40041E) (bufEnd)   (#2 → FUN_3874)
 *   00028EDA  move.l  D1,-(SP)             ; push arg1Long (value)       (#1 → FUN_3874)
 *   00028EDC  jsr     0x00000112.l         ; → jmp 0x3874 = FUN_3874 (number formatter)
 *
 *   00028EE2  moveq   #2,D0
 *   00028EE4  cmp.w   D2w,D0w              ; D0=2 vs D2=arg2.w: arg2.w == 2?
 *   00028EE6  lea     (0x14,SP),SP         ; cleanup 5 long pushed per FUN_3874
 *   00028EEA  bne.b   0x00028F02           ; arg2.w != 2 → skip trim
 *
 *   00028EEC  move.w  (0x1E,SP),D0w        ; arg5.w (SP è tornato baseline)
 *   00028EF0  ext.l   D0
 *   00028EF2  move.l  D0,-(SP)             ; push sext_l(arg5.w) (maxLen)
 *   00028EF4  move.l  (0x40041E).l,-(SP)   ; push *(0x40041E)    (strPtr)
 *   00028EFA  jsr     0x00028F28.l         ; → FUN_28F28 = trimTrailingSpace
 *   00028F00  addq.l  #8,SP                ; cleanup 2 long
 *
 *   00028F02  move.w  (0x22,SP),D0w        ; arg6.lo word (render arg)
 *   00028F06  ext.l   D0
 *   00028F08  move.l  D0,-(SP)             ; push sext_l(arg6.w)   (#3 → FUN_28FA0)
 *   00028F0A  move.w  (0x1E,SP),D0w        ; (SP-4) → arg4.lo word a SP+0x1A originale
 *   00028F0E  ext.l   D0
 *   00028F10  move.l  D0,-(SP)             ; push sext_l(arg4.w)   (#2 → FUN_28FA0)
 *   00028F12  move.w  D3w,D0w              ; arg3.w (col)
 *   00028F14  ext.l   D0
 *   00028F16  move.l  D0,-(SP)             ; push sext_l(arg3.w)   (#1 → FUN_28FA0)
 *   00028F18  jsr     0x00028FA0.l         ; → FUN_28FA0 = renderStringEntry28FA0
 *   00028F1E  lea     (0xC,SP),SP          ; cleanup 3 long
 *   00028F22  movem.l (SP)+,{D2 D3}        ; restore callee-save
 *   00028F26  rts
 *
 * **Stack layout (post-movem)**: 8B saved D2/D3 + 4B retaddr ⇒ args partono
 * da SP+12 (= 0xC). I 6 long arg occupano SP+0xC..SP+0x33 (i.e. 24 byte):
 *   - SP+0x0C..0x0F : arg1Long (value, intero)
 *   - SP+0x10..0x13 : arg2Long; low word @ SP+0x12 (state-selector)
 *   - SP+0x14..0x17 : arg3Long; low word @ SP+0x16 (col)
 *   - SP+0x18..0x1B : arg4Long; low word @ SP+0x1A (tickOff)
 *   - SP+0x1C..0x1F : arg5Long; low word @ SP+0x1E (width / maxLen)
 *   - SP+0x20..0x23 : arg6Long; low word @ SP+0x22 (render arg)
 *
 * Confermato da xref caller @ 0x18C7E..0x18C90 (6 push + jsr): pushes RTL
 *   pea(7), pea(0x18), pea(0x17), clr.l, move.l(0xBC,A2)  // top 5 of 6
 *   precedente: move.w D5w; ext.l; move.l → 6° push (arg6 = ext_l(D5.w))
 * E poi `lea (0x3C,SP),SP` post-jsr/jsr per pop totale di 6 long del 28EB2 +
 * 1 long del 28DB8 + 8 long del precedente blocco = 60 byte = 0x3C ✓.
 *
 * **Sub-call #1 — `FUN_00003874`** (via trampoline `jmp 0x112` → `jmp 0x3874`):
 *   number formatter. Args (push order in FUN_28EB2, RTL):
 *     1. value      = arg1Long              (long: SP+8 dentro FUN_3874)
 *     2. bufEnd     = *(0x40041E)           (long: SP+12, output buffer ptr)
 *     3. fmtMode    = 0x64 ('d', byte field at SP+0x1F dentro FUN_3874)
 *                     Modi: 'd' (decimal), 'b' (binary), 's' (signed dec),
 *                           altro (hex). Hardcoded a 'd' qui.
 *     4. width      = sext_l(arg2.w)         (long: SP+16; nota: byte field
 *                     a SP+0x23 → low byte di ext_l(arg2.w) = arg2.l & 0xff;
 *                     **stesso byte usato come state-selector qui**: il "2"
 *                     che attiva il trim path è anche il "width" passato a
 *                     FUN_3874 ⇒ width=2 quando attiva il trim. Comportamento
 *                     atteso del binario.)
 *     5. fillCh/etc = sext_l(arg5.w)         (long: SP+20; byte @ SP+0x27 →
 *                     fill-char or 's'-flag indicator; arg5.l & 0xff usato
 *                     come fill char + flag in FUN_3874. Per il caller @
 *                     0x18C90, arg5 = 7).
 *
 *   Side effects: scrive `width` byte ASCII a `*(bufEnd-width+1)..bufEnd` poi
 *   un null terminator @ `bufEnd[width+1]` (in realtà `clr.b (0,A0,D0w*1)`
 *   con D0=width). Vedi disasm di FUN_3874 @ 0x3874..0x39FF per dettaglio.
 *
 * **Sub-call #2 — `FUN_00028F28`** (`trimTrailingSpace`, condizionale):
 *   solo se `arg2.w == 2`. Args:
 *     1. strPtr = *(0x40041E)         (stesso buffer scritto da FUN_3874)
 *     2. maxLen = sext_l(arg5.w)
 *   Side effects: walka da `strPtr` fino a primo space o `maxLen` byte; se
 *   trova space prima di maxLen, lo azzera (un solo byte). Vedi
 *   `string-trim.ts::trimTrailingSpace` per replica TS bit-perfect.
 *
 * **Sub-call #3 — `FUN_00028FA0`** (`renderStringEntry28FA0`, sempre):
 *   Args: (arg3.l_ext, arg4.l_ext, arg6.l_ext). Mappatura dentro 28FA0:
 *     - arg3 → col byte → workRam[0x41C]
 *     - arg4 → tickOff byte → workRam[0x41D]
 *     - arg6 → render arg (low word ext, propagato a FUN_3520)
 *   Side effects: 3 byte writes (col, tickOff, marker=0) + chiamata a
 *   `FUN_3520` (renderStringChain2). Vedi `render-string-entry-28fa0.ts`.
 *
 * **Caller del binario** (8 xref):
 *   - `FUN_00010504` (boot/dispatch HUD): 5 call site (0x1083E, 0x108A8,
 *      0x109C2, 0x109FA, 0x10CB2) — formatta vari counter HUD.
 *   - `FUN_00011B18`: 1 call (0x11C82).
 *   - `FUN_00018A88`: 1 call (0x18C90) — esempio analizzato per derivare
 *      la firma a 6 args (precedente `lea 0x3C,SP` cleanup).
 *
 * **Effetti diretti** (assumendo `*(0x40041E)` punta a workRam valida):
 *   1. buffer @ `*(0x40041E)..(*(0x40041E) + arg2.w + 1)` ← ASCII digits + null
 *   2. (se arg2.w==2): un byte space → 0 nel range walked
 *   3. workRam[0x41C] ← arg3.lowByte (col)
 *   4. workRam[0x41D] ← arg4.lowByte (tickOff)
 *   5. workRam[0x422] ← 0 (marker clear)
 *   6. invocazione `FUN_3520` (renderStringChain2) — esterna, side-effect
 *      sull'alpha tilemap @ 0xA03000.
 *
 * **Sub injection**: tutte e tre le sub-call sono iniettabili (pattern
 * `scene-init-11428.ts`). Default: no-op. La parità è verificata patchando
 * le 3 entry binarie a stub `addq.b #1, sentinel.l ; rts` e contando hit
 * per side, oppure (per FUN_28F28) lasciando il bin reale e confrontando il
 * buffer post-call. Vedi `cli/src/test-format-and-render-28eb2-parity.ts`.
 *
 * **Bit-perfect range**: il modulo `formatAndRender28EB2` di per sé NON
 * tocca `state.workRam` direttamente (le 3 sub-call sono iniettabili).
 * L'unica side-effect "interna" sarebbe il dispatch ordinato delle 3 sub.
 * Pertanto la parità si misura sui sentinel byte counter delle sub e sui
 * loro args. Per rendere il test compatibile con `renderStringEntry28FA0`
 * reale (modulo già verificato), si può iniettare la replica TS di FUN_28FA0
 * come callback e confrontare i 3 byte dell'entry @ 0x41C/0x41D/0x422 +
 * un sentinel per FUN_3874 e FUN_28F28.
 */

import type { GameState } from "./state.js";

// ─── Address constants ──────────────────────────────────────────────────

/** Indirizzo assoluto del puntatore "bufEnd" per FUN_3874 + FUN_28F28. */
export const BUFEND_PTR_ADDR = 0x0040041e as const;
/** Offset in `state.workRam` di BUFEND_PTR_ADDR. */
export const BUFEND_PTR_OFF = 0x41e as const;

/** Hardcoded byte 'd' = 0x64 passato come fmtMode a FUN_3874 (decimal). */
export const FMT_MODE_D = 0x64 as const;

/** State-selector word che attiva il trim path. */
export const TRIM_SELECTOR = 2 as const;

/** Indirizzo entry-point del binario (per parity / cross-ref). */
export const FUN_28EB2_ADDR = 0x00028eb2 as const;

/** Indirizzi delle 3 sub-jsr nell'ordine di invocazione. */
export const FUN_28EB2_SUB_ADDRS = [
  0x00003874, // FUN_3874 (via trampoline 0x112) — number formatter
  0x00028f28, // FUN_28F28 — trimTrailingSpace (cond. arg2.w == 2)
  0x00028fa0, // FUN_28FA0 — renderStringEntry28FA0
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Sign-extend di una word (16 bit, signed) in long (32 bit, signed unsigned-rep).
 *
 * Replica dell'`ext.l Dx` M68k su un valore già word (low 16 bit). Il bit 15
 * viene replicato nei 16 bit alti.
 */
function extLowWordToLong(value: number): number {
  const w = value & 0xffff;
  return (w & 0x8000) !== 0 ? (w | 0xffff0000) >>> 0 : w >>> 0;
}

/**
 * Legge il long big-endian a `state.workRam[off..off+3]`.
 *
 * Il binario fa `move.l (0x40041E).l,-(SP)` — leggendo 4 byte come long
 * big-endian dall'indirizzo `0x40041E` (= workRam offset 0x41E).
 */
function readWorkLongBE(state: GameState, off: number): number {
  const r = state.workRam;
  return (
    (((r[off] ?? 0) << 24) |
      ((r[off + 1] ?? 0) << 16) |
      ((r[off + 2] ?? 0) << 8) |
      (r[off + 3] ?? 0)) >>>
    0
  );
}

// ─── Sub injection ──────────────────────────────────────────────────────

/**
 * Bag delle 3 sub-jsr orchestrate da `FUN_00028EB2`. Ogni callback è opzionale
 * (default no-op) per consentire test isolati o iniezione di stub. Ordine di
 * chiamata identico al binario.
 *
 * Nota: i parametri sono i long *dopo* sign-extension (ovvero esattamente i
 * long pushati sullo stack dal binario), per consistenza con quanto il
 * sub-callee leggerà.
 */
export interface FormatAndRender28EB2Subs {
  /**
   * `FUN_00003874` (via trampoline `0x112`) — number formatter.
   *
   * Args (matching binario, 5 long, RTL push order):
   *   - `value`     : arg1Long (full long).
   *   - `bufEnd`    : `*(0x40041E)` long big-endian (output buffer end ptr).
   *   - `fmtMode`   : 0x64 long (= 'd' byte). Hardcoded.
   *   - `width`     : sext_l(arg2.w). Low byte è il "format width" usato da
   *                   FUN_3874; stessa low word del state-selector qui.
   *   - `fillExtra` : sext_l(arg5.w). Low byte è fill-char/flag in FUN_3874.
   *
   * Default: no-op.
   */
  numberFormatter?: (
    state: GameState,
    value: number,
    bufEnd: number,
    fmtMode: number,
    width: number,
    fillExtra: number,
  ) => void;

  /**
   * `FUN_00028F28` — `trimTrailingSpace(strPtr, maxLen)`. Chiamata SOLO
   * quando `arg2.w == 2`.
   *
   * Args (matching binario, 2 long):
   *   - `strPtr`  : `*(0x40041E)` long big-endian.
   *   - `maxLen`  : sext_l(arg5.w).
   *
   * Default: no-op (la replica TS è in `string-trim.ts::trimTrailingSpace`).
   */
  trimTrailingSpace?: (
    state: GameState,
    strPtr: number,
    maxLen: number,
  ) => void;

  /**
   * `FUN_00028FA0` — `renderStringEntry28FA0`. Sempre invocata.
   *
   * Args (matching binario, 3 long):
   *   - `arg1Long` : sext_l(arg3.w) — col byte, low → workRam[0x41C].
   *   - `arg2Long` : sext_l(arg4.w) — tickOff byte, low → workRam[0x41D].
   *   - `arg3Long` : sext_l(arg6.w) — render arg (low word ext) per FUN_3520.
   *
   * Default: no-op (la replica TS è in
   * `render-string-entry-28fa0.ts::renderStringEntry28FA0`).
   */
  renderStringEntry?: (
    state: GameState,
    arg1Long: number,
    arg2Long: number,
    arg3Long: number,
  ) => void;
}

// ─── Funzione principale ────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00028EB2`.
 *
 * Orchestratore "format-and-render" a 3 step:
 *   1. `FUN_3874` formatta `arg1Long` come stringa decimale di larghezza
 *      `arg2.w` nel buffer puntato da `*(0x40041E)`, con fill-char `arg5.w`.
 *   2. (se `arg2.w == 2`) `FUN_28F28` trimma uno space trailing nel buffer.
 *   3. `FUN_28FA0` aggiorna la string-chain entry @ `0x40041C` con
 *      (col=arg3.lo, tickOff=arg4.lo, marker=0) e invoca il render.
 *
 * **Side effects diretti del modulo**: ZERO (tutto delegato alle sub-call
 * iniettabili — pattern `scene-init-11428.ts`).
 *
 * @param state    GameState passato alle 3 callback (mutato dalle sub).
 * @param arg1Long arg1 long: valore (o ptr a valore) da formattare.
 * @param arg2Long arg2 long: low word usata come `width` per FUN_3874 e come
 *                 state-selector (== 2 attiva il trim path).
 * @param arg3Long arg3 long: low word → col byte (sext propagato a FUN_28FA0).
 * @param arg4Long arg4 long: low word → tickOff byte (sext propagato a 28FA0).
 * @param arg5Long arg5 long: low word → fill-char/maxLen (sext propagato a
 *                 FUN_3874 e FUN_28F28).
 * @param arg6Long arg6 long: low word → render arg (sext propagato a 28FA0).
 * @param subs     stub injection per le 3 sub-call. Default: tutte no-op.
 */
export function formatAndRender28EB2(
  state: GameState,
  arg1Long: number,
  arg2Long: number,
  arg3Long: number,
  arg4Long: number,
  arg5Long: number,
  arg6Long: number,
  subs: FormatAndRender28EB2Subs = {},
): void {
  // ── Prologue: callee-save di D2/D3 (no-op in TS). ───────────────────

  // Read `*(0x40041E)` come long big-endian — bufEnd ptr per FUN_3874 e
  // FUN_28F28. Il binario lo fa due volte (uno per ciascuna sub-call); noi
  // lo leggiamo una sola volta perché è invariante (FUN_3874 non scrive a
  // 0x40041E).
  const bufEnd = readWorkLongBE(state, BUFEND_PTR_OFF);

  // ── Step 1: FUN_3874 (number formatter, sempre invocato). ───────────
  // Push order RTL: arg1, *0x40041E, 0x64, ext_l(arg2.w), ext_l(arg5.w).
  // I primi 2 sono long "as-is", il 3° è la costante 0x64 long, gli ultimi
  // 2 sono sign-extension della low word (replica `move.w; ext.l; push`).
  const widthExtL = extLowWordToLong(arg2Long);
  const fillExtraExtL = extLowWordToLong(arg5Long);

  subs.numberFormatter?.(
    state,
    arg1Long >>> 0,
    bufEnd >>> 0,
    FMT_MODE_D,
    widthExtL,
    fillExtraExtL,
  );

  // ── Step 2: FUN_28F28 (trimTrailingSpace, condizionale). ────────────
  // Branch: `bne.b 0x28F02` quando D0 (=2) != D2 (=arg2.w). Eseguito SOLO
  // se arg2.w == 2 (i.e. low word di arg2Long == 2, signed comparison ma
  // identico per TRIM_SELECTOR=2 unsigned).
  if ((arg2Long & 0xffff) === TRIM_SELECTOR) {
    // Args: (*(0x40041E), ext_l(arg5.w)).
    subs.trimTrailingSpace?.(state, bufEnd >>> 0, fillExtraExtL);
  }

  // ── Step 3: FUN_28FA0 (renderStringEntry28FA0, sempre invocato). ────
  // Push order RTL: ext_l(arg6.w), ext_l(arg4.w), ext_l(arg3.w).
  // FUN_28FA0 firma: (arg1Long=ext_l(arg3.w), arg2Long=ext_l(arg4.w),
  //                   arg3Long=ext_l(arg6.w)).
  const colExtL = extLowWordToLong(arg3Long);
  const tickOffExtL = extLowWordToLong(arg4Long);
  const renderArgExtL = extLowWordToLong(arg6Long);

  subs.renderStringEntry?.(state, colExtL, tickOffExtL, renderArgExtL);

  // ── Epilogue: lea cleanup + movem.l (SP)+,{D2 D3} + rts (no-op TS). ──
}

/**
 * Re-export del simbolo come "FUN_00028EB2" per mappatura esplicita
 * binario→TS.
 */
export { formatAndRender28EB2 as FUN_00028EB2 };
