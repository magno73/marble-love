/**
 * mo-screen-init-1a286.ts — replica `FUN_0001A286` (408 byte).
 *
 * Helper di "screen-init / motion-object table init" chiamato come parte
 * della sequenza di entrata in un livello (subito dopo che il caller ha
 * preparato eventuali state sub-initializers). La funzione:
 *
 *   1. Salva A2 e carica `A2 = 0x401FF8` (puntatore a un long volatile in
 *      work RAM, tipicamente un counter aggiornato dall'ISR VBLANK).
 *   2. Wait-loop iniziale: `btst.b #0, (0xF60001).l ; beq.b $-2`. Resta
 *      bloccato finché il bit 0 di `*0xF60001` (switch port) non è 1.
 *      Modello: side-effect MMIO esterno; nel reimpl puro è un no-op (il
 *      caller TS non ha bisogno del wait — il binario lo usa solo per
 *      sincronizzarsi col video chip).
 *   3. `clr.l -(SP); jsr 0x28C7E.l` → `clearAlphaTilesFromIndex(0)`.
 *   4. `jsr 0x1A41E.l` → `paletteInitLevel(rom)`.
 *   5. `pea #0x2000; pea #0x22A9E; jsr 0x142.l` →
 *      `renderString(strPtr=0x22A9E, slot=0x2000)`. (`0x142` è una `JMP.L`
 *      trampoline → FUN_2572.)
 *   6. Stessa cosa con `strPtr=0x22906`.
 *   7. Cleanup stack (`lea (0x14,SP), SP` = pop 5 long).
 *   8. Carica `A1 = *0x000001D8` (= 0x00400008) e `A0 = *0x000001DC`
 *      (= 0x0040000A). Scrive `*A0 = 0`, `*A1 = 0` (entrambi word). Nel
 *      binario originale le due sono "interrupt-write pointer" usati dall'ISR
 *      per arming/clearing flags.
 *   9. Wait loop centrale: `cmp.l (A2),D0 ; beq.b $-2`. Aspetta che
 *      `*0x401FF8` cambi (frame-counter). No-op nel reimpl.
 *  10. `clr.w (0x860000).l` → AV-control reset (no-op nel reimpl, MMIO).
 *  11. **8 iterazioni** di 4 word writes ciascuna in motion-object RAM
 *      (sprite-RAM 0xA02000+):
 *
 *        bank A (0xA02000 + i*2): sempre 0x1401
 *        bank B (0xA02080 + i*2): 0x0001 + i*0x0800
 *        bank C (0xA02100 + i*2): 0x0400 + i*0x0200    (i*0x0200 + 0x0400)
 *        bank D (0xA02180 + i*2): i+1 (per i=0..6), MA per i=7 anche 7
 *                                 (LAST entry 0xA0218e = 0x0007 NON 0x0008)
 *
 *      Le 32 word writes coprono le entry 0..7 (8 oggetti) di ognuno dei
 *      4 banchi 0/1/2/3 della MO RAM (banks 0..3 sono i registri header).
 *
 *  12. **4 word writes** in playfield RAM (0xA00A20/A28/A30/A38):
 *
 *        pfRam[0xA20] = 0x0010
 *        pfRam[0xA28] = 0x1010
 *        pfRam[0xA30] = 0x2010
 *        pfRam[0xA38] = 0x3010
 *
 *      Layout: 0x0010 + i*0x1000 per i=0..3, ad offset 0xA20 + i*8.
 *
 *  13. Wait-loop finale: `btst.b #0, (0xF60001).l ; beq end ; cmp/bne loop`.
 *      Aspetta `*0xF60001 bit 0 == 0` (release switch) o un cambio di A2.
 *      No-op nel reimpl.
 *  14. `movea.l (SP)+, A2 ; rts`.
 *
 * **Side effect bit-perfect** (escluse le 5 sub-jsr e gli MMIO):
 *
 *   workRam[0x08..0x09] = 0x0000              (BE word @ *0x1D8 dst)
 *   workRam[0x0A..0x0B] = 0x0000              (BE word @ *0x1DC dst)
 *
 *   spriteRam[0x000..0x00F] step 2: 0x1401 × 8                (bank A)
 *   spriteRam[0x080..0x08F] step 2: 0x0001+i*0x0800 (i=0..7)  (bank B)
 *   spriteRam[0x100..0x10F] step 2: 0x0400+i*0x0200 (i=0..7)  (bank C)
 *   spriteRam[0x180..0x18F] step 2: 1,2,3,4,5,6,7,7           (bank D)
 *
 *   pfRam[0xA20], [0xA28], [0xA30], [0xA38]: 0x0010+i*0x1000 (i=0..3)
 *
 * Le 5 sub-jsr (`clearAlphaTiles`, `paletteInitLevel`, `renderString` x2)
 * sono modellate come callback iniettabili (default no-op).
 *
 * **Caller**: la funzione ha 1 xref nota (parte del path "level enter").
 * Il binario fa multi-spin-wait su MMIO/IRQ counter — l'TS non riproduce
 * la sincronizzazione, solo il side-effect su RAM/sprite/PF.
 *
 * Verifica bit-perfect via `cli/src/test-mo-screen-init-1a286-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

/** Offset workRam del primo "interrupt-write pointer" target (= *0x1D8). */
const ISR_WRITE_DST_A_OFF = 0x08 as const;
/** Offset workRam del secondo target (= *0x1DC). */
const ISR_WRITE_DST_B_OFF = 0x0a as const;

/** Numero di entry (oggetti) inizializzate in MO RAM (banks 0..3). */
const MO_ENTRY_COUNT = 8 as const;

/** Offsets dei 4 banchi MO (sprite RAM relativi a 0xA02000). */
const MO_BANK_A_OFF = 0x000 as const; // header word 0 — sempre 0x1401
const MO_BANK_B_OFF = 0x080 as const; // header word 1 — index/flag
const MO_BANK_C_OFF = 0x100 as const; // header word 2 — counter (× 0x200)
const MO_BANK_D_OFF = 0x180 as const; // header word 3 — small index

/** Base offset (in pfRam[]) dei 4 PF register writes. */
const PF_REG_BASE_OFF = 0xa20 as const;

/**
 * Callback bag per le 5 sub-jsr (FUN_28C7E, FUN_1A41E, FUN_142 ×2 con
 * arg diverso). Default: no-op. Chiamate nell'ordine binary:
 *   clearAlphaTiles → paletteInitLevel → renderString(0x22A9E)
 *                                       → renderString(0x22906)
 */
export interface MoScreenInit1A286Subs {
  /** FUN_28C7E: clearAlphaTilesFromIndex(0). */
  clearAlphaTiles?: (state: GameState) => void;
  /** FUN_1A41E: paletteInitLevel(rom) — copia 192 word in palette RAM. */
  paletteInitLevel?: (state: GameState, rom: RomImage) => void;
  /**
   * FUN_142 (= JMP.L FUN_2572): renderString(strPtr, slot).
   * Chiamata 2 volte con (slot=0x2000, strPtr ∈ {0x22A9E, 0x22906}).
   */
  renderString?: (state: GameState, strPtr: number, slot: number) => void;
}

/** Scrive una word big-endian in `dst` a offset. */
function writeWordBE(dst: Uint8Array, off: number, word: number): void {
  dst[off] = (word >>> 8) & 0xff;
  dst[off + 1] = word & 0xff;
}

/**
 * Replica `FUN_0001A286` — motion-object/text screen init helper.
 *
 * Zero argomenti M68K, zero return. Side effects bit-perfect su:
 *   - `state.workRam[0x08..0x0B]` (2 word a 0)
 *   - `state.spriteRam[0..0x18F]` (32 word, 4 banchi × 8 entry)
 *   - `pfRam[0xA20..0xA39]`       (4 word PF register init)
 *   - tutto ciò che le sub-callback scrivono.
 *
 * @param state GameState. Mutato in-place.
 * @param rom   ROM image (passata a paletteInitLevel).
 * @param pfRam Buffer playfield RAM (size ≥ 0x2000), indicizzato da 0=0xA00000.
 *              Se null/undefined, le 4 PF writes sono saltate (no-op).
 * @param subs  Callback bag per le 5 sub-jsr. Default: tutte no-op.
 */
export function moScreenInit1A286(
  state: GameState,
  rom: RomImage,
  pfRam: Uint8Array | null = null,
  subs: MoScreenInit1A286Subs = {},
): void {
  // 0x1A28E..0x1A296: spin-wait su *0xF60001 bit 0 — modellato no-op (MMIO).

  // 0x1A298..0x1A29A: clr.l -(SP) ; jsr 0x28C7E.l
  subs.clearAlphaTiles?.(state);

  // 0x1A2A0: jsr 0x1A41E.l → paletteInitLevel(rom)
  subs.paletteInitLevel?.(state, rom);

  // 0x1A2A6..0x1A2B0: pea #0x2000 ; pea #0x22A9E ; jsr 0x142.l
  // → renderString(strPtr=0x22A9E, slot=0x2000)
  subs.renderString?.(state, 0x22a9e, 0x2000);

  // 0x1A2B6..0x1A2C0: pea #0x2000 ; pea #0x22906 ; jsr 0x142.l
  // → renderString(strPtr=0x22906, slot=0x2000)
  subs.renderString?.(state, 0x22906, 0x2000);

  // 0x1A2C6..0x1A2D6: A1 = *0x1D8 (= 0x400008), A0 = *0x1DC (= 0x40000A)
  // D0 = 0; *A0 = D0w ; *A1 = D0w (entrambe word).
  writeWordBE(state.workRam, ISR_WRITE_DST_A_OFF, 0x0000);
  writeWordBE(state.workRam, ISR_WRITE_DST_B_OFF, 0x0000);

  // 0x1A2D8..0x1A2E0: lea cleanup + spin-wait su *A2 — no-op (MMIO).

  // 0x1A2E2: clr.w (0x860000).l — AV control = 0 (MMIO write, no-op).

  // 0x1A2E8..0x1A3E0: 8 iterazioni × 4 word writes (32 totali) in MO RAM.
  for (let i = 0; i < MO_ENTRY_COUNT; i++) {
    const o = i * 2;
    // Bank C (0xA02100 + i*2): 0x0400 + i*0x0200
    writeWordBE(state.spriteRam, MO_BANK_C_OFF + o, (0x0400 + i * 0x0200) & 0xffff);
    // Bank A (0xA02000 + i*2): sempre 0x1401
    writeWordBE(state.spriteRam, MO_BANK_A_OFF + o, 0x1401);
    // Bank B (0xA02080 + i*2): 0x0001 + i*0x0800
    writeWordBE(state.spriteRam, MO_BANK_B_OFF + o, (0x0001 + i * 0x0800) & 0xffff);
    // Bank D (0xA02180 + i*2): i+1, ma l'ULTIMA entry (i=7) è 7, non 8.
    const bankDValue = i === 7 ? 7 : i + 1;
    writeWordBE(state.spriteRam, MO_BANK_D_OFF + o, bankDValue & 0xffff);
  }

  // 0x1A3E8..0x1A406: 4 word writes in PF RAM @ 0xA00A20/A28/A30/A38.
  if (pfRam !== null) {
    for (let i = 0; i < 4; i++) {
      writeWordBE(pfRam, PF_REG_BASE_OFF + i * 8, (0x0010 + i * 0x1000) & 0xffff);
    }
  }

  // 0x1A408..0x1A41C: spin-wait finale su *0xF60001 / *A2, no-op.
  // 0x1A41A: movea.l (SP)+, A2 ; rts → return.
}

// ─── Costanti esposte per i test di parità / cross-ref ────────────────────

/** Indirizzo entry-point del binario. */
export const MO_SCREEN_INIT_1A286_ADDR = 0x0001a286 as const;

/** Indirizzi delle 4 sub-jsr nell'ordine di chiamata (renderString è 2x). */
export const MO_SCREEN_INIT_1A286_SUB_ADDRS = [
  0x00028c7e, // clearAlphaTilesFromIndex(0)
  0x0001a41e, // paletteInitLevel
  0x00000142, // renderString trampoline (chiamato 2x con args diversi)
  0x00000142, // (idem; il bersaglio reale è FUN_2572 via JMP.L)
] as const;

/**
 * Indirizzo reale del trampoline 0x142 (vedi ROM[0x142] = `4EF9 0000 2572`).
 */
export const MO_SCREEN_INIT_1A286_RENDER_STRING_TARGET = 0x00002572 as const;

/** Indirizzi assoluti dei 2 globali word toccati (workRam). */
export const MO_SCREEN_INIT_1A286_ISR_DST_A_ADDR = 0x00400008 as const;
export const MO_SCREEN_INIT_1A286_ISR_DST_B_ADDR = 0x0040000a as const;

/**
 * Argomenti delle 2 chiamate `renderString` (slot, strPtr) nell'ordine binary.
 */
export const MO_SCREEN_INIT_1A286_RENDER_STRING_ARGS = [
  { strPtr: 0x00022a9e, slot: 0x00002000 },
  { strPtr: 0x00022906, slot: 0x00002000 },
] as const;

/** Numero di entry (oggetti) inizializzate per banco MO. */
export const MO_SCREEN_INIT_1A286_MO_ENTRY_COUNT = MO_ENTRY_COUNT;
