/**
 * bbox-hit-test-19d94.ts — replica `FUN_00019D94` (174 byte).
 *
 * "Mode-4 AABB hit-test sull'array @ 0x4019F8". Iterando le 10 slot da 0x38
 * byte dell'array @ `0x4019F8` (cfr. `slotArrayBulkInit`), per ciascuna slot
 * "armata" (`slot[0x18] != 0` && `slot[0x1A] == 0`), verifica se il punto
 * "(x, y) marble" (word @ `0x400690..0x400693`) cade dentro un bounding-box
 * 12×12 word costruito attorno alle coordinate della slot (slot[0x0C..0x0D]
 * x-word, slot[0x10..0x11] y-word). Su collisione:
 *   - segna la slot in stato `0x02` (slot[0x1A]=2);
 *   - bind di un puntatore script costante `0x00022546` in `slot[0x1C..0x1F]`;
 *   - inizializza `slot[0x25]=0x04`, `slot[0x24]=0x00`;
 *   - sull'entity passata come argomento (A2): `entity[0x1A]=0x0B`,
 *     `entity[0x57]=0x66`;
 *   - chiama `FUN_000158AC(0x3E)` (sound trigger).
 *
 * **Tutto il loop body è gated** dal check iniziale `*0x400394 == 4`: se il
 * "game-mode" word (cfr. `sound-pair-15884.ts`) non vale `4`, la funzione
 * esce subito (NOP per mode != 4). È quindi una hit-test legata al sub-state
 * "in-game / mode 4".
 *
 * **Disasm 0x19D94..0x19E41** (174 byte):
 *
 *   movem.l {D2,D3,D4,A2,A3},-(SP)            ; salva D2/D3/D4/A2/A3 (20 byte)
 *   movea.l (0x18,SP),A2                      ; A2 = arg long (entity ptr)
 *   moveq   #4,D0                             ; D0 = 4
 *   cmp.w   (0x00400394).l,D0w                ; D0 - mem.w
 *   bne.w   epilogue                          ; if (4 != *0x400394) → exit
 *
 *   movea.l #0x004019F8,A3                    ; A3 = base array (slot 0)
 *   clr.b   D2b                               ; D2.b = 0 (loop index byte)
 *
 * loop:                                       ; @ 0x19DB0
 *   tst.b   (0x18,A3)                         ; slot[0x18] == 0?
 *   beq.w   next_iter                         ; → skip slot
 *   tst.b   (0x1A,A3)                         ; slot[0x1A] != 0?
 *   bne.w   next_iter                         ; → skip slot
 *
 *   ; word arithmetic (16-bit signed, le bgt/ble sono signed)
 *   lea     (0x10,A3),A0                      ; A0 = &slot[0x10]
 *   move.w  (A0),D1w                          ; D1.w = slot.y (y-word)
 *   subq.w  #4,D1w                            ; D1 = y - 4 (top)
 *   move.w  D1w,D4w                           ; D4 = y - 4
 *   addi.w  #0xC,D4w                          ; D4 = y + 8 (bottom)
 *
 *   lea     (0x0C,A3),A0                      ; A0 = &slot[0x0C]
 *   move.w  (A0),D0w                          ; D0.w = slot.x
 *   subq.w  #6,D0w                            ; D0 = x - 6 (left)
 *   move.w  D0w,D3w                           ; D3 = x - 6
 *   addi.w  #0xC,D3w                          ; D3 = x + 6 (right)
 *
 *   cmp.w   (0x00400690).l,D0w                ; D0 - marble.x
 *   bgt.b   next_iter                         ; left  >  marble.x → miss
 *   cmp.w   (0x00400690).l,D3w                ; D3 - marble.x
 *   ble.b   next_iter                         ; right <= marble.x → miss
 *   cmp.w   (0x00400692).l,D1w                ; D1 - marble.y
 *   bgt.b   next_iter                         ; top  >  marble.y → miss
 *   cmp.w   (0x00400692).l,D4w                ; D4 - marble.y
 *   ble.b   next_iter                         ; bot. <= marble.y → miss
 *
 *   ; ─── HIT — marble bbox-overlap con la slot ────────────────────────────
 *   move.b  #0x02,(0x1A,A3)                   ; slot[0x1A] = 2 (state busy)
 *   move.l  #0x00022546,(0x1C,A3)             ; slot[0x1C..0x1F] = 0x22546 (script ptr)
 *   move.b  #0x04,(0x25,A3)                   ; slot[0x25] = 4
 *   clr.b   (0x24,A3)                         ; slot[0x24] = 0
 *   move.b  #0x0B,(0x1A,A2)                   ; entity[0x1A] = 0x0B
 *   move.b  #0x66,(0x57,A2)                   ; entity[0x57] = 0x66
 *   pea     (0x3E).l                          ; push 0x3E (long)
 *   jsr     0x000158AC.l                      ; FUN_158AC(0x3E) — sound
 *   addq.l  #4,SP                              ; pop arg
 *
 * next_iter:                                  ; @ 0x19E2E
 *   moveq   #0x38,D0                          ; D0 = stride 0x38
 *   adda.l  D0,A3                             ; A3 += 0x38
 *   addq.b  #1,D2b                            ; D2++
 *   cmpi.b  #0x0A,D2b                         ; D2 == 10 ?
 *   bne.w   loop                              ; iterate
 *
 * epilogue:                                   ; @ 0x19E3C
 *   movem.l (SP)+,{A3,A2,D4,D3,D2}            ; ripristina
 *   rts
 *
 * **Globals (workRam) letti**:
 *   - `*0x400394` (word)  = game-mode discriminator (cfr. sound-pair-15884).
 *   - `*0x400690` (word)  = marble world x (cfr. sprite-derive).
 *   - `*0x400692` (word)  = marble world y.
 *
 * **Slot array** @ `0x4019F8`, 10 entries × `0x38` byte
 * (cfr. `slot-array-init.ts` array 1). Campi toccati per slot:
 *   - `slot[0x18]` byte: gate "armed" (in: read; out: unchanged)
 *   - `slot[0x1A]` byte: gate "free" (in: read; out: scritto a 2 su hit)
 *   - `slot[0x0C..0x0D]` word BE: x position (signed 16-bit)
 *   - `slot[0x10..0x11]` word BE: y position (signed 16-bit)
 *   - `slot[0x1C..0x1F]` long BE: script ptr (out: scritto a 0x22546 su hit)
 *   - `slot[0x24]` byte (out: 0 su hit)
 *   - `slot[0x25]` byte (out: 4 su hit)
 *
 * **Entity arg** (A2 = `entityAddr`):
 *   - `entity[0x1A]` byte (out: 0x0B su hit)
 *   - `entity[0x57]` byte (out: 0x66 su hit)
 *
 * **Word semantica**:
 *   - `subq.w #4, D1` → wrap modulo 0x10000 (16-bit).
 *   - `addi.w #0xC, D4` → wrap modulo 0x10000.
 *   - `cmp.w` + `bgt`/`ble` → confronto **signed** 16-bit.
 *   I valori di posizione possono essere negativi (sign-bit 0x8000).
 *
 * **Caller noto** (1 xref): `FUN_000121B8` @ 0x1240A — in sequenza dopo
 * `jsr FUN_1924E(entity)` e prima di `cmpi.b #0x0B, (0x1A, A2)` che proprio
 * ricontrolla il valore appena scritto su hit (entity[0x1A] = 0x0B → branch
 * di "marble caught / level transition"). Coerente con la semantica di
 * "trigger transition di stato sul marble quando entra in collisione con
 * una slot dell'array 0x4019F8".
 *
 * **Sub injection**:
 *   - `FUN_000158AC` (sound command sender) NON è replicata; default no-op.
 *     Lo stesso pattern di `sound-pair-15884.ts` / `object-update-pair-158cc.ts`.
 *
 * **Side effects** in `state.workRam` (per ogni slot in stato hit):
 *   - `slot[0x1A], slot[0x1C..0x1F], slot[0x24], slot[0x25]` riscritti.
 *   - `entity[0x1A], entity[0x57]` riscritti.
 *   - 1+ chiamate a `subs.soundCommand(0x3E)` (una per slot in hit).
 *
 * **Niente RNG, niente accesso a colorRam/spriteRam/alphaRam.**
 *
 * Verifica bit-perfect via
 * `packages/cli/src/test-bbox-hit-test-19d94-parity.ts` (500 casi).
 */

import type { GameState } from "./state.js";

// ─── Globals (offset workRam relativi a 0x400000) ────────────────────────

/** Offset workRam della "game mode" word (assoluto = 0x400394). */
export const GAME_MODE_WORD_OFF = 0x394 as const;
/** Offset workRam della marble x-word (assoluto = 0x400690). */
export const MARBLE_X_WORD_OFF = 0x690 as const;
/** Offset workRam della marble y-word (assoluto = 0x400692). */
export const MARBLE_Y_WORD_OFF = 0x692 as const;

/** Valore di "game mode" che abilita il loop (cfr. `cmp.w; bne.w`). */
export const REQUIRED_GAME_MODE = 0x0004 as const;

// ─── Slot array @ 0x4019F8 ───────────────────────────────────────────────

/** Indirizzo assoluto m68k della slot 0 (`movea.l #0x4019F8, A3`). */
export const SLOT_ARRAY_BASE_ADDR = 0x004019f8 as const;
/** Stride tra due slot consecutive (`moveq #0x38, D0; adda.l D0, A3`). */
export const SLOT_STRIDE = 0x38 as const;
/** Numero di slot iterate (`cmpi.b #0xA, D2`). */
export const SLOT_COUNT = 10 as const;

// Field offsets all'interno di una slot.
/** Byte: gate "armed" (skip slot se 0). */
export const SLOT_ARMED_OFF = 0x18 as const;
/** Byte: gate "free" (skip slot se != 0). */
export const SLOT_STATE_OFF = 0x1a as const;
/** Word BE: slot x position (signed 16-bit). */
export const SLOT_X_OFF = 0x0c as const;
/** Word BE: slot y position (signed 16-bit). */
export const SLOT_Y_OFF = 0x10 as const;
/** Long BE: slot script ptr scritto su hit. */
export const SLOT_SCRIPT_PTR_OFF = 0x1c as const;
/** Byte: scritto a 0 su hit. */
export const SLOT_FLAG_OFF = 0x24 as const;
/** Byte: scritto a 0x04 su hit (state). */
export const SLOT_NEW_STATE_OFF = 0x25 as const;

// ─── Constants scritte su hit ────────────────────────────────────────────

/** Valore di `slot[0x1A]` su hit (`move.b #2, (0x1A,A3)`). */
export const HIT_SLOT_STATE = 0x02 as const;
/** Valore di `slot[0x25]` su hit (`move.b #4, (0x25,A3)`). */
export const HIT_SLOT_NEW_STATE = 0x04 as const;
/** Valore script-ptr scritto in `slot[0x1C..0x1F]` su hit. */
export const HIT_SCRIPT_PTR = 0x00022546 as const;
/** Valore di `entity[0x1A]` su hit (`move.b #0x0B, (0x1A,A2)`). */
export const HIT_ENTITY_STATE = 0x0b as const;
/** Valore di `entity[0x57]` su hit (`move.b #0x66, (0x57,A2)`). */
export const HIT_ENTITY_FIELD_57 = 0x66 as const;

/** Offset entity (A2): byte di stato scritto su hit. */
export const ENTITY_STATE_OFF = 0x1a as const;
/** Offset entity (A2): byte ausiliario scritto su hit. */
export const ENTITY_FIELD_57_OFF = 0x57 as const;

/** Sound command id pushato via `pea (0x3E).l; jsr FUN_158AC`. */
export const SOUND_HIT_COMMAND = 0x3e as const;

// ─── Bbox half-extents (word) ────────────────────────────────────────────

/** `subq.w #6, D0` (x left  = slot.x - 6). */
export const BBOX_LEFT_DELTA = 6 as const;
/** `addi.w #0xC, D3` dopo subq.w #6 → right = slot.x + 6 (effettivo). */
export const BBOX_RIGHT_DELTA = 6 as const;
/** `subq.w #4, D1` (y top  = slot.y - 4). */
export const BBOX_TOP_DELTA = 4 as const;
/** `addi.w #0xC, D4` dopo subq.w #4 → bottom = slot.y + 8 (effettivo). */
export const BBOX_BOTTOM_DELTA = 8 as const;

// ─── Sub injection ───────────────────────────────────────────────────────

/**
 * Sub-functions stub iniettabili per `bboxHitTest19D94`.
 *
 * `FUN_000158AC` (sound command sender) NON è replicato; default no-op.
 * Stesso pattern di `sound-pair-15884.ts` (la chiamata è `pea (cmd).l;
 * jsr FUN_158AC; addq.l #4, SP` e FUN_158AC legge solo il byte LSB).
 */
export interface BboxHitTest19D94Subs {
  /**
   * `FUN_000158AC`: invia un sound command. Arg = byte LSB del long pushato
   * via `pea`. Default no-op (caller futuro connette al sound chip).
   */
  soundCommand?: (cmd: number) => void;
}

// ─── Risultato ───────────────────────────────────────────────────────────

/** Esito della scansione su una singola slot. */
export type SlotResult = "skip_armed" | "skip_state" | "miss" | "hit";

export interface BboxHitTest19D94Result {
  /** True se *0x400394 != REQUIRED_GAME_MODE (early-exit, niente loop). */
  earlyExit: boolean;
  /** Esito per ciascuna delle 10 slot (length 10 sempre, anche con earlyExit
   *  → in tal caso array vuoto `[]`). */
  perSlot: SlotResult[];
  /** Numero di hit effettivi (0..10). */
  hitCount: number;
  /** Numero di chiamate a `subs.soundCommand(0x3E)` eseguite (= hitCount). */
  soundTriggers: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function readByte(state: GameState, off: number): number {
  return (state.workRam[off] ?? 0) & 0xff;
}

function writeByte(state: GameState, off: number, v: number): void {
  state.workRam[off] = v & 0xff;
}

function readWordBE(state: GameState, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

function writeLongBE(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 24) & 0xff;
  state.workRam[off + 1] = (v >>> 16) & 0xff;
  state.workRam[off + 2] = (v >>> 8) & 0xff;
  state.workRam[off + 3] = v & 0xff;
}

/**
 * Sign-extend 16-bit → JS signed 32-bit. Le `bgt`/`ble` del binario sono
 * confronti **signed** sui registri D0/D1/D3/D4 dopo `cmp.w`, quindi i
 * valori coinvolti vanno trattati come int16 con segno.
 */
function sext16(w: number): number {
  return (w & 0x8000) ? (w - 0x10000) : w;
}

// ─── Replica ─────────────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00019D94`.
 *
 * @param state       GameState. Letture: `workRam[0x394..0x395]`,
 *                    `workRam[0x690..0x693]`, slot array @
 *                    `workRam[0x19F8..0x1B6F]`, entity @ `entityAddr`.
 *                    Scritture (per slot in hit): `slot[0x1A]`,
 *                    `slot[0x1C..0x1F]`, `slot[0x24]`, `slot[0x25]`,
 *                    `entity[0x1A]`, `entity[0x57]`.
 * @param entityAddr  Indirizzo assoluto m68k della struct entity (A2 =
 *                    arg long). Convertito a offset `entityAddr - 0x400000`
 *                    per accedere a `workRam`.
 * @param subs        Injection. `subs.soundCommand(0x3E)` chiamato una
 *                    volta per ciascuno slot in hit. Default: no-op
 *                    (matching del binario stubbato con RTS in parity).
 *
 * @returns dettaglio per slot + early-exit + numero hit/triggers.
 *
 * **Ordine delle scritture** (rilevante per parity):
 *   Per ciascuna slot dalla 0 alla 9 (in ordine), nel branch hit:
 *     1. `slot[0x1A] = 0x02`
 *     2. `slot[0x1C..0x1F] = 0x00022546`
 *     3. `slot[0x25] = 0x04`
 *     4. `slot[0x24] = 0x00`
 *     5. `entity[0x1A] = 0x0B`
 *     6. `entity[0x57] = 0x66`
 *     7. `subs.soundCommand(0x3E)`
 */
export function bboxHitTest19D94(
  state: GameState,
  entityAddr: number,
  subs?: BboxHitTest19D94Subs,
): BboxHitTest19D94Result {
  const entityOff = (entityAddr - 0x400000) >>> 0;

  // ─── Game-mode gate ────────────────────────────────────────────────────
  // `moveq #4, D0; cmp.w (0x400394).l, D0w; bne.w epilogue`
  //   - cmp.w D0=4 vs mem.w → confronto word.
  //   - branch se NON uguali → exit.
  const gameMode = readWordBE(state, GAME_MODE_WORD_OFF);
  if (gameMode !== REQUIRED_GAME_MODE) {
    return { earlyExit: true, perSlot: [], hitCount: 0, soundTriggers: 0 };
  }

  // ─── Marble pos words (read fuori dal loop body, ma il binario li
  //     rilegge ad ogni iterazione via `cmp.w (0x400690).l, ...`. Il valore
  //     è invariato a meno che la sub stessa non scriva in workRam[0x690]:
  //     in questo modulo non lo facciamo, ma per parity bit-perfect si
  //     potrebbe rileggerli ad ogni iter. Qui leggiamoli una volta — la sub
  //     soundCommand iniettata non scrive workRam in test, e il binario
  //     stubbato con RTS non altera 0x400690/692.) ────────────────────────
  // NB: per matchare un caller che mutasse i marble globals tra iter, il
  //     fix sarebbe trivialmente spostare le 2 letture dentro il loop. Non
  //     necessario per FUN_158AC stub-RTS in parity.
  const marbleX = sext16(readWordBE(state, MARBLE_X_WORD_OFF));
  const marbleY = sext16(readWordBE(state, MARBLE_Y_WORD_OFF));

  const perSlot: SlotResult[] = [];
  let hitCount = 0;

  // ─── Loop sulle 10 slot ────────────────────────────────────────────────
  // A3 = 0x4019F8 + i * 0x38; i in [0..9]
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slotOff = (SLOT_ARRAY_BASE_ADDR - 0x400000 + i * SLOT_STRIDE) >>> 0;

    // tst.b (0x18, A3); beq.w next_iter
    if (readByte(state, slotOff + SLOT_ARMED_OFF) === 0) {
      perSlot.push("skip_armed");
      continue;
    }
    // tst.b (0x1A, A3); bne.w next_iter
    if (readByte(state, slotOff + SLOT_STATE_OFF) !== 0) {
      perSlot.push("skip_state");
      continue;
    }

    // ─── Costruzione bbox (word arithmetic, signed) ─────────────────────
    // D1.w = slot.y; D1 -= 4 (top); D4 = D1 + 0xC (= slot.y + 8, bottom)
    const yRaw = readWordBE(state, slotOff + SLOT_Y_OFF);
    const top16 = (yRaw - BBOX_TOP_DELTA) & 0xffff;
    const bottom16 = (top16 + 0xc) & 0xffff;
    const top = sext16(top16);
    const bottom = sext16(bottom16);

    // D0.w = slot.x; D0 -= 6 (left); D3 = D0 + 0xC (= slot.x + 6, right)
    const xRaw = readWordBE(state, slotOff + SLOT_X_OFF);
    const left16 = (xRaw - BBOX_LEFT_DELTA) & 0xffff;
    const right16 = (left16 + 0xc) & 0xffff;
    const left = sext16(left16);
    const right = sext16(right16);

    // cmp.w (0x400690).l, D0w; bgt → miss        if (left  >  marble.x)
    if (left > marbleX) { perSlot.push("miss"); continue; }
    // cmp.w (0x400690).l, D3w; ble → miss        if (right <= marble.x)
    if (right <= marbleX) { perSlot.push("miss"); continue; }
    // cmp.w (0x400692).l, D1w; bgt → miss        if (top   >  marble.y)
    if (top > marbleY) { perSlot.push("miss"); continue; }
    // cmp.w (0x400692).l, D4w; ble → miss        if (bot. <= marble.y)
    if (bottom <= marbleY) { perSlot.push("miss"); continue; }

    // ─── HIT: scrivi tutti i campi nell'ordine del binario ──────────────
    writeByte(state, slotOff + SLOT_STATE_OFF, HIT_SLOT_STATE);
    writeLongBE(state, slotOff + SLOT_SCRIPT_PTR_OFF, HIT_SCRIPT_PTR);
    writeByte(state, slotOff + SLOT_NEW_STATE_OFF, HIT_SLOT_NEW_STATE);
    writeByte(state, slotOff + SLOT_FLAG_OFF, 0);
    writeByte(state, entityOff + ENTITY_STATE_OFF, HIT_ENTITY_STATE);
    writeByte(state, entityOff + ENTITY_FIELD_57_OFF, HIT_ENTITY_FIELD_57);

    subs?.soundCommand?.(SOUND_HIT_COMMAND);

    perSlot.push("hit");
    hitCount++;
  }

  return {
    earlyExit: false,
    perSlot,
    hitCount,
    soundTriggers: hitCount,
  };
}
