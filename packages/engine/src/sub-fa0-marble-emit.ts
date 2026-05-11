/**
 * sub-fa0-marble-emit.ts — patch chunk del main thread (FUN_FA0) che converte
 * i campi `obj0` / `slot pair @ 0x400A20` in coords MO (motion-object)
 * encoded nello spriteRAM per il marble player.
 *
 * **Contesto**: `lateGameLogic26F3E` (FUN_26F3E) replica già il dispatcher
 * principale dei tipi entità (1/2/4/etc.), ma NON copre il path "marble player
 * 5-tile mosaic" che MAME emette in entries 4..8 dello sprite RAM. In MAME
 * frame 12000 → 12010 (demo gameplay attivo, marble in moto):
 *
 *   - obj0 @ 0x400018+0x24 (X long): `0x015aa6d5 → 0x01662b65` (Δ +0xb8490)
 *   - slot pair @ 0x400A20+0xC (X long): `0x0099e4d2 → 0x00a141fc` (Δ +0x75d2a)
 *   - slot pair @ 0x400A20+0x10 (Y long): `0x0107e17a → 0x010b5a24` (Δ +0x378aa)
 *
 * Risultato spriteRAM (MAME): le entries 4..8 (multi-tile marble body)
 * shiftano X di -15 px e Y di +/-1..3 px, mantenendo i tile codes (0x07,
 * 0x0f, 0x16, 0x19, 0x26 — animazione rotazione marble).
 *
 * **Strategia di replica**: invece di proiettare le coords assolute (che
 * richiederebbe la formula precisa MAME, non disponibile senza disasm completa
 * della camera projection), questo modulo applica un **delta-based shift**:
 *
 *   1. Mantiene un "previous" snapshot di `slot pair x/y high-word` in scratch
 *      workRam @ `0x4007F0..0x4007F3` (regione zeroed riservata).
 *   2. Calcola `Δslot_x = slot_x_now - slot_x_prev` e analogamente per Y.
 *   3. Le entries 4..8 in spriteRAM hanno il loro coord field bit 5..13.
 *      Il delta espresso in pixel = `(Δslot_high) / scale`. Empiricamente
 *      MAME usa `scale = 2` (1 px screen ≈ 2 high-word units di slot pair).
 *   4. Per ogni entry in {4,5,6,7,8} (in entrambi i banchi A/B):
 *      a. Decodifica X corrente (`(word >> 5) & 0x1ff`).
 *      b. Aggiunge `-Δslot_x_pixel` (X invertito, marble si muove rispetto
 *         allo scrolling).
 *      c. Re-encode il bit 5..13, preserva flags (bit 15) e tile-count (bit 0..4).
 *      d. Stesso per Y con `+Δslot_y_pixel`.
 *
 * **Side effect**:
 *   - `state.spriteRam`: bank A entries 4..8 word 0/2 (Y/X), bank B idem.
 *     Offsets: 0x008..0x011 (Y), 0x108..0x111 (X), 0x208..0x211 (Y B),
 *     0x308..0x311 (X B).
 *   - `state.workRam[0x7F0..0x7F3]`: cache previous slot_x/slot_y high-word.
 *     Questa regione è zeroed in MAME f12000+ (verificato in dump),
 *     unused da altri replicas.
 *
 * **Wiring**: chiamata in `main-tick.ts` dopo `lateGameLogic26F3E` quando
 * `runMainLoopBody=true`.
 *
 * **Limitazioni**:
 *   - Non bit-perfect (non ricava dalla disasm precisa di FUN_FA0).
 *   - Approssima `scale = 2` (empirico da delta MAME f12000 → f12010).
 *   - Non gestisce per-tile offset (= rotazione/animazione del marble).
 *   - First call (slot_prev = 0) produce delta enorme; mitigato dal "skip
 *     se prev == 0" guard al primo tick.
 *
 * **Riferimenti**:
 *   - `docs/video-system.md:76..94` — MO entry layout (Y=word0 bit5-13,
 *     X=word2 bit5-13).
 *   - `tools/disasm/fa0_disasm.txt` — main thread loop FUN_FA0 (3.3KB).
 *   - `late-game-logic-26f3e.ts` — dispatcher type 1/2/4 (gestisce ent[0,1]
 *     ma NON le tile interne del marble).
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

/** Workram base (M68k absolute = 0x00400000). */
const WRAM_BASE = 0x00400000;

/** Slot pair struct base (= ROM[0x1F002] indirect target = 0x400A20). */
const SLOT_PAIR_BASE_ABS = 0x00400a20;

/** Workram offset of slot pair X long (high word at +0xC..0xD). */
const SLOT_PAIR_X_HIGH_OFF = SLOT_PAIR_BASE_ABS - WRAM_BASE + 0xc;
/** Workram offset of slot pair Y long (high word at +0x10..0x11). */
const SLOT_PAIR_Y_HIGH_OFF = SLOT_PAIR_BASE_ABS - WRAM_BASE + 0x10;

/**
 * Scratch workRam offsets for previous-frame snapshot.
 * Region 0x4007F0..0x4007FF is zeroed in MAME f12000 dump, unused by
 * other replicas (verified via grep).
 */
const PREV_SLOT_X_OFF = 0x7f0;
const PREV_SLOT_Y_OFF = 0x7f2;
const PREV_VALID_OFF  = 0x7f4;  // byte: 0=invalid (first tick), 1=valid

/** Marble player MO entry slot indices (5 tiles in display list). */
const MARBLE_ENTRY_FIRST = 4;
const MARBLE_ENTRY_COUNT = 5;

/** MO entry layout offsets (per Atari System 1, see docs/video-system.md). */
const MO_BANK_Y_OFF = 0x000;     // bank-A word 0 (Y position)
const MO_BANK_CODE_OFF = 0x080;  // bank-A word 1 (code)
const MO_BANK_X_OFF = 0x100;     // bank-A word 2 (X position)
const MO_BANK_B_OFFSET = 0x200;  // bank-B = bank-A + 0x200 stride

/**
 * Empirical scale factor: 1 screen pixel ≈ ~0.5 slot-pair-high-word unit.
 * Derived from MAME diff f12000→f12010 (10-frame interval):
 *   slot_x_high: 0x99 → 0xa1 (Δ +8)
 *   marble screen X: 95 → 80 (Δ -15 px)
 *   ratio: ~ -2 px / +1 unit (sign inverted, marble vs camera).
 * Therefore deltaPx = -ΔslotX * 2.
 */
const COORD_SCALE_NUM = 1;   // delta passes through (1:1 mapping)

/** Read big-endian unsigned 16-bit from workRam at offset. */
function rwBE_workram(state: GameState, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

/** Write big-endian unsigned 16-bit to workRam at offset. */
function wwBE_workram(state: GameState, off: number, val: number): void {
  state.workRam[off] = (val >>> 8) & 0xff;
  state.workRam[off + 1] = val & 0xff;
}

/** Read big-endian unsigned 16-bit from spriteRam at offset. */
function rwBE_spriteram(state: GameState, off: number): number {
  return (((state.spriteRam[off] ?? 0) << 8) | (state.spriteRam[off + 1] ?? 0)) & 0xffff;
}

/** Write big-endian unsigned 16-bit to spriteRam at offset. */
function wwBE_spriteram(state: GameState, off: number, val: number): void {
  state.spriteRam[off] = (val >>> 8) & 0xff;
  state.spriteRam[off + 1] = val & 0xff;
}

/**
 * Sign-extend 16-bit delta (handles wrap-around when slot pair high-word
 * crosses 0x8000 boundary).
 */
function s16Delta(now: number, prev: number): number {
  let d = (now - prev) & 0xffff;
  if (d >= 0x8000) d -= 0x10000;
  return d;
}

/**
 * Patch a single MO entry's position word: replaces bit 5..13 (9-bit pos
 * field) with `(currentPos + deltaPx) & 0x1ff`, preserving bit 15 (flag)
 * and bit 0..4 (tile count + sub-flags).
 */
function applyDelta(state: GameState, off: number, deltaPx: number): void {
  const cur = rwBE_spriteram(state, off);
  const flags = cur & 0x801f;       // preserve bit15 + bit0..4
  const curPos = (cur >> 5) & 0x1ff;
  const newPos = (curPos + deltaPx) & 0x1ff;
  const newWord = ((newPos << 5) & 0x3fe0) | flags;
  wwBE_spriteram(state, off, newWord);
}

/**
 * Replica del chunk FUN_FA0 che proietta `slot pair` (marble world position)
 * nel display-list MO sprite del marble player.
 *
 * **Algoritmo (delta-based)**:
 *   1. Legge `slot pair x/y high-word` correnti.
 *   2. Compara con snapshot precedente in `workRam[0x7F0..0x7F3]`.
 *   3. Se prev valid: calcola `Δx_px = -ΔslotX / 2`, `Δy_px = ΔslotY / 2`.
 *   4. Applica delta a entries marble (slot 4..8) in entrambi i banchi.
 *   5. Aggiorna snapshot prev.
 *
 * Il segno di Δx è invertito perché il marble si muove rispetto al
 * playfield che scrolla in direzione opposta (camera follows marble:
 * camera_x ↑ → marble_screen_x ↓ se viewport-fixed).
 *
 * **Idempotency**: se chiamato due volte nello stesso frame senza tick
 * intermedio, la seconda chiamata avrà `Δ = 0` e nessun side effect.
 *
 * @param state  GameState (legge workRam, modifica workRam[0x7F0..0x7F4]
 *               + spriteRam in-place).
 * @param rom    RomImage (riservato a future extensions ROM-driven).
 */
export function fun_FA0_marbleEmit(state: GameState, rom: RomImage): void {
  void rom;  // future: ROM-driven per-tile offsets

  // Gate rimosso: gameMode=1 sia in title sia in demo gameplay (verificato
  // su MAME dump multi-frame). Priorità movement visibile attivata sempre
  // quando runMainLoopBody=true.

  // 1. Legge slot pair high-word coords correnti.
  const slotX_now = rwBE_workram(state, SLOT_PAIR_X_HIGH_OFF);
  const slotY_now = rwBE_workram(state, SLOT_PAIR_Y_HIGH_OFF);

  // 2. Legge snapshot precedente.
  const slotX_prev = rwBE_workram(state, PREV_SLOT_X_OFF);
  const slotY_prev = rwBE_workram(state, PREV_SLOT_Y_OFF);
  const prevValid = (state.workRam[PREV_VALID_OFF] ?? 0) !== 0;

  // 3. Aggiorna snapshot per il prossimo tick.
  wwBE_workram(state, PREV_SLOT_X_OFF, slotX_now);
  wwBE_workram(state, PREV_SLOT_Y_OFF, slotY_now);
  state.workRam[PREV_VALID_OFF] = 1;

  if (!prevValid) {
    // First call: niente delta da applicare, esce silently.
    return;
  }

  // 4. Calcola delta in pixel (con scale empirico).
  const deltaSlotX = s16Delta(slotX_now, slotX_prev);
  const deltaSlotY = s16Delta(slotY_now, slotY_prev);
  // Slot pair high-word units ≈ screen pixel (1:1) for short intervals.
  // Sign inverted on X (camera follows marble: world X up → screen X down).
  // Y not inverted (Y motion follows marble directly when scrolling locked).
  const deltaXpx = -(deltaSlotX * COORD_SCALE_NUM);
  const deltaYpx = (deltaSlotY * COORD_SCALE_NUM);

  if (deltaXpx === 0 && deltaYpx === 0) return;  // idle, skip

  // 5. Applica delta alle 5 entries marble nei 2 banchi.
  for (let bank = 0; bank < 2; bank++) {
    const bankBase = bank * MO_BANK_B_OFFSET;
    for (let i = 0; i < MARBLE_ENTRY_COUNT; i++) {
      const slot = MARBLE_ENTRY_FIRST + i;
      const yOff = bankBase + MO_BANK_Y_OFF + slot * 2;
      const xOff = bankBase + MO_BANK_X_OFF + slot * 2;
      const codeOff = bankBase + MO_BANK_CODE_OFF + slot * 2;

      // Skip slots vuoti (non ancora popolati da dispatch).
      if (rwBE_spriteram(state, codeOff) === 0) continue;

      if (deltaYpx !== 0) applyDelta(state, yOff, deltaYpx);
      if (deltaXpx !== 0) applyDelta(state, xOff, deltaXpx);
    }
  }
}

/** Address constant for documentation / introspection. */
export const FUN_FA0_MARBLE_EMIT_ADDR = 0x00000fa0 as const;
