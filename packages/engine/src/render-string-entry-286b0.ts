/**
 * render-string-entry-286b0.ts — replica `FUN_000286B0` (62 byte).
 *
 * Helper "copy-string-and-render" — variante più ricca di `FUN_28FDE`
 * (`render-string-entry-28fde.ts`). Differenze chiave:
 *
 *   - struct di lavoro fissa @ `0x400410` (NON `0x400434`).
 *   - copia attiva una stringa null-terminated da `**arg1` verso il buffer
 *     destinazione `*(0x400412)` PRIMA di scrivere col/tickOff/marker.
 *   - `attr` per la chiamata a `renderStringChain` (`FUN_2572`) è preso da
 *     `arg4` (NON hard-coded a `0x3400`).
 *
 * **Disasm 0x286B0..0x286EE** (62 byte, 4 long-on-stack args, ret void):
 *
 *   000286b0  move.l A2,-(SP)                    ; save A2 (4 byte)
 *   000286b2  movea.l (0x8,SP),A0                ; A0 = arg1Long (ptr-to-ptr)
 *   000286b6  move.b  (0xf,SP),D1b               ; D1b = LSB di arg2Long (col)
 *   000286ba  move.b  (0x13,SP),D0b              ; D0b = LSB di arg3Long (tickOff)
 *   000286be  movea.l #0x400410,A1               ; A1 = STRUCT_BASE
 *   000286c4  movea.l (A0),A2                    ; A2 = *(arg1) = ptr a source
 *   000286c6  movea.l (0x2,A1),A0                ; A0 = *(0x400412) = dest ptr
 *   000286ca  move.b  (A2)+,(A0)+                ; copy byte src→dst (postinc)
 *   000286cc  bne.b   0x000286ca                 ; loop until written byte == 0
 *   000286ce  move.b  D1b,(A1)                   ; struct[0] = col byte
 *   000286d0  move.b  D0b,(0x1,A1)               ; struct[1] = tickOff byte
 *   000286d4  clr.b   (0x6,A1)                   ; struct[6] = 0 (marker)
 *   000286d8  move.w  (0x16,SP),D0w              ; D0.w = LOW WORD di arg4Long (attr)
 *   000286dc  ext.l   D0
 *   000286de  move.l  D0,-(SP)                   ; push attr ext_l
 *   000286e0  pea     (A1)                       ; push struct ptr (0x400410)
 *   000286e2  jsr     0x00000142.l               ; → FUN_2572 (renderStringChain)
 *   000286e8  addq.l  0x8,SP                     ; pop 8 byte (attr long + struct ptr)
 *   000286ea  movea.l (SP)+,A2                   ; restore A2
 *   000286ec  rts
 *
 * **Convenzione caller** (cfr. xref @ 0x10bb8 / 0x10bde / etc., FUN_10504):
 *
 *   pea     (attr_word).w        ; 4 byte (BE: hi=00, lo=attr_word)
 *   move.l  D0,-(SP)             ; arg3Long (ext_l di tickOff byte)
 *   pea     (col_word).w         ; arg2Long (ext_l di col byte)
 *   pea     (stringPtrPtr).l     ; arg1Long
 *   jsr     0x000286b0.l
 *
 * Quindi gli offset stack visti da `FUN_286B0` (dopo `move.l A2,-(SP)`):
 *   - SP+0   saved A2  (4 byte)
 *   - SP+4   return PC (4 byte)
 *   - SP+8   arg1Long  (4 byte) — ptr-to-ptr a source string
 *   - SP+12  arg2Long  (4 byte) — col byte (LSB), letto come byte @ SP+0xF
 *   - SP+16  arg3Long  (4 byte) — tickOff byte (LSB), letto come byte @ SP+0x13
 *   - SP+20  arg4Long  (4 byte) — attr word (LSW), letto come word @ SP+0x16
 *
 * **Layout struct @ `0x400410`** (workRam off `0x410`):
 *
 *   +0  byte  : col (scritto da FUN_286B0)
 *   +1  byte  : tickOff (scritto da FUN_286B0)
 *   +2  long  : pointer al buffer di destinazione della stringa (NON
 *               modificato qui; il caller / init code lo configura)
 *   +6  byte  : marker (azzerato qui)
 *   +8  long  : pointer alla next entry (NON modificato qui)
 *
 * **Loop di copia stringa** (`move.b (A2)+,(A0)+; bne`):
 *   - copia byte source → dest in postinc, si ferma DOPO aver scritto un byte
 *     `0x00` (terminator INCLUSO, come la `strcpy` standard).
 *   - se la prima byte è già 0, scrive 0 e termina (1 byte copiato).
 *   - aggiorna `*(0x400412)` (dest ptr) NON è scritto: il binario aggiorna
 *     `A0` register interno, ma dato che è caricato in un registro CPU,
 *     `*(0x400412)` resta invariato post-call. Il "advance" del dest ptr
 *     NON viene salvato nello slot — è una variabile locale.
 *   - similmente `**arg1` (la sorgente) NON viene avanzata persistentemente.
 *
 * **Side effects** in workRam (relativi a base `0x400000`):
 *
 *   1. `[destOff .. destOff+N]` ← bytes della stringa null-terminated
 *      (con `destOff = readLong(0x412)` mappato a workRam, e `N` = lunghezza
 *      includendo il terminator). Se la dest punta fuori workRam non
 *      sappiamo cosa fa il binario (presumibilmente cart RAM); in TS
 *      assumiamo dest in workRam range `[0..0x2000)`.
 *
 *   2. `[0x410]` ← `arg2Long & 0xff`           (col byte)
 *   3. `[0x411]` ← `arg3Long & 0xff`           (tickOff byte)
 *   4. `[0x416]` ← `0`                         (marker clear)
 *
 *   5. invocazione `subs.renderStringChain(0x400410, arg4Long & 0xffff)`
 *      via stub injection. La funzione sub (`FUN_2572`) può modificare
 *      `colorRam` / `alphaRam` etc. ma NON è di competenza di `FUN_286B0`.
 *
 * **Ordine delle scritture** (rilevante per parity test che fa snapshot
 * della workRam alla fine):
 *   1. string copy (postinc loop)
 *   2. struct[0] = col
 *   3. struct[1] = tickOff
 *   4. struct[6] = 0
 *   5. (jsr 0x142 — patched a `rts` nel parity test → no extra effects)
 *
 * **JSR sub injection**: `FUN_2572` (renderStringChain). In smoke test si
 * lascia no-op (default), in parity test si patcha la sub binaria a `rts`
 * e si confronta solo lo state pre-render (struct + dest buffer).
 *
 * Verifica bit-perfect via `cli/src/test-render-string-entry-286b0-parity.ts`.
 */

import type { GameState } from "./state.js";

/** Indirizzo assoluto della struct @ `0x400410` cabled in FUN_286B0. */
export const STRUCT_ABS_ADDR = 0x00400410 as const;

/** Offset struct in `state.workRam` (= STRUCT_ABS_ADDR - 0x400000). */
export const STRUCT_OFF = 0x410 as const;

/** Sub-offset campi struct (rispetto a `STRUCT_OFF`). */
export const COL_BYTE_OFF = 0 as const;
export const TICKOFF_BYTE_OFF = 1 as const;
/** Long pointer al buffer destinazione stringa (`*(0x400412)`). */
export const DEST_PTR_LONG_OFF = 2 as const;
export const MARKER_BYTE_OFF = 6 as const;

/** Indirizzo struct usato come arg1 di renderStringChain. */
export const RENDER_STRUCT_ADDR = STRUCT_ABS_ADDR;

/** Base assoluta workRam (per ricostruire offset da pointer assoluto). */
const WORK_RAM_BASE_ADDR = 0x00400000 as const;
const WORK_RAM_SIZE = 0x2000 as const;

/**
 * Stub injection per la JSR a `FUN_2572` (renderStringChain). Il loop di
 * copia stringa è inline-replicato (deterministico, niente da iniettare).
 */
export interface RenderStringEntry286B0Subs {
  /**
   * `FUN_2572` — render string chain. Default no-op.
   *
   * Args (matching binario): `(structAddr, attrWord)`. Il caller futuro
   * dovrebbe wirare a `string-render.renderStringChain(state, rom, ...)`.
   */
  renderStringChain?: (structAddr: number, attrWord: number) => void;
}

/**
 * Helper: legge un long big-endian da `mem` a `off`. Restituisce 0 se off
 * fuori range (-1 byte safety).
 */
function readLongBE(mem: Uint8Array, off: number): number {
  const a = mem[off] ?? 0;
  const b = mem[off + 1] ?? 0;
  const c = mem[off + 2] ?? 0;
  const d = mem[off + 3] ?? 0;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

/**
 * Replica bit-perfect di `FUN_000286B0`.
 *
 * **Side effects** in `state.workRam`:
 *
 *   1. **String copy** da `srcPtr = *(*arg1Long)` a `dstPtr = *(0x400412)`.
 *      Copia byte-per-byte fino a (incluso) il primo `0x00`. Lettura della
 *      sorgente avviene attraverso `bus.read8` perché può puntare in ROM;
 *      la scrittura avviene su `state.workRam` se `dstPtr` cade nel range
 *      workRam (0x400000..0x401FFF), altrimenti silently no-op (il caller
 *      dovrebbe sempre puntare in workRam — è un dest buffer locale).
 *
 *   2. `workRam[0x410]` ← `arg2Long & 0xff`     (col byte)
 *   3. `workRam[0x411]` ← `arg3Long & 0xff`     (tickOff byte)
 *   4. `workRam[0x416]` ← `0`                    (marker clear)
 *
 *   5. invoca `subs.renderStringChain(0x400410, arg4Long & 0xffff)` (default
 *      no-op).
 *
 * @param state     GameState (modifica `workRam[dstOff..dstOff+N]`,
 *                  `[0x410]`, `[0x411]`, `[0x416]`).
 * @param arg1Long  long arg1: pointer al **pointer-to-source-string**.
 *                  `*(arg1Long)` → src ptr (può essere in ROM o RAM).
 * @param arg2Long  long arg2: solo `& 0xff` usato → struct[0] (col).
 * @param arg3Long  long arg3: solo `& 0xff` usato → struct[1] (tickOff).
 * @param arg4Long  long arg4: solo `& 0xffff` usato → attr per renderStringChain.
 * @param subs      stub injection per `renderStringChain` (default no-op).
 * @param romRead8  funzione di lettura byte-da-rom; usata se la sorgente
 *                  cade fuori dal range workRam. Default: legge zeri (utile
 *                  per smoke test con stringhe completamente in workRam).
 *
 * **Nessun return value rilevante**: il binario fa `rts` senza valorizzare
 * D0 in modo significativo (il caller `FUN_10504` ignora il return).
 */
export function renderStringEntry286B0(
  state: GameState,
  arg1Long: number,
  arg2Long: number,
  arg3Long: number,
  arg4Long: number,
  subs?: RenderStringEntry286B0Subs,
  romRead8?: (absAddr: number) => number,
): void {
  const r = state.workRam;

  // Step 1: deref arg1 → A2 = *(arg1Long) (long-BE da memoria).
  // arg1 può puntare in ROM (xref: 0x22eb2 etc.) oppure in workRam.
  let srcPtr: number;
  const a1Abs = arg1Long >>> 0;
  if (a1Abs >= WORK_RAM_BASE_ADDR && a1Abs + 4 <= WORK_RAM_BASE_ADDR + WORK_RAM_SIZE) {
    srcPtr = readLongBE(r, a1Abs - WORK_RAM_BASE_ADDR);
  } else if (romRead8) {
    srcPtr =
      (((romRead8(a1Abs) & 0xff) << 24) |
        ((romRead8(a1Abs + 1) & 0xff) << 16) |
        ((romRead8(a1Abs + 2) & 0xff) << 8) |
        (romRead8(a1Abs + 3) & 0xff)) >>>
      0;
  } else {
    srcPtr = 0;
  }

  // Step 2: A0 = *(0x400412) = dest pointer (long-BE da workRam @ 0x412).
  const dstPtr = readLongBE(r, STRUCT_OFF + DEST_PTR_LONG_OFF) >>> 0;

  // Step 3: string copy `(A2)+ → (A0)+; bne` — copia fino al primo 0x00 incluso.
  //   - lettura source: workRam se in range, altrimenti via romRead8.
  //   - scrittura dest: workRam se in range; out-of-range = silently skip.
  const inWorkRam = (abs: number): boolean =>
    abs >= WORK_RAM_BASE_ADDR && abs < WORK_RAM_BASE_ADDR + WORK_RAM_SIZE;

  const readSrc = (abs: number): number => {
    if (inWorkRam(abs)) return r[abs - WORK_RAM_BASE_ADDR] ?? 0;
    if (romRead8) return romRead8(abs) & 0xff;
    return 0;
  };

  const writeDst = (abs: number, v: number): void => {
    if (inWorkRam(abs)) r[abs - WORK_RAM_BASE_ADDR] = v & 0xff;
    // else: silently skip (out-of-workRam dest). Il binario reale scriverebbe
    // in cart RAM o sprite RAM; per parity-friendly copertura, i test devono
    // assicurare dstPtr in workRam.
  };

  // Hard cap di sicurezza per stringhe non-terminate (no infinite loop).
  // 0x2000 = full workRam: sufficiente per qualsiasi stringa lecita.
  const COPY_HARD_CAP = WORK_RAM_SIZE;
  let s = srcPtr >>> 0;
  let d = dstPtr >>> 0;
  for (let n = 0; n < COPY_HARD_CAP; n++) {
    const byte = readSrc(s) & 0xff;
    writeDst(d, byte);
    s = (s + 1) >>> 0;
    d = (d + 1) >>> 0;
    if (byte === 0) break;
  }

  // Step 4: byte writes su struct (col, tickOff, marker=0).
  r[STRUCT_OFF + COL_BYTE_OFF] = arg2Long & 0xff;
  r[STRUCT_OFF + TICKOFF_BYTE_OFF] = arg3Long & 0xff;
  r[STRUCT_OFF + MARKER_BYTE_OFF] = 0;

  // Step 5: jsr 0x142 → FUN_2572 (renderStringChain). Stub injection.
  // attr = LOW WORD di arg4Long (matching `move.w (0x16,SP),D0w`).
  const attrWord = arg4Long & 0xffff;
  subs?.renderStringChain?.(RENDER_STRUCT_ADDR, attrWord);
}

/** Re-export del simbolo come "FUN_000286B0" per cross-reference. */
export { renderStringEntry286B0 as FUN_000286B0 };
