/**
 * helper-1c88.ts — replica `FUN_00001C88` (34 istruzioni, 10 caller).
 *
 * **Semantica**: routine di inizializzazione RAM chiamata ad ogni transizione
 * di modo. In ordine:
 *
 *   1. Azzera tutta l'Alpha RAM (0xA03000-0xA03FFE, 2048 word = 4096 byte):
 *        loop: a0 = 0xA03000; while a0 <= 0xA03FFE: *a0 = 0; a0 += 2
 *
 *   2. Riempie tutta la Playfield RAM (0xA00000-0xA01FFE, 4096 word = 8192 byte)
 *      con un valore dipendente dal flag vblank:
 *        if mem16[0x400016] != 0 → fillWord = 0
 *        else                    → fillWord = s16(ROM16[0x10060])
 *        loop: a0 = 0xA00000; while a0 <= 0xA01FFE: *a0 = fillWord; a0 += 2
 *
 *   3. Azzera la word a 0xA02000 (primo slot sprite RAM).
 *   4. Azzera la word a 0xA02180 (sprite RAM bank-3 slot-0).
 *   5. Azzera la word a 0xB00400 (palette RAM entry 0x200).
 *   6. Scrive 0 al MMIO 0x860000 (AV-control; segnalato via `subs.onAvControl`).
 *
 * **Disasm** (0x1C88-0x1CE8, 34 istruzioni):
 *
 *   1C88  move.l   D2,-(A7)
 *   1C8A  movea.l  #$A03000,A0
 *   1C90  exg.l    D2,A0            ; D2 = ptr, A0 = old-D2
 *   1C92  cmpi.l   #$A03FFE,D2
 *   1C98  exg.l    D2,A0            ; restore
 *   1C9A  bhi.b    $1CA0            ; if ptr > $A03FFE → exit loop
 *   1C9C  clr.w    (A0)+
 *   1C9E  bra.b    $1C90
 *
 *   1CA0  movea.l  #$A00000,A0
 *   1CA6  exg.l    D2,A0
 *   1CA8  cmpi.l   #$A01FFE,D2
 *   1CAE  exg.l    D2,A0
 *   1CB0  bhi.b    $1CCA
 *   1CB2  tst.w    $400016.l
 *   1CB8  bne.b    $1CC4
 *   1CBA  move.w   $10060.l,D0
 *   1CC0  ext.l    D0
 *   1CC2  bra.b    $1CC6
 *   1CC4  moveq    #$0,D0
 *   1CC6  move.w   D0,(A0)+
 *   1CC8  bra.b    $1CA6
 *
 *   1CCA  movea.l  #$A02000,A0
 *   1CD0  clr.w    (A0)
 *   1CD2  movea.l  #$A02180,A0
 *   1CD8  clr.w    (A0)
 *   1CDA  clr.w    $860000.l
 *   1CE0  clr.w    $B00400.l
 *   1CE6  move.l   (A7)+,D2
 *   1CE8  rts
 *
 * **Caller** (10):
 *   0x1022, 0x1268, 0x1384, 0x14BC, 0x161A, 0x1EF2, 0x2182, 0x222E, 0x3B30
 *   (+ 0x1122 per un totale di 10 JSR $1C88)
 *
 * **Convezione**: nessun argomento, nessun valore di ritorno (void).
 *   D2 è callee-saved. D0, A0 sono scratch.
 *
 * **Nota ROM**: `ROM16[0x10060] = 0x0000` nella ROM marble corrente, quindi
 *   `fillWord` è sempre 0. Il codice replica fedelmente la logica per parità
 *   bit-perfect indipendentemente dal contenuto ROM.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── Costanti ────────────────────────────────────────────────────────────────

/** Indirizzo di `FUN_00001C88` nell'address space M68k. */
export const HELPER_1C88_ADDR = 0x00001c88 as const;

/** Offset ROM del word letto come fill value per la Playfield RAM. */
const ROM_FILL_WORD_OFF = 0x10060 as const;

/** Offset in workRam del flag vblank (word a 0x400016). */
const VBLANK_FLAG_OFF      = 0x16 as const;        // word @ workRam[0x16..0x17]

/** Sprite RAM: offset dei due slot azzerati. */
const SPRITE_OFF_0000      = 0x0000 as const;      // 0xA02000
const SPRITE_OFF_0180      = 0x0180 as const;      // 0xA02180

/** Palette RAM: offset dell'entry azzerata (0xB00400 - 0xB00000 = 0x400). */
const COLOR_OFF_0400       = 0x0400 as const;      // 0xB00400

// ─── Sub-callback interface ───────────────────────────────────────────────────

/** Hook opzionale per la scrittura MMIO 0x860000 (AV-control). */
export interface Helper1C88Subs {
  /**
   * Chiamato quando il binario esegue `clr.w $860000.l` (AV-control reset).
   * Non riflesso in nessuna RAM region (MMIO puro).
   * Default: no-op.
   */
  onAvControl?: (state: GameState) => void;
}

// ─── Helper interni ───────────────────────────────────────────────────────────

/** Legge un unsigned 16-bit BE dal programma ROM. */
function romR16(rom: RomImage, off: number): number {
  const o = off | 0;
  return (((rom.program[o] ?? 0) & 0xff) << 8) | ((rom.program[o + 1] ?? 0) & 0xff);
}

/** Sign-estende un valore a 16 bit. */
function s16(v: number): number {
  const w = v & 0xffff;
  return w & 0x8000 ? w - 0x10000 : w;
}

/** Legge un unsigned 16-bit BE da workRam all'offset indicato. */
function wrR16(state: GameState, off: number): number {
  const o = off | 0;
  return (((state.workRam[o] ?? 0) & 0xff) << 8) | ((state.workRam[o + 1] ?? 0) & 0xff);
}

/** Scrive un unsigned 16-bit BE in alphaRam all'offset indicato. */
function alphaW16(state: GameState, off: number, v: number): void {
  const w = v & 0xffff;
  state.alphaRam[off]     = (w >>> 8) & 0xff;
  state.alphaRam[off + 1] = w & 0xff;
}

/** Scrive un unsigned 16-bit BE in playfieldRam all'offset indicato. */
function pfW16(state: GameState, off: number, v: number): void {
  const w = v & 0xffff;
  state.playfieldRam[off]     = (w >>> 8) & 0xff;
  state.playfieldRam[off + 1] = w & 0xff;
}

/** Scrive un unsigned 16-bit BE in spriteRam all'offset indicato. */
function spW16(state: GameState, off: number, v: number): void {
  const w = v & 0xffff;
  state.spriteRam[off]     = (w >>> 8) & 0xff;
  state.spriteRam[off + 1] = w & 0xff;
}

/** Scrive un unsigned 16-bit BE in colorRam all'offset indicato. */
function colW16(state: GameState, off: number, v: number): void {
  const w = v & 0xffff;
  state.colorRam[off]     = (w >>> 8) & 0xff;
  state.colorRam[off + 1] = w & 0xff;
}

// ─── Funzione principale ──────────────────────────────────────────────────────

/**
 * Replica `FUN_00001C88`.
 *
 * Inizializza le regioni RAM hardware per una nuova modalità di gioco:
 * cancella Alpha RAM, riempie Playfield RAM con un valore ROM-dipendente,
 * azzera due slot sprite e un'entry palette.
 *
 * @param state  GameState — alpha/playfield/sprite/colorRam vengono modificate.
 * @param rom    ROM image — letto per il fill word @ 0x10060. Accettato come
 *               `undefined` per compatibilità con caller che non hanno il ROM
 *               caricato (valore fallback 0x0000).
 * @param subs   Hook opzionali (MMIO write AV-control).
 */
export function helper1C88(
  state: GameState,
  rom: RomImage | undefined,
  subs?: Helper1C88Subs,
): void {
  // ── Loop 1: azzera Alpha RAM 0xA03000..0xA03FFE (2048 word, 4096 byte) ─────
  // exg-trick: a0 funge sia da puntatore corrente sia da comparato.
  // La condizione è checked PRIMA di clr.w, quindi:
  //   - se a0 > 0xA03FFE → esci (primo controllo con a0=0xA03000 non esce)
  //   - clr.w (a0)+; loop
  // In TS: offset in alphaRam = (M68kAddr - 0xA03000)
  for (let off = 0; off + 1 < state.alphaRam.length && off <= 0x0ffe; off += 2) {
    alphaW16(state, off, 0);
  }

  // ── Loop 2: riempie Playfield RAM 0xA00000..0xA01FFE (4096 word, 8192 byte) ─
  // Fill word: se workRam16[0x16] != 0 → 0, altrimenti s16(ROM16[0x10060]).
  // N.B. ext.l d0 sign-estende ma poi move.w scrive solo il word basso → s16.
  const vblankFlag = wrR16(state, VBLANK_FLAG_OFF);
  const romFillRaw = (rom !== undefined) ? romR16(rom, ROM_FILL_WORD_OFF) : 0;
  const fillWord   = (vblankFlag !== 0) ? 0 : (s16(romFillRaw) & 0xffff);

  for (let off = 0; off + 1 < state.playfieldRam.length && off <= 0x1ffe; off += 2) {
    pfW16(state, off, fillWord);
  }

  // ── Epilog: azzera slot sprite e palette ─────────────────────────────────
  // clr.w (0xA02000) → spriteRam[0x000]
  spW16(state, SPRITE_OFF_0000, 0);
  // clr.w (0xA02180) → spriteRam[0x180]
  spW16(state, SPRITE_OFF_0180, 0);
  // clr.w $860000.l → MMIO AV-control (no-op in RAM; notificato via hook)
  (subs?.onAvControl ?? ((_s) => {}))(state);
  // clr.w $B00400.l → colorRam[0x400]
  colW16(state, COLOR_OFF_0400, 0);
}
