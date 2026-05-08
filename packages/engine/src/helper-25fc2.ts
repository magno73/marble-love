/**
 * helper-25fc2.ts — replica `FUN_00025FC2` (129 istr, 0x25FC2..0x26194).
 *
 * **Semantica**: "animation-sequence stepper" per una coppia di object
 * struct in work RAM. Avanza il puntatore animazione, rileva la fine
 * sequenza (sentinel `0xFFFFFFFF` nella ROM), e dispatcha una transizione
 * di stato in base a `A2[+0x1A]` (state byte).
 *
 * **Argomento** (1 long sullo stack = `objPtr`):
 *   - `objPtr` → `A2` = puntatore assoluto M68k alla object struct
 *
 * **Costanti hard-coded**:
 *   - `A1 = 0x20FDE`  — base della tabella animazione primaria in ROM
 *     ("anim_base": 10 entry long = 0x28 byte → indice 0..9)
 *   - `A3 = 0x400018` — base pair di object struct in work RAM
 *     (primo oggetto @ 0x400018, secondo @ 0x400018 + 0xE2 = 0x4000FA)
 *
 * **Object struct fields** (offset rispetto ad `objPtr`):
 *   | Off  | Size | Nome             | Uso                                |
 *   |------|------|------------------|------------------------------------|
 *   | 0x18 | byte | secondary_state  | 0=idle, 2=in-flight → dispatched   |
 *   | 0x19 | byte | sub_idx          | index passato a helper18F46        |
 *   | 0x1A | byte | state            | 1,2,5 = known states; altri = 4    |
 *   | 0x20 | word | dead_load_field  | letto ma non usato (dead-load)     |
 *   | 0x56 | byte | step_counter     | conta le iterazioni al sentinel    |
 *   | 0x57 | byte | obj_type         | 0x65 = segnale di init speciale    |
 *   | 0x5A | long | anim_ptr         | ptr ROM corrente nella seq. anim.  |
 *   | 0x5F | byte | frame_ctr        | counter di frame dentro uno step   |
 *   | 0x60 | byte | frames_per_step  | step ogni N frame                  |
 *   | 0x62 | long | secondary_ptr    | ptr secondario (animazione overlay)|
 *   | 0x66 | byte | sub_frame_ctr    | sub-counter per avanzare sec. ptr  |
 *   | 0x67 | byte | flag67           | flag set a 1 quando idx==9 in st.2 |
 *   | 0xA4 | word | word_a4          | azzerato al completamento (coppia) |
 *
 * **Flusso principale** (vedi annotazioni inline):
 *
 * ### Blocco 1 — Sub-frame advance (solo state==2, anim_ptr > anim_base,
 *               anim_ptr < anim_base+0x80, index > 9):
 *   Incrementa `sub_frame_ctr`. Se diventa 1: azzera + avanza `secondary_ptr`
 *   di 4.
 *
 * ### Blocco 2 — Main frame advance:
 *   Incrementa `frame_ctr`. Se < `frames_per_step` → return early.
 *   Altrimenti: azzera `frame_ctr`, avanza `anim_ptr` di 4.
 *
 * ### Blocco 3 — Wrap detection (solo state==2, nuovo index==9):
 *   Imposta `secondary_ptr = 0x215F6`, azz. `sub_frame_ctr`, set `flag67=1`,
 *   chiama `soundCommand(0x5F)`. Dead-load di `A2[+0x20].w` (CCR non usato).
 *
 * ### Blocco 4 — Sentinel check:
 *   Se `*anim_ptr != 0xFFFFFFFF` → return (animazione in corso).
 *   Altrimenti dispatch su state:
 *   - **state 1 o 5**: se `A2[+0x56] > 6` → setup con `anim_ptr=0x20FB6`,
 *     else → setup con `anim_ptr=0x20FD2`. Entrambi: `frame_ctr=0`, `fps=2`.
 *   - **state 2**: `A2[+0x56]` incrementale:
 *     - `== 0`: reset con `anim_ptr=0x20FD2` + `A2[+0x56]=1`
 *     - `== 1`: `soundPair15884()` + `objectStateEntry25BAE(obj, 2)`
 *     - `>= 2`: gestione avanzata (clear `flag67`, clear `word_a4` per prima/
 *       seconda coppia, dispatch su `secondary_state==2` → `helper18F46`
 *       altrimenti `objectStateEntry25BAE(obj, 4)`)
 *   - **altri state**: `A2[+0x57]=0x65` + `objectStateEntry25BAE(obj, 4)`
 *
 * **Sub-JSR esterne** (injectable via `Helper25FC2Subs`):
 *   - `FUN_158AC` (@ 0x158AC) → `soundCommand(cmd)` — sound trigger.
 *     Invocata max 1 volta per tick: nel blocco wrap-detect (cmd=0x5F).
 *   - `FUN_15884` (@ 0x15884) → `soundPair15884(state)` — pair sound trigger.
 *     Invocata solo nel sub-path state-2/step1 al sentinel.
 *   - `FUN_25BAE` (@ 0x25BAE) → `objectStateEntry25BAE(state, objPtr, code)`.
 *     Invocata nei path sentinel (state-2/step2, state-2/step3-type4, altri).
 *   - `FUN_18F46` (@ 0x18F46) → `helper18F46(state, rom, typeCode, subIdx)`.
 *     Invocata nel path sentinel state-2/step3 quando `secondary_state==2`.
 *
 * **Note bit-perfect**:
 *   1. `addq.b #1` su byte: wrap 0xFF→0x00.
 *   2. `addq.l #4` su long: wrap a 32-bit (unsigned).
 *   3. `bcc.b` (Branch if Carry Clear) = branch if D0 >= src (unsigned cmp).
 *   4. `bls.b` (Branch if Lower or Same) = branch if D0 <= src (unsigned).
 *   5. `bge.b` (Branch if Greater or Equal) = signed comparison 9 >= index.
 *   6. `cmp.b D0, src` è `src - D0`; `bgt` = branch se `src > D0` (signed).
 *   7. Dead-load `move.w (0x20,A2),D0` in blocco 3: non modellato (CCR non
 *      consumato, D0 caller-saved, nessun side-effect su workRam).
 *   8. `ext.w; ext.l` sul byte `A2[+0x19]` → sign-extend byte a long; il
 *      receiver `helper18F46` applica `& 0xff` → equivalente a passare il
 *      byte direttamente.
 *   9. `lea 0xE2(a3), a0` → secondo oggetto = A3 + 0xE2 = 0x4000FA.
 *   10. Confronto `A2 == A3` o `A2 == A3+0xE2` identifica se objPtr è il
 *      primo o secondo oggetto della coppia → clr.w word_a4.
 *
 * Verifica bit-perfect via
 * `cli/src/test-helper-25fc2-parity.ts` (500/500 casi vs Musashi).
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── Costanti pubbliche ───────────────────────────────────────────────────────

/** Indirizzo ROM di `FUN_00025FC2`. */
export const HELPER_25FC2_ADDR = 0x00025fc2 as const;

/** Base tabella animazione primaria in ROM (A1 hardcoded). */
export const ANIM_BASE_ROM = 0x00020fde as const;

/** Base della coppia object struct in work RAM (A3 hardcoded). */
export const OBJECT_PAIR_BASE = 0x00400018 as const;

/** Offset del secondo oggetto nella coppia (A3 + 0xE2). */
export const OBJECT_PAIR_SECOND_OFFSET = 0xe2 as const;

/** Puntatori ROM delle tabelle animazione usati nei reset. */
export const ANIM_PTRS = {
  /** Tabella "high count" (state 1/5 con A2[+0x56] > 6). */
  highCount: 0x00020fb6,
  /** Tabella "low count" (state 1/5 con A2[+0x56] <= 6; state 2). */
  lowCount: 0x00020fd2,
  /** Tabella overlay secondaria (setata al wrap index 9 in state 2). */
  secondary: 0x000215f6,
} as const;

/** Sentinel sound command inviato al wrap index 9 (state 2). */
export const SOUND_WRAP_INDEX9 = 0x5f as const;

/** Indici delle sub-jsr esterne (per reference/testing). */
export const HELPER_25FC2_SUB_ADDRS = {
  /** FUN_158AC — sound command sender. */
  fun_158AC: 0x000158ac,
  /** FUN_15884 — sound pair trigger. */
  fun_15884: 0x00015884,
  /** FUN_25BAE — object state-transition entry. */
  fun_25BAE: 0x00025bae,
  /** FUN_18F46 — remove-from-draw-list. */
  fun_18F46: 0x00018f46,
} as const;

// ─── Base work RAM ────────────────────────────────────────────────────────────

const WORK_RAM_BASE = 0x00400000 as const;
const WORK_RAM_END = 0x00402000 as const;

// ─── Sub-JSR injection interface ─────────────────────────────────────────────

/**
 * Bag delle 4 sub-JSR esterne orchestrate da `FUN_00025FC2`.
 * Ogni callback è opzionale (default no-op) per consentire test isolati.
 */
export interface Helper25FC2Subs {
  /**
   * `FUN_158AC(cmd)` — sound command sender.
   * Chiamata max 1 volta per tick: in blocco 3 (wrap index 9, state==2)
   * con `cmd = 0x5F`.
   */
  soundCommand?: (cmd: number) => void;

  /**
   * `FUN_15884()` — sound pair trigger (0x3A + eventualmente 0x3B).
   * Chiamata nel path sentinel state-2/step1 (A2[+0x56]==1).
   * Legge `workRam[0x394..0x395]` per decidere se inviare il secondo cmd.
   */
  soundPair15884?: (state: GameState) => void;

  /**
   * `FUN_25BAE(objPtr, subStateCode)` — object state-transition entry.
   * Chiamata in 3 path:
   *   - sentinel state-2/step1: `subStateCode=2`
   *   - sentinel state-2/step3 (secondary_state != 2): `subStateCode=4`
   *   - sentinel altri state: `subStateCode=4`
   */
  objectStateEntry25BAE?: (
    state: GameState,
    objPtr: number,
    subStateCode: number,
  ) => void;

  /**
   * `FUN_18F46(typeCode, subIdx)` — remove-from-draw-list.
   * Chiamata nel path sentinel state-2/step3 quando `secondary_state==2`.
   * `typeCode` ∈ {1, 2} (1=primo oggetto coppia, 2=secondo o terzo).
   * `subIdx` = `A2[+0x19]` sign-extended (8-bit → 32-bit).
   */
  helper18F46?: (
    state: GameState,
    rom: RomImage,
    typeCode: number,
    subIdx: number,
  ) => void;
}

// ─── Helpers interni ──────────────────────────────────────────────────────────

/** Legge byte da workRam a indirizzo assoluto. */
function readU8(wr: Uint8Array, addrAbs: number): number {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_END) return 0;
  return (wr[a - WORK_RAM_BASE] ?? 0) & 0xff;
}

/** Scrive byte in workRam a indirizzo assoluto. */
function writeU8(wr: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_END) return;
  wr[a - WORK_RAM_BASE] = value & 0xff;
}

/** Scrive word BE in workRam a indirizzo assoluto. */
function writeU16BE(wr: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 1 >= WORK_RAM_END) return;
  const o = a - WORK_RAM_BASE;
  const v = value & 0xffff;
  wr[o] = (v >>> 8) & 0xff;
  wr[o + 1] = v & 0xff;
}

/** Legge long BE (unsigned) da workRam a indirizzo assoluto. */
function readU32BE_wr(wr: Uint8Array, addrAbs: number): number {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 3 >= WORK_RAM_END) return 0;
  const o = a - WORK_RAM_BASE;
  return (
    (((wr[o] ?? 0) << 24) |
      ((wr[o + 1] ?? 0) << 16) |
      ((wr[o + 2] ?? 0) << 8) |
      (wr[o + 3] ?? 0)) >>>
    0
  );
}

/** Scrive long BE in workRam a indirizzo assoluto. */
function writeU32BE_wr(wr: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 3 >= WORK_RAM_END) return;
  const o = a - WORK_RAM_BASE;
  const v = value >>> 0;
  wr[o] = (v >>> 24) & 0xff;
  wr[o + 1] = (v >>> 16) & 0xff;
  wr[o + 2] = (v >>> 8) & 0xff;
  wr[o + 3] = v & 0xff;
}

/** Legge long BE (unsigned) da ROM (rom.program) a offset assoluto. */
function readU32BE_rom(rom: RomImage, absOff: number): number {
  const o = absOff >>> 0;
  const b0 = (rom.program[o] ?? 0) & 0xff;
  const b1 = (rom.program[o + 1] ?? 0) & 0xff;
  const b2 = (rom.program[o + 2] ?? 0) & 0xff;
  const b3 = (rom.program[o + 3] ?? 0) & 0xff;
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
}

// ─── Funzione principale ──────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00025FC2` — animation sequence stepper.
 *
 * Vedi disasm e semantica nell'header del file.
 *
 * @param state    GameState corrente (`workRam` mutato in-place).
 * @param rom      ROM image (letto per controllo sentinel `0xFFFFFFFF`).
 * @param objPtr   Puntatore assoluto M68k alla object struct in work RAM
 *                 (es. `0x401000`). Range valido: `[0x400018, 0x401FFF]`.
 * @param subs     Bag di callback per le 4 sub-jsr esterne. Default no-op.
 */
export function helper25FC2(
  state: GameState,
  rom: RomImage,
  objPtr: number,
  subs: Helper25FC2Subs = {},
): void {
  const wr = state.workRam;
  const obj = objPtr >>> 0;

  // ── Costanti locali (A1, A3) ────────────────────────────────────────────
  const A1 = ANIM_BASE_ROM;          // 0x20FDE
  const A3 = OBJECT_PAIR_BASE;       // 0x400018
  const A3_SECOND = (A3 + OBJECT_PAIR_SECOND_OFFSET) >>> 0; // 0x4000FA

  // ─────────────────────────────────────────────────────────────────────────
  // BLOCCO 1: Sub-frame advance (solo state==2 e anim_ptr entro range)
  // ─────────────────────────────────────────────────────────────────────────
  // cmpi.b #2, 0x1A(a2)  / bne.b → 0x2601A
  const state1A = readU8(wr, obj + 0x1a);
  if (state1A === 0x02) {
    const animPtr = readU32BE_wr(wr, obj + 0x5a);

    // cmp.l $5A(A2), D0=A1  → bcc (D0 >= animPtr unsigned) → skip
    // Continua solo se animPtr > A1 (strictly greater)
    // bcc = branch se carry clear = branch se A1 >= animPtr unsigned
    // → salta se A1 >= animPtr → procede solo se animPtr > A1
    const continueSubFrame =
      animPtr > A1 &&
      animPtr < (A1 + 0x80) >>> 0 &&
      (((animPtr - A1) >>> 2) & 0xffff) > 9;

    if (continueSubFrame) {
      // addq.b #1, 0x66(a2) — wrap 0xFF→0x00
      const subFrameCtr = (readU8(wr, obj + 0x66) + 1) & 0xff;
      writeU8(wr, obj + 0x66, subFrameCtr);

      // cmpi.b #1, 0x66(a2) / bne.b → 0x2601A
      if (subFrameCtr === 1) {
        // clr.b 0x66(a2)
        writeU8(wr, obj + 0x66, 0);
        // addq.l #4, 0x62(a2) — advance secondary ptr (32-bit wrap)
        const secPtr = readU32BE_wr(wr, obj + 0x62);
        writeU32BE_wr(wr, obj + 0x62, (secPtr + 4) >>> 0);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BLOCCO 2: Main frame advance
  // ─────────────────────────────────────────────────────────────────────────
  // addq.b #1, 0x5F(a2)
  const frameCtr = (readU8(wr, obj + 0x5f) + 1) & 0xff;
  writeU8(wr, obj + 0x5f, frameCtr);

  // move.b 0x60(a2), d0 / cmp.b 0x5F(a2), d0 / bgt.w → 0x26190
  // cmp.b src,D0 → D0 - src; bgt = branch se D0 > src (signed byte)
  // D0 = frames_per_step, src = frame_ctr
  // bgt = branch se frames_per_step > frame_ctr → return early
  const framesPerStep = readU8(wr, obj + 0x60);
  // Signed byte comparison: interpret as signed bytes
  const fpsSigned = framesPerStep >= 0x80 ? framesPerStep - 0x100 : framesPerStep;
  const fcSigned = frameCtr >= 0x80 ? frameCtr - 0x100 : frameCtr;
  if (fpsSigned > fcSigned) {
    return; // bgt.w → 0x26190 (epilog)
  }

  // Frame counter expired: reset and advance
  writeU8(wr, obj + 0x5f, 0);           // clr.b 0x5F(a2)
  const animPtrOld = readU32BE_wr(wr, obj + 0x5a);
  writeU32BE_wr(wr, obj + 0x5a, (animPtrOld + 4) >>> 0); // addq.l #4, 0x5A(a2)

  // ─────────────────────────────────────────────────────────────────────────
  // BLOCCO 3: Wrap detection (solo state==2, nuovo index==9)
  // ─────────────────────────────────────────────────────────────────────────
  // cmpi.b #2, 0x1A(a2) / bne.b → 0x26070
  // NB: state1A già letto all'inizio, ma il binario potrebbe aver cambiato
  // 0x1A nel frattempo? No: nessuno scrive 0x1A in blocco 1 o 2. Safe.
  if (state1A === 0x02) {
    const newAnimPtr = readU32BE_wr(wr, obj + 0x5a);
    // Compute index = (newAnimPtr - A1) / 4 — unsigned
    // cmp.w D1=index, D0=9 / bne.b → 0x26070 (solo se index==9 continua)
    const offsetW = ((newAnimPtr - A1) >>> 0) & 0xffffffff;
    const index = ((offsetW >>> 2) & 0xffff); // .w (low 16 bit)
    if (index === 9) {
      // dead-load: move.w 0x20(a2), D0 — non modellato (CCR non consumato)

      // move.l #0x215F6, 0x62(a2)
      writeU32BE_wr(wr, obj + 0x62, ANIM_PTRS.secondary);
      // clr.b 0x66(a2)
      writeU8(wr, obj + 0x66, 0);
      // move.b #1, 0x67(a2)
      writeU8(wr, obj + 0x67, 1);
      // pea 0x5F.l / jsr 0x158AC / addq.l #4, a7
      subs.soundCommand?.(SOUND_WRAP_INDEX9);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BLOCCO 4: Sentinel check
  // ─────────────────────────────────────────────────────────────────────────
  // movea.l 0x5A(a2), A0 / moveq #-1, D0 / cmp.l (A0), D0
  // cmp.l src,D0 → D0 - (A0); bne.w → 0x26190 se non sentinel
  const finalAnimPtr = readU32BE_wr(wr, obj + 0x5a);
  const sentinel = readU32BE_rom(rom, finalAnimPtr);
  if (sentinel !== 0xffffffff) {
    return; // bne.w → 0x26190
  }

  // ── Animazione terminata: dispatch su state ─────────────────────────────
  const stateNow = readU8(wr, obj + 0x1a);

  // cmpi.b #1, 0x1A(a2) / beq.w → 0x2608E
  // cmpi.b #5, 0x1A(a2) / bne.b → 0x260C2
  if (stateNow === 0x01 || stateNow === 0x05) {
    // ── STATE 1 o 5: reset animation ──────────────────────────────────────
    const step56 = readU8(wr, obj + 0x56);
    // cmpi.b #6, 0x56(a2) / ble.b → 0x260AC (low_count if <= 6)
    // ble = branch if lower or equal (signed)
    const step56Signed = step56 >= 0x80 ? step56 - 0x100 : step56;
    writeU8(wr, obj + 0x5f, 0);   // clr.b 0x5F(a2)
    writeU8(wr, obj + 0x60, 2);   // move.b #2, 0x60(a2)
    if (step56Signed > 6) {
      // A2[+0x56] > 6 (signed): tabella high-count
      writeU32BE_wr(wr, obj + 0x5a, ANIM_PTRS.highCount); // 0x20FB6
    } else {
      // A2[+0x56] <= 6 (signed): tabella low-count
      writeU32BE_wr(wr, obj + 0x5a, ANIM_PTRS.lowCount); // 0x20FD2
    }
    return;
  }

  if (stateNow !== 0x02) {
    // ── ALTRI STATE (non 1, 5, 2): dispatch a state 4 ─────────────────────
    // 0x2617C:
    writeU8(wr, obj + 0x57, 0x65);  // move.b #0x65, 0x57(a2)
    subs.objectStateEntry25BAE?.(state, obj, 0x04);
    return;
  }

  // ── STATE 2 sentinel handler ──────────────────────────────────────────────
  const step56 = readU8(wr, obj + 0x56);

  // tst.b 0x56(a2) / bne.b → 0x260EE (step2 se != 0)
  if (step56 === 0) {
    // Prima iterazione: setup con tabella low-count
    writeU8(wr, obj + 0x5f, 0);               // clr.b 0x5F(a2)
    writeU8(wr, obj + 0x60, 2);               // move.b #2, 0x60(a2)
    writeU32BE_wr(wr, obj + 0x5a, ANIM_PTRS.lowCount); // move.l #0x20FD2, 0x5A(a2)
    writeU8(wr, obj + 0x56, 1);               // move.b #1, 0x56(a2)
    return;
  }

  // cmpi.b #1, 0x56(a2) / bne.b → 0x2610E (step3 se != 1)
  if (step56 === 1) {
    // Seconda iterazione: suono + transizione a state 2
    subs.soundPair15884?.(state);
    subs.objectStateEntry25BAE?.(state, obj, 0x02);
    return;
  }

  // Terza+ iterazione (A2[+0x56] >= 2): gestione avanzata
  // 0x2610E:
  writeU8(wr, obj + 0x67, 0); // clr.b 0x67(a2)

  // cmpa.l A0=A3, A2 / beq.w → 0x26122 (A2 è il primo della coppia?)
  // lea 0xE2(A3), A0 / cmpa.l A0, A2 / bne.b → 0x26126 (né primo né secondo?)
  // 0x26122: clr.w 0xA4(a2) (solo se A2 è primo o secondo della coppia)
  if (obj === A3 || obj === A3_SECOND) {
    writeU16BE(wr, obj + 0xa4, 0); // clr.w 0xA4(a2)
  }

  // 0x26126: cmpi.b #2, 0x18(a2) / bne.b → 0x26166
  const secondaryState = readU8(wr, obj + 0x18);
  if (secondaryState === 0x02) {
    // clr.b 0x18(a2)
    writeU8(wr, obj + 0x18, 0);

    // Determina type_code in base alla posizione nella coppia
    // cmpa.l A0=A3, A2 → se A2 è primo: D0=1
    // lea 0xE2(A3), A0 / cmpa.l A0, A2 → se A2 è secondo: D0=1 (beq → 0x26142)
    // altrimenti D0=2
    let typeCode: number;
    if (obj === A3) {
      typeCode = 1;
    } else {
      // lea 0xE2(a3), a0 / cmpa.l a0, a2 / bne.b → 0x26146 (D0=2) / 0x26142 (D0=1)
      // 0x26142 è raggiunto sia da A2==A3 (già gestito sopra) che da A2==A3+0xE2
      typeCode = obj === A3_SECOND ? 1 : 2;
    }

    // move.b 0x19(a2), D0 → ext.w → ext.l (sign-extend byte a long)
    const subIdx = readU8(wr, obj + 0x19);
    // jsr 0x18F46.l — helper18F46(typeCode, subIdx)
    subs.helper18F46?.(state, rom, typeCode, subIdx);
    return;
  }

  // 0x26166: A2[+0x18] != 2 → set obj_type=0x65 + dispatch a state 4
  writeU8(wr, obj + 0x57, 0x65);  // move.b #0x65, 0x57(a2)
  subs.objectStateEntry25BAE?.(state, obj, 0x04);
}
