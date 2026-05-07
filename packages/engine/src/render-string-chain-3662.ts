/**
 * render-string-chain-3662.ts — replica `FUN_00003662` (290 byte, fino al
 * `rts` @ 0x3782).
 *
 * Variante "dispatch-per-char" del render-string-chain (cfr. FUN_2572 in
 * `string-render.ts`): cammina la stessa linked list di entry e per ognuna
 * itera sui byte della stringa puntata da `(A2+2)`, dispatchando per
 * carattere a:
 *   - `FUN_00032BA` (alias `fun_32ba`)  se rotation == 0
 *   - `FUN_000033F4` (alias `fun_33f4`) se rotation != 0
 * con argomenti `(alphaPtr, 0x3c, 0)` (clear-long sullo stack come 3° arg).
 *
 * **Layout entry struct** (identico a FUN_2572 / FUN_2DA0):
 *   +0  byte  : col (signed)
 *   +1  byte  : tickOff (signed, ma sub.w usa la versione sign-extended a word)
 *   +2  long  : pointer alla stringa (terminata da 0)
 *   +6  byte  : marker (chain end-check additivo a *0x401F00)
 *   +8  long  : pointer next entry
 *
 * **Globals workRam**:
 *   0x401F00  word: VALUE_F00 (additivo per marker check, signed)
 *   0x401F3A  word: tick counter (signed; sub.w applica word arithmetic)
 *   0x401F42  word: rotation flag (0..7), letta come word; ext.l a long signed
 *
 * **ROM tables** (stesse di FUN_2572):
 *   0x7294   word table   : max-display-row per rotation (signed cmp.w)
 *   0x72a0   word table   : stride between consecutive chars per rotation
 *   0x72a4+1 byte table   : shift count per rotation (`asl.l Dn,Dm`, mod 64)
 *   0x72ac   long table   : per-char glyph index (long), indexed da char*4
 *
 * **Disasm 0x3662..0x3784** (290 byte / 0x122):
 *
 *   0x3662  movem.l {A4 A3 A2 D3 D2},-(SP)         ; 5 reg → SP -= 0x14
 *   0x3666  movea.l (0x18,SP),A2                    ; A2 = arg1 long (struct ptr)
 *   0x366a  move.w  (0x1e,SP),D0w                   ; D0w = arg2 low word
 *                                                   ;   (LETTO ma SUBITO sovrascritto)
 *   0x366e  movea.l #0x401f42,A3                    ; A3 = &rotation flag (work RAM)
 *
 *   0x3674  loop_top:                               ; iterazione su ogni entry chain
 *   0x3674    move.b  (0x1,A2),D1b                  ; D1b = byte @ A2+1 (tickOff)
 *   0x3678    ext.w   D1w                            ; sext byte → word
 *   0x367a    sub.w   (0x00401f3a).l,D1w             ; D1w = sext_w(tickOff) - tick
 *   0x3680    move.w  (A3),D0w                       ; D0w = rotation
 *   0x3682    ext.l   D0
 *   0x3684    add.l   D0,D0                          ; D0 = sext(rotation) * 2
 *   0x3686    movea.l #0x7294,A0                     ; A0 = ROM lookup table
 *   0x368c    cmp.w   (0x0,A0,D0*0x1),D1w            ; cmp lookup[rotation*2], D1w
 *   0x3690    bgt.w   0x375c                         ; if D1w > lookup → exit_path
 *
 *   0x3694    move.l  #0xa03000,D3                   ; D3 = ALPHA_BASE
 *   0x369a    movea.l (0x2,A2),A4                    ; A4 = stringPtr (long @ A2+2)
 *   0x369e    tst.w   (A3)                           ; rotation == 0?
 *   0x36a0    beq.b   0x36ac                         ;   (use ROT0 path)
 *
 *   ; rotation != 0:  D2 = 0x29 - sext_l(D1w)
 *   0x36a2    moveq   0x29,D2
 *   0x36a4    move.w  D1w,D0w
 *   0x36a6    ext.l   D0                              ; D0 = sext_l(D1w)
 *   0x36a8    sub.l   D0,D2                           ; D2 = 0x29 - D0
 *   0x36aa    bra.b   0x36b2
 *
 *   ; rotation == 0:  D2 = sext_l(D1w) << 6
 *   0x36ac    move.w  D1w,D2w
 *   0x36ae    ext.l   D2                              ; D2 = sext_l(D1w)
 *   0x36b0    asl.l   #0x6,D2                         ; D2 <<= 6 (arith == logical
 *                                                     ; per i valori validi qui)
 *
 *   ; join: compute alpha base D3
 *   0x36b2    move.b  (A2),D0b                        ; D0b = col (byte @ A2)
 *   0x36b4    ext.w   D0w
 *   0x36b6    ext.l   D0                              ; D0 = sext_l(col)
 *   0x36b8    move.w  (A3),D1w                        ; D1w = rotation
 *   0x36ba    ext.l   D1
 *   0x36bc    add.l   D1,D1                           ; D1 = sext(rotation) * 2
 *   0x36be    movea.l #0x72a4,A0                      ; A0 = ROM shift table base
 *   0x36c4    move.b  (0x1,A0,D1*0x1),D1b             ; D1b = byte @ 0x72a5+rot*2
 *   0x36c8    asl.l   D1,D0                           ; D0 <<= (D1 mod 64), 0 se >=32
 *   0x36ca    add.l   D2,D0                           ; D0 += D2
 *   0x36cc    add.l   D0,D0                           ; D0 *= 2 (word index → byte)
 *   0x36ce    add.l   D0,D3                           ; D3 = ALPHA_BASE + D0
 *
 *   ; per-char dispatch loop @ 0x36d0
 *   0x36d0    char_loop:
 *   0x36d0    move.b  (A4)+,D2b                       ; D2b = byte[A4]; A4++
 *   0x36d2    beq.w   0x375c                          ; if char==0 → exit_path
 *   0x36d6    tst.w   (A3)                            ; rotation == 0?
 *   0x36d8    beq.b   0x36ee                          ;   (call FUN_32BA branch)
 *
 *   ; rotation != 0:  call FUN_33F4(D3, 0x3c, 0)
 *   0x36da    clr.l   -(SP)                           ; push 0 (long arg3)
 *   0x36dc    pea     (0x3c).w                         ; push 0x3c (long arg2,
 *                                                     ;   sext from word 0x003C)
 *   0x36e0    move.l  D3,-(SP)                        ; push D3 (long arg1)
 *   0x36e2    jsr     0x000033f4.l                    ; FUN_33F4(alphaPtr, 0x3c, 0)
 *   0x36e8    lea     (0xc,SP),SP                     ; pop 12 bytes
 *   0x36ec    bra.b   0x3700
 *
 *   ; rotation == 0:  call FUN_32BA(D3, 0x3c, 0)
 *   0x36ee    clr.l   -(SP)
 *   0x36f0    pea     (0x3c).w
 *   0x36f4    move.l  D3,-(SP)
 *   0x36f6    jsr     0x000032ba.l                    ; FUN_32BA(alphaPtr, 0x3c, 0)
 *   0x36fc    lea     (0xc,SP),SP
 *
 *   ; per-char stride dispatch @ 0x3700
 *   0x3700    moveq   0x0,D1
 *   0x3702    move.b  D2b,D1b                         ; D1 = char (zero-ext)
 *   0x3704    asl.w   #0x2,D1w                         ; D1w = char * 4 (max 0x3FC)
 *   0x3706    movea.l #0x72ac,A0                       ; A0 = glyph-index table
 *   0x370c    moveq   0x26,D0                         ; D0 = 0x26
 *   0x370e    cmp.l   (0x0,A0,D1w*0x1),D0             ; cmp.l table[char*4], D0
 *   0x3712    bgt.b   0x3740                          ; if 0x26 > table → wide
 *
 *   0x3714    moveq   0x0,D1
 *   0x3716    move.b  D2b,D1b
 *   0x3718    asl.w   #0x2,D1w
 *   0x371a    movea.l #0x72ac,A0
 *   0x3720    moveq   0x2e,D0                         ; D0 = 0x2e
 *   0x3722    cmp.l   (0x0,A0,D1w*0x1),D0
 *   0x3726    blt.b   0x3740                          ; if 0x2e < table → wide
 *
 *   ; narrow: stride * 2
 *   0x3728    move.w  (A3),D0w                        ; D0w = rotation
 *   0x372a    ext.l   D0
 *   0x372c    add.l   D0,D0                           ; D0 = rotation * 2
 *   0x372e    movea.l #0x72a0,A0                       ; A0 = stride table
 *   0x3734    move.w  (0x0,A0,D0*0x1),D0w             ; D0w = stride[rotation*2]
 *   0x3738    ext.l   D0                              ; sext to long
 *   0x373a    add.l   D0,D0                           ; D0 = stride * 2
 *   0x373c    add.l   D0,D3                           ; D3 += stride*2 (NARROW step)
 *   0x373e    bra.b   0x36d0                          ; → char_loop
 *
 *   ; wide: stride * 4
 *   0x3740    move.w  (A3),D0w
 *   0x3742    ext.l   D0
 *   0x3744    add.l   D0,D0                           ; D0 = rotation * 2
 *   0x3746    movea.l #0x72a0,A0
 *   0x374c    move.w  (0x0,A0,D0*0x1),D0w             ; D0w = stride[rotation*2]
 *   0x3750    ext.l   D0
 *   0x3752    asl.l   #0x1,D0                          ; D0 = stride * 2
 *   0x3754    add.l   D0,D0                           ; D0 = stride * 4
 *   0x3756    add.l   D0,D3                           ; D3 += stride*4 (WIDE step)
 *   0x3758    bra.w   0x36d0                          ; → char_loop
 *
 *   ; exit_path: chain advance check + maybe loop
 *   0x375c    move.b  (0x6,A2),D0b                    ; D0b = marker (byte @ A2+6)
 *   0x3760    ext.w   D0w
 *   0x3762    ext.l   D0
 *   0x3764    move.w  (0x00401f00).l,D1w              ; D1w = VAL_F00
 *   0x376a    ext.l   D1
 *   0x376c    add.l   D1,D0                           ; D0 = sext(marker) + sext(VAL_F00)
 *   0x376e    moveq   0x1,D1
 *   0x3770    cmp.l   D0,D1                           ; flags = D1 - D0 = 1 - sum
 *   0x3772    bge.b   0x377c                          ; if 1 >= sum → return 1
 *   0x3774    movea.l (0x8,A2),A2                     ; A2 = next entry (long @ A2+8)
 *   0x3778    bra.w   0x3674                          ; → loop_top
 *
 *   0x377c    moveq   0x1,D0                          ; D0 = 1 (return)
 *   0x377e    movem.l (SP)+,{D2 D3 A2 A3 A4}
 *   0x3782    rts
 *
 * **Calling convention** (cdecl, args pushed RTL):
 *   - arg1 long @ (0x18,SP) post-prolog: `structAddr` (pointer alla prima
 *     entry della linked list). Movem ha pushato 5*4=20=0x14 byte; 0x18 =
 *     0x14 + 4 (return addr) → arg1 long.
 *   - arg2 long @ (0x1c,SP), low word @ (0x1e,SP): valore read in D0w ma
 *     **immediatamente sovrascritto** a 0x3680 (`move.w (A3),D0w`). Quindi
 *     arg2 è effettivamente IGNORATO dalla funzione (resta come ABI
 *     compatibility con FUN_2572 che lo usa come `attrWord`).
 *   - return D0 long: **sempre 1** (`moveq 0x1, D0` @ 0x377C, unico path).
 *   - D2, D3, A2, A3, A4 callee-saved (preserved da movem.l).
 *
 * **Side effects**:
 *   - Lettura: workRam @ 0x401F00 (VAL_F00), 0x401F3A (tick), 0x401F42 (rot);
 *     A2 e linked list (struct entries); stringa @ A4; ROM tables 0x7294,
 *     0x72a0, 0x72a4, 0x72ac.
 *   - Scrittura: **nessuna** diretta. Tutte le scritture in alphaRam (ed
 *     eventualmente altrove) avvengono dentro `FUN_32BA` / `FUN_33F4` che
 *     vanno chiamate dal caller-binario o iniettate via `subs`.
 *
 * **Modellazione bit-perfect** delle sottigliezze M68k:
 *
 *   1. **`sub.w (0x00401f3a).l,D1w`**: word arithmetic. D1w = (sext_b(tickOff)
 *      - tick) & 0xFFFF. La cmp successiva `cmp.w lookup[rot*2], D1w` è
 *      signed-word; bgt branca se D1w > lookup (signed).
 *
 *   2. **`asl.l #6, D2`** (rotation==0): arithmetic-shift-left long con
 *      count immediato 6. Per valori in range tickOff (-128..127), D2 è
 *      sext_l, range [-128..127], shift << 6 → [-8192..8128]. Non c'è
 *      overflow del segno (cap a 32-bit signed).
 *
 *   3. **`asl.l Dn, Dm`** (count from byte): count = `Dn & 63`. Per shift
 *      count >= 32 il valore long viene azzerato. JS `<<` masca a 5 bit,
 *      quindi serve guard `count >= 32 ? 0 : (val << count)`.
 *
 *   4. **`(0x0,A0,D1w*0x1)`**: indexed addressing word-sized. D1w è
 *      sign-extended a long per il calcolo dell'indirizzo. Qui D1w =
 *      char*4, max 0xFF*4 = 0x3FC < 0x8000 → no sign extension issue.
 *
 *   5. **Char dispatch**:
 *      - byte 0 → exit chain (terminator)
 *      - byte ≠ 0 → jsr a FUN_32BA (rot==0) o FUN_33F4 (rot!=0)
 *      - stride: narrow (table[char*4] in [0x26..0x2e]) → +stride*2
 *                wide   (table[char*4] not in [0x26..0x2e])  → +stride*4
 *
 *   6. **Marker check**:
 *      D0 = sext_l(byte @ A2+6) + sext_l(word @ 0x401F00)
 *      `cmp.l D0,D1; bge` con D1=1 → branch when 1 >= D0 → exit return 1
 *      Quindi continua la chain solo se sum > 1 (stretto), identico a
 *      FUN_2572.
 *
 *   7. **arg2 ignorato**: il binario fa `move.w (0x1e,SP),D0w` ma D0 viene
 *      sovrascritto pochi cicli dopo. L'arg2 è quindi semantically un dead
 *      argument. Lo accettiamo e lo ignoriamo nella replica TS.
 *
 *   8. **Return D0 = 1**: unico path di uscita. Il binario non setta D0 a
 *      altri valori (no error path, no terminator distinto).
 *
 *   9. **Pure read**: la funzione di per sé non scrive in nessuna RAM. Ogni
 *      side effect transita per `subs.fun_32ba` / `subs.fun_33f4`.
 *
 * **Xref**: nessun caller diretto trovato (thunk @ 0x206 scopre il punto di
 * ingresso ma non risulta a sua volta riferito). Funzione "dead-code" nel
 * binario shippato, replicata per coerenza/completezza.
 *
 * Verifica bit-perfect via
 * `packages/cli/src/test-render-string-chain-3662-parity.ts`, dove
 * FUN_32BA e FUN_33F4 sono entrambe patchate a stub-probe (record di ogni
 * call: `alphaPtr`).
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── Address constants (M68k absolute) ───────────────────────────────────

const VAL_F00_OFF = 0x1f00 as const;
const TICK_OFF = 0x1f3a as const;
const ROTATION_OFF = 0x1f42 as const;
const ALPHA_BASE = 0xa03000 as const;

const ROM_LOOKUP_LIMIT = 0x7294 as const;
const ROM_STRIDE_TABLE = 0x72a0 as const;
const ROM_SHIFT_TABLE = 0x72a4 as const;
const ROM_GLYPH_INDEX_TABLE = 0x72ac as const;

/** Costante immediata pushata come arg2 in FUN_32BA/FUN_33F4. */
export const RENDER_CHAR_ARG2 = 0x3c as const;

/** Indirizzo della jsr eseguita quando rotation == 0. */
export const FUN_32BA_ADDR = 0x000032ba as const;
/** Indirizzo della jsr eseguita quando rotation != 0. */
export const FUN_33F4_ADDR = 0x000033f4 as const;

/** Soglia inferiore (inclusiva) per il glyph-index "narrow". */
export const NARROW_GLYPH_LO_INCL = 0x26 as const;
/** Soglia superiore (inclusiva) per il glyph-index "narrow". */
export const NARROW_GLYPH_HI_INCL = 0x2e as const;

// ─── Memory helpers ──────────────────────────────────────────────────────

/**
 * Lettura byte assoluta M68k → memory map subset (rom + workRam + spriteRam +
 * alphaRam + colorRam). Coerente con `string-render.ts` / `state-sub-2da0.ts`.
 */
function readByteAbs(state: GameState, rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (a < 0x80000) return rom.program[a] ?? 0;
  if (a >= 0x400000 && a < 0x402000) return state.workRam[a - 0x400000] ?? 0;
  if (a >= 0xa02000 && a < 0xa03000) return state.spriteRam[a - 0xa02000] ?? 0;
  if (a >= 0xa03000 && a < 0xa04000) return state.alphaRam[a - 0xa03000] ?? 0;
  if (a >= 0xb00000 && a < 0xb00800) return state.colorRam[a - 0xb00000] ?? 0;
  return 0;
}

/** Lettura long assoluta big-endian. */
function readLongAbs(state: GameState, rom: RomImage, addr: number): number {
  return (
    ((readByteAbs(state, rom, addr) << 24) |
      (readByteAbs(state, rom, (addr + 1) >>> 0) << 16) |
      (readByteAbs(state, rom, (addr + 2) >>> 0) << 8) |
      readByteAbs(state, rom, (addr + 3) >>> 0)) >>>
    0
  );
}

/** Lettura word workRam (offset relativo a 0x400000). */
function readU16WorkRam(state: GameState, off: number): number {
  return ((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0);
}

/** Word signed @ workRam offset. */
function readU16WorkRamSigned(state: GameState, off: number): number {
  const w = readU16WorkRam(state, off);
  return w & 0x8000 ? w - 0x10000 : w;
}

/** Long signed da ROM (per cmp signed). */
function readRomLongSigned(rom: RomImage, romAddr: number): number {
  const a = romAddr >>> 0;
  const b0 = rom.program[a] ?? 0;
  const b1 = rom.program[(a + 1) >>> 0] ?? 0;
  const b2 = rom.program[(a + 2) >>> 0] ?? 0;
  const b3 = rom.program[(a + 3) >>> 0] ?? 0;
  const u = ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
  // Convert to signed 32-bit
  return u | 0;
}

/** Word signed da ROM. */
function readRomWordSigned(rom: RomImage, romAddr: number): number {
  const w = ((rom.program[romAddr] ?? 0) << 8) | (rom.program[romAddr + 1] ?? 0);
  return w & 0x8000 ? w - 0x10000 : w;
}

/** Sign-extend byte → 32-bit signed JS number. */
function sextByte(b: number): number {
  return b & 0x80 ? (b & 0xff) - 0x100 : b & 0xff;
}

// ─── JSR stub injection ──────────────────────────────────────────────────

/**
 * Argomenti di una singola call a FUN_32BA o FUN_33F4 (entrambi cdecl con
 * 3 long args RTL). Il binario sempre passa `arg2=0x3c, arg3=0`, quindi
 * espogniamo qui solo `alphaPtr` (l'unico parametro variabile).
 */
export interface RenderCharCall {
  /** D3 al momento della call: pointer assoluto in alpha tilemap. */
  alphaPtr: number;
  /** Sempre 0x3c (immediate da `pea (0x3c).w`). Esposto per simmetria. */
  arg2: number;
  /** Sempre 0 (immediate da `clr.l -(SP)`). Esposto per simmetria. */
  arg3: number;
  /** Byte char corrente (D2.b) — non passato al binario, comodo per debug. */
  charByte: number;
  /** Rotation corrente (word @ 0x401F42) — comodo per debug. */
  rotation: number;
}

/**
 * Stub injection per le due jsr esterne (FUN_32BA e FUN_33F4). Default
 * no-op — il caller-binario o i parity test li patcha a stub-probe.
 */
export interface RenderStringChain3662Subs {
  /** Hook chiamato quando rotation == 0 (replica `jsr 0x000032ba.l`). */
  fun_32ba?: (call: RenderCharCall) => void;
  /** Hook chiamato quando rotation != 0 (replica `jsr 0x000033f4.l`). */
  fun_33f4?: (call: RenderCharCall) => void;
}

// ─── Main function: replica FUN_3662 ─────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00003662` — render-string-chain dispatch.
 *
 * @param state       GameState (pure-read in TS; tutti gli effect tramite
 *                    `subs.fun_32ba`/`subs.fun_33f4`).
 * @param rom         RomImage (per ROM tables 0x7294/0x72A0/0x72A4/0x72AC e
 *                    per dereferenziare struct/string in zone ROM).
 * @param structAddr  arg1 long: pointer alla prima entry della linked list.
 * @param _attrWord   arg2 long: **IGNORATO** dal binario (vedi nota nel
 *                    file header). Mantenuto in firma per ABI compatibility.
 * @param subs        Stub injection per le due jsr esterne. Default no-op.
 *
 * @returns Sempre 1 (D0 al ritorno del binario).
 *
 * **No mutation** di GameState: questa funzione di per sé NON scrive in
 * memoria. Tutte le scritture in alphaRam (e registri MMIO) avvengono
 * dentro FUN_32BA/FUN_33F4, che vanno passate via `subs` o eseguite dal
 * binario reale (in differential test).
 *
 * **Safety guards** per chain malformate / stringhe non terminate:
 *   - `chainSafety = 1024`: max 1024 entry walked → evita loop su chain
 *     circolari malformate.
 *   - `charSafety = 65536`: max 65536 char per stringa → evita read out-of-
 *     range se la stringa non è terminata da 0. Il binario non ha
 *     safety net (in produzione le stringhe sono ben formate).
 */
export function renderStringChain3662(
  state: GameState,
  rom: RomImage,
  structAddr: number,
  _attrWord: number,
  subs: RenderStringChain3662Subs = {},
): number {
  let a2 = structAddr >>> 0;
  let chainSafety = 1024;

  // Loop sulle entry della linked list (chain advance @ marker check)
  while (chainSafety-- > 0) {
    // ── tickOff check vs lookup table ─────────────────────────────────
    // 0x3674..0x3690
    const tickOffByte = readByteAbs(state, rom, (a2 + 1) >>> 0);
    const tickOffSigned = sextByte(tickOffByte); // ext.w D1w
    const tickWordSigned = readU16WorkRamSigned(state, TICK_OFF);
    // sub.w in word arithmetic: result wraps mod 0x10000
    const d1Word = (tickOffSigned - tickWordSigned) & 0xffff;
    const d1Signed = d1Word & 0x8000 ? d1Word - 0x10000 : d1Word;

    // rotation @ 0x401F42, sext to long
    const rotationWord = readU16WorkRam(state, ROTATION_OFF);
    const rotationSigned =
      rotationWord & 0x8000 ? rotationWord - 0x10000 : rotationWord;

    // lookup[rot*2] (signed word from ROM)
    const lookup = readRomWordSigned(
      rom,
      (ROM_LOOKUP_LIMIT + rotationSigned * 2) >>> 0,
    );

    // bgt: branch if D1w > lookup (signed-word) → skip render this entry
    if (d1Signed > lookup) {
      // Direttamente al marker check (exit_path @ 0x375c)
      // (i.e. salta il blocco render ma fa comunque l'advance check)
    } else {
      // ── compute D2 (rotation branch) ──────────────────────────────────
      // 0x3694..0x36b0
      let d2: number;
      if (rotationWord !== 0) {
        // D2 = 0x29 - sext_l(D1w)  (signed long sub)
        d2 = (0x29 - d1Signed) | 0;
      } else {
        // D2 = sext_l(D1w) << 6 (asl.l #6 — arith == logical here, sign
        // preserved/overflow into sign bit possibile ma nel range usato
        // (-128..127 << 6 = -8192..8128) non capita).
        d2 = (d1Signed << 6) | 0;
      }

      // ── compute D3 = ALPHA_BASE + 2 * (col << shift + d2) ─────────────
      // 0x36b2..0x36ce
      const colByte = readByteAbs(state, rom, a2);
      const colSigned = sextByte(colByte); // ext.l after move.b → sext

      // shift count: byte @ 0x72a5 + rotation*2
      const shiftCount =
        (rom.program[(ROM_SHIFT_TABLE + 1 + rotationSigned * 2) >>> 0] ?? 0) &
        0x3f; // m68k count mod 64

      let d0Long: number;
      if (shiftCount >= 32) {
        // shift count >= 32 → result 0 (logical: tutti i bit escono).
        d0Long = 0;
      } else {
        // asl.l: equivalente a logical left shift su signed value (sign
        // bit può cambiare ma il valore numerico binario è lo stesso).
        d0Long = (colSigned << shiftCount) | 0;
      }
      d0Long = (d0Long + d2) | 0;
      d0Long = (d0Long * 2) | 0;

      let d3 = (ALPHA_BASE + d0Long) >>> 0;

      // ── per-char dispatch loop ────────────────────────────────────────
      // 0x36d0..0x375A
      const stringPtr = readLongAbs(state, rom, (a2 + 2) >>> 0);
      let a4 = stringPtr >>> 0;

      let charSafety = 0x10000; // 65536 max bytes per string
      while (charSafety-- > 0) {
        // 0x36d0: move.b (A4)+, D2b
        const charByte = readByteAbs(state, rom, a4);
        a4 = (a4 + 1) >>> 0;
        // 0x36d2: beq.w 0x375c — terminator
        if (charByte === 0) break;

        // 0x36d6: tst.w (A3); beq → call FUN_32BA (rot==0)
        const callArgs: RenderCharCall = {
          alphaPtr: d3,
          arg2: RENDER_CHAR_ARG2,
          arg3: 0,
          charByte,
          rotation: rotationWord,
        };
        if (rotationWord === 0) {
          // 0x36ee..0x36fc: jsr FUN_32BA(D3, 0x3c, 0)
          subs.fun_32ba?.(callArgs);
        } else {
          // 0x36da..0x36e8: jsr FUN_33F4(D3, 0x3c, 0)
          subs.fun_33f4?.(callArgs);
        }

        // ── stride dispatch (narrow vs wide via 0x72ac glyph table) ────
        // 0x3700..0x3758
        const glyphIdx = readRomLongSigned(
          rom,
          (ROM_GLYPH_INDEX_TABLE + (charByte & 0xff) * 4) >>> 0,
        );
        const isNarrow =
          glyphIdx >= NARROW_GLYPH_LO_INCL && glyphIdx <= NARROW_GLYPH_HI_INCL;

        // stride[rotation*2] (signed word from ROM)
        const stride = readRomWordSigned(
          rom,
          (ROM_STRIDE_TABLE + rotationSigned * 2) >>> 0,
        );

        if (isNarrow) {
          // narrow: D3 += stride * 2
          d3 = (d3 + stride * 2) >>> 0;
        } else {
          // wide:   D3 += stride * 4
          d3 = (d3 + stride * 4) >>> 0;
        }
      }
    }

    // ── chain advance check @ 0x375c ─────────────────────────────────────
    const markerByte = readByteAbs(state, rom, (a2 + 6) >>> 0);
    const markerSigned = sextByte(markerByte);
    const valF00Signed = readU16WorkRamSigned(state, VAL_F00_OFF);
    const sum = (markerSigned + valF00Signed) | 0;

    // bge.b 0x377c: cmp.l D0,D1 con D1=1 → flags = 1 - sum
    // bge: branch if N=0 (signed result >= 0) → 1 >= sum → sum <= 1 → exit
    if (sum <= 1) return 1;

    // Advance to next entry
    a2 = readLongAbs(state, rom, (a2 + 8) >>> 0);
  }

  // Safety fallback (chain malformata che non termina): return 1 come binario.
  return 1;
}
