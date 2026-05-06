/**
 * state-sub-5608.ts — replica `FUN_00005608` (82 byte).
 *
 * Wrapper di livello "scena" che invoca tre callee back-to-back con argomenti
 * costanti derivati da:
 *   - una variabile gating letta da ROM @ `0x10072` (byte) → seleziona D2 ∈ {4,8}
 *   - due ROM-pointer literal (`0x7978`, `0x7980`) — probabili stringhe formato
 *     o tabelle dati statiche
 *   - due immediate (`0x1B`, `0x1C`) — probabili "row" / position id
 *   - un long letto da ROM @ `0x10074` — handle long propagato a FUN_5334
 *
 * **Disasm 0x5608..0x5658** (82 byte = 0x52):
 *
 *   0x5608  move.l D2,-(SP)                 ; preserve D2 (callee-saved)
 *   0x560A  tst.b  (0x00010072).l           ; test byte ROM @ 0x10072
 *   0x5610  beq.b  0x00005616                ; if byte == 0  → D0 = 8
 *   0x5612  moveq  #4,D0                    ; if byte != 0  → D0 = 4
 *   0x5614  bra.b  0x00005618
 *   0x5616  moveq  #8,D0
 *   0x5618  move.l D0,D2                    ; D2 = D0 (saved per fase 2/3)
 *   0x561A  pea    (0x7978).l               ; push 0x7978  → arg3 di FUN_52DA #1
 *   0x5620  pea    (0x1B).w                 ; push 0x1B   → arg2 di FUN_52DA #1
 *   0x5624  move.l D2,D0
 *   0x5626  addq.l #3,D0                    ; D0 = D2 + 3
 *   0x5628  move.l D0,-(SP)                 ; push D2+3   → arg1 di FUN_52DA #1
 *   0x562A  jsr    0x000052DA.l             ; FUN_52DA(D2+3, 0x1B, 0x7978)
 *   0x5630  move.l (0x00010074).l,-(SP)     ; push long ROM @ 0x10074 → argLong FUN_5334
 *   0x5636  jsr    0x00005334.l             ; FUN_5334(*ROM[0x10074])
 *   0x563C  pea    (0x7980).l               ; push 0x7980  → arg3 di FUN_52DA #2
 *   0x5642  pea    (0x1C).w                 ; push 0x1C   → arg2 di FUN_52DA #2
 *   0x5646  move.l D2,D0
 *   0x5648  addq.l #4,D0                    ; D0 = D2 + 4
 *   0x564A  move.l D0,-(SP)                 ; push D2+4   → arg1 di FUN_52DA #2
 *   0x564C  jsr    0x000052DA.l             ; FUN_52DA(D2+4, 0x1C, 0x7980)
 *   0x5652  lea    (0x1C,SP),SP             ; pop 28 byte (12 + 4 + 12 = 28 = 0x1C)
 *   0x5656  move.l (SP)+,D2                 ; restore D2
 *   0x5658  rts
 *
 * **ROM addresses** (immutabili a runtime):
 *   - `0x10072` : byte gating. Nella ROM marble corrente vale `0x00`, quindi
 *     in produzione il ramo selezionato è SEMPRE `D2 = 8`. Modelliamo comunque
 *     il branch per fedeltà.
 *   - `0x10074` : long BE = `0x00022EC6` nella ROM marble corrente (un pointer
 *     dentro la stessa ROM). Propagato come `argLong` a FUN_5334.
 *   - `0x7978`, `0x7980` : pointer literal a stringhe/tabelle in ROM (immediate
 *     `pea`, NON dereferenced qui — passati as-is).
 *
 * **Convenzione caller**:
 *   - Nessun argomento esplicito (no stack args, no register args attesi).
 *   - D2 preservato (prologue/epilogue).
 *   - Nessun valore di ritorno significativo (D0 contiene il D0 di FUN_52DA #2,
 *     ma il caller — visto in xref a 0x594C e 0x5B7A — non lo usa: `jsr` senza
 *     test successivo).
 *
 * **Side effects**:
 *   In QUESTO modulo: nessuno diretto. Tutti gli effetti reali (scritture in
 *   workRam, MMIO, dispatch a sub-system) sono dentro le 3 invocazioni dei
 *   callee:
 *     1. `FUN_52DA(D2+3, 0x1B, 0x7978)` — render-string-like #1
 *     2. `FUN_5334(*ROM[0x10074])`     — handle dispatch
 *     3. `FUN_52DA(D2+4, 0x1C, 0x7980)` — render-string-like #2
 *
 * Le 3 invocazioni sono iniettabili tramite `inner52DA` / `inner5334`. Default
 * = `() => 0` (no-op), permette test isolati. Il differential test usa il
 * binario originale su Musashi; questo modulo cattura le 3 invocazioni con
 * stub che registrano gli argomenti e li confronta con i valori sullo stack
 * del binario al momento del jsr.
 *
 * **Note di low-level fidelity**:
 *   - `tst.b` di un byte ROM è side-effect free (set CCR.Z, CCR.N).
 *   - `beq.b` branch su Z=1 (byte == 0).
 *   - `moveq #4,D0` e `moveq #8,D0` settano TUTTO D0 (sign-extended a long),
 *     non solo il low byte. 4 e 8 sono entrambi positivi → D0 = 0x00000004 o
 *     0x00000008. `move.l D0,D2` propaga il long completo.
 *   - `addq.l #3,D0` / `addq.l #4,D0`: long add, no flag check necessario.
 *   - `pea (0x7978).l` e `pea (0x7980).l`: push effective address come long.
 *     `pea (0x1B).w` e `pea (0x1C).w`: il `.w` è perché immediate fits in word
 *     ed è sign-extended a long (qui sempre positivo, equivalente a long).
 *   - `move.l (0x00010074).l,-(SP)`: read long BE da ROM, push as-is.
 *   - `lea (0x1C,SP),SP`: equivalente a `addq.l #0x1C,SP` (pop 28 byte di args).
 *
 * **Xrefs** (3 ref, 2 callsite):
 *   - `0x594C` in FUN_5688 — jsr 0x5608 (UNCONDITIONAL_CALL)
 *   - `0x5B7A` in FUN_5A5E — jsr 0x5608 (UNCONDITIONAL_CALL)
 *
 * Verifica bit-perfect via `packages/cli/src/test-state-sub-5608-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── ROM addresses ────────────────────────────────────────────────────────

/** Byte ROM @ 0x10072: se != 0 → D2 = 4, altrimenti D2 = 8. */
export const ROM_GATE_BYTE_ADDR = 0x00010072 as const;

/** Long BE ROM @ 0x10074: argLong propagato a FUN_5334. */
export const ROM_HANDLE_LONG_ADDR = 0x00010074 as const;

/** Pointer literal #1: arg3 della prima invocazione di FUN_52DA. */
export const PTR_LITERAL_1 = 0x00007978 as const;

/** Pointer literal #2: arg3 della seconda invocazione di FUN_52DA. */
export const PTR_LITERAL_2 = 0x00007980 as const;

/** Immediate row id #1: arg2 della prima invocazione di FUN_52DA. */
export const ROW_IMM_1 = 0x0000001b as const;

/** Immediate row id #2: arg2 della seconda invocazione di FUN_52DA. */
export const ROW_IMM_2 = 0x0000001c as const;

/** Bias additivo arg1 fase 1 (`addq.l #3,D0`). */
export const ARG1_BIAS_PHASE1 = 3 as const;

/** Bias additivo arg1 fase 3 (`addq.l #4,D0`). */
export const ARG1_BIAS_PHASE3 = 4 as const;

// ─── Tipi callback ─────────────────────────────────────────────────────────

/**
 * Signature di `FUN_000052DA` — riceve 3 long unsigned (callee vede gli args
 * sullo stack a `(0x4,SP)`, `(0x8,SP)`, `(0xC,SP)`).
 *   - `arg1` = D2+3 oppure D2+4 (small int, 7..12)
 *   - `arg2` = 0x1B oppure 0x1C (immediate)
 *   - `arg3` = pointer literal (0x7978 oppure 0x7980)
 *
 * Ritorna long; il valore in D0 è ignorato dal wrapper (l'epilogue di 0x5658
 * fa `move.l (SP)+,D2; rts` senza toccare D0, ma il caller non controlla D0).
 */
export type Sub5608Inner52DA = (
  arg1: number,
  arg2: number,
  arg3: number,
) => number;

/**
 * Signature di `FUN_00005334` — riceve 1 long unsigned `argLong`.
 *   - `argLong` = long BE letto da ROM @ 0x10074
 *
 * Ritorna long; ignorato dal wrapper.
 */
export type Sub5608Inner5334 = (argLong: number) => number;

// ─── Utility: read long BE from Uint8Array ─────────────────────────────────

/** Legge un long big-endian (4 byte) da `bytes` a offset `off` come unsigned32. */
function readLongBE(bytes: Uint8Array, off: number): number {
  return (
    (((bytes[off] ?? 0) << 24) |
      ((bytes[off + 1] ?? 0) << 16) |
      ((bytes[off + 2] ?? 0) << 8) |
      (bytes[off + 3] ?? 0)) >>>
    0
  );
}

// ─── Replica ───────────────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00005608` — wrapper a 3 callee con args costanti.
 *
 * @param state         GameState. Non modificato direttamente da questo wrapper
 *                      (gli effetti reali vivono dentro i callback `inner*`).
 * @param rom           RomImage. Letto a `0x10072` (byte) per il gate e a
 *                      `0x10074` (long BE) per `argLong` di FUN_5334.
 * @param inner52DA     Callback che modella `FUN_000052DA`. Invocato 2 volte
 *                      con `(D2+3, 0x1B, 0x7978)` e `(D2+4, 0x1C, 0x7980)`.
 *                      Default `() => 0`.
 * @param inner5334     Callback che modella `FUN_00005334`. Invocato 1 volta
 *                      con `(*ROM[0x10074])`. Default `() => 0`.
 *
 * @returns void. Il wrapper non ha valore di ritorno utile (i caller a 0x594C
 *          e 0x5B7A ignorano D0).
 *
 * Note di fedeltà:
 *   - L'ordine di invocazione è esattamente: 52DA #1 → 5334 → 52DA #2.
 *     Importante perché `inner5334` può modificare workRam (via la sua replica
 *     interna, che chiama un altro 52DA con byte globali workRam-letti). Se
 *     `inner52DA` #1 modifica workRam @ `0x401F98/99`, allora `inner5334`
 *     leggerà i nuovi valori. La replica TS preserva quest'ordine.
 *   - I valori `0x7978`, `0x7980`, `0x1B`, `0x1C` sono passati come unsigned32
 *     long; nessun sign-extend da fare (sono tutti positivi `<= 0x7FFFFFFF`).
 *   - Il byte gate viene letto in OGNI invocazione (non cached): se la ROM
 *     fosse mutata fra due chiamate (cosa che NON succede, ROM è read-only),
 *     il valore di D2 cambierebbe coerentemente.
 *   - Il long ROM @ 0x10074 è BE: nei 4 byte ROM[0x10074..0x10077] = MSB → LSB.
 */
export function stateSub5608(
  state: GameState,
  rom: RomImage,
  inner52DA: Sub5608Inner52DA = () => 0,
  inner5334: Sub5608Inner5334 = () => 0,
): void {
  // ─── tst.b (0x10072).l + beq → seleziona D2 ─────────────────────────────
  const gateByte = rom.program[ROM_GATE_BYTE_ADDR] ?? 0;
  // beq branch se byte == 0 → D0 = 8; altrimenti D0 = 4.
  const d2 = gateByte === 0 ? 8 : 4;

  // ─── Fase 1: FUN_52DA(D2+3, 0x1B, 0x7978) ───────────────────────────────
  // Push order RTL: 0x7978 (arg3), 0x1B (arg2), D2+3 (arg1).
  // Callee vede arg1=(0x4,SP), arg2=(0x8,SP), arg3=(0xC,SP).
  const phase1Arg1 = (d2 + ARG1_BIAS_PHASE1) >>> 0;
  inner52DA(phase1Arg1, ROW_IMM_1, PTR_LITERAL_1);
  // Nota: D2 NON è clobberato dal callee (FUN_52DA preserva D2 — vedi disasm
  // 0x52DE: `move.l D2,-(SP)` come prima istruzione del prologue).

  // ─── Fase 2: FUN_5334(*ROM[0x10074]) ─────────────────────────────────────
  const argLong5334 = readLongBE(rom.program, ROM_HANDLE_LONG_ADDR);
  inner5334(argLong5334);

  // ─── Fase 3: FUN_52DA(D2+4, 0x1C, 0x7980) ───────────────────────────────
  // D2 ancora valido (preservato da 52DA #1 e da 5334 — entrambi salvano D2).
  const phase3Arg1 = (d2 + ARG1_BIAS_PHASE3) >>> 0;
  inner52DA(phase3Arg1, ROW_IMM_2, PTR_LITERAL_2);

  // Epilogue: `lea (0x1C,SP),SP; move.l (SP)+,D2; rts`. Nessun ulteriore
  // effetto osservabile dal lato chiamante. Il param `state` non è mutato
  // direttamente; eventuali mutazioni si producono solo all'interno dei
  // callback `inner*`.
  void state; // referenced for API consistency / future expansion
}
