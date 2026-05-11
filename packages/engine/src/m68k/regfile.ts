/**
 * regfile.ts — Mini register file M68010 + helper per le 8 istruzioni di
 * stack ABI usate dal body del main loop di Marble Madness:
 *   LINK, UNLK, MOVEM.L reg→-(An), MOVEM.L (An)+→reg,
 *   MOVE.L/W (d16,An)↔reg, JSR <ea>, RTS, ADDQ.L #n,SP.
 *
 * Scopo: chiudere il drift "stack residue" di ~172B nel cluster
 * 0x1D40..0x1E7F del workRam, dove le sub TS-port leggono/scrivono il
 * frame di stack a offset coerenti con il prologo/epilogo emesso da GCC
 * per il body ROM. Le istruzioni qui replicano la semantica architectural
 * Motorola 68010 quando A7 è allineato (caso reale del gioco — l'address
 * error path NON ci serve, lo gestiamo come no-op a livello validation).
 *
 * Architettura:
 *  - `M68kRegFile`: data/address registers + PC + SR + USP/SSP. A7 attivo
 *    è memorizzato in `a[7]`; al cambio supervisor/user lo swap è
 *    responsabilità del caller (per Marble Madness body siamo sempre in
 *    user mode "stabile" → swap non richiesto qui).
 *  - `MemBus`: interface minimale read/write 8/16/32 bit. Tom Harte test
 *    bus = Map<u32, u8> con address mask 24-bit (m68k bus reale).
 *  - Le 8 istruzioni sono funzioni pure (rf, bus, params) → mutano stato.
 *    CCR/SR NON viene toccato (le 8 istruzioni stack ABI non scrivono
 *    flags). Il PC viene mantenuto coerente con la convenzione Tom Harte
 *    "next prefetch address" = start_pc + length_in_bytes.
 *
 * Riferimenti Musashi (MIT) `m68k_in.c` / `m68kcpu.c`:
 *  - link 16: cicli 16 (M68010 = M68000), m68k_op_link_16.
 *  - unlk:    12 cicli, m68k_op_unlk_32.
 *  - movem.l (predec):  8 + 8 × regCount, mask reversed.
 *  - movem.l (postinc): 12 + 8 × regCount, mask normale.
 *  - jsr (mem):  base 12 + EA extra (vedi cycle-table.ts).
 *  - rts:        16 cicli.
 *  - addq.l #n,An: 8 cicli (special-case: niente flag update con dst=An).
 *
 * NOTA: PC final per LINK/MOVEM/MOVE è `start_pc + bytes_consumed`
 * (allineato all'opcode + ext words). Per JSR/RTS è il target.
 */

import type { u32, u16, i16 } from "../wrap.js";
import {
  as_u32, u32_add, u32_sub, u32_and, u32_or,
  sext_16_32, as_u16, raw,
} from "../wrap.js";

// ─── Register file ────────────────────────────────────────────────────────

export interface M68kRegFile {
  /** D0..D7 (8 × u32). */
  readonly d: Uint32Array;
  /** A0..A6 + A7 (SP attivo). A7 viene swappato con USP/SSP al cambio modo. */
  readonly a: Uint32Array;
  /** Program counter (32-bit; il bus mask a 24-bit). */
  pc: u32;
  /** Status register (T1 S — IPM • • • X N Z V C). Le 8 istruzioni stack
   * ABI non lo modificano. */
  sr: u16;
  /** User stack pointer "shadow" (= A7 quando SR.S=0). */
  usp: u32;
  /** Supervisor stack pointer "shadow" (= A7 quando SR.S=1). */
  ssp: u32;
}

/** Crea un regfile zeroed. */
export function createRegFile(): M68kRegFile {
  return {
    d: new Uint32Array(8),
    a: new Uint32Array(8),
    pc: as_u32(0),
    sr: as_u16(0x2700), // supervisor + IPM=7, interrupt locked (default reset)
    usp: as_u32(0),
    ssp: as_u32(0),
  };
}

// ─── Memory bus interface ─────────────────────────────────────────────────

export interface MemBus {
  read8(addr: u32): import("../wrap.js").u8;
  read16(addr: u32): u16;
  read32(addr: u32): u32;
  write8(addr: u32, value: import("../wrap.js").u8): void;
  write16(addr: u32, value: u16): void;
  write32(addr: u32, value: u32): void;
}

// ─── A7 helper (push/pop) ─────────────────────────────────────────────────

/** push.l: A7 -= 4, write32(A7, value). */
function push_l(rf: M68kRegFile, bus: MemBus, value: u32): void {
  const sp = u32_sub(as_u32(rf.a[7] ?? 0), as_u32(4));
  rf.a[7] = raw(sp);
  bus.write32(sp, value);
}

/** pop.l: read32(A7), A7 += 4 → ritorna il valore. */
function pop_l(rf: M68kRegFile, bus: MemBus): u32 {
  const sp = as_u32(rf.a[7] ?? 0);
  const v = bus.read32(sp);
  rf.a[7] = raw(u32_add(sp, as_u32(4)));
  return v;
}

// ─── LINK An,#disp ────────────────────────────────────────────────────────

/**
 * LINK An,#disp (.W): push An, An := SP, SP += sext(disp).
 *
 * Sequenza Motorola PRM:
 *   1. SP -= 4; M[SP] := An       (push An)
 *   2. An := SP
 *   3. SP += sext_16_32(disp)     (disp solitamente negativo → frame locale)
 *
 * NB: se `an == 7`, il valore di An *pushato* è quello PRIMA del decrement,
 * cioè SP originale. Musashi `m68k_op_link_16` riflette esattamente questa
 * sequenza (`PUSH_32(AY); AY = REG_A[7]; REG_A[7] += MAKE_INT_16(...)`).
 * Cicli: 16. CCR: invariato.
 */
export function link_w(
  rf: M68kRegFile,
  bus: MemBus,
  an: number,
  disp: i16,
): void {
  // Push An (valore corrente, incluso il caso an=7 dove pushiamo SP-pre-decrement)
  const anVal = as_u32(rf.a[an] ?? 0);
  push_l(rf, bus, anVal);
  // An := SP (SP è già decrementato di 4)
  rf.a[an] = rf.a[7] ?? 0;
  // SP += sext(disp)
  const newSp = u32_add(as_u32(rf.a[7] ?? 0), as_u32(raw(sext_16_32(as_u16(raw(disp) & 0xffff)))));
  rf.a[7] = raw(newSp);
}

// ─── UNLK An ──────────────────────────────────────────────────────────────

/**
 * UNLK An: SP := An; An := pop.l().
 *
 * Sequenza:
 *   1. SP := An
 *   2. An := M[SP]; SP += 4
 *
 * Se `an == 7`, il primo assegnamento è no-op (SP=SP), poi An (=A7) viene
 * sovrascritto dal valore poppato → SP finale = popped_value, NON +4.
 * Musashi `m68k_op_unlk_32`: `REG_A[7] = AY; AY = m68ki_pull_32();`.
 * Cicli: 12. CCR: invariato.
 */
export function unlk(rf: M68kRegFile, bus: MemBus, an: number): void {
  rf.a[7] = rf.a[an] ?? 0;
  const popped = pop_l(rf, bus);
  rf.a[an] = raw(popped);
}

// ─── MOVEM.L reg→-(An) (predecrement, register-to-memory) ─────────────────

/**
 * MOVEM.L <list>,-(An): predecrement mode.
 *
 * CONVENZIONE MASK (predec mode): la mask è "reversed".
 *   bit 0  = A7 (write first, at highest address)
 *   bit 1  = A6
 *   ...
 *   bit 7  = A0
 *   bit 8  = D7
 *   bit 9  = D6
 *   ...
 *   bit 15 = D0 (write last, at lowest address)
 *
 * Algoritmo:
 *   for i in 0..15:
 *     if mask & (1 << i):
 *       An -= 4
 *       reg = (i < 8) ? A[7-i] : D[15-i]
 *       M[An] := reg
 *
 * EDGE CASE M68000: se `an` è uno dei registri inclusi nella lista (es.
 * `movem.l d0-a7,-(a7)`), il valore di An *scritto* è quello INIZIALE (prima
 * del decrement). Sul 68010 questa quirk è stata "fixata": viene scritto il
 * valore *decrementato*. Tom Harte testa M68000 (decoder dice "m68000.json"),
 * quindi seguiamo la semantica M68000. Per Marble Love (M68010) usiamo
 * comunque questa funzione perché i compilatori GCC m68k non emettono mai
 * `movem.l ax,-(ax)` con ax in lista — il path quirk non si manifesta.
 * Cicli M68010: 8 + 8 × regCount.
 */
export function movem_l_pd(
  rf: M68kRegFile,
  bus: MemBus,
  mask: u16,
  an: number,
): void {
  const m = raw(mask);
  // Salva il valore iniziale di An per la quirk M68000 (vedi sopra).
  const anInitial = as_u32(rf.a[an] ?? 0);
  let addr = as_u32(rf.a[an] ?? 0);
  for (let i = 0; i < 16; i++) {
    if (((m >>> i) & 1) !== 0) {
      addr = u32_sub(addr, as_u32(4));
      let regVal: u32;
      if (i < 8) {
        // Address registers, reverse order: i=0→A7, i=1→A6, ..., i=7→A0
        const aIdx = 7 - i;
        // M68000 quirk: se aIdx == an (stiamo scrivendo An stesso),
        // usa il valore INIZIALE (pre-decrement).
        regVal = (aIdx === an) ? anInitial : as_u32(rf.a[aIdx] ?? 0);
      } else {
        // Data registers, reverse: i=8→D7, i=9→D6, ..., i=15→D0
        const dIdx = 15 - i;
        regVal = as_u32(rf.d[dIdx] ?? 0);
      }
      bus.write32(addr, regVal);
    }
  }
  rf.a[an] = raw(addr);
}

// ─── MOVEM.L (An)+→<list> (postincrement, memory-to-register) ─────────────

/**
 * MOVEM.L (An)+,<list>: post-increment mode.
 *
 * CONVENZIONE MASK (postinc mode): "normale".
 *   bit 0  = D0
 *   bit 1  = D1
 *   ...
 *   bit 7  = D7
 *   bit 8  = A0
 *   bit 9  = A1
 *   ...
 *   bit 15 = A7
 *
 * Algoritmo:
 *   for i in 0..15:
 *     if mask & (1 << i):
 *       reg := M[An]
 *       An += 4
 *
 * EDGE CASE: se An è in lista, il register file dopo è dominato dal pop
 * (l'ultimo valore caricato). Cicli M68010: 12 + 8 × regCount.
 */
export function movem_l_postinc(
  rf: M68kRegFile,
  bus: MemBus,
  mask: u16,
  an: number,
): void {
  const m = raw(mask);
  let addr = as_u32(rf.a[an] ?? 0);
  for (let i = 0; i < 16; i++) {
    if (((m >>> i) & 1) !== 0) {
      const v = bus.read32(addr);
      if (i < 8) {
        rf.d[i] = raw(v);
      } else {
        rf.a[i - 8] = raw(v);
      }
      addr = u32_add(addr, as_u32(4));
    }
  }
  rf.a[an] = raw(addr);
}

// ─── MOVE.L/W con (d16,An) ────────────────────────────────────────────────

/** move.l (d16,An),Dn */
export function move_l_disp_to_reg(
  rf: M68kRegFile, bus: MemBus,
  disp: i16, an: number, dn: number,
): void {
  const addr = u32_add(as_u32(rf.a[an] ?? 0), as_u32(raw(sext_16_32(as_u16(raw(disp) & 0xffff)))));
  rf.d[dn] = raw(bus.read32(addr));
}

/** move.l Dn,(d16,An) */
export function move_l_reg_to_disp(
  rf: M68kRegFile, bus: MemBus,
  dn: number, disp: i16, an: number,
): void {
  const addr = u32_add(as_u32(rf.a[an] ?? 0), as_u32(raw(sext_16_32(as_u16(raw(disp) & 0xffff)))));
  bus.write32(addr, as_u32(rf.d[dn] ?? 0));
}

/** move.w (d16,An),Dn — solo low word di Dn viene scritta. */
export function move_w_disp_to_reg(
  rf: M68kRegFile, bus: MemBus,
  disp: i16, an: number, dn: number,
): void {
  const addr = u32_add(as_u32(rf.a[an] ?? 0), as_u32(raw(sext_16_32(as_u16(raw(disp) & 0xffff)))));
  const w = bus.read16(addr);
  // MOVE.W (mode src=mem, dst=Dn): low word aggiornata, high word INVARIATA.
  const hi = u32_and(as_u32(rf.d[dn] ?? 0), as_u32(0xffff0000));
  rf.d[dn] = raw(u32_or(hi, as_u32(raw(w) & 0xffff)));
}

/** move.w Dn,(d16,An) — scrive la low word di Dn. */
export function move_w_reg_to_disp(
  rf: M68kRegFile, bus: MemBus,
  dn: number, disp: i16, an: number,
): void {
  const addr = u32_add(as_u32(rf.a[an] ?? 0), as_u32(raw(sext_16_32(as_u16(raw(disp) & 0xffff)))));
  bus.write16(addr, as_u16(raw(as_u32(rf.d[dn] ?? 0)) & 0xffff));
}

// ─── JSR / RTS / ADDQ.L #n,SP ─────────────────────────────────────────────

/**
 * JSR target: push PC (= start_pc + length_of_instruction), PC := target.
 *
 * NOTA: per la validation Tom Harte, il "PC pushato" è `start_pc + 2 +
 * ea_extension_words`. Tom Harte stores il "next prefetch address" come
 * PC final → coincide con `target` (più exactly, target — anche se Musashi
 * ha un quirk: il PC final dopo JSR è `target + 2` perché c'è un prefetch
 * already done. Da test JSR_PC sample: PC final = 3356502262 = 0xC8126D F6
 * = qualcosa. Non importante per la nostra validation perché filtreremo
 * tests con address error. Per regfile pulito: PC := target.
 *
 * Qui passiamo `pushedPc` esplicito (il caller calcola in base alle ext
 * words consumate dall'EA).
 */
export function jsr_abs(
  rf: M68kRegFile, bus: MemBus,
  pushedPc: u32, target: u32,
): void {
  push_l(rf, bus, pushedPc);
  rf.pc = target;
}

/**
 * RTS: PC := pop.l().
 * Cicli: 16. CCR: invariato.
 */
export function rts(rf: M68kRegFile, bus: MemBus): void {
  const newPc = pop_l(rf, bus);
  rf.pc = newPc;
}

/**
 * ADDQ.L #n,An: An += n. NON setta flag (quirk: ADDQ con dst=An ignora CCR).
 * Per SP (An = A7) usiamo direttamente A7.
 * n ∈ {1..8} (encoded come 0 = 8).
 * Cicli: 8.
 */
export function addq_l_sp(rf: M68kRegFile, n: number): void {
  rf.a[7] = raw(u32_add(as_u32(rf.a[7] ?? 0), as_u32(n)));
}

