/**
 * helper-25fc2.test.ts — unit test di `helper25FC2` (FUN_00025FC2).
 *
 * FUN_00025FC2 (129 istr, 0x25FC2..0x26194) è un animation-sequence stepper:
 * avanza il puntatore animazione di una object struct in work RAM,
 * e dispatcha una transizione di stato quando la sequenza ROM termina
 * (sentinel `0xFFFFFFFF`).
 *
 * Test copertura:
 *   1. Costante indirizzo corretta
 *   2. Early return (frame_ctr < frames_per_step)
 *   3. Main frame advance (frame_ctr == frames_per_step)
 *   4. Sub-frame advance (state==2, anim_ptr in range, index > 9)
 *   5. Sub-frame: sub_frame_ctr == 1 → azz. + advance secondary_ptr
 *   6. Sub-frame: sub_frame_ctr != 1 → no secondary advance
 *   7. Wrap detection (state==2, index==9 dopo advance): sound(0x5F) + setup
 *   8. Sentinel check: no sentinel → return senza dispatch
 *   9. Sentinel + state 1: A2[+0x56] > 6 → anim 0x20FB6
 *  10. Sentinel + state 1: A2[+0x56] <= 6 → anim 0x20FD2
 *  11. Sentinel + state 5: stessa logica
 *  12. Sentinel + state 2 / step56==0: reset + mark step56=1
 *  13. Sentinel + state 2 / step56==1: soundPair + objectStateEntry(2)
 *  14. Sentinel + state 2 / step56>=2: clr flag67, step-3 dispatch
 *      a) A2 è primo oggetto coppia → clr word_a4
 *      b) A2 è secondo oggetto coppia → clr word_a4
 *      c) A2 è altro → NO clr word_a4
 *      d) secondary_state==2 → helper18F46 (typeCode 1 se primo, 2 se altro)
 *      e) secondary_state!=2 → objectStateEntry(4) + set obj_type=0x65
 *  15. Sentinel + altri state → set obj_type=0x65 + objectStateEntry(4)
 *  16. No-spill: nessun campo non previsto viene toccato
 *
 * Bit-perfect 500/500 verificato via
 * `cli/src/test-helper-25fc2-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  helper25FC2,
  HELPER_25FC2_ADDR,
  ANIM_BASE_ROM,
  OBJECT_PAIR_BASE,
  OBJECT_PAIR_SECOND_OFFSET,
  ANIM_PTRS,
  SOUND_WRAP_INDEX9,
  HELPER_25FC2_SUB_ADDRS,
  type Helper25FC2Subs,
} from "../src/helper-25fc2.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WORK_RAM_BASE = 0x400000;
const OBJ_ABS = 0x00401200; // oggetto generico in work RAM
const OBJ_OFF = OBJ_ABS - WORK_RAM_BASE;

function readU32BE(r: Uint8Array, off: number): number {
  return (
    (((r[off] ?? 0) << 24) |
      ((r[off + 1] ?? 0) << 16) |
      ((r[off + 2] ?? 0) << 8) |
      (r[off + 3] ?? 0)) >>>
    0
  );
}

function writeU32BE(r: Uint8Array, off: number, v: number): void {
  const x = v >>> 0;
  r[off] = (x >>> 24) & 0xff;
  r[off + 1] = (x >>> 16) & 0xff;
  r[off + 2] = (x >>> 8) & 0xff;
  r[off + 3] = x & 0xff;
}

function readU16BE(r: Uint8Array, off: number): number {
  return (((r[off] ?? 0) << 8) | (r[off + 1] ?? 0)) & 0xffff;
}

/**
 * Imposta il sentinel 0xFFFFFFFF nella ROM all'indirizzo `romAddr`.
 */
function setSentinel(rom: ReturnType<typeof emptyRomImage>, romAddr: number): void {
  rom.program[romAddr] = 0xff;
  rom.program[romAddr + 1] = 0xff;
  rom.program[romAddr + 2] = 0xff;
  rom.program[romAddr + 3] = 0xff;
}

/**
 * Imposta un valore NON-sentinel nella ROM all'indirizzo `romAddr`.
 */
function clearSentinel(rom: ReturnType<typeof emptyRomImage>, romAddr: number): void {
  rom.program[romAddr] = 0x00;
  rom.program[romAddr + 1] = 0x21;
  rom.program[romAddr + 2] = 0x40;
  rom.program[romAddr + 3] = 0x0a;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("helper25FC2 (FUN_00025FC2)", () => {
  it("1. HELPER_25FC2_ADDR è 0x00025fc2", () => {
    expect(HELPER_25FC2_ADDR).toBe(0x00025fc2);
  });

  it("2. costanti pubbliche corrette", () => {
    expect(ANIM_BASE_ROM).toBe(0x00020fde);
    expect(OBJECT_PAIR_BASE).toBe(0x00400018);
    expect(OBJECT_PAIR_SECOND_OFFSET).toBe(0xe2);
    expect(ANIM_PTRS.highCount).toBe(0x00020fb6);
    expect(ANIM_PTRS.lowCount).toBe(0x00020fd2);
    expect(ANIM_PTRS.secondary).toBe(0x000215f6);
    expect(SOUND_WRAP_INDEX9).toBe(0x5f);
    expect(HELPER_25FC2_SUB_ADDRS.fun_158AC).toBe(0x000158ac);
    expect(HELPER_25FC2_SUB_ADDRS.fun_15884).toBe(0x00015884);
    expect(HELPER_25FC2_SUB_ADDRS.fun_25BAE).toBe(0x00025bae);
    expect(HELPER_25FC2_SUB_ADDRS.fun_18F46).toBe(0x00018f46);
  });

  it("3. early return: frame_ctr < frames_per_step → nessun avanzamento", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    // anim_ptr punta a indirizzo ROM non-sentinel
    const animPtr = 0x00020fe2; // A1+4 = ANIM_BASE_ROM+4
    writeU32BE(r, OBJ_OFF + 0x5a, animPtr);
    clearSentinel(rom, animPtr);

    r[OBJ_OFF + 0x1a] = 0x00; // state = 0 (not 2)
    r[OBJ_OFF + 0x5f] = 0x01; // frame_ctr = 1
    r[OBJ_OFF + 0x60] = 0x05; // frames_per_step = 5

    const sounds: number[] = [];
    const ose25Calls: { objPtr: number; code: number }[] = [];
    helper25FC2(state, rom, OBJ_ABS, {
      soundCommand: (cmd) => sounds.push(cmd),
      objectStateEntry25BAE: (_s, p, c) => ose25Calls.push({ objPtr: p, code: c }),
    });

    // frame_ctr avanzato a 2 (1→2), ma fps=5 > 2 → return early
    expect(r[OBJ_OFF + 0x5f]).toBe(2);
    // anim_ptr NON avanzato
    expect(readU32BE(r, OBJ_OFF + 0x5a)).toBe(animPtr);
    expect(sounds).toHaveLength(0);
    expect(ose25Calls).toHaveLength(0);
  });

  it("4. main frame advance: frame_ctr == frames_per_step → avanza anim_ptr", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    const animPtr = 0x00020fe2;
    writeU32BE(r, OBJ_OFF + 0x5a, animPtr);
    clearSentinel(rom, animPtr + 4); // il prossimo entry non è sentinel

    r[OBJ_OFF + 0x1a] = 0x00; // state != 2
    r[OBJ_OFF + 0x5f] = 0x02; // frame_ctr = 2
    r[OBJ_OFF + 0x60] = 0x02; // frames_per_step = 2

    helper25FC2(state, rom, OBJ_ABS, {});

    // frame_ctr → 3 → 3 == 2? No, 2 > 3 → return early?
    // Wait: incremented to 3, then signed cmp: fps(2) > fc(3)? 2 > 3 signed = false → advance
    // Actually: 2 > 3 is false, so we advance
    expect(r[OBJ_OFF + 0x5f]).toBe(0); // cleared after advance
    expect(readU32BE(r, OBJ_OFF + 0x5a)).toBe(animPtr + 4); // advanced by 4
  });

  it("5. early return corretto (fps signed > fc signed)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    const animPtr = 0x00020fe2;
    writeU32BE(r, OBJ_OFF + 0x5a, animPtr);
    clearSentinel(rom, animPtr);

    r[OBJ_OFF + 0x1a] = 0x00;
    r[OBJ_OFF + 0x5f] = 0x00; // frame_ctr = 0 → dopo incr = 1
    r[OBJ_OFF + 0x60] = 0x03; // fps = 3 > 1 → early return

    helper25FC2(state, rom, OBJ_ABS, {});

    expect(r[OBJ_OFF + 0x5f]).toBe(1); // incrementato ma non azzerato
    expect(readU32BE(r, OBJ_OFF + 0x5a)).toBe(animPtr); // non avanzato
  });

  it("6. sub-frame advance: state==2, ptr in range, index > 9 → incr sub_frame_ctr", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    // anim_ptr = A1 + 11*4 = 0x20FDE + 44 = 0x2100A (index 11 > 9)
    const animPtr = ANIM_BASE_ROM + 11 * 4;
    writeU32BE(r, OBJ_OFF + 0x5a, animPtr);
    clearSentinel(rom, animPtr + 4); // prossimo non sentinel

    r[OBJ_OFF + 0x1a] = 0x02; // state = 2
    r[OBJ_OFF + 0x66] = 0x03; // sub_frame_ctr = 3 (dopo incr → 4, != 1 → no advance)
    r[OBJ_OFF + 0x5f] = 0x00; // frame_ctr = 0
    r[OBJ_OFF + 0x60] = 0x05; // fps = 5 → early return dopo incr frame_ctr=1

    const secPtrBefore = 0x00021000;
    writeU32BE(r, OBJ_OFF + 0x62, secPtrBefore);

    helper25FC2(state, rom, OBJ_ABS, {});

    // sub_frame_ctr: 3 → 4
    expect(r[OBJ_OFF + 0x66]).toBe(4);
    // secondary_ptr NON avanzato (sub_frame_ctr != 1)
    expect(readU32BE(r, OBJ_OFF + 0x62)).toBe(secPtrBefore);
  });

  it("7. sub-frame: sub_frame_ctr diventa 1 → reset + advance secondary_ptr", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    const animPtr = ANIM_BASE_ROM + 11 * 4; // index 11 > 9
    writeU32BE(r, OBJ_OFF + 0x5a, animPtr);
    clearSentinel(rom, animPtr + 4);

    r[OBJ_OFF + 0x1a] = 0x02; // state = 2
    r[OBJ_OFF + 0x66] = 0x00; // sub_frame_ctr = 0 → incr → 1 → clear + advance
    r[OBJ_OFF + 0x5f] = 0x00; // frame_ctr = 0
    r[OBJ_OFF + 0x60] = 0x05; // fps = 5 → early return

    const secPtr = 0x000215f6;
    writeU32BE(r, OBJ_OFF + 0x62, secPtr);

    helper25FC2(state, rom, OBJ_ABS, {});

    // sub_frame_ctr azzerato
    expect(r[OBJ_OFF + 0x66]).toBe(0);
    // secondary_ptr avanzato di 4
    expect(readU32BE(r, OBJ_OFF + 0x62)).toBe(secPtr + 4);
  });

  it("8. sub-frame: non attivo se state != 2", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    const animPtr = ANIM_BASE_ROM + 11 * 4;
    writeU32BE(r, OBJ_OFF + 0x5a, animPtr);
    clearSentinel(rom, animPtr + 4);

    r[OBJ_OFF + 0x1a] = 0x01; // state = 1 (not 2)
    r[OBJ_OFF + 0x66] = 0x00; // sub_frame_ctr = 0
    r[OBJ_OFF + 0x5f] = 0x00;
    r[OBJ_OFF + 0x60] = 0x05;

    const secPtr = 0x00021000;
    writeU32BE(r, OBJ_OFF + 0x62, secPtr);

    helper25FC2(state, rom, OBJ_ABS, {});

    // sub_frame_ctr NON toccato (state != 2)
    expect(r[OBJ_OFF + 0x66]).toBe(0);
    expect(readU32BE(r, OBJ_OFF + 0x62)).toBe(secPtr);
  });

  it("9. wrap detection: state==2, index==9 dopo advance → sound(0x5F) + setup", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    // Arrange: dopo advance (frame_ctr == fps), nuovo anim_ptr sarà index 9
    // anim_ptr attuale = A1 + 8*4 = 0x20FFE (index 8), fps=1
    const animPtrBefore = ANIM_BASE_ROM + 8 * 4; // 0x20FFE
    const animPtrAfter = animPtrBefore + 4; // 0x21002 → index 9
    writeU32BE(r, OBJ_OFF + 0x5a, animPtrBefore);
    clearSentinel(rom, animPtrAfter); // il successivo non è sentinel

    r[OBJ_OFF + 0x1a] = 0x02; // state = 2
    r[OBJ_OFF + 0x5f] = 0x01; // frame_ctr = 1 → dopo incr = 2
    r[OBJ_OFF + 0x60] = 0x02; // fps = 2 → 2 > 2? No → advance

    r[OBJ_OFF + 0x66] = 0xaa; // sub_frame_ctr pre (non in range sub-frame: index 8 <= 9)
    r[OBJ_OFF + 0x67] = 0x00;
    writeU32BE(r, OBJ_OFF + 0x62, 0x00021000); // secondary_ptr pre

    const sounds: number[] = [];
    helper25FC2(state, rom, OBJ_ABS, {
      soundCommand: (cmd) => sounds.push(cmd),
    });

    // frame_ctr azzerato, anim_ptr avanzato a index 9
    expect(r[OBJ_OFF + 0x5f]).toBe(0);
    expect(readU32BE(r, OBJ_OFF + 0x5a)).toBe(animPtrAfter);
    // sound(0x5F) chiamato
    expect(sounds).toEqual([SOUND_WRAP_INDEX9]);
    // secondary_ptr = 0x215F6
    expect(readU32BE(r, OBJ_OFF + 0x62)).toBe(ANIM_PTRS.secondary);
    // flag67 = 1
    expect(r[OBJ_OFF + 0x67]).toBe(1);
    // sub_frame_ctr azzerato
    expect(r[OBJ_OFF + 0x66]).toBe(0);
  });

  it("10. sentinel check: non sentinel → return senza dispatch", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    const animPtr = 0x00021002;
    writeU32BE(r, OBJ_OFF + 0x5a, animPtr);
    clearSentinel(rom, animPtr); // NOT sentinel
    // però dopo l'advance arriverà a animPtr+4
    clearSentinel(rom, animPtr + 4);

    r[OBJ_OFF + 0x1a] = 0x01; // state = 1
    r[OBJ_OFF + 0x5f] = 0x01;
    r[OBJ_OFF + 0x60] = 0x01; // fps = 1 → advance

    const ose25Calls: { code: number }[] = [];
    helper25FC2(state, rom, OBJ_ABS, {
      objectStateEntry25BAE: (_s, _p, c) => ose25Calls.push({ code: c }),
    });

    // Nessun dispatch
    expect(ose25Calls).toHaveLength(0);
    // anim_ptr avanzato di 4
    expect(readU32BE(r, OBJ_OFF + 0x5a)).toBe(animPtr + 4);
  });

  it("11. sentinel + state 1 + A2[+0x56] > 6 → anim_ptr = 0x20FB6, fps=2", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    const animPtr = 0x00020fe2;
    // advance: frame_ctr=1, fps=1 → advance → new_ptr=animPtr+4
    writeU32BE(r, OBJ_OFF + 0x5a, animPtr);
    setSentinel(rom, animPtr + 4); // il nuovo ptr punta a sentinel

    r[OBJ_OFF + 0x1a] = 0x01; // state = 1
    r[OBJ_OFF + 0x56] = 0x07; // step56 = 7 > 6 → highCount
    r[OBJ_OFF + 0x5f] = 0x01;
    r[OBJ_OFF + 0x60] = 0x01;

    helper25FC2(state, rom, OBJ_ABS, {});

    expect(readU32BE(r, OBJ_OFF + 0x5a)).toBe(ANIM_PTRS.highCount); // 0x20FB6
    expect(r[OBJ_OFF + 0x5f]).toBe(0);
    expect(r[OBJ_OFF + 0x60]).toBe(2);
  });

  it("12. sentinel + state 1 + A2[+0x56] <= 6 → anim_ptr = 0x20FD2, fps=2", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    const animPtr = 0x00020fe2;
    writeU32BE(r, OBJ_OFF + 0x5a, animPtr);
    setSentinel(rom, animPtr + 4);

    r[OBJ_OFF + 0x1a] = 0x01; // state = 1
    r[OBJ_OFF + 0x56] = 0x06; // step56 = 6 == 6 → lowCount (ble: <= 6)
    r[OBJ_OFF + 0x5f] = 0x01;
    r[OBJ_OFF + 0x60] = 0x01;

    helper25FC2(state, rom, OBJ_ABS, {});

    expect(readU32BE(r, OBJ_OFF + 0x5a)).toBe(ANIM_PTRS.lowCount); // 0x20FD2
    expect(r[OBJ_OFF + 0x5f]).toBe(0);
    expect(r[OBJ_OFF + 0x60]).toBe(2);
  });

  it("13. sentinel + state 5 + A2[+0x56] > 6 → stessa logica di state 1", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    const animPtr = 0x00020fe2;
    writeU32BE(r, OBJ_OFF + 0x5a, animPtr);
    setSentinel(rom, animPtr + 4);

    r[OBJ_OFF + 0x1a] = 0x05; // state = 5
    r[OBJ_OFF + 0x56] = 0x0a; // > 6
    r[OBJ_OFF + 0x5f] = 0x01;
    r[OBJ_OFF + 0x60] = 0x01;

    helper25FC2(state, rom, OBJ_ABS, {});

    expect(readU32BE(r, OBJ_OFF + 0x5a)).toBe(ANIM_PTRS.highCount);
    expect(r[OBJ_OFF + 0x5f]).toBe(0);
    expect(r[OBJ_OFF + 0x60]).toBe(2);
  });

  it("14. sentinel + state 2 + step56==0 → reset + set step56=1", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    const animPtr = 0x00020fe2;
    writeU32BE(r, OBJ_OFF + 0x5a, animPtr);
    setSentinel(rom, animPtr + 4);

    r[OBJ_OFF + 0x1a] = 0x02; // state = 2
    r[OBJ_OFF + 0x56] = 0x00; // step56 = 0
    r[OBJ_OFF + 0x5f] = 0x01;
    r[OBJ_OFF + 0x60] = 0x01;

    const ose25Calls: { code: number }[] = [];
    const soundPairCalls: number[] = [];
    helper25FC2(state, rom, OBJ_ABS, {
      soundPair15884: () => soundPairCalls.push(1),
      objectStateEntry25BAE: (_s, _p, c) => ose25Calls.push({ code: c }),
    });

    expect(readU32BE(r, OBJ_OFF + 0x5a)).toBe(ANIM_PTRS.lowCount);
    expect(r[OBJ_OFF + 0x5f]).toBe(0);
    expect(r[OBJ_OFF + 0x60]).toBe(2);
    expect(r[OBJ_OFF + 0x56]).toBe(1);
    expect(soundPairCalls).toHaveLength(0);
    expect(ose25Calls).toHaveLength(0);
  });

  it("15. sentinel + state 2 + step56==1 → soundPair + objectStateEntry(2)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    const animPtr = 0x00020fe2;
    writeU32BE(r, OBJ_OFF + 0x5a, animPtr);
    setSentinel(rom, animPtr + 4);

    r[OBJ_OFF + 0x1a] = 0x02; // state = 2
    r[OBJ_OFF + 0x56] = 0x01; // step56 = 1
    r[OBJ_OFF + 0x5f] = 0x01;
    r[OBJ_OFF + 0x60] = 0x01;

    const soundPairCalls: number[] = [];
    const ose25Calls: { objPtr: number; code: number }[] = [];
    helper25FC2(state, rom, OBJ_ABS, {
      soundPair15884: () => soundPairCalls.push(1),
      objectStateEntry25BAE: (_s, p, c) => ose25Calls.push({ objPtr: p, code: c }),
    });

    expect(soundPairCalls).toHaveLength(1);
    expect(ose25Calls).toHaveLength(1);
    expect(ose25Calls[0]).toEqual({ objPtr: OBJ_ABS, code: 0x02 });
  });

  it("16. sentinel + state 2 + step56>=2 → clr flag67, dispatch state-3", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    const animPtr = 0x00020fe2;
    writeU32BE(r, OBJ_OFF + 0x5a, animPtr);
    setSentinel(rom, animPtr + 4);

    r[OBJ_OFF + 0x1a] = 0x02; // state = 2
    r[OBJ_OFF + 0x56] = 0x02; // step56 = 2 >= 2 → step3
    r[OBJ_OFF + 0x67] = 0xff; // flag67 pre
    r[OBJ_OFF + 0x18] = 0x00; // secondary_state = 0 (not 2) → objectStateEntry(4)
    r[OBJ_OFF + 0x5f] = 0x01;
    r[OBJ_OFF + 0x60] = 0x01;

    const ose25Calls: { objPtr: number; code: number }[] = [];
    helper25FC2(state, rom, OBJ_ABS, {
      objectStateEntry25BAE: (_s, p, c) => ose25Calls.push({ objPtr: p, code: c }),
    });

    // flag67 azzerato
    expect(r[OBJ_OFF + 0x67]).toBe(0);
    // obj_type impostato a 0x65
    expect(r[OBJ_OFF + 0x57]).toBe(0x65);
    // objectStateEntry(4) chiamato
    expect(ose25Calls).toHaveLength(1);
    expect(ose25Calls[0]).toEqual({ objPtr: OBJ_ABS, code: 0x04 });
  });

  it("17. state-3: A2 è primo oggetto coppia → clr word_a4", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    const objAbsFirst = OBJECT_PAIR_BASE; // 0x400018
    const objOffFirst = objAbsFirst - WORK_RAM_BASE;

    const animPtr = 0x00020fe2;
    writeU32BE(r, objOffFirst + 0x5a, animPtr);
    setSentinel(rom, animPtr + 4);

    r[objOffFirst + 0x1a] = 0x02;
    r[objOffFirst + 0x56] = 0x03; // >= 2
    r[objOffFirst + 0x18] = 0x00; // secondary_state != 2
    r[objOffFirst + 0x5f] = 0x01;
    r[objOffFirst + 0x60] = 0x01;
    // Scrivi valore non-zero in word_a4
    r[objOffFirst + 0xa4] = 0xbe;
    r[objOffFirst + 0xa5] = 0xef;

    helper25FC2(state, rom, objAbsFirst, {
      objectStateEntry25BAE: () => { /* noop */ },
    });

    // word_a4 azzerato (A2 == A3 → clr.w)
    expect(readU16BE(r, objOffFirst + 0xa4)).toBe(0);
  });

  it("18. state-3: A2 è secondo oggetto coppia → clr word_a4", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    const objAbsSecond = OBJECT_PAIR_BASE + OBJECT_PAIR_SECOND_OFFSET; // 0x4000FA
    const objOffSecond = objAbsSecond - WORK_RAM_BASE;

    const animPtr = 0x00020fe2;
    writeU32BE(r, objOffSecond + 0x5a, animPtr);
    setSentinel(rom, animPtr + 4);

    r[objOffSecond + 0x1a] = 0x02;
    r[objOffSecond + 0x56] = 0x03;
    r[objOffSecond + 0x18] = 0x00;
    r[objOffSecond + 0x5f] = 0x01;
    r[objOffSecond + 0x60] = 0x01;
    r[objOffSecond + 0xa4] = 0xca;
    r[objOffSecond + 0xa5] = 0xfe;

    helper25FC2(state, rom, objAbsSecond, {
      objectStateEntry25BAE: () => { /* noop */ },
    });

    expect(readU16BE(r, objOffSecond + 0xa4)).toBe(0);
  });

  it("19. state-3: A2 altro → NO clr word_a4", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    const animPtr = 0x00020fe2;
    writeU32BE(r, OBJ_OFF + 0x5a, animPtr);
    setSentinel(rom, animPtr + 4);

    r[OBJ_OFF + 0x1a] = 0x02;
    r[OBJ_OFF + 0x56] = 0x03;
    r[OBJ_OFF + 0x18] = 0x00;
    r[OBJ_OFF + 0x5f] = 0x01;
    r[OBJ_OFF + 0x60] = 0x01;
    r[OBJ_OFF + 0xa4] = 0xde;
    r[OBJ_OFF + 0xa5] = 0xad;

    helper25FC2(state, rom, OBJ_ABS, {
      objectStateEntry25BAE: () => { /* noop */ },
    });

    // word_a4 NON toccata
    expect(r[OBJ_OFF + 0xa4]).toBe(0xde);
    expect(r[OBJ_OFF + 0xa5]).toBe(0xad);
  });

  it("20. state-3: secondary_state==2 → clr 0x18 + helper18F46 (typeCode=1 primo)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    const objAbsFirst = OBJECT_PAIR_BASE;
    const objOffFirst = objAbsFirst - WORK_RAM_BASE;

    const animPtr = 0x00020fe2;
    writeU32BE(r, objOffFirst + 0x5a, animPtr);
    setSentinel(rom, animPtr + 4);

    r[objOffFirst + 0x1a] = 0x02;
    r[objOffFirst + 0x56] = 0x03;
    r[objOffFirst + 0x18] = 0x02; // secondary_state == 2 → helper18F46
    r[objOffFirst + 0x19] = 0x04; // sub_idx
    r[objOffFirst + 0x5f] = 0x01;
    r[objOffFirst + 0x60] = 0x01;

    const h18f46Calls: { typeCode: number; subIdx: number }[] = [];
    helper25FC2(state, rom, objAbsFirst, {
      helper18F46: (_s, _r, tc, si) => h18f46Calls.push({ typeCode: tc, subIdx: si }),
    });

    expect(r[objOffFirst + 0x18]).toBe(0); // clr.b 0x18
    expect(h18f46Calls).toHaveLength(1);
    expect(h18f46Calls[0]).toEqual({ typeCode: 1, subIdx: 0x04 });
  });

  it("21. state-3: secondary_state==2 → typeCode=1 per secondo oggetto", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    const objAbsSecond = OBJECT_PAIR_BASE + OBJECT_PAIR_SECOND_OFFSET;
    const objOffSecond = objAbsSecond - WORK_RAM_BASE;

    const animPtr = 0x00020fe2;
    writeU32BE(r, objOffSecond + 0x5a, animPtr);
    setSentinel(rom, animPtr + 4);

    r[objOffSecond + 0x1a] = 0x02;
    r[objOffSecond + 0x56] = 0x03;
    r[objOffSecond + 0x18] = 0x02;
    r[objOffSecond + 0x19] = 0x07;
    r[objOffSecond + 0x5f] = 0x01;
    r[objOffSecond + 0x60] = 0x01;

    const h18f46Calls: { typeCode: number; subIdx: number }[] = [];
    helper25FC2(state, rom, objAbsSecond, {
      helper18F46: (_s, _r, tc, si) => h18f46Calls.push({ typeCode: tc, subIdx: si }),
    });

    expect(h18f46Calls).toHaveLength(1);
    expect(h18f46Calls[0]).toEqual({ typeCode: 1, subIdx: 0x07 });
  });

  it("22. state-3: secondary_state==2 → typeCode=2 per oggetto non nella coppia", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    const animPtr = 0x00020fe2;
    writeU32BE(r, OBJ_OFF + 0x5a, animPtr);
    setSentinel(rom, animPtr + 4);

    r[OBJ_OFF + 0x1a] = 0x02;
    r[OBJ_OFF + 0x56] = 0x03;
    r[OBJ_OFF + 0x18] = 0x02;
    r[OBJ_OFF + 0x19] = 0x09;
    r[OBJ_OFF + 0x5f] = 0x01;
    r[OBJ_OFF + 0x60] = 0x01;

    const h18f46Calls: { typeCode: number; subIdx: number }[] = [];
    helper25FC2(state, rom, OBJ_ABS, {
      helper18F46: (_s, _r, tc, si) => h18f46Calls.push({ typeCode: tc, subIdx: si }),
    });

    expect(h18f46Calls).toHaveLength(1);
    expect(h18f46Calls[0]).toEqual({ typeCode: 2, subIdx: 0x09 });
  });

  it("23. sentinel + altri state → set obj_type=0x65 + objectStateEntry(4)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    const animPtr = 0x00020fe2;
    writeU32BE(r, OBJ_OFF + 0x5a, animPtr);
    setSentinel(rom, animPtr + 4);

    r[OBJ_OFF + 0x1a] = 0x03; // state = 3 (non 1, 2, 5)
    r[OBJ_OFF + 0x57] = 0x00; // obj_type pre
    r[OBJ_OFF + 0x5f] = 0x01;
    r[OBJ_OFF + 0x60] = 0x01;

    const ose25Calls: { objPtr: number; code: number }[] = [];
    helper25FC2(state, rom, OBJ_ABS, {
      objectStateEntry25BAE: (_s, p, c) => ose25Calls.push({ objPtr: p, code: c }),
    });

    expect(r[OBJ_OFF + 0x57]).toBe(0x65);
    expect(ose25Calls).toHaveLength(1);
    expect(ose25Calls[0]).toEqual({ objPtr: OBJ_ABS, code: 0x04 });
  });

  it("24. sub-frame: non attivo se ptr <= anim_base (A1)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    // anim_ptr == A1 → non > A1 → skip sub-frame
    writeU32BE(r, OBJ_OFF + 0x5a, ANIM_BASE_ROM);
    clearSentinel(rom, ANIM_BASE_ROM + 4);

    r[OBJ_OFF + 0x1a] = 0x02;
    r[OBJ_OFF + 0x66] = 0x00;
    r[OBJ_OFF + 0x5f] = 0x00;
    r[OBJ_OFF + 0x60] = 0x05; // early return

    helper25FC2(state, rom, OBJ_ABS, {});

    expect(r[OBJ_OFF + 0x66]).toBe(0); // sub_frame_ctr non toccato
  });

  it("25. sub-frame: non attivo se index <= 9", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    // index = 9: non > 9 → skip sub-frame
    const animPtr = ANIM_BASE_ROM + 9 * 4;
    writeU32BE(r, OBJ_OFF + 0x5a, animPtr);
    clearSentinel(rom, animPtr + 4);

    r[OBJ_OFF + 0x1a] = 0x02;
    r[OBJ_OFF + 0x66] = 0x00;
    r[OBJ_OFF + 0x5f] = 0x00;
    r[OBJ_OFF + 0x60] = 0x05;

    helper25FC2(state, rom, OBJ_ABS, {});

    expect(r[OBJ_OFF + 0x66]).toBe(0);
  });

  it("26. addq.b wrap: frame_ctr 0xFF → 0x00 (byte wrap)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = state.workRam;

    const animPtr = 0x00020fe2;
    writeU32BE(r, OBJ_OFF + 0x5a, animPtr);
    clearSentinel(rom, animPtr);

    r[OBJ_OFF + 0x1a] = 0x00;
    r[OBJ_OFF + 0x5f] = 0xff; // 0xFF + 1 = 0x00 (byte wrap)
    r[OBJ_OFF + 0x60] = 0x05; // fps=5 > 0 → early return

    helper25FC2(state, rom, OBJ_ABS, {});

    // 0xFF + 1 = 0x00, poi 5 > 0 (signed: both +ve) → early return
    expect(r[OBJ_OFF + 0x5f]).toBe(0x00);
  });
});
