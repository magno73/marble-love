/**
 * cycle-table.ts — Cycle counts M68010 per istruzione (subset).
 *
 * Estratti da Musashi (MIT, https://github.com/kstenerud/Musashi)
 * @ commit `313ebf1bd9f4d0d93341eb5ce21fd8a119e9dbdd` (tip 2026-05-11):
 *   - opcode cycles: `m68k_in.c` colonna `010`
 *   - EA cycle table: `m68kmake.c` `g_ea_cycle_table[..][1][..]`
 *   - JSR/JMP/LEA/PEA/MOVEM EA extras: `m68kmake.c` rispettive tabelle
 *   - movem per-register / bcc-notake / dbcc-noexp: `m68kcpu.c` `case
 *     M68K_CPU_TYPE_68010`
 *
 * Questi sono "instruction cycles" (somma totale per esecuzione) — non bus-
 * accurate. Sufficienti per la **cadence simulation** del main loop di
 * Marble Madness (30/60 Hz dynamic switching basato su `CYCLES_PER_VBLANK`).
 *
 * Copre solo le istruzioni che dominano il cost del body: MOVEM (prologue/
 * epilogue), JSR/RTS/LINK/UNLK, MOVE/MOVE.L con EA, MULS/MULU/DIVS/DIVU,
 * Bcc/DBcc, BCLR/BSET/BTST, e una manciata di ALU comuni.
 *
 * License Musashi: MIT (Karl Stenerud).
 */

import type { u32 } from "../wrap.js";
import { as_u32, u32_add, u32_mul } from "../wrap.js";

// ─── Constants di pacing ──────────────────────────────────────────────────

/**
 * Frequenza clock M68010 di Marble Madness = 7159 MHz (cfr. MAME driver
 * `atarisy1.cpp`). A 60 Hz un vblank dura 7159000/60 ≈ 119316 cicli.
 *
 * Il main loop ROM legge la mailbox a fine body: se i cicli accumulati
 * superano questa soglia, MAME esegue **un** body extra senza attendere
 * vblank → cadenza dinamica 30/60 Hz.
 */
export const CYCLES_PER_VBLANK = as_u32(Math.floor(7159000 / 60));

// ─── Special cycle constants 68010 (m68kcpu.c L818-833) ───────────────────

/** Costo extra Bcc *non* taken con displacement byte (= 10 base + (-4)). */
export const CYC_BCC_NOTAKE_B_DELTA = -4;
/** Costo extra Bcc *non* taken con displacement word (= 10 base + 0). */
export const CYC_BCC_NOTAKE_W_DELTA = 0;
/** DBcc condition true (loop fall-through senza decrement), no expire. */
export const CYC_DBCC_F_NOEXP_DELTA = 0;
/** DBcc condition false con expire (counter==-1 dopo decr): +6. */
export const CYC_DBCC_F_EXP_DELTA = 6;
/** Scc condition true, register variant. */
export const CYC_SCC_R_TRUE_DELTA = 0;
/** Cicli per registro nel MOVEM.W. */
export const CYC_MOVEM_W_PER_REG = as_u32(2);
/** Cicli per registro nel MOVEM.L. */
export const CYC_MOVEM_L_PER_REG = as_u32(3);
/** Costo aggiuntivo dello shift per posizione (ASR/LSR/ROR). */
export const CYC_SHIFT_PER_BIT = as_u32(1);
/** Cicli di una RESET. */
export const CYC_RESET = as_u32(130);

// ─── Istruzioni base (no EA / EA implicito) ───────────────────────────────

export const CYC_NOP = as_u32(4);
export const CYC_RTS = as_u32(16);
export const CYC_RTE = as_u32(24);
export const CYC_LINK_W = as_u32(16);
export const CYC_UNLK = as_u32(12);
export const CYC_SWAP = as_u32(4);
export const CYC_EXT_W = as_u32(4);
export const CYC_EXT_L = as_u32(4);
export const CYC_MOVEQ = as_u32(4);
export const CYC_TRAP = as_u32(4);

/** Bcc taken (qualunque displacement). 68010. */
export const CYC_BCC_TAKEN = as_u32(10);
/** BRA — sempre taken. */
export const CYC_BRA = as_u32(10);
/** BSR — JSR-via-PC. */
export const CYC_BSR = as_u32(18);
/** DBcc base (condition false, decrement, branch taken). */
export const CYC_DBCC_BASE = as_u32(12);

// ─── JSR/JMP base + EA extras (Musashi g_jsr_cycle_table) ─────────────────

/** JSR base — sommare `jsrEaExtra[eaMode]`. */
export const CYC_JSR_BASE = as_u32(12);
/** JMP base — sommare `jmpEaExtra[eaMode]`. */
export const CYC_JMP_BASE = as_u32(4);

/** Modalità EA supportate per il cycle costing. */
export type EaMode =
  | "Dn"
  | "An"
  | "AnIndirect" // (An)
  | "AnPostInc" // (An)+
  | "AnPreDec" // -(An)
  | "d16An" // (d16, An)
  | "d8AnXn" // (d8, An, Xn)
  | "AbsW"
  | "AbsL"
  | "d16PC"
  | "d8PCXn"
  | "Imm";

/** EA extra cycles per JSR (68010). */
export const jsrEaExtra: Readonly<Record<EaMode, u32>> = {
  Dn: as_u32(0), // illegal but tabled as 0
  An: as_u32(0), // illegal
  AnIndirect: as_u32(4),
  AnPostInc: as_u32(0),
  AnPreDec: as_u32(0),
  d16An: as_u32(6),
  d8AnXn: as_u32(10),
  AbsW: as_u32(6),
  AbsL: as_u32(8),
  d16PC: as_u32(6),
  d8PCXn: as_u32(10),
  Imm: as_u32(0),
};

/** EA extra cycles per JMP (68010). */
export const jmpEaExtra: Readonly<Record<EaMode, u32>> = {
  Dn: as_u32(0),
  An: as_u32(0),
  AnIndirect: as_u32(4),
  AnPostInc: as_u32(0),
  AnPreDec: as_u32(0),
  d16An: as_u32(6),
  d8AnXn: as_u32(10),
  AbsW: as_u32(6),
  AbsL: as_u32(8),
  d16PC: as_u32(6),
  d8PCXn: as_u32(10),
  Imm: as_u32(0),
};

// ─── LEA / PEA base + EA extras ───────────────────────────────────────────

/** LEA cycles = leaEaExtra[eaMode] (base 0 sul 68010). */
export const leaEaExtra: Readonly<Record<EaMode, u32>> = {
  Dn: as_u32(0),
  An: as_u32(0),
  AnIndirect: as_u32(4),
  AnPostInc: as_u32(0),
  AnPreDec: as_u32(0),
  d16An: as_u32(8),
  d8AnXn: as_u32(12),
  AbsW: as_u32(8),
  AbsL: as_u32(12),
  d16PC: as_u32(8),
  d8PCXn: as_u32(12),
  Imm: as_u32(0),
};

/** PEA base (= 6) + peaEaExtra[eaMode]. */
export const CYC_PEA_BASE = as_u32(6);
export const peaEaExtra: Readonly<Record<EaMode, u32>> = {
  Dn: as_u32(0),
  An: as_u32(0),
  AnIndirect: as_u32(6),
  AnPostInc: as_u32(0),
  AnPreDec: as_u32(0),
  d16An: as_u32(10),
  d8AnXn: as_u32(14),
  AbsW: as_u32(10),
  AbsL: as_u32(14),
  d16PC: as_u32(10),
  d8PCXn: as_u32(14),
  Imm: as_u32(0),
};

// ─── MOVEM base + EA extras (Musashi g_movem_cycle_table, 68010) ──────────

/**
 * MOVEM base cycles (010, da m68k_in.c L703-714):
 *   - "re" (registers → memory): 8 sia W che L
 *   - "er" (memory → registers): 12 sia W che L
 *
 * Sommare `movemEaExtra[ea]` per displacement/absolute, e
 * `CYC_MOVEM_{W,L}_PER_REG * regCount` per il banco.
 */
export const CYC_MOVEM_RE_BASE = as_u32(8);
export const CYC_MOVEM_ER_BASE = as_u32(12);

/** EA extras MOVEM (g_movem_cycle_table, identico 000/010). */
export const movemEaExtra: Readonly<Record<EaMode, u32>> = {
  Dn: as_u32(0),
  An: as_u32(0),
  AnIndirect: as_u32(0),
  AnPostInc: as_u32(0),
  AnPreDec: as_u32(0),
  d16An: as_u32(4),
  d8AnXn: as_u32(6),
  AbsW: as_u32(4),
  AbsL: as_u32(8),
  d16PC: as_u32(0),
  d8PCXn: as_u32(0),
  Imm: as_u32(0),
};

// ─── EA cycle table generica (g_ea_cycle_table, 010, [b/w, l]) ────────────

/**
 * Cicli aggiuntivi per fetch operand con dato EA, per dimensione
 * (`b_w` = 8/16 bit, `l` = 32 bit).
 *
 * Per la maggior parte delle istruzioni ALU "to register": cycles =
 * baseTable[opcode] + eaCycles[eaMode][size]. La sola EA address-register
 * variants per le istruzioni `... ., a` sono già nelle righe `m68k_in.c`
 * (es. `cmp 32 . a` = 6).
 */
export const eaCycles: Readonly<Record<EaMode, { b_w: u32; l: u32 }>> = {
  Dn: { b_w: as_u32(0), l: as_u32(0) },
  An: { b_w: as_u32(0), l: as_u32(0) },
  AnIndirect: { b_w: as_u32(4), l: as_u32(8) },
  AnPostInc: { b_w: as_u32(4), l: as_u32(8) },
  AnPreDec: { b_w: as_u32(6), l: as_u32(10) },
  d16An: { b_w: as_u32(8), l: as_u32(12) },
  d8AnXn: { b_w: as_u32(10), l: as_u32(14) },
  AbsW: { b_w: as_u32(8), l: as_u32(12) },
  AbsL: { b_w: as_u32(12), l: as_u32(16) },
  d16PC: { b_w: as_u32(8), l: as_u32(12) },
  d8PCXn: { b_w: as_u32(10), l: as_u32(14) },
  Imm: { b_w: as_u32(4), l: as_u32(8) },
};

// ─── MOVE (Musashi `move <size> <dst> <src>` table colonna 010) ───────────

/**
 * MOVE base cycles per dst EA, indipendente dalla src (la src aggiunge
 * `eaCycles[srcEa].b_w` per W/B o `.l` per L).
 *
 * NB: nella tabella Musashi i MOVE *includono* la totale: per non
 * duplicare, esporremo `moveDstBase[dstEa]` come SE la src fosse `Dn`
 * (=0). Il chiamante aggiunge `eaCycles[srcEa]` per la src.
 *
 * Valori da `m68k_in.c` riga 617-684 colonna 010 con `srcEa=d`:
 *  - 8/16: dst=Dn 4, AI 8, PI 8, PD 8, DI 12, IX 14, AW 12, AL 16
 *  - 32:   dst=Dn 4, AI 12, PI 12, PD 14, DI 16, IX 18, AW 16, AL 20
 *
 * (Il 32-bit PD ha 14 sul 010 vs 12 sul 000 — Musashi corregge una quirk
 * del 010 documentata.)
 */
export const moveDstBase: Readonly<
  Record<EaMode, { b_w: u32; l: u32 }>
> = {
  Dn: { b_w: as_u32(4), l: as_u32(4) },
  An: { b_w: as_u32(4), l: as_u32(4) }, // movea
  AnIndirect: { b_w: as_u32(8), l: as_u32(12) },
  AnPostInc: { b_w: as_u32(8), l: as_u32(12) },
  AnPreDec: { b_w: as_u32(8), l: as_u32(14) },
  d16An: { b_w: as_u32(12), l: as_u32(16) },
  d8AnXn: { b_w: as_u32(14), l: as_u32(18) },
  AbsW: { b_w: as_u32(12), l: as_u32(16) },
  AbsL: { b_w: as_u32(16), l: as_u32(20) },
  d16PC: { b_w: as_u32(0), l: as_u32(0) }, // illegal dst
  d8PCXn: { b_w: as_u32(0), l: as_u32(0) }, // illegal dst
  Imm: { b_w: as_u32(0), l: as_u32(0) }, // illegal dst
};

// ─── Moltiplicazione / Divisione 16-bit (peso significativo) ──────────────

/**
 * MULS.W / MULU.W: 68010 li accelera vs 68000.
 *  - MULS.W: 32 cicli + EA (m68k_in.c L724-725)
 *  - MULU.W: 30 cicli + EA (L726-727)
 * Sul 68000 la latenza dipende dal numero di 1-bit nel sorgente; il 68010
 * la fissa al worst case (overhead costante).
 */
export const CYC_MULS_W = as_u32(32);
export const CYC_MULU_W = as_u32(30);

/**
 * DIVS.W / DIVU.W:
 *  - DIVS.W: 122 cicli + EA (L569-570)
 *  - DIVU.W: 108 cicli + EA (L571-572)
 */
export const CYC_DIVS_W = as_u32(122);
export const CYC_DIVU_W = as_u32(108);

// ─── Bit ops (BCLR/BSET/BTST) ─────────────────────────────────────────────

/**
 * 68010 cycles per BCLR/BSET/BTST. Sul 010 il BCLR ha 10 cicli con dest
 * memoria (Musashi L469), gli altri 8/12 (cfr. tabelle).
 *
 * Forme:
 *  - r (Dn source bit number), dest=Dn 32-bit: BCLR=10, BSET=8, BTST=6
 *  - r, dest=mem 8-bit:                        BCLR=10, BSET=8, BTST=4
 *  - s (imm bit number), dest=Dn 32-bit:       BCLR=14, BSET=12, BTST=10
 *  - s, dest=mem 8-bit:                        BCLR=12, BSET=12, BTST=8
 * Si aggiunge `eaCycles[ea].b_w` per dest mem.
 */
export const CYC_BCLR_R_D = as_u32(10);
export const CYC_BCLR_R_M = as_u32(10);
export const CYC_BCLR_S_D = as_u32(14);
export const CYC_BCLR_S_M = as_u32(12);
export const CYC_BSET_R_D = as_u32(8);
export const CYC_BSET_R_M = as_u32(8);
export const CYC_BSET_S_D = as_u32(12);
export const CYC_BSET_S_M = as_u32(12);
export const CYC_BTST_R_D = as_u32(6);
export const CYC_BTST_R_M = as_u32(4);
export const CYC_BTST_S_D = as_u32(10);
export const CYC_BTST_S_M = as_u32(8);

// ─── ALU "er" (effective addr → register): ADD/SUB/AND/OR/EOR/CMP ─────────

/**
 * Base cycles per "ALU er" verso Dn, da `m68k_in.c` 010:
 *  - 8/16 bit: 4
 *  - 32 bit: 6 (richiede 2 word fetch, anche con Dn src)
 * Aggiungere `eaCycles[srcEa]`.
 */
export const CYC_ALU_ER_BW = as_u32(4);
export const CYC_ALU_ER_L = as_u32(6);

/** ALU "re" (register → memory): più costoso, base 8/8/12 + eaCycles. */
export const CYC_ALU_RE_BW = as_u32(8);
export const CYC_ALU_RE_L = as_u32(12);

/** ADDA/SUBA verso An. 16-bit src costa 8 (sign-extend penalty), 32-bit = 6. */
export const CYC_ADDA_SUBA_W = as_u32(8);
export const CYC_ADDA_SUBA_L = as_u32(6);

/** ADDQ/SUBQ a registro: 4 b/w/imm Dn, 8 long Dn (più 8 ad An b/w extension). */
export const CYC_ADDQ_SUBQ_D_BW = as_u32(4);
export const CYC_ADDQ_SUBQ_D_L = as_u32(8);
export const CYC_ADDQ_SUBQ_A = as_u32(8);

/** CMP a Dn 8/16 = 4, 32 = 6 (più eaCycles). */
export const CYC_CMP_D_BW = as_u32(4);
export const CYC_CMP_D_L = as_u32(6);
/** CMPA, CMPI a register (Dn dest): 8 base. */
export const CYC_CMPA = as_u32(6);
export const CYC_CMPI_D = as_u32(8);

/** TST register Dn = 4 (b/w/l); a memoria = 4 + eaCycles. */
export const CYC_TST_D = as_u32(4);
export const CYC_TST_MEM = as_u32(4);

/** CLR Dn = 4 (B/W), 6 (L); a memoria 4/4/6 + eaCycles (010 errata fix). */
export const CYC_CLR_D_BW = as_u32(4);
export const CYC_CLR_D_L = as_u32(6);
export const CYC_CLR_MEM_BW = as_u32(4);
export const CYC_CLR_MEM_L = as_u32(6);

// ─── Helper: estimate cycles for a single instruction kind ────────────────

/**
 * Discriminated union delle "instruction shape" coperte dall'helper.
 * Volutamente NON cover ogni opcode — solo i casi che dominano i body del
 * main loop (cfr. nota in apertura).
 */
export type InstrEstimate =
  | { kind: "nop" }
  | { kind: "rts" }
  | { kind: "rte" }
  | { kind: "link_w" }
  | { kind: "unlk" }
  | { kind: "swap" }
  | { kind: "ext_w" }
  | { kind: "ext_l" }
  | { kind: "moveq" }
  | { kind: "trap" }
  | { kind: "bra" }
  | { kind: "bsr" }
  | {
      kind: "bcc";
      /** `true` se il branch è preso. */
      taken: boolean;
      /** Displacement size: byte o word. */
      displacement: "b" | "w";
    }
  | {
      kind: "dbcc";
      /** Cond true (no decr): solo base. False: base + decrement (loop). Expire: condizione false ma counter==-1 dopo decr. */
      outcome: "cond_true" | "cond_false_loop" | "cond_false_expire";
    }
  | { kind: "jsr"; ea: EaMode }
  | { kind: "jmp"; ea: EaMode }
  | { kind: "lea"; ea: EaMode }
  | { kind: "pea"; ea: EaMode }
  | {
      kind: "movem";
      /** Direzione del trasferimento. */
      dir: "reg_to_mem" | "mem_to_reg";
      size: "w" | "l";
      /** EA del banco di memoria. */
      ea: EaMode;
      /** Numero di registri nella mask. */
      regCount: number;
    }
  | {
      kind: "move";
      size: "b" | "w" | "l";
      srcEa: EaMode;
      dstEa: EaMode;
    }
  | { kind: "muls_w"; srcEa: EaMode }
  | { kind: "mulu_w"; srcEa: EaMode }
  | { kind: "divs_w"; srcEa: EaMode }
  | { kind: "divu_w"; srcEa: EaMode }
  | {
      kind: "bclr" | "bset" | "btst";
      /** "r": bit number da Dn. "s": bit number immediato. */
      form: "r" | "s";
      /** Dest Dn (long bit) o memoria (byte). */
      dst: "d" | "m";
      /** Solo se dst=m. */
      ea?: EaMode;
    }
  | {
      kind: "alu_er";
      size: "b" | "w" | "l";
      srcEa: EaMode;
    }
  | {
      kind: "alu_re";
      size: "b" | "w" | "l";
      dstEa: EaMode;
    }
  | { kind: "adda_suba"; size: "w" | "l"; srcEa: EaMode }
  | {
      kind: "addq_subq";
      size: "b" | "w" | "l";
      /** Dn, An, oppure mem (con EA). */
      dst: "d" | "a" | "m";
      ea?: EaMode;
    }
  | {
      kind: "cmp";
      size: "b" | "w" | "l";
      srcEa: EaMode;
    }
  | { kind: "cmpa"; size: "w" | "l"; srcEa: EaMode }
  | { kind: "cmpi"; size: "b" | "w" | "l"; dstEa: EaMode }
  | {
      kind: "tst";
      size: "b" | "w" | "l";
      ea: EaMode;
    }
  | {
      kind: "clr";
      size: "b" | "w" | "l";
      ea: EaMode;
    };

/** Picks `b_w` vs `l` from a {b_w,l} pair given size. */
function bwOrL<T>(pair: { b_w: T; l: T }, size: "b" | "w" | "l"): T {
  return size === "l" ? pair.l : pair.b_w;
}

/**
 * Stima cicli per una singola istruzione.
 *
 * Ritorna sempre `u32 ≥ 0`. Per istruzioni non coperte, lancia (fail loud).
 */
export function estimateCycles(instr: InstrEstimate): u32 {
  switch (instr.kind) {
    case "nop":
      return CYC_NOP;
    case "rts":
      return CYC_RTS;
    case "rte":
      return CYC_RTE;
    case "link_w":
      return CYC_LINK_W;
    case "unlk":
      return CYC_UNLK;
    case "swap":
      return CYC_SWAP;
    case "ext_w":
      return CYC_EXT_W;
    case "ext_l":
      return CYC_EXT_L;
    case "moveq":
      return CYC_MOVEQ;
    case "trap":
      return CYC_TRAP;
    case "bra":
      return CYC_BRA;
    case "bsr":
      return CYC_BSR;
    case "bcc": {
      if (instr.taken) return CYC_BCC_TAKEN;
      // Not taken: 10 base + delta (negative for byte, 0 for word). I delta
      // sono raw `number` (non branded), quindi sommiamo via `as_u32` puro.
      const delta =
        instr.displacement === "b"
          ? CYC_BCC_NOTAKE_B_DELTA
          : CYC_BCC_NOTAKE_W_DELTA;
      // CYC_BCC_TAKEN è u32; usiamo u32_add con `as_u32(delta)`. Per delta
      // negativo (-4) → as_u32 produce 0xFFFFFFFC, sommato a 10 e mascherato
      // u32 ridarà 6. È bit-perfect ma poco leggibile; preferisco branchless.
      if (delta === 0) return CYC_BCC_TAKEN;
      return as_u32(6); // 10 + (-4) per byte not-taken
    }
    case "dbcc": {
      // Base 12 = "cond false, decrement, branch". Per il cycle counting body:
      //   cond_false_loop  : 12  (iter normale)
      //   cond_false_expire: 12 + 6 = 18  (counter==-1)
      //   cond_true        : 12 + 0 = 12  (Musashi: cyc_dbcc_f_noexp=0)
      if (instr.outcome === "cond_false_expire") {
        return u32_add(CYC_DBCC_BASE, as_u32(CYC_DBCC_F_EXP_DELTA));
      }
      return CYC_DBCC_BASE;
    }
    case "jsr":
      return u32_add(CYC_JSR_BASE, jsrEaExtra[instr.ea]);
    case "jmp":
      return u32_add(CYC_JMP_BASE, jmpEaExtra[instr.ea]);
    case "lea":
      return leaEaExtra[instr.ea];
    case "pea":
      return u32_add(CYC_PEA_BASE, peaEaExtra[instr.ea]);
    case "movem": {
      const base =
        instr.dir === "reg_to_mem" ? CYC_MOVEM_RE_BASE : CYC_MOVEM_ER_BASE;
      const perReg =
        instr.size === "l" ? CYC_MOVEM_L_PER_REG : CYC_MOVEM_W_PER_REG;
      const eaExtra = movemEaExtra[instr.ea];
      const regs = u32_mul(perReg, as_u32(instr.regCount));
      return u32_add(u32_add(base, eaExtra), regs);
    }
    case "move": {
      const dst = bwOrL(moveDstBase[instr.dstEa], instr.size);
      const src = bwOrL(eaCycles[instr.srcEa], instr.size);
      return u32_add(dst, src);
    }
    case "muls_w":
      return u32_add(CYC_MULS_W, eaCycles[instr.srcEa].b_w);
    case "mulu_w":
      return u32_add(CYC_MULU_W, eaCycles[instr.srcEa].b_w);
    case "divs_w":
      return u32_add(CYC_DIVS_W, eaCycles[instr.srcEa].b_w);
    case "divu_w":
      return u32_add(CYC_DIVU_W, eaCycles[instr.srcEa].b_w);
    case "bclr":
    case "bset":
    case "btst": {
      const k = instr.kind;
      const isS = instr.form === "s";
      const isMem = instr.dst === "m";
      const base = (() => {
        if (k === "bclr") {
          return isS
            ? isMem
              ? CYC_BCLR_S_M
              : CYC_BCLR_S_D
            : isMem
              ? CYC_BCLR_R_M
              : CYC_BCLR_R_D;
        }
        if (k === "bset") {
          return isS
            ? isMem
              ? CYC_BSET_S_M
              : CYC_BSET_S_D
            : isMem
              ? CYC_BSET_R_M
              : CYC_BSET_R_D;
        }
        return isS
          ? isMem
            ? CYC_BTST_S_M
            : CYC_BTST_S_D
          : isMem
            ? CYC_BTST_R_M
            : CYC_BTST_R_D;
      })();
      if (!isMem) return base;
      if (!instr.ea) {
        throw new Error(`estimateCycles: ${k} mem form requires ea`);
      }
      return u32_add(base, eaCycles[instr.ea].b_w);
    }
    case "alu_er": {
      const base = instr.size === "l" ? CYC_ALU_ER_L : CYC_ALU_ER_BW;
      return u32_add(base, bwOrL(eaCycles[instr.srcEa], instr.size));
    }
    case "alu_re": {
      const base = instr.size === "l" ? CYC_ALU_RE_L : CYC_ALU_RE_BW;
      return u32_add(base, bwOrL(eaCycles[instr.dstEa], instr.size));
    }
    case "adda_suba": {
      const base =
        instr.size === "l" ? CYC_ADDA_SUBA_L : CYC_ADDA_SUBA_W;
      return u32_add(base, bwOrL(eaCycles[instr.srcEa], instr.size));
    }
    case "addq_subq": {
      if (instr.dst === "a") return CYC_ADDQ_SUBQ_A;
      if (instr.dst === "d") {
        return instr.size === "l" ? CYC_ADDQ_SUBQ_D_L : CYC_ADDQ_SUBQ_D_BW;
      }
      // memory
      if (!instr.ea) {
        throw new Error("estimateCycles: addq_subq mem dst requires ea");
      }
      // 8 b/w, 12 l + eaCycles (already includes write-back).
      const base = instr.size === "l" ? as_u32(12) : as_u32(8);
      return u32_add(base, bwOrL(eaCycles[instr.ea], instr.size));
    }
    case "cmp": {
      const base = instr.size === "l" ? CYC_CMP_D_L : CYC_CMP_D_BW;
      return u32_add(base, bwOrL(eaCycles[instr.srcEa], instr.size));
    }
    case "cmpa":
      return u32_add(CYC_CMPA, bwOrL(eaCycles[instr.srcEa], instr.size));
    case "cmpi": {
      // Forma immediate src; aggiunge imm fetch (già in eaCycles[Imm]).
      const baseDst = instr.dstEa === "Dn" ? CYC_CMPI_D : as_u32(8);
      const dstExtra =
        instr.dstEa === "Dn"
          ? as_u32(0)
          : bwOrL(eaCycles[instr.dstEa], instr.size);
      const immFetch = bwOrL(eaCycles.Imm, instr.size);
      return u32_add(u32_add(baseDst, dstExtra), immFetch);
    }
    case "tst": {
      if (instr.ea === "Dn") return CYC_TST_D;
      return u32_add(CYC_TST_MEM, bwOrL(eaCycles[instr.ea], instr.size));
    }
    case "clr": {
      if (instr.ea === "Dn") {
        return instr.size === "l" ? CYC_CLR_D_L : CYC_CLR_D_BW;
      }
      const base = instr.size === "l" ? CYC_CLR_MEM_L : CYC_CLR_MEM_BW;
      return u32_add(base, bwOrL(eaCycles[instr.ea], instr.size));
    }
  }
}
