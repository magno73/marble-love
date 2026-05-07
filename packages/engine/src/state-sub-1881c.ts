/**
 * state-sub-1881c.ts — replica `FUN_0001881C` (342 byte).
 *
 * "Entity-vs-table proximity reactor". Riceve sullo stack un pointer ad una
 * struct entity (A2 = arg long). Itera la tabella di 36 entry × 16 byte @
 * `0x401650` (work RAM offset 0x1650) e — per ogni entry il cui slot è
 * "attivo" (`entry[0x2..0x3] == 0xFFFF` word) e i cui byte `entry[0x4]` /
 * `entry[0x5]` matchano i globals "current spawn pair"
 * `*0x400697 / *0x400699` — esegue uno dei due rami:
 *
 *   1. **Math/sound branch**: se `entry[0x4]/[0x5]/[0x6]` matchano anche
 *      `byte((long@0x400684)>>19)`, `byte((long@0x400688)>>19)` e la word
 *      `entity[0x14]`. Aggiorna `entity[0x8]=0x70000`,
 *      `entity[0x14]+=0xc0000`, attenua entity[0..3] e [4..7] con `(x>>1)±0x6000`
 *      via 2 estrazioni RNG(2), setta `entity[0x36]=2`, suona 0x45.
 *
 *   2. **Reflect branch**: se la distanza word(`entity[0x14] - entry[0x6]`)
 *      < 12 (signed), nega entity[0..3] e entity[4..7].
 *
 * Inoltre **prima di ogni iterazione** che matcha i primi 3 campi, scrive
 * `entity[0xc]=*0x400684` e `entity[0x10]=*0x400688` (long).
 *
 * **Early-out**: se `(*0x400394).w != 3` AND `*0x400760 == 0` → ritorna 0
 * immediatamente. Se `(*0x400394).w == 3` OR (`(*0x400394).w == 3` AND
 * `*0x400760 != 0`) il loop si esegue. (La logica esatta del binario è
 * `if (gameMode != 3) goto check760; check760: if (byte760==0) goto exit0;
 * else fallthrough` — vedi disasm sotto.)
 *
 * Restituisce 1 (sext.w / sext.l) se almeno un'entry ha matchato i primi 3
 * campi durante il loop, 0 altrimenti (incluso il caso early-out).
 *
 * **Disasm 0x1881C..0x18972** (342 byte):
 *
 *   movem.l {A4 A3 A2 D7 D6 D5 D4 D3 D2}, -(SP)
 *   movea.l (0x28,SP), A2                 ; A2 = entity ptr
 *   moveq   #3, D0
 *   cmp.w   (0x00400394).l, D0w
 *   bne.w   check760                      ; if gameMode != 3 → check760
 *   tst.b   (0x00400760).l                ; (always reached if gameMode == 3)
 *   bne.b   enter_loop                    ; if byte760 != 0 → enter_loop
 *  check760:
 *   moveq   #0, D0
 *   bra.w   exit                          ; → return 0
 *  enter_loop:
 *   clr.b   D5b                           ; D5 = 0 (matched flag)
 *   move.b  (0x00400697).l, D6b
 *   move.b  (0x00400699).l, D7b
 *   movea.l D7, A4                        ; A4 = D7 (no-op alias)
 *   move.l  (0x00400684).l, D0
 *   moveq   #0x13, D1
 *   asr.l   D1, D0                        ; D0 = long@684 >> 19 (signed)
 *   move.b  D0b, D3b                      ; D3.b = byte
 *   move.l  (0x00400688).l, D0
 *   moveq   #0x13, D1
 *   asr.l   D1, D0
 *   move.b  D0b, D2b                      ; D2.b = byte((long@688) >> 19)
 *   movea.l #0x401650, A3                 ; A3 = table base
 *   clr.b   D4b                           ; D4 = 0 (loop counter)
 *  loop_top:
 *   moveq   #-1, D0
 *   cmp.w   (0x2,A3), D0w                 ; entry[0x2..0x3] (word) vs 0xFFFF
 *   bne.w   next_entry
 *   cmp.b   (0x4,A3), D6b                 ; entry[0x4] vs *0x400697
 *   bne.w   next_entry
 *   exg     D7, A4
 *   cmp.b   (0x5,A3), D7b                 ; entry[0x5] vs *0x400699 (D7 == A4)
 *   exg     D7, A4
 *   bne.w   next_entry
 *   ; ─── primi 3 match: scrivi entity[0xc/0x10] ─────────────────────
 *   move.l  (0x00400684).l, (0xc, A2)
 *   move.l  (0x00400688).l, (0x10, A2)
 *   ; ─── secondo livello check ───────────────────────────────────────
 *   cmp.b   (0x4,A3), D3b                 ; entry[0x4] vs byte((long@684)>>19)
 *   bne.w   reflect_block
 *   cmp.b   (0x5,A3), D2b
 *   bne.w   reflect_block
 *   move.w  (0x6,A3), D0w
 *   lea     (0x14,A2), A0
 *   cmp.w   (A0), D0w                     ; entry[0x6].w vs entity[0x14].w
 *   bne.w   reflect_block
 *   ; ─── math/sound branch ───────────────────────────────────────────
 *   move.l  #0x70000, (0x8,A2)
 *   addi.l  #0xc0000, (0x14,A2)
 *   pea     (0x2).w
 *   jsr     0x00013a98.l                  ; D0 = rng(2)
 *   tst.l   D0
 *   addq.l  #4, SP
 *   beq.b   neg_d1_a
 *   move.l  #0x6000, D1
 *   bra.b   apply_a
 *  neg_d1_a:
 *   move.l  #-0x6000, D1
 *  apply_a:
 *   move.l  (A2), D0                      ; entity[0..3] (long)
 *   asr.l   #1, D0                        ; D0 = entity[0..3] >> 1 (signed)
 *   add.l   D1, D0
 *   move.l  D0, (A2)
 *   pea     (0x2).w
 *   jsr     0x00013a98.l
 *   tst.l   D0
 *   addq.l  #4, SP
 *   beq.b   neg_d1_b
 *   move.l  #0x6000, D1
 *   bra.b   apply_b
 *  neg_d1_b:
 *   move.l  #-0x6000, D1
 *  apply_b:
 *   move.l  (0x4,A2), D0
 *   asr.l   #1, D0
 *   add.l   D1, D0
 *   move.l  D0, (0x4,A2)
 *   move.b  #2, (0x36,A2)
 *   pea     (0x45).l
 *   jsr     0x000158ac.l                  ; soundCommand(0x45)
 *   addq.l  #4, SP
 *   bra.b   matched
 *  reflect_block:
 *   lea     (0x14,A2), A0
 *   move.w  (A0), D0w
 *   ext.l   D0                            ; D0 = sext16(entity[0x14])
 *   move.w  (0x6,A3), D1w
 *   ext.l   D1                            ; D1 = sext16(entry[0x6])
 *   sub.l   D1, D0                        ; D0 = entity[0x14] - entry[0x6]
 *   moveq   #0xc, D1
 *   cmp.l   D0, D1                        ; D1 - D0
 *   ble.b   matched                       ; if 12 <= D0 → skip (no reflect)
 *   move.l  (A2), D0
 *   neg.l   D0
 *   move.l  D0, (A2)
 *   move.l  (0x4,A2), D0
 *   neg.l   D0
 *   move.l  D0, (0x4,A2)
 *  matched:
 *   moveq   #1, D5                        ; sticky "any match"
 *  next_entry:
 *   moveq   #0x10, D0
 *   adda.l  D0, A3                        ; A3 += 16
 *   addq.b  #1, D4b
 *   cmpi.b  #0x24, D4b                    ; 36 entries
 *   bne.w   loop_top
 *   move.b  D5b, D0b
 *   ext.w   D0w
 *   ext.l   D0                            ; result = sext(D5)
 *  exit:
 *   movem.l (SP)+, {D2 D3 D4 D5 D6 D7 A2 A3 A4}
 *   rts
 *
 * **JSR esterne**:
 *   - `FUN_00013A98` (RNG): chiamata 0/1/2 volte per ogni entry che matcha i
 *     primi 3 campi E i secondi 3 campi → cioè 2 chiamate per entry
 *     "math/sound branch". 0 chiamate altrimenti. Replicata bit-perfect in
 *     `rng.ts`; lasciata live in parity.
 *   - `FUN_000158AC` (soundCommand): chiamata 1 volta per ogni entry che
 *     entra nel math/sound branch. Stubbabile via `subs.soundCommand`;
 *     argomento = 0x45 (long pushato via `pea (0x45).l`, FUN_158AC legge LSB).
 *
 * **Side effects** in workRam (entity @ argAddr):
 *   - `entity[0xc..0xf]`   ← `*0x400684` (per ogni primo-match)
 *   - `entity[0x10..0x13]` ← `*0x400688` (per ogni primo-match)
 *   - math branch: `entity[0x8..0xb]=0x70000`, `entity[0x14..0x17]+=0xc0000`,
 *     `entity[0..3] = (entity[0..3] >> 1) ± 0x6000`,
 *     `entity[0x4..0x7] = (entity[0x4..0x7] >> 1) ± 0x6000`,
 *     `entity[0x36] = 2`.
 *   - reflect branch: `entity[0..3] = -entity[0..3]`,
 *     `entity[0x4..0x7] = -entity[0x4..0x7]`.
 *
 * **Caller noto** (1 xref): `FUN_000121b8 @ 0x123ee` (UNCONDITIONAL_CALL).
 *
 * Verifica bit-perfect via
 * `packages/cli/src/test-state-sub-1881c-parity.ts` (500 casi).
 */

import type { GameState } from "./state.js";
import { rngNext } from "./rng.js";
import { as_u16 } from "./wrap.js";

// ─── Address constants (work RAM, base 0x400000) ─────────────────────────

/** Word: game-mode discriminator. Loop entra solo se valore == 3. */
export const GAME_MODE_OFFSET = 0x394 as const;
/** Byte: "secondary gate" — se gameMode==3 e questo è zero, early-out. */
export const SECONDARY_GATE_OFFSET = 0x760 as const;
/** Byte: current spawn pair byte 1 (cmp con entry[0x4]). */
export const SPAWN_BYTE0_OFFSET = 0x697 as const;
/** Byte: current spawn pair byte 2 (cmp con entry[0x5]). */
export const SPAWN_BYTE1_OFFSET = 0x699 as const;
/** Long: world position X (?), letto e propagato a entity[0xc]. */
export const WORLD_X_OFFSET = 0x684 as const;
/** Long: world position Y (?), letto e propagato a entity[0x10]. */
export const WORLD_Y_OFFSET = 0x688 as const;
/** Base della tabella (36 × 16 byte = 0x240 byte). */
export const TABLE_BASE_OFFSET = 0x1650 as const;

/** Numero entries della tabella @ 0x401650. */
export const TABLE_ENTRY_COUNT = 0x24 as const; // 36
/** Stride (byte) di una entry. */
export const TABLE_ENTRY_STRIDE = 0x10 as const; // 16

// ─── Entity offsets ──────────────────────────────────────────────────────

/** Long: entity[0x0..0x3] — velocità/posizione X (32-bit signed). */
export const ENTITY_LONG0_OFFSET = 0x00 as const;
/** Long: entity[0x4..0x7] — velocità/posizione Y. */
export const ENTITY_LONG1_OFFSET = 0x04 as const;
/** Long: entity[0x8..0xb] — set a 0x70000 nel math branch. */
export const ENTITY_LONG2_OFFSET = 0x08 as const;
/** Long: entity[0xc..0xf] — overwritten con `*0x400684`. */
export const ENTITY_LONG3_OFFSET = 0x0c as const;
/** Long: entity[0x10..0x13] — overwritten con `*0x400688`. */
export const ENTITY_LONG4_OFFSET = 0x10 as const;
/** Long: entity[0x14..0x17] — incrementato di 0xc0000 (read word in cmp). */
export const ENTITY_LONG5_OFFSET = 0x14 as const;
/** Byte: entity[0x36] — set a 2 nel math branch. */
export const ENTITY_FLAG36_OFFSET = 0x36 as const;

// ─── Entry offsets (table @ 0x401650, stride 16) ─────────────────────────

/** Word: entry[0x2..0x3] (slot active flag, must == 0xFFFF). */
export const ENTRY_ACTIVE_OFFSET = 0x02 as const;
/** Byte: entry[0x4] (matched against `*0x400697` and `byte(long@684>>19)`). */
export const ENTRY_KEY_BYTE0_OFFSET = 0x04 as const;
/** Byte: entry[0x5] (matched against `*0x400699` and `byte(long@688>>19)`). */
export const ENTRY_KEY_BYTE1_OFFSET = 0x05 as const;
/** Word: entry[0x6..0x7] (matched against entity[0x14].w; reflect distance). */
export const ENTRY_KEY_WORD_OFFSET = 0x06 as const;

// ─── Magic constants ─────────────────────────────────────────────────────

/** Valore di gameMode che abilita il loop. */
export const GAME_MODE_ACTIVE = 0x0003 as const;
/** Valore "active" del flag entry[0x2..0x3]. */
export const ACTIVE_SENTINEL = 0xffff as const;
/** Shift signed applicato a long@684 e long@688 prima di byte-cast. */
export const KEY_SHIFT = 0x13 as const; // 19 bit
/** Valore costante scritto in entity[0x8] nel math branch. */
export const MATH_LONG2_VALUE = 0x00070000 as const;
/** Incremento applicato a entity[0x14..0x17] nel math branch. */
export const MATH_LONG5_INCREMENT = 0x000c0000 as const;
/** Magnitude di D1 (±0x6000) sommato a (entity[0..3]>>1) e (entity[4..7]>>1). */
export const MATH_DAMP_MAGNITUDE = 0x6000 as const;
/** Limit RNG usato per scegliere il segno di D1. */
export const MATH_RNG_LIMIT = 0x0002 as const;
/** Valore byte scritto in entity[0x36]. */
export const MATH_FLAG36_VALUE = 0x02 as const;
/** Sound id pushato come `pea (0x45).l; jsr 0x158ac`. */
export const MATH_SOUND_ID = 0x45 as const;
/** Soglia signed per il reflect block (`entity[0x14] - entry[0x6] < 12`). */
export const REFLECT_DISTANCE_THRESHOLD = 0x0c as const;

// ─── Sub injection ───────────────────────────────────────────────────────

/**
 * Stub injection. `FUN_158AC` (sound command sender) non è ancora replicata
 * bit-perfect; default no-op (matching del binario stubbato con RTS).
 * `FUN_13A98` (RNG) NON è iniettabile: è già replicata in `rng.ts`.
 */
export interface StateSub1881CSubs {
  /**
   * `FUN_000158AC`: invia un sound command. Argomento = byte LSB del long
   * pushato (sempre `MATH_SOUND_ID = 0x45`). Default no-op.
   */
  soundCommand?: (cmd: number) => void;
}

// ─── Risultato ───────────────────────────────────────────────────────────

/** Quale dei due rami è stato eseguito per una specifica entry matched. */
export type EntryBranch = "math" | "reflect_neg" | "reflect_skip";

export interface EntryHit {
  /** Indice della entry (0..35). */
  index: number;
  /** Branch eseguito dopo che i primi 3 campi hanno matchato. */
  branch: EntryBranch;
  /** RNG(2) per il segno di D1 sul long0. `null` se branch != "math". */
  rngSignA: number | null;
  /** RNG(2) per il segno di D1 sul long1. `null` se branch != "math". */
  rngSignB: number | null;
}

export interface StateSub1881CResult {
  /** True se è stata presa la early-out (gameMode != 3 e/o byte760 == 0). */
  earlyOut: boolean;
  /**
   * D5 finale (sign-extended a long): 0 se nessuna entry ha matchato i
   * primi 3 campi (o earlyOut), 1 altrimenti. Replica esatta del valore
   * di ritorno del binario (D0 dopo `move.b D5b,D0b; ext.w D0w; ext.l D0`).
   */
  result: number;
  /** Lista delle entry matched (in ordine di scansione). */
  hits: EntryHit[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function readByte(state: GameState, off: number): number {
  return (state.workRam[off] ?? 0) & 0xff;
}

function writeByte(state: GameState, off: number, v: number): void {
  state.workRam[off] = v & 0xff;
}

function readWordBE(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff
  );
}

function readLongBE(state: GameState, off: number): number {
  return (
    ((state.workRam[off] ?? 0) << 24) |
    ((state.workRam[off + 1] ?? 0) << 16) |
    ((state.workRam[off + 2] ?? 0) << 8) |
    (state.workRam[off + 3] ?? 0)
  ) >>> 0;
}

function writeLongBE(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 24) & 0xff;
  state.workRam[off + 1] = (v >>> 16) & 0xff;
  state.workRam[off + 2] = (v >>> 8) & 0xff;
  state.workRam[off + 3] = v & 0xff;
}

/** Sign-extend 16-bit unsigned → signed JS number. */
function sext16(u: number): number {
  return ((u & 0xffff) << 16) >> 16;
}

/** Wrapper RNG con normalizzazione `r mod limit`, identico a state-sub-1960e. */
function rng(state: GameState, limit: number): number {
  let r = rngNext(state.rng, as_u16(limit)) as unknown as number;
  if (limit > 0) {
    while (r >= limit) r -= limit;
  }
  return r & 0xffff;
}

// ─── Replica ─────────────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_0001881C`.
 *
 * @param state       GameState (legge globals @ 0x394/0x760/0x697/0x699/0x684/
 *                    0x688 e tabella @ 0x1650; modifica entity @ argAddr e
 *                    `state.rng.seed`).
 * @param entityAddr  indirizzo m68k della struct entity. Convertito a offset
 *                    workRam come `entityAddr - 0x400000`.
 * @param subs        injection (default no-op). `subs.soundCommand(0x45)`
 *                    chiamato 1 volta per ogni math/sound branch.
 *
 * @returns dettaglio dei match + valore di ritorno (= D0 finale del binario).
 *
 * **Ordine delle scritture** (rilevante per parity vs binario):
 *   1. Per ogni entry che matcha i primi 3 campi: scrive `entity[0xc]` e
 *      `entity[0x10]` PRIMA del secondo check.
 *   2. Math branch: writes nell'ordine del disasm (entity[0x8], entity[0x14] +=,
 *      RNG(2)#1, entity[0..3] update, RNG(2)#2, entity[4..7] update,
 *      entity[0x36], soundCommand).
 *   3. Reflect branch: solo se distanza word < 12 signed; nega entity[0..3]
 *      e poi entity[0x4..0x7].
 *   4. D5 sticky: una volta entrato nel "match path", D5=1 fino al ritorno.
 */
export function stateSub1881C(
  state: GameState,
  entityAddr: number,
  subs?: StateSub1881CSubs,
): StateSub1881CResult {
  const off = (entityAddr - 0x400000) >>> 0;

  // ─── Early-out gate ─────────────────────────────────────────────────
  // Disasm:
  //   moveq #3, D0; cmp.w (0x400394).l, D0w; bne check760
  //   tst.b (0x400760).l; bne enter_loop
  //  check760: moveq #0, D0; bra exit
  //
  // bne con cmp.w D0=3 vs mem: branch if D0 != mem (nei flag ZX dopo cmp).
  // Quindi se gameMode != 3 → check760. Se gameMode == 3 → tst byte760, se
  // byte760 != 0 → enter_loop, altrimenti fallthrough a check760 → exit 0.
  //
  // Risultato netto:
  //   enter loop iff (gameMode == 3 AND byte760 != 0).
  const gameMode = readWordBE(state, GAME_MODE_OFFSET);
  const byte760 = readByte(state, SECONDARY_GATE_OFFSET);
  if (gameMode !== GAME_MODE_ACTIVE || byte760 === 0) {
    return { earlyOut: true, result: 0, hits: [] };
  }

  // ─── Pre-loop: load globals ─────────────────────────────────────────
  const d6 = readByte(state, SPAWN_BYTE0_OFFSET); // *0x400697
  const d7 = readByte(state, SPAWN_BYTE1_OFFSET); // *0x400699 (== A4 alias)

  const long684 = readLongBE(state, WORLD_X_OFFSET);
  const long688 = readLongBE(state, WORLD_Y_OFFSET);

  // asr.l #0x13, D0 — arithmetic shift right by 19 (signed); take low byte.
  // long684 / long688 are read unsigned u32; convert to signed i32 (|0) before >>.
  const d3 = (((long684 | 0) >> KEY_SHIFT) | 0) & 0xff; // byte((long@684 >> 19))
  const d2 = (((long688 | 0) >> KEY_SHIFT) | 0) & 0xff; // byte((long@688 >> 19))

  const hits: EntryHit[] = [];
  let d5 = 0; // sticky "any match" flag

  // ─── Loop ───────────────────────────────────────────────────────────
  for (let i = 0; i < TABLE_ENTRY_COUNT; i++) {
    const entryOff = TABLE_BASE_OFFSET + i * TABLE_ENTRY_STRIDE;

    // First gate: entry[0x2..0x3] (word) == 0xFFFF
    const activeWord = readWordBE(state, entryOff + ENTRY_ACTIVE_OFFSET);
    if (activeWord !== ACTIVE_SENTINEL) continue;

    // Second gate: entry[0x4] == d6 (= *0x400697)
    const entryB0 = readByte(state, entryOff + ENTRY_KEY_BYTE0_OFFSET);
    if (entryB0 !== d6) continue;

    // Third gate: entry[0x5] == d7 (= *0x400699)
    // (binary fa exg D7,A4 ma A4 == D7 sempre, quindi nessun cambio.)
    const entryB1 = readByte(state, entryOff + ENTRY_KEY_BYTE1_OFFSET);
    if (entryB1 !== d7) continue;

    // ─── Primi 3 match: scrivi entity[0xc] = long684, entity[0x10] = long688
    writeLongBE(state, off + ENTITY_LONG3_OFFSET, long684);
    writeLongBE(state, off + ENTITY_LONG4_OFFSET, long688);

    // ─── Secondo livello check ──────────────────────────────────────
    let branch: EntryBranch;
    let rngSignA: number | null = null;
    let rngSignB: number | null = null;

    const entryWord6 = readWordBE(state, entryOff + ENTRY_KEY_WORD_OFFSET);
    const entityWord14 = readWordBE(state, off + ENTITY_LONG5_OFFSET);

    if (entryB0 === d3 && entryB1 === d2 && entryWord6 === entityWord14) {
      // ─── Math/sound branch ────────────────────────────────────────
      branch = "math";

      // entity[0x8..0xb] = 0x70000
      writeLongBE(state, off + ENTITY_LONG2_OFFSET, MATH_LONG2_VALUE);

      // entity[0x14..0x17] += 0xc0000  (read u32, add, write u32 wrap-around)
      const long5Old = readLongBE(state, off + ENTITY_LONG5_OFFSET);
      const long5New = (long5Old + MATH_LONG5_INCREMENT) >>> 0;
      writeLongBE(state, off + ENTITY_LONG5_OFFSET, long5New);

      // ── RNG(2) #1 ──────────────────────────────────────────────────
      // ATTENZIONE: il binario fa `tst.l D0` post-JSR. Ma `FUN_13A98`
      // preserva D0.high (`move.w` → solo .w; `and.w` → solo .w). All'entry
      // della prima JSR, D0 è composto da:
      //   - D0.high = 0xFFFF (set da `moveq -0x1, D0` al top del loop)
      //   - D0.low  = entry[0x6].w (set da `move.w (0x6,A3),D0w` poco prima)
      // Dopo JSR: D0 = (0xFFFF << 16) | rngResult. tst.l è SEMPRE non-zero
      // (alta = 0xFFFF != 0). Quindi `beq` NON è mai presa → D1 = +0x6000.
      rngSignA = rng(state, MATH_RNG_LIMIT);
      // D0 effettivo per tst.l: (0xFFFF << 16) | rngSignA  → SEMPRE != 0
      const d0AfterRngA = ((0xffff << 16) | (rngSignA & 0xffff)) | 0;
      const d1a = d0AfterRngA === 0 ? -MATH_DAMP_MAGNITUDE : MATH_DAMP_MAGNITUDE;

      // entity[0..3] = (entity[0..3] >> 1 signed) + d1  (i32 wrap)
      // Importante: il valore i32 di `(entity[0..3]>>1) + d1a` finisce in D0
      // (via `add.l D1,D0; move.l D0,(A2)`) e questo è il D0 entrante alla
      // SECONDA JSR rng — la sua HIGH word determina il check `tst.l`.
      const long0 = readLongBE(state, off + ENTITY_LONG0_OFFSET);
      const long0New = (((long0 | 0) >> 1) + d1a) | 0; // D0 dopo l'add
      writeLongBE(state, off + ENTITY_LONG0_OFFSET, long0New >>> 0);

      // ── RNG(2) #2 ──────────────────────────────────────────────────
      // D0 entering second rng = long0New (32-bit). FUN_13A98 preserva D0.high.
      // After JSR: D0 = (long0New & 0xFFFF0000) | rngSignB.
      // tst.l → zero iff (long0New & 0xFFFF0000) == 0 AND rngSignB == 0.
      rngSignB = rng(state, MATH_RNG_LIMIT);
      const d0AfterRngB = ((long0New & 0xffff0000) | (rngSignB & 0xffff)) | 0;
      const d1b = d0AfterRngB === 0 ? -MATH_DAMP_MAGNITUDE : MATH_DAMP_MAGNITUDE;

      const long1 = readLongBE(state, off + ENTITY_LONG1_OFFSET);
      const long1New = (((long1 | 0) >> 1) + d1b) | 0;
      writeLongBE(state, off + ENTITY_LONG1_OFFSET, long1New >>> 0);

      // entity[0x36] = 2
      writeByte(state, off + ENTITY_FLAG36_OFFSET, MATH_FLAG36_VALUE);

      // soundCommand(0x45)
      subs?.soundCommand?.(MATH_SOUND_ID);
    } else {
      // ─── Reflect block ───────────────────────────────────────────
      // dist = sext16(entity[0x14]) - sext16(entry[0x6])
      // if 12 <= dist (signed) → skip (no negate)
      // else → negate entity[0..3] and entity[4..7]
      const dist = (sext16(entityWord14) - sext16(entryWord6)) | 0;
      if (REFLECT_DISTANCE_THRESHOLD <= dist) {
        branch = "reflect_skip";
      } else {
        branch = "reflect_neg";
        const long0 = readLongBE(state, off + ENTITY_LONG0_OFFSET);
        writeLongBE(state, off + ENTITY_LONG0_OFFSET, (-(long0 | 0)) >>> 0);
        const long1 = readLongBE(state, off + ENTITY_LONG1_OFFSET);
        writeLongBE(state, off + ENTITY_LONG1_OFFSET, (-(long1 | 0)) >>> 0);
      }
    }

    hits.push({ index: i, branch, rngSignA, rngSignB });
    d5 = 1; // sticky
  }

  // ─── Return: ext.w(D5b) → ext.l(D0w) ────────────────────────────────
  // D5 is 0 or 1 (clr.b/moveq.l #1), so sext is identity. result ∈ {0, 1}.
  return { earlyOut: false, result: d5, hits };
}
