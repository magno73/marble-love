/**
 * state-sub-5250.ts — replica `FUN_00005250` (12 byte, 0x5250–0x525B).
 *
 * Primitive di OR bitmask su entrambe le bitmap di status flags in work RAM.
 * Sequenza esatta delle due istruzioni:
 *
 * **Disasm 0x5250..0x525B** (12 byte):
 *
 *   0x5250  or.l  D1,(0x00401F5E).l   ; *0x401F5E |= D1  (primary flags,  long-BE)
 *   0x5256  or.l  D1,(0x00401F76).l   ; *0x401F76 |= D1  (secondary flags, long-BE)
 *   0x525C  rts
 *
 * `or.l Dn,(abs).l` = 2-byte opcode + 4-byte absolute address = 6 byte per
 * istruzione. Due istruzioni = 12 byte + rts = 14 byte se si include l'rts a
 * 0x525C; ma l'rts a 0x525C è il primo byte di `FUN_0000525C` secondo i range
 * Ghidra (0x525C–0x5283). In M68k il `rts` è sempre l'ultima istruzione della
 * funzione corrente — il byte 0x525C appartiene all'inizio della funzione
 * successiva ma il compilatore non emette un `rts` duplicato; lo share di
 * indirizzo è consentito quando FUN_525C inizia con il medesimo opcode `rts`.
 * Ghidra delimita FUN_5250 a 12 byte escludendo il `rts` condiviso: i 12 byte
 * contengono solo i due `or.l`.
 *
 * **NOTA sul rts condiviso**: il range 0x5250–0x525B (12 byte) è corretto perché
 * 0x525C è il rts che chiude sia FUN_5250 (fall-through) che è la prima istruzione
 * di FUN_525C secondo l'encoding di Ghidra. La replica TS emette l'effetto delle
 * due `or.l` e ritorna (il `rts` è implicito nel return TS).
 *
 * **Xrefs (callers)**:
 *   - 0x50C6 in FUN_00004F38 (UNCONDITIONAL_CALL)
 *   - 0x51F8 in FUN_00004F38 (UNCONDITIONAL_CALL)
 *
 * **Convenzione caller**: D1 è un long bitmask settato dal caller prima del jsr.
 * I due OR sono idempotenti su bit già settati — il caller usa questa sub ogni
 * volta che vuole marcare un set di flag sia nel primary che nel secondary long.
 *
 * **Side effects** (workRam, entrambi gli OR sono sempre eseguiti):
 *   - workRam[0x1F5E..0x1F61] (long-BE) |= d1
 *   - workRam[0x1F76..0x1F79] (long-BE) |= d1
 *
 * **Relazione con moduli adiacenti**:
 *   - `FUN_005248` (predecessor immediato): `or.l D1,(0x401F5E).l; rts` — OR solo
 *     primary flags. FUN_5250 aggiunge l'OR anche su secondary, coprendo entrambe
 *     le bitmap controllate da `FUN_52A2` (cfr `state-sub-5284.ts`).
 *   - `FUN_0000525C` (successor): usa `fun523A` per settare bit individuali nel
 *     primary flags; non tocca secondary direttamente.
 *
 * Verifica bit-perfect via `packages/cli/src/test-state-sub-5250-parity.ts`.
 */

import type { GameState } from "./state.js";

// ─── Costanti ────────────────────────────────────────────────────────────────

/** Offset workRam del long-BE "primary status flags" @ 0x401F5E. */
export const PRIMARY_FLAGS_OFF = 0x1f5e as const;

/** Offset workRam del long-BE "secondary status flags" @ 0x401F76. */
export const SECONDARY_FLAGS_OFF = 0x1f76 as const;

/** Indirizzo assoluto M68k del primary flags long. */
export const PRIMARY_FLAGS_ADDR = 0x00401f5e as const;

/** Indirizzo assoluto M68k del secondary flags long. */
export const SECONDARY_FLAGS_ADDR = 0x00401f76 as const;

// ─── Helper ──────────────────────────────────────────────────────────────────

/**
 * OR cumulativo di una maschera 32-bit su un long-BE in workRam a `off`.
 *
 * Implementa `or.l Dn,(abs).l` per un offset workRam dato.
 */
function orLongBE(r: Uint8Array, off: number, mask: number): void {
  const m = mask >>> 0;
  if (m === 0) return; // OR con 0 = no-op; evita write inutile.
  const cur =
    (((r[off] ?? 0) << 24) |
      ((r[off + 1] ?? 0) << 16) |
      ((r[off + 2] ?? 0) << 8) |
      (r[off + 3] ?? 0)) >>>
    0;
  const next = (cur | m) >>> 0;
  r[off]     = (next >>> 24) & 0xff;
  r[off + 1] = (next >>> 16) & 0xff;
  r[off + 2] = (next >>> 8)  & 0xff;
  r[off + 3] =  next         & 0xff;
}

// ─── Replica ─────────────────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00005250` — OR bitmask su primary + secondary flags.
 *
 * Esegue nella sequenza esatta del binario:
 *   1. `or.l D1,(0x401F5E).l`  — primary flags
 *   2. `or.l D1,(0x401F76).l`  — secondary flags
 *
 * @param state  GameState. workRam mutata in due posizioni:
 *               `[0x1F5E..0x1F61]` e `[0x1F76..0x1F79]`.
 * @param d1     Bitmask long (unsigned 32-bit). Stessa maschera applicata a
 *               entrambi i long-BE. Il caller la prepara in D1 prima del jsr.
 *               Valore 0 = no-op (OR con 0).
 *
 * @returns void. Side effects elencati sopra.
 *
 * **Bit-perfect notes**:
 *   - Entrambi gli OR sono **sempre** eseguiti (nessun branch).
 *   - Ordine fisso: primary PRIMA, secondary DOPO (replica sequenza esatta del
 *     binario; in pratica i due long sono indipendenti e l'ordine non è
 *     osservabile dall'esterno, ma la replica è fedele per completezza).
 *   - Il long-BE è letto a 32 bit, OR-ato, riscritto a 32 bit big-endian in
 *     quattro byte separati (la workRam è `Uint8Array`, non big-endian nativa).
 */
export function stateSub5250(state: GameState, d1: number): void {
  const r = state.workRam;
  const mask = d1 >>> 0;

  // 0x5250: or.l D1,(0x00401F5E).l — primary status flags.
  orLongBE(r, PRIMARY_FLAGS_OFF, mask);

  // 0x5256: or.l D1,(0x00401F76).l — secondary status flags.
  orLongBE(r, SECONDARY_FLAGS_OFF, mask);
}
