/**
 * level-fraction-render-28232.ts — replica `FUN_00028232` (400 byte, 0 args, 0 ret).
 *
 * Helper "level / fraction display dispatcher": legge il word corrente
 * @ `0x4003DE` (level index byte) e `0x4003EA` (level number) e renderizza
 * fino a 5 string-chain entry tramite chiamate ripetute a `renderStringChain`
 * (`FUN_2572`, via trampoline 0x142), `initStructHeader` (`FUN_255A`, via
 * trampoline 0x13C) e `renderStringHelper` (`FUN_28E3C`).
 *
 * **Layout output** (tipico HUD "level X/Y" o overlay "1/2"):
 *   1. (cond) `pea 0x1800; arg = ROM[0x23C04 + (idx+1)*4]; jsr renderStringChain`
 *      — solo se mode "selettore" (vedi sotto) `D2 == 0`. attr=0x1800.
 *   2. `arg = ROM[0x23C18 + (idx+1)*4]; attr = 0x3400 - D2;
 *       jsr renderStringChain` — sempre.
 *   3. early-out se `word(0x4003DE) == -1` (sentinel "no current level"). Altrimenti:
 *   4. (cond, D2==0) `pea 0x1800; pea 0x228CA; jsr renderStringChain`.
 *   5. `pea 0x228D6; attr = 0x3400 - D2; jsr renderStringChain`.
 *   6. `divs.w #0xC, word(0x4003EA)` → quotient → D4, remainder → D3.
 *   7. `jsr 0x28E3C(arg1=D4_extL, arg2=0, arg3=0x21, arg4=0x1C, arg5=2,
 *       arg6=0x3400-D2)` — render del quotient come stringa numerica.
 *   8. Scrive una stringa di 4 byte (' ', 3-char, 0) a `*(0x40042A)` come
 *      "fraction string" basata su D3 ∈ {3,4,6,8,9, altro}:
 *        3 → " 1/4", 4 → " 1/3", 6 → " 1/2", 8 → " 2/3", 9 → " 3/4",
 *        altro → "    " (3 space).
 *   9. `jsr 0x13C` (initStructHeader): `workRam[0x428] = 0x23` (col),
 *       `workRam[0x429] = 0x1C` (tickOff), `workRam[0x42E] = 0` (marker).
 *  10. `jsr 0x142(arg1=0x400428, attr=0x3400-D2)` — render finale della
 *      string-chain entry @ 0x400428.
 *
 * **Disasm 0x28232..0x283C1** (400 byte, 0 args, 0 ret):
 *
 *   00028232  movem.l {A4 A3 A2 D4 D3 D2},-(SP)   ; salva 24 byte
 *   00028236  movea.l #0x142,A2                   ; A2 = trampoline 0x142 (renderStringChain)
 *   0002823C  movea.l #0x4003DE,A4                ; A4 = ptr a (level index word @ workRam 0x3DE)
 *   00028242  movea.l #0x400428,A3                ; A3 = ptr struct entry (workRam 0x428)
 *   00028248  moveq   #2,D0
 *   0002824A  cmp.w   (0x00400392).l,D0w          ; (word @ 0x400392) == 2 ?
 *   00028250  bne.b   0x2825A                     ; no  → D0 = 0
 *   00028252  move.l  #0x2000,D0                  ; yes → D0 = 0x2000
 *   00028258  bra.b   0x2825C
 *   0002825A  moveq   #0,D0
 *   0002825C  move.w  D0w,D2w                     ; D2 = 0 o 0x2000 (selettore palette)
 *   0002825E  bne.b   0x2827A                     ; D2 != 0 → skip "1° pea 1800" block
 *
 *   ; ── (cond, D2==0) prima jsr A2 ────────────────────────────────────
 *   00028260  pea     0x1800.w                    ; arg2 attr = 0x1800 long
 *   00028264  move.w  (A4),D0w                    ; D0 = level idx byte (word @ 0x4003DE)
 *   00028266  ext.l   D0
 *   00028268  addq.l  #1,D0                       ; D0 = idx+1
 *   0002826A  asl.w   #2,D0w                      ; D0 = (idx+1) * 4
 *   0002826C  movea.l #0x23C04,A0                 ; A0 = ROM table base 1
 *   00028272  move.l  (0,A0,D0w*1),-(SP)          ; arg1 entry ptr = ROM_BE[0x23C04+idx_offset]
 *   00028276  jsr     (A2)                        ; → renderStringChain(arg1, attr=0x1800)
 *   00028278  addq.l  #8,SP                       ; cleanup 2 long
 *
 *   ; ── seconda jsr A2 (sempre) ─────────────────────────────────────
 *   0002827A  move.l  #0x3400,D0
 *   00028280  move.w  D2w,D1w
 *   00028282  ext.l   D1
 *   00028284  sub.l   D1,D0                       ; D0 = 0x3400 - sext_l(D2.w)
 *   00028286  move.l  D0,-(SP)                    ; arg2 attr = 0x3400 - D2 long
 *   00028288  move.w  (A4),D0w                    ; idx
 *   0002828A  ext.l   D0
 *   0002828C  addq.l  #1,D0
 *   0002828E  asl.w   #2,D0w
 *   00028290  movea.l #0x23C18,A0                 ; A0 = ROM table base 2
 *   00028296  move.l  (0,A0,D0w*1),-(SP)          ; arg1 entry ptr = ROM_BE[0x23C18+idx_offset]
 *   0002829A  jsr     (A2)                        ; → renderStringChain
 *   0002829C  moveq   #-1,D0
 *   0002829E  cmp.w   (A4),D0w                    ; word(A4) == -1 ?
 *   000282A0  addq.l  #8,SP                       ; cleanup 2 long
 *   000282A2  beq.w   0x283BC                     ; sentinel -1 → epilogo
 *
 *   ; ── (cond, D2==0) terza jsr A2 ─────────────────────────────────
 *   000282A6  tst.w   D2w
 *   000282A8  bne.b   0x282B8                     ; D2 != 0 → skip
 *   000282AA  pea     0x1800.w                    ; arg2 attr = 0x1800
 *   000282AE  pea     0x228CA.l                   ; arg1 entry ptr = ROM 0x228CA
 *   000282B4  jsr     (A2)                        ; → renderStringChain
 *   000282B6  addq.l  #8,SP
 *
 *   ; ── quarta jsr A2 (sempre) ─────────────────────────────────────
 *   000282B8  move.l  #0x3400,D0
 *   000282BE  move.w  D2w,D1w
 *   000282C0  ext.l   D1
 *   000282C2  sub.l   D1,D0
 *   000282C4  move.l  D0,-(SP)                    ; arg2 attr = 0x3400 - D2
 *   000282C6  pea     0x228D6.l                   ; arg1 entry ptr = ROM 0x228D6
 *   000282CC  jsr     (A2)                        ; → renderStringChain
 *
 *   ; ── divs.w del numero di livello (resta sullo stack 8 byte) ─────
 *   000282CE  move.w  (0x004003EA).l,D0w          ; D0.w = level number word
 *   000282D4  ext.l   D0
 *   000282D6  divs.w  #0xC,D0                     ; quotient.w = D0[15:0], rem.w = D0[31:16]
 *   000282DA  move.w  D0w,D4w                     ; D4 = quotient word (low part)
 *   000282DC  move.w  (0x004003EA).l,D0w          ; ricarica
 *   000282E2  ext.l   D0
 *   000282E4  divs.w  #0xC,D0
 *   000282E8  swap    D0
 *   000282EA  ext.l   D0
 *   000282EC  move.w  D0w,D3w                     ; D3 = remainder word (sext_l)
 *
 *   ; ── jsr FUN_28E3C (renderStringHelper, 6 long arg) ─────────────
 *   000282EE  move.l  #0x3400,D0
 *   000282F4  move.w  D2w,D1w
 *   000282F6  ext.l   D1
 *   000282F8  sub.l   D1,D0
 *   000282FA  move.l  D0,-(SP)                    ; arg6 = 0x3400 - D2
 *   000282FC  pea     2.w                         ; arg5 = 2
 *   00028300  pea     0x1C.w                      ; arg4 = 0x1C
 *   00028304  pea     0x21.w                      ; arg3 = 0x21
 *   00028308  clr.l   -(SP)                       ; arg2 = 0
 *   0002830A  move.w  D4w,D0w
 *   0002830C  ext.l   D0
 *   0002830E  move.l  D0,-(SP)                    ; arg1 = ext_l(D4)
 *   00028310  jsr     0x28E3C.l                   ; → renderStringHelper
 *   00028316  movea.l (0x2,A3),A0                 ; A0 = long @ workRam[0x42A]  (string buffer ptr)
 *   0002831A  move.b  #0x20,(A0)+                 ; *A0++ = ' '
 *
 *   ; ── dispatch su D3 (resto della division per 12) ───────────────
 *   0002831E  moveq   #3,D0
 *   00028320  cmp.w   D3w,D0w
 *   00028322  lea     (0x20,SP),SP                ; cleanup 32 byte = 8 long (= 6 + 8)
 *                                                  ; (8 = 4 long pre-jsr 28E3C
 *                                                  ;     dal 4° jsr A2: 1 long arg
 *                                                  ;     + 1 long pea → ancora vivi)
 *                                                  ; + 6 long del jsr 28E3C
 *   00028326  bne.b   0x28338
 *   00028328  move.b  #0x31,(A0)+                 ; "1"
 *   0002832C  move.b  #0x2F,(A0)+                 ; "/"
 *   00028330  move.b  #0x34,(A0)+                 ; "4" → " 1/4"
 *   00028334  bra.w   0x28394
 *   00028338  moveq   #4,D0
 *   0002833A  cmp.w   D3w,D0w
 *   0002833C  bne.b   0x2834C
 *   0002833E  move.b  #0x31,(A0)+                 ; "1"
 *   00028342  move.b  #0x2F,(A0)+                 ; "/"
 *   00028346  move.b  #0x33,(A0)+                 ; "3" → " 1/3"
 *   0002834A  bra.b   0x28394
 *   0002834C  moveq   #6,D0
 *   0002834E  cmp.w   D3w,D0w
 *   00028350  bne.b   0x28360
 *   00028352  move.b  #0x31,(A0)+                 ; "1"
 *   00028356  move.b  #0x2F,(A0)+                 ; "/"
 *   0002835A  move.b  #0x32,(A0)+                 ; "2" → " 1/2"
 *   0002835E  bra.b   0x28394
 *   00028360  moveq   #8,D0
 *   00028362  cmp.w   D3w,D0w
 *   00028364  bne.b   0x28374
 *   00028366  move.b  #0x32,(A0)+                 ; "2"
 *   0002836A  move.b  #0x2F,(A0)+                 ; "/"
 *   0002836E  move.b  #0x33,(A0)+                 ; "3" → " 2/3"
 *   00028372  bra.b   0x28394
 *   00028374  moveq   #9,D0
 *   00028376  cmp.w   D3w,D0w
 *   00028378  bne.b   0x28388
 *   0002837A  move.b  #0x33,(A0)+                 ; "3"
 *   0002837E  move.b  #0x2F,(A0)+                 ; "/"
 *   00028382  move.b  #0x34,(A0)+                 ; "4" → " 3/4"
 *   00028386  bra.b   0x28394
 *   00028388  move.b  #0x20,(A0)+                 ; default: 3 space
 *   0002838C  move.b  #0x20,(A0)+
 *   00028390  move.b  #0x20,(A0)+
 *   00028394  clr.b   (A0)                        ; null terminator
 *
 *   ; ── jsr 0x13C (initStructHeader) ───────────────────────────────
 *   00028396  pea     0x1C.w                      ; arg3 = 0x1C (tickOff)
 *   0002839A  pea     0x23.w                      ; arg2 = 0x23 (col)
 *   0002839E  pea     (A3)                        ; arg1 = 0x400428 (struct ptr)
 *   000283A0  jsr     0x13C.l                     ; → initStructHeader
 *
 *   ; ── jsr A2 finale (renderStringChain del struct @ 0x400428) ────
 *   000283A6  move.l  #0x3400,D0
 *   000283AC  move.w  D2w,D1w
 *   000283AE  ext.l   D1
 *   000283B0  sub.l   D1,D0
 *   000283B2  move.l  D0,-(SP)                    ; arg2 attr = 0x3400 - D2
 *   000283B4  pea     (A3)                        ; arg1 = 0x400428
 *   000283B6  jsr     (A2)                        ; → renderStringChain
 *   000283B8  lea     (0x14,SP),SP                ; cleanup 5 long = 20 byte
 *                                                  ; (3 long initStructHeader + 2 long renderStringChain)
 *
 *   ; ── epilogo ────────────────────────────────────────────────────
 *   000283BC  movem.l (SP)+,{D2 D3 D4 A2 A3 A4}
 *   000283C0  rts
 *
 * **Caller** (unico): `FUN_0001101E` @ `0x00011170` (UNCONDITIONAL_CALL).
 *
 * **Side effects diretti** del modulo (assumendo sub-call no-op):
 *   1. `state.workRam[0x428] = 0x23`        (col, da initStructHeader)
 *   2. `state.workRam[0x429] = 0x1C`        (tickOff, da initStructHeader)
 *   3. `state.workRam[0x42E] = 0`           (marker, da initStructHeader)
 *   4. 4 byte scritti a `*(0x40042A)`        (fraction string + null, vedi sotto)
 *
 * **NB sul write a `*(0x40042A)`**: il binario fa `movea.l (0x2,A3),A0` →
 * legge il long puntatore a workRam offset 0x42A (cioè i 4 byte di
 * `state.workRam[0x42A..0x42D]` interpretati come big-endian long), poi
 * scrive 4 byte (' ', 3 char, null) a quell'indirizzo. Poiché il puntatore
 * tipicamente cade in workRam (off 0..0x1FFF), li scriviamo come byte writes
 * a `state.workRam[ptr & 0x1FFF]`. Per parity testing il caller setta il
 * puntatore esplicitamente.
 *
 * **JSR sub injection**: 3 sub-call esterne, tutte iniettabili (pattern
 * `obj-dirty-dispatch-28624`):
 *   - `renderStringChain` (FUN_2572 via 0x142) — 5 invocazioni totali (3
 *     condizionali + 2 sempre).
 *   - `initStructHeader`   (FUN_255A via 0x13C) — 1 invocazione.
 *   - `renderStringHelper` (FUN_28E3C)         — 1 invocazione.
 *
 * **Verifica bit-perfect** via
 * `packages/cli/src/test-level-fraction-render-28232-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { renderScore28E3C } from "./render-score-28e3c.js";
import { renderStringEntry28F62 } from "./render-string-entry-28f62.js";
import { stateSub2572 } from "./state-sub-2572.js";
import { formatNumber3874 } from "./string-format.js";

// ─── Address constants ──────────────────────────────────────────────────

/** Indirizzo entry-point binario (per parity / cross-ref). */
export const FUN_28232_ADDR = 0x00028232 as const;

/** Workram offset del word "mode selector" (assoluto 0x400392). */
export const MODE_SELECTOR_OFF = 0x392 as const;

/** Workram offset del word "level index" (assoluto 0x4003DE). */
export const LEVEL_IDX_OFF = 0x3de as const;

/** Workram offset del word "level number" (assoluto 0x4003EA). */
export const LEVEL_NUM_OFF = 0x3ea as const;

/** Workram offset della struct string-chain entry (assoluto 0x400428). */
export const STRUCT_BASE_OFF = 0x428 as const;

/** Workram offset del long puntatore al buffer "fraction string" (assoluto
 *  0x40042A = STRUCT_BASE_OFF + 2). */
export const FRACTION_PTR_OFF = 0x42a as const;

/** ROM address della tabella entry-pointer 1 (D2==0 path). */
export const ROM_TABLE1_ADDR = 0x00023c04 as const;

/** ROM address della tabella entry-pointer 2 (sempre). */
export const ROM_TABLE2_ADDR = 0x00023c18 as const;

/** ROM address dell'entry "label fixed" 1 (D2==0 path). */
export const ROM_ENTRY_228CA = 0x000228ca as const;

/** ROM address dell'entry "label fixed" 2 (sempre). */
export const ROM_ENTRY_228D6 = 0x000228d6 as const;

/** Word "mode selector" valore che attiva il path D2 != 0 (palette 0x2000). */
export const MODE_SELECTOR_ACTIVE = 2 as const;

/** Attr "alt" usato nelle 2 jsr condizionali (D2==0). */
export const ATTR_ALT_1800 = 0x1800 as const;

/** Base attr usato nelle 3 jsr "always" — sottratto sext_l(D2). */
export const ATTR_BASE_3400 = 0x3400 as const;

/** Palette shift quando MODE_SELECTOR_ACTIVE attivo (D2 = 0x2000). */
export const PALETTE_SHIFT = 0x2000 as const;

/** Sentinel "no current level" (word). */
export const SENTINEL_NO_LEVEL = 0xffff as const;

/** Divisor usato per derivare quotient (D4) e remainder (D3). */
export const LEVEL_DIVISOR = 12 as const;

/** Argomenti costanti per la jsr a FUN_28E3C. */
export const RENDER_HELPER_ARG3 = 0x21 as const;
export const RENDER_HELPER_ARG4 = 0x1c as const;
export const RENDER_HELPER_ARG5 = 2 as const;

/** Argomenti costanti per la jsr a FUN_255A (initStructHeader). */
export const INIT_STRUCT_COL = 0x23 as const;
export const INIT_STRUCT_TICKOFF = 0x1c as const;
export const INIT_STRUCT_MARKER_OFF = 6 as const;

/** Indirizzi delle 3 sub-jsr nell'ordine logico di prima invocazione. */
export const FUN_28232_SUB_ADDRS = [
  0x00000142, // renderStringChain (trampoline a FUN_2572)
  0x0000013c, // initStructHeader  (trampoline a FUN_255A)
  0x00028e3c, // renderStringHelper
] as const;

// ─── Sub injection ──────────────────────────────────────────────────────

/**
 * Callback della sub-jsr `renderStringChain` (FUN_2572 via 0x142). Riceve
 * i 2 long arg nello stesso ordine pushato dal binario:
 *   - `entryPtr` : long, indirizzo della string-chain entry da renderizzare.
 *   - `attrLong` : long pushato come arg2 (low word usato come attr word).
 */
export type RenderStringChainFn = (
  state: GameState,
  entryPtr: number,
  attrLong: number,
) => void;

/**
 * Callback della sub-jsr `initStructHeader` (FUN_255A via 0x13C). Riceve
 * i 3 long arg:
 *   - `structPtr` : long, indirizzo dell'entry header da inizializzare.
 *   - `colLong`   : low byte = col scritto a `*structPtr`.
 *   - `tickOffLong`: low byte = tickOff scritto a `*(structPtr+1)`.
 *
 * Nota: anche `*(structPtr+6) = 0` (clear marker) — replicato qui.
 */
export type InitStructHeaderFn = (
  state: GameState,
  structPtr: number,
  colLong: number,
  tickOffLong: number,
) => void;

/**
 * Callback della sub-jsr `renderStringHelper` (FUN_28E3C). Riceve i 6
 * long arg nello stesso ordine letto da FUN_28E3C dopo il proprio prologue
 * (= push order RTL: arg1 ultimo pushato, primo letto):
 *   - `arg1Long` : `sext_l(D4.w)` — quotient della division per 12.
 *   - `arg2Long` : 0 (costante).
 *   - `arg3Long` : `0x21` (costante).
 *   - `arg4Long` : `0x1C` (costante).
 *   - `arg5Long` : `2` (costante).
 *   - `arg6Long` : `0x3400 - sext_l(D2.w)` (attr derivato).
 */
export type RenderStringHelperFn = (
  state: GameState,
  arg1Long: number,
  arg2Long: number,
  arg3Long: number,
  arg4Long: number,
  arg5Long: number,
  arg6Long: number,
) => void;

/**
 * Bag delle 3 sub-jsr orchestrate da `FUN_00028232`.
 */
export interface LevelFractionRender28232Subs {
  /** `FUN_2572` (renderStringChain, via trampoline 0x142). Default: no-op. */
  renderStringChain?: RenderStringChainFn;
  /** `FUN_255A` (initStructHeader, via trampoline 0x13C). Default: no-op.
   *  Quando invocata, dovrebbe scrivere i byte (col, tickOff, marker) a
   *  `state.workRam[structPtr&0x1FFF]/+1/+6`. Per la replica in-line dei
   *  side-effect del binario, vedi `defaultInitStructHeader` esposto. */
  initStructHeader?: InitStructHeaderFn;
  /** `FUN_28E3C` (renderStringHelper). Default: no-op. */
  renderStringHelper?: RenderStringHelperFn;
}

// ─── Helpers ────────────────────────────────────────────────────────────

/** Legge un word big-endian da `state.workRam[off..off+1]`. */
function readWorkWordBE(state: GameState, off: number): number {
  const r = state.workRam;
  return (((r[off] ?? 0) << 8) | (r[off + 1] ?? 0)) & 0xffff;
}

/** Legge un long big-endian da `state.workRam[off..off+3]`. */
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

/** Legge un long big-endian da `rom.program[addr..addr+3]`. */
function readRomLongBE(rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  const p = rom.program;
  return (
    (((p[a] ?? 0) << 24) |
      ((p[a + 1] ?? 0) << 16) |
      ((p[a + 2] ?? 0) << 8) |
      (p[a + 3] ?? 0)) >>>
    0
  );
}

/**
 * Sign-extend di una word (16 bit) a long (32 bit, two's complement).
 * Replica `ext.l Dx` M68k.
 */
function extLowWordToLong(value: number): number {
  const w = value & 0xffff;
  return (w & 0x8000) !== 0 ? (w | 0xffff0000) >>> 0 : w >>> 0;
}

/**
 * Sign-extend di un word a int signed (range [-32768..32767]).
 * Usato per la `divs.w` simulation (M68k signed division).
 */
function sextWord(value: number): number {
  const w = value & 0xffff;
  return (w & 0x8000) !== 0 ? w - 0x10000 : w;
}

/**
 * Replica della M68k `divs.w divisor, Dn` con dividend signed long, divisor
 * signed word. Ritorna `{ quotient: word, remainder: word }` (entrambi
 * signed-extended in word storage convention).
 *
 * Il binario fa:
 *   move.w (mem),D0w; ext.l D0; divs.w #C,D0
 *   → D0[15:0]  = quotient.w  (signed)
 *     D0[31:16] = remainder.w (signed)
 *
 * Per il caso d'uso di FUN_28232: dividend = sext_l(word(0x4003EA)),
 * divisor = 12. Niente overflow se quotient cape in 16-bit signed.
 */
function divsWord(dividendLong: number, divisor: number): {
  quotient: number;
  remainder: number;
} {
  // Normalizza dividend a int signed 32 bit.
  const dvl =
    (dividendLong & 0x80000000) !== 0
      ? dividendLong - 0x100000000
      : dividendLong;
  const dvr = divisor; // già int (LEVEL_DIVISOR = 12 positivo)
  if (dvr === 0) {
    // Trap "divide by zero" del M68k — fuori scope per il test parity.
    return { quotient: 0, remainder: 0 };
  }
  // M68k signed division: quotient è truncated-toward-zero, remainder ha
  // segno del dividendo. JS `Math.trunc` matcha questa semantica.
  const q = Math.trunc(dvl / dvr);
  const r = dvl - q * dvr;
  return { quotient: q & 0xffff, remainder: r & 0xffff };
}

// ─── Funzione principale ────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00028232`.
 *
 * Orchestratore "level/fraction render" a 7 step (5 renderStringChain + 1
 * initStructHeader + 1 renderStringHelper) con dispatch su mode selector
 * e dispatch ASCII su remainder mod 12.
 *
 * **Side effects diretti del modulo** (assumendo sub-call no-op):
 *   1. `state.workRam[0x428] = 0x23`     (col, da initStructHeader inline)
 *   2. `state.workRam[0x429] = 0x1C`     (tickOff)
 *   3. `state.workRam[0x42E] = 0`        (marker)
 *   4. 4 byte scritti a `*(state.workRam[0x42A..0x42D] long BE) & workRam_mask`
 *      (fraction string + null terminator)
 *
 * **Note sull'early-out**: se `word(0x4003DE) == 0xFFFF` (sentinel "no
 * current level"), la funzione ritorna immediatamente DOPO il 2° render
 * (cioè dopo aver mostrato il "label" generico). I write a workRam[0x428..]
 * NON vengono eseguiti.
 *
 * @param state GameState (workRam mutata, vedi sopra).
 * @param rom   RomImage (letta solo: ROM tables + entry pointer fixed).
 * @param subs  Bag callback. Default: tutte no-op.
 */
export function levelFractionRender28232(
  state: GameState,
  rom: RomImage,
  subs: LevelFractionRender28232Subs = {},
): void {
  // ── Step A: leggi mode selector word @ 0x400392. ────────────────────
  // Replica `cmp.w (0x400392).l, D0w` con D0=2 → D2 = (==2) ? 0x2000 : 0.
  const modeSel = readWorkWordBE(state, MODE_SELECTOR_OFF);
  const d2Word = modeSel === MODE_SELECTOR_ACTIVE ? PALETTE_SHIFT : 0;
  // sext_l(D2.w). PALETTE_SHIFT=0x2000 ha bit 15 = 0 → ext_l = 0x00002000.
  // 0 → ext_l = 0. Quindi attrAlways = 0x3400 - sext_l(D2.w) sempre positivo.
  const d2ExtL = extLowWordToLong(d2Word);
  const attrAlways = (ATTR_BASE_3400 - d2ExtL) >>> 0;

  // ── Step B (cond, D2==0): jsr A2 con attr=0x1800 e entry da ROM table 1. ─
  const levelIdxWord = readWorkWordBE(state, LEVEL_IDX_OFF);
  // ext.w + addq.l #1 + asl.w #2 sul low word dell'idx. Per idx in [0..0x3FFF]
  // (sempre in pratica) il low word dopo `addq.l #1; asl.w #2` è (idx+1)*4 mod 0x10000.
  // Indexed addressing `(0,A0,D0w*1)` legge a A0 + sext.w(D0w) → tratta D0
  // come signed word offset. Per (idx+1)*4 < 0x8000 (idx < 0x1FFF) è
  // identità. Replichiamo il pattern come signed.
  const idxScaled = (((levelIdxWord + 1) << 2) & 0xffff);
  // Sign-extend la word a int per essere fedeli all'indexed addressing M68k.
  const idxScaledSigned = idxScaled & 0x8000 ? idxScaled - 0x10000 : idxScaled;

  if (d2Word === 0) {
    const entryPtr1 = readRomLongBE(rom, (ROM_TABLE1_ADDR + idxScaledSigned) >>> 0);
    // arg2 attr = pea 0x1800 → long 0x00001800 (sign-extended pea word).
    subs.renderStringChain?.(state, entryPtr1, ATTR_ALT_1800);
  }

  // ── Step C (sempre): jsr A2 con attr=0x3400-D2 e entry da ROM table 2. ─
  const entryPtr2 = readRomLongBE(rom, (ROM_TABLE2_ADDR + idxScaledSigned) >>> 0);
  subs.renderStringChain?.(state, entryPtr2, attrAlways);

  // ── Step D: early-out se word(0x4003DE) == -1 (sentinel "no level"). ─
  if (levelIdxWord === SENTINEL_NO_LEVEL) {
    return;
  }

  // ── Step E (cond, D2==0): jsr A2 con attr=0x1800 e entry fixed 0x228CA. ─
  if (d2Word === 0) {
    subs.renderStringChain?.(state, ROM_ENTRY_228CA, ATTR_ALT_1800);
  }

  // ── Step F (sempre): jsr A2 con attr=0x3400-D2 e entry fixed 0x228D6. ─
  subs.renderStringChain?.(state, ROM_ENTRY_228D6, attrAlways);

  // ── Step G: divs.w del level number / 12 → D4=quotient, D3=remainder. ─
  const levelNumWord = readWorkWordBE(state, LEVEL_NUM_OFF);
  const dividendLong = extLowWordToLong(levelNumWord);
  const div = divsWord(dividendLong, LEVEL_DIVISOR);
  const d4Word = div.quotient & 0xffff;
  const d3WordSigned = sextWord(div.remainder); // signed value usato nei cmp.w

  // ── Step H: jsr FUN_28E3C(arg1=ext_l(D4), arg2=0, arg3=0x21, arg4=0x1C,
  //                          arg5=2, arg6=0x3400-D2). ─────────────────────
  const arg1HelperLong = extLowWordToLong(d4Word);
  subs.renderStringHelper?.(
    state,
    arg1HelperLong,
    0,
    RENDER_HELPER_ARG3,
    RENDER_HELPER_ARG4,
    RENDER_HELPER_ARG5,
    attrAlways,
  );

  // ── Step I: leggi puntatore @ workRam[0x42A] long BE → write 4 byte. ─
  // Il binario fa `movea.l (0x2,A3),A0; move.b #0x20,(A0)+; ...; clr.b (A0)`.
  // Scriviamo in workRam mascherando l'indirizzo a 8 KB (workRam size).
  const fracPtr = readWorkLongBE(state, FRACTION_PTR_OFF);
  // Caso "puntatore in workRam (0x400000..0x401FFF)". Mascheriamo con 0x1FFF
  // per ottenere l'offset interno. Il binario non controlla bounds — se il
  // puntatore è altrove, scrive in altre regioni (gestiamo solo workRam qui).
  const fracOff = fracPtr & 0x1fff;
  // Byte 0 = ' '
  state.workRam[fracOff] = 0x20;
  // Byte 1..3 = 3-char fraction code per D3, oppure 3 space.
  let b1 = 0x20;
  let b2 = 0x20;
  let b3 = 0x20;
  if (d3WordSigned === 3) {
    b1 = 0x31; b2 = 0x2f; b3 = 0x34; // " 1/4"
  } else if (d3WordSigned === 4) {
    b1 = 0x31; b2 = 0x2f; b3 = 0x33; // " 1/3"
  } else if (d3WordSigned === 6) {
    b1 = 0x31; b2 = 0x2f; b3 = 0x32; // " 1/2"
  } else if (d3WordSigned === 8) {
    b1 = 0x32; b2 = 0x2f; b3 = 0x33; // " 2/3"
  } else if (d3WordSigned === 9) {
    b1 = 0x33; b2 = 0x2f; b3 = 0x34; // " 3/4"
  }
  state.workRam[(fracOff + 1) & 0x1fff] = b1;
  state.workRam[(fracOff + 2) & 0x1fff] = b2;
  state.workRam[(fracOff + 3) & 0x1fff] = b3;
  // null terminator (clr.b (A0) — A0 punta a fracOff+4 dopo i 4 post-incr)
  state.workRam[(fracOff + 4) & 0x1fff] = 0;

  // ── Step J: jsr 0x13C (initStructHeader). ─────────────────────────
  // I 3 byte writes (col @ structPtr, tickOff @ +1, marker @ +6) sono
  // eseguiti dalla callback (default: no-op). Per replica completa del
  // side-effect del binario, il caller deve fornire `initStructHeader`
  // (es. `defaultInitStructHeader`) — vedi parity test.
  subs.initStructHeader?.(
    state,
    0x00400000 | STRUCT_BASE_OFF,
    INIT_STRUCT_COL,
    INIT_STRUCT_TICKOFF,
  );

  // ── Step K: jsr A2 finale — renderStringChain(struct=0x400428, attr=attrAlways). ─
  subs.renderStringChain?.(
    state,
    (0x00400000 | STRUCT_BASE_OFF) >>> 0,
    attrAlways,
  );
}

/**
 * Implementazione di `initStructHeader` (FUN_255A) — replica inline.
 *
 * Scrive 3 byte: col @ `state.workRam[(structPtr & 0x1FFF)]`, tickOff @ +1,
 * 0 @ +6 (marker). Il binario reale fa esattamente queste 3 byte writes.
 *
 * Esposto come callback default da passare a `subs.initStructHeader` per
 * ottenere bit-parity completa fuori dal parity test (dove invece
 * iniettiamo un sentinel counter).
 */
export const defaultInitStructHeader: InitStructHeaderFn = (
  state,
  structPtr,
  colLong,
  tickOffLong,
) => {
  const off = structPtr & 0x1fff;
  state.workRam[off] = colLong & 0xff;
  state.workRam[(off + 1) & 0x1fff] = tickOffLong & 0xff;
  state.workRam[(off + INIT_STRUCT_MARKER_OFF) & 0x1fff] = 0;
};

export function levelFractionRender28232Default(
  state: GameState,
  rom: RomImage,
): void {
  const renderStringChain = (s: GameState, structAddr: number, attrWord: number): void => {
    stateSub2572(s, rom, structAddr, attrWord);
  };

  levelFractionRender28232(state, rom, {
    renderStringChain: (s, entryPtr, attrLong) => {
      renderStringChain(s, entryPtr, attrLong);
    },
    initStructHeader: defaultInitStructHeader,
    renderStringHelper: (s, arg1, arg2, arg3, arg4, arg5, arg6) => {
      renderScore28E3C(s, arg1, arg2, arg3, arg4, arg5, arg6, {
        numberFormatter: (st, value, bufEnd, fmtMode, width, fillExtra) => {
          formatNumber3874(st, value, bufEnd, fmtMode, width, fillExtra);
        },
        renderStringEntry28F62: (st, col, tickOff, attr) => {
          renderStringEntry28F62(st, col, tickOff, attr, {
            renderStringChain: (structAddr, attrWord) => {
              renderStringChain(st, structAddr, attrWord);
            },
          });
        },
      });
    },
  });
}

/**
 * Re-export del simbolo come "FUN_00028232" per mappatura esplicita
 * binario→TS.
 */
export { levelFractionRender28232 as FUN_00028232 };
