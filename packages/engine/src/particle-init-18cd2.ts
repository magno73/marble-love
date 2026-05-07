/**
 * particle-init-18cd2.ts — replica `FUN_00018CD2` (248 byte).
 *
 * **Particle-array spawn/init** (loop count = arg1 LSB) sull'array
 * `0x400A9C`, stride 0xA. Stesso array consumato da `particle-bounce.ts`
 * (`FUN_00018DCA`). Per ogni slot:
 *   - genera xpos / ypos via RNG con offset
 *   - genera xvel / yvel via RNG con bias signed
 *   - genera animation/mode field (offset 8..9) basato su arg2 LSB
 *   - chiama `FUN_00018E6C` per inserire un rect entry (typeCode 0x2C,
 *     subIdx = i) nella draw-list ordinata
 * Alla fine: `*0x004003E2 = D3` (count consumato da `particleBounce`).
 *
 * Ulteriore side-effect: se arg2 LSB == 0xFF (mode "RANDOM_8"), all'ingresso
 * chiama `FUN_00026CFA` (`paletteRngFill26CFA` — refresh palette + 8 RNG).
 *
 * **Disasm 0x18CD2..0x18DC9** (248 byte):
 *
 *   0x18CD2: movem.l {A3,A2,D4,D3,D2},-(SP) ; save (5 longs = 0x14 byte)
 *   0x18CD6: move.b  (0x1B,SP),D3b           ; D3 = arg1 LSB = "count"
 *   0x18CDA: move.b  (0x1F,SP),D2b           ; D2 = arg2 LSB = "mode"
 *   0x18CDE: movea.l #0x13a98,A3             ; A3 = &FUN_13A98 (RNG)
 *   0x18CE4: cmpi.b  #-0x1,D2b
 *   0x18CE8: bne.b   0x18CF0                 ; if mode != 0xFF → skip
 *   0x18CEA: jsr     0x00026cfa.l            ; jsr FUN_26CFA (palette+8 RNG)
 *   0x18CF0: movea.l #0x400a9c,A2            ; A2 = particle array base
 *   0x18CF6: clr.b   D4b                     ; D4 = i = 0
 *   0x18CF8: bra.w   0x18DB8                 ; jump to loop test
 *   ; ─── loop body @ 0x18CFC ──────────────────────────────────────────
 *   0x18CFC: pea     (0x100).w               ; rng(256)
 *   0x18D00: jsr     (A3)
 *   0x18D02: ext.l   D0
 *   0x18D04: andi.l  #0xff,D0                ; D0 &= 0xFF
 *   0x18D0A: moveq   #0x24,D1
 *   0x18D0C: add.l   D1,D0                   ; D0 += 0x24
 *   0x18D0E: asl.l   #4,D0                   ; D0 <<= 4
 *   0x18D10: move.w  D0w,(A2)                ; entry[0..1] = xpos
 *   0x18D12: pea     (0x80).w                ; rng(128)
 *   0x18D16: jsr     (A3)
 *   0x18D18: moveq   #0x30,D1
 *   0x18D1A: add.l   D1,D0
 *   0x18D1C: asl.l   #4,D0                   ; (rng(128)+0x30) << 4
 *   0x18D1E: move.w  D0w,(0x2,A2)            ; entry[2..3] = ypos
 *   0x18D22: pea     (0x60).w                ; rng(96)
 *   0x18D26: jsr     (A3)
 *   0x18D28: subi.w  #0x30,D0w               ; xvel = rng(96) - 0x30
 *   0x18D2C: move.w  D0w,(0x4,A2)            ; entry[4..5] = xvel (raw)
 *   0x18D30: lea     (0xc,SP),SP             ; pop 3 args
 *   0x18D34: bge.b   0x18D3E                 ; xvel >= 0 → +0x10
 *   0x18D36: subi.w  #0x10,(0x4,A2)          ; xvel < 0 → -0x10
 *   0x18D3C: bra.b   0x18D44
 *   0x18D3E: addi.w  #0x10,(0x4,A2)
 *   0x18D44: pea     (0x60).w                ; rng(96) (yvel)
 *   0x18D48: jsr     (A3)
 *   0x18D4A: subi.w  #0x30,D0w
 *   0x18D4E: move.w  D0w,(0x6,A2)            ; entry[6..7] = yvel (raw)
 *   0x18D52: addq.l  #4,SP
 *   0x18D54: bge.b   0x18D5E
 *   0x18D56: subi.w  #0x10,(0x6,A2)
 *   0x18D5C: bra.b   0x18D64
 *   0x18D5E: addi.w  #0x10,(0x6,A2)
 *   ; ─── animation/mode word @ entry[8..9] ───────────────────────────
 *   0x18D64: tst.b   D2b                     ; mode (signed)
 *   0x18D66: blt.b   0x18D72                 ; mode < 0 → branch
 *   0x18D68: move.b  D2b,D0b                 ; mode in [0..0x7F]:
 *   0x18D6A: ext.w   D0w                     ;   D0w = sign-ext(mode)
 *   0x18D6C: move.w  D0w,(0x8,A2)            ;   entry[8..9] = mode word
 *   0x18D70: bra.b   0x18D92
 *   0x18D72: cmpi.b  #-0x1,D2b
 *   0x18D76: bne.b   0x18D86                 ; mode != 0xFF (and < 0) → rng(2)
 *   0x18D78: pea     (0x8).w                 ; mode == 0xFF: rng(8)
 *   0x18D7C: jsr     (A3)
 *   0x18D7E: move.w  D0w,(0x8,A2)
 *   0x18D82: addq.l  #4,SP
 *   0x18D84: bra.b   0x18D92
 *   0x18D86: pea     (0x2).w                 ; mode in [0x80..0xFE]: rng(2)
 *   0x18D8A: jsr     (A3)
 *   0x18D8C: move.w  D0w,(0x8,A2)
 *   0x18D90: addq.l  #4,SP
 *   0x18D92: move.w  (0x8,A2),D0w
 *   0x18D96: moveq   #0xb,D1
 *   0x18D98: asl.w   D1,D0w                  ; D0w <<= 11 (word)
 *   0x18D9A: move.w  D0w,(0x8,A2)            ; entry[8..9] = result
 *   ; ─── jsr FUN_18E6C(0x2C, i) ─────────────────────────────────────
 *   0x18D9E: move.b  D4b,D0b                 ; D0 = i
 *   0x18DA0: ext.w   D0w
 *   0x18DA2: ext.l   D0
 *   0x18DA4: move.l  D0,-(SP)                ; push i (long)   = subIdx
 *   0x18DA6: pea     (0x2c).w                ; push 0x2C (long)= typeCode
 *   0x18DAA: jsr     0x00018e6c.l
 *   0x18DB0: moveq   #0xa,D0
 *   0x18DB2: adda.l  D0,A2                   ; A2 += 10 (next slot)
 *   0x18DB4: addq.l  #8,SP                   ; pop 2 args
 *   0x18DB6: addq.b  #1,D4b                  ; i++
 *   0x18DB8: cmp.b   D3b,D4b                 ; (loop test entry)
 *   0x18DBA: bne.w   0x18CFC                 ; if i != count → loop
 *   0x18DBE: move.b  D3b,(0x004003e2).l      ; *0x4003E2 = count
 *   0x18DC4: movem.l (SP)+,{D2,D3,D4,A2,A3}
 *   0x18DC8: rts
 *
 * **Calling convention** (2 longword args RTL, LSB letti come byte):
 *   - `arg1` (long, LSB → D3): "count" — numero di slot da inizializzare,
 *     0..255. Scritto al termine in `*0x004003E2`.
 *   - `arg2` (long, LSB → D2): "mode" — controlla mode-word + palette refresh.
 *     - `0x00..0x7F` → entry[8] = sign-ext(mode) << 11 (NO RNG step)
 *     - `0x80..0xFE` → entry[8] = rng(2) << 11 (1 RNG step extra/slot)
 *     - `0xFF`        → entry[8] = rng(8) << 11 (1 RNG step extra/slot)
 *                        + chiamata IN INGRESSO a `FUN_26CFA` (8 RNG step
 *                        + palette refresh)
 *
 * **Numero di chiamate RNG per slot**:
 *   - 4 sempre (xpos, ypos, xvel, yvel).
 *   - +1 se mode in [0x80..0xFF] (mode-word RNG-driven).
 * **Numero di chiamate RNG one-shot al frame**:
 *   - +8 se mode == 0xFF (FUN_26CFA per palette).
 *
 * **JSR esterne**:
 *   - `FUN_00013A98` (RNG) — replica bit-perfect via `rngNext`. Sempre live.
 *   - `FUN_00026CFA` (palette + 8 RNG) — sub injection (default: no-op).
 *     Replicabile via `paletteRngFill26CFATick` se serve l'effetto reale.
 *   - `FUN_00018E6C` (slot insert sorted) — sub injection (default: no-op).
 *     Replicabile via `slotInsertSorted18E6C` se serve la draw-list reale.
 *
 * **Caller noti** (3 xref interni):
 *   - `FUN_00011452` @ 0x115B8 (main-loop init)
 *   - `FUN_00011B18` @ 0x11B60 (probabile "level reset")
 *   - `FUN_00018A88` @ 0x18AA2 (entity-related)
 *
 * **Effetti collaterali in `state.workRam`** (su 1+ slot e count byte):
 *   - `(0x400A9C + i*0xA)[0..1]` = xpos: `(rng(256)+0x24) << 4` (low 16-bit
 *     della long-shift; il bit 4 del high-byte viene perso, risultato è
 *     `((rngLow8+0x24)<<4) & 0xFFFF`).
 *   - `(0x400A9C + i*0xA)[2..3]` = ypos: `(rng(128)+0x30) << 4` (& 0xFFFF).
 *   - `(0x400A9C + i*0xA)[4..5]` = xvel: vedi calcolo signed sopra.
 *   - `(0x400A9C + i*0xA)[6..7]` = yvel: idem.
 *   - `(0x400A9C + i*0xA)[8..9]` = mode-word << 11 (& 0xFFFF).
 *   - `(0x004003E2)` = D3 (count) — DOPO il loop, sempre scritto.
 *   - `state.rng.seed` avanzato di:
 *       (4 + (mode>=0x80 ? 1 : 0)) * count + (mode==0xFF ? 8 : 0) step LFSR.
 *
 * Verifica bit-perfect via `packages/cli/src/test-particle-init-18cd2-parity.ts`
 * (500 casi).
 */

import type { GameState } from "./state.js";
import { rngNext } from "./rng.js";
import { as_u16 } from "./wrap.js";

// ─── Constants ───────────────────────────────────────────────────────────

/** Base assoluta workRam M68k. */
const WORK_RAM_BASE = 0x00400000;

/** Base assoluta del particle-array. */
export const PARTICLE_ARRAY_ABS = 0x00400a9c as const;
/** Stride per slot (10 byte). */
export const PARTICLE_STRIDE = 0x0a as const;
/** Indirizzo del byte "count" finale. */
export const COUNT_BYTE_ABS = 0x004003e2 as const;

/** Tipo code passato a `FUN_18E6C` per ogni slot. */
export const RECT_TYPE_CODE = 0x2c as const;

/** Marker `mode == 0xFF` → palette refresh + rng(8) per mode-word. */
export const MODE_RANDOM_8 = 0xff as const;

// ─── Helpers ─────────────────────────────────────────────────────────────

function writeWordBE(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}

function readWordBE(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff
  );
}

/**
 * Normalizza il risultato di `rngNext` da `[0, limit]` a `[0, limit)`.
 *
 * `rngNext` (in `rng.ts`) usa `while (r > limit) r -= limit` ⇒ puó ritornare
 * `r == limit`. Il binario (`FUN_13A98`) usa `cmp.w D0,D1; bgt exit; sub
 * D1,D0` ⇒ produce `r ∈ [0, limit)`. Stessa workaround di
 * `palette-rng-fill-26cfa.ts` e `state-sub-1960e.ts`.
 */
function rng(state: GameState, limit: number): number {
  let r = rngNext(state.rng, as_u16(limit)) as unknown as number;
  if (limit > 0) {
    while (r >= limit) r -= limit;
  }
  return r & 0xffff;
}

// ─── Sub injection ───────────────────────────────────────────────────────

/**
 * Stub injection per le 2 JSR esterne.
 *
 * - `fun_26cfa`: chiamata UNA volta in ingresso solo se `mode == 0xFF`.
 *    Default: no-op. Replicabile via `paletteRngFill26CFATick(state, rom)`.
 *    NOTA: avanza l'RNG di 8 step quando attiva — questo va replicato
 *    dalla callback per matchare il binario.
 * - `fun_18e6c`: chiamata per OGNI slot con `(typeCode=0x2C, subIdx=i)`.
 *    Default: no-op. Replicabile via `slotInsertSorted18E6C(state, rom,
 *    0x2C, i, slotInsertSubs)`.
 */
export interface ParticleInit18CD2Subs {
  /** Replica di `FUN_00026CFA` (palette refresh + 8 RNG). */
  fun_26cfa?: (state: GameState) => void;
  /** Replica di `FUN_00018E6C` (insert-sorted in draw-list). */
  fun_18e6c?: (state: GameState, typeCode: number, subIdx: number) => void;
}

// ─── Risultato ───────────────────────────────────────────────────────────

/**
 * Dettaglio per slot generato.
 */
export interface ParticleInit18CD2SlotDetail {
  /** Index dello slot (0..count-1). */
  index: number;
  /** xpos word scritto in entry[0..1]. */
  xpos: number;
  /** ypos word scritto in entry[2..3]. */
  ypos: number;
  /** xvel word scritto in entry[4..5] (dopo adjustment ±0x10). */
  xvel: number;
  /** yvel word scritto in entry[6..7] (dopo adjustment ±0x10). */
  yvel: number;
  /** mode-word scritto in entry[8..9] (dopo `<<11`). */
  modeWord: number;
}

export interface ParticleInit18CD2Result {
  /** Numero di slot inizializzati (= count = arg1 LSB). */
  count: number;
  /** Mode byte (= arg2 LSB). */
  mode: number;
  /** True se `fun_26cfa` è stato invocato (mode == 0xFF). */
  paletteRefreshed: boolean;
  /** Dettaglio per slot — array di lunghezza `count`. */
  slots: ParticleInit18CD2SlotDetail[];
}

// ─── Replica ─────────────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00018CD2`.
 *
 * @param state  GameState (modifica `workRam[0xA9C..0xA9C+count*0xA)`,
 *               `workRam[0x3E2]` e `state.rng.seed`).
 * @param count  byte (0..255) — LSB del primo arg pushato dal caller.
 * @param mode   byte (0..255) — LSB del secondo arg pushato dal caller.
 *               Vedi top-comment per la semantica dei range.
 * @param subs   sub injection per `FUN_26CFA` e `FUN_18E6C`. Default: no-op.
 *
 * @returns      dettaglio della run (count, mode, paletteRefreshed, slots[]).
 *
 * **Ordine delle scritture / RNG step** (rilevante per parity):
 *   1. Se `mode == 0xFF`: `subs.fun_26cfa(state)` (avanza RNG 8 step se
 *      replicato fedelmente).
 *   2. Per i = 0..count-1:
 *      a. `entry[0..1] = ((rng(256) & 0xFF) + 0x24) << 4` (& 0xFFFF)
 *      b. `entry[2..3] = (rng(128) + 0x30) << 4` (& 0xFFFF)
 *      c. raw = `rng(96) - 0x30` (signed word); `entry[4..5] = raw & 0xFFFF`,
 *         poi `entry[4..5] += 0x10` se raw >= 0 altrimenti `-= 0x10`.
 *      d. raw = `rng(96) - 0x30`; idem per `entry[6..7]`.
 *      e. mode-word secondo branch (vedi sopra), poi `entry[8..9] = (mw <<
 *         11) & 0xFFFF`.
 *      f. `subs.fun_18e6c(state, 0x2C, i)`.
 *   3. `workRam[0x3E2] = count`.
 */
export function particleInit18CD2(
  state: GameState,
  count: number,
  mode: number,
  subs: ParticleInit18CD2Subs = {},
): ParticleInit18CD2Result {
  const d3 = count & 0xff; // count
  const d2 = mode & 0xff; // mode

  // ─── Ingresso: cmpi.b #-1,D2; bne skip; jsr FUN_26CFA ────────────────
  const paletteRefreshed = d2 === MODE_RANDOM_8;
  if (paletteRefreshed) {
    subs.fun_26cfa?.(state);
  }

  const baseOff = PARTICLE_ARRAY_ABS - WORK_RAM_BASE; // 0xA9C
  const slots: ParticleInit18CD2SlotDetail[] = [];

  // d2 < 0 in m68k = byte >= 0x80
  const d2Negative = (d2 & 0x80) !== 0;

  for (let i = 0; i < d3; i++) {
    const entryOff = baseOff + i * PARTICLE_STRIDE;

    // ─── xpos: rng(256) & 0xFF, +0x24, <<4 (long-shift, then move.w) ──
    // `ext.l D0` su valore 0..0xFF è no-op; `andi.l #0xFF` esplicita la
    // mask. Dopo `add.l #0x24` il valore è 0x24..0x123 (entra in long).
    // `asl.l #4` produce 0x240..0x1230 (può uscire da word). `move.w D0w`
    // prende solo i low 16 bit ⇒ il bit 12 (0x1000) viene perso quando il
    // long supera 0xFFFF? No: 0x1230 < 0x10000 ⇒ resta intatto. Massimo
    // valore: (0xFF + 0x24) << 4 = 0x123 << 4 = 0x1230 ⇒ NO overflow di
    // word. Quindi & 0xFFFF è defensive ma sempre = al valore long.
    const r0 = rng(state, 0x100) & 0xff;
    const xpos = (((r0 + 0x24) << 4) & 0xffff) >>> 0;
    writeWordBE(state, entryOff + 0, xpos);

    // ─── ypos: (rng(128) + 0x30) << 4 (long-shift, low 16 bit) ────────
    // rng(128) ∈ [0..0x7F], +0x30 ∈ [0x30..0xAF], <<4 ∈ [0x300..0xAF0].
    // Tutti < 0x10000 ⇒ no perdita di bit.
    const r1 = rng(state, 0x80);
    const ypos = (((r1 + 0x30) << 4) & 0xffff) >>> 0;
    writeWordBE(state, entryOff + 2, ypos);

    // ─── xvel: rng(96) - 0x30 (signed word), poi adj ±0x10 in memoria ─
    // `subi.w #0x30,D0w` opera su word: se r2 in [0..0x2F] ⇒ D0w in
    // 0xFFD0..0xFFFF (signed -0x30..-1). Se r2 in [0x30..0x5F] ⇒ D0w in
    // 0x00..0x2F. La move.w preserva il pattern u16. Il bge legge il
    // segno di D0w (bit 15) post-subi.
    const r2 = rng(state, 0x60);
    const xvelRawSigned = r2 - 0x30; // -0x30..0x2F
    let xvelOut: number;
    writeWordBE(state, entryOff + 4, xvelRawSigned & 0xffff);
    if (xvelRawSigned >= 0) {
      // bge → addi.w #0x10,(0x4,A2)
      const v = (readWordBE(state, entryOff + 4) + 0x10) & 0xffff;
      writeWordBE(state, entryOff + 4, v);
      xvelOut = v;
    } else {
      // blt → subi.w #0x10,(0x4,A2) (note: addi.w sub mod 16-bit)
      const v = (readWordBE(state, entryOff + 4) - 0x10) & 0xffff;
      writeWordBE(state, entryOff + 4, v);
      xvelOut = v;
    }

    // ─── yvel: idem ───────────────────────────────────────────────────
    const r3 = rng(state, 0x60);
    const yvelRawSigned = r3 - 0x30;
    let yvelOut: number;
    writeWordBE(state, entryOff + 6, yvelRawSigned & 0xffff);
    if (yvelRawSigned >= 0) {
      const v = (readWordBE(state, entryOff + 6) + 0x10) & 0xffff;
      writeWordBE(state, entryOff + 6, v);
      yvelOut = v;
    } else {
      const v = (readWordBE(state, entryOff + 6) - 0x10) & 0xffff;
      writeWordBE(state, entryOff + 6, v);
      yvelOut = v;
    }

    // ─── mode-word: tst.b D2; blt … ───────────────────────────────────
    let modeWordPre: number;
    if (!d2Negative) {
      // mode in [0x00..0x7F]: D0w = sign-ext(D2.b). D2 in [0..0x7F] ⇒ D0w =
      // 0..0x7F (non-negativi, top byte zero). NO RNG step.
      modeWordPre = d2 & 0xffff; // sign-ext: bit 7 di d2 è 0 ⇒ word = d2
    } else if (d2 === MODE_RANDOM_8) {
      // mode == 0xFF: rng(8). Risultato word in [0..7].
      modeWordPre = rng(state, 0x08);
    } else {
      // mode in [0x80..0xFE]: rng(2). Risultato word in [0..1].
      modeWordPre = rng(state, 0x02);
    }

    // 0x18D9A: move.w D0w << 11 → entry[8..9]. asl.w D1=11,D0 — opera su
    // 16 bit, top bit shifted out ⇒ mask & 0xFFFF.
    const modeWord = (modeWordPre << 11) & 0xffff;
    writeWordBE(state, entryOff + 8, modeWord);

    // ─── jsr FUN_18E6C(0x2C, i) ──────────────────────────────────────
    subs.fun_18e6c?.(state, RECT_TYPE_CODE, i);

    slots.push({
      index: i,
      xpos,
      ypos,
      xvel: xvelOut,
      yvel: yvelOut,
      modeWord,
    });
  }

  // ─── Tail: *0x004003E2 = D3 (count) ──────────────────────────────────
  state.workRam[COUNT_BYTE_ABS - WORK_RAM_BASE] = d3;

  return {
    count: d3,
    mode: d2,
    paletteRefreshed,
    slots,
  };
}
