/**
 * object-render-update-13334.ts — `FUN_00013334` replica (280 bytes).
 *
 * (xref: `FUN_00012896`, `FUN_00013068` ×3 — 4 total jsrs). Receives one
 * long argument (struct ptr `A2`) and combines three roles:
 *
 *   1. **Gating on `struct[0x1e]`** (mode byte): early-exit to epilogue if
 *      `struct[0x1e] ∈ {1,2}` and `*(struct[0x3e]) == 0xFFFFFFFF`. For active
 *      mode 1 (valid record), save the two "active object globals" at the
 *      epilogue. For active mode 2, save those same globals with an additional
 *      constraint on `struct[0x1a] ∈ {1,2}`, then continue to compute.
 *
 *      `0x400690/0x400692`, poi packed `(yMinusX_signed << 16) | adjustedX_word`
 *
 *   3. **Two conditional dispatches** (post-compute):
 *        L3 green waves, modeled through callback `inner1D06A`.
 *
 *      of the compute path; not executed on the `*A0 == -1` early-exit path).
 *
 * **Disasm 0x13334..0x1344B** (280 byte):
 *
 *   00013334  movem.l {A3,A2,D3,D2},-(SP)        ; save 16 bytes
 *   00013338  movea.l (0x14,SP),A2                ; A2 = arg long (struct ptr)
 *   0001333c  movea.l #0x400692,A3                ; A3 → POS_Y global
 *   00013342  movea.l #0x400690,A1                ; A1 → POS_X global
 *   00013348  cmpi.b  #0x1,(0x1e,A2)              ; struct[0x1e] == 1?
 *   0001334e  beq.w   0x1335a                     ;   yes → check_3e
 *   00013352  cmpi.b  #0x2,(0x1e,A2)              ; struct[0x1e] == 2?
 *   00013358  bne.b   0x13398                     ;   no → compute (skip globals)
 *                                                 ; struct[0x1e] ∈ {1,2}:
 *   0001335a  movea.l (0x3e,A2),A0                ; A0 = struct[0x3e] (long ptr)
 *   0001335e  moveq   #-0x1,D0                    ; D0 = 0xFFFFFFFF
 *   00013360  cmp.l   (A0),D0                     ; *A0 == 0xFFFFFFFF?
 *   00013362  beq.w   0x13446                     ;   yes → epilogue (no-op)
 *   00013366  cmpi.b  #0x2,(0x1e,A2)              ; struct[0x1e] != 2 (i.e. ==1)?
 *   0001336c  bne.b   0x13380                     ;   yes → store_globals
 *   0001336e  cmpi.b  #0x2,(0x1a,A2)              ; struct[0x1a] == 2?
 *   00013374  beq.b   0x13380                     ;   yes → store_globals
 *   00013376  cmpi.b  #0x1,(0x1a,A2)              ; struct[0x1a] != 1?
 *   0001337c  bne.w   0x13398                     ;   yes → compute (no globals)
 *                                                 ; ammesso: 1e==1 OR (1e==2 AND 1a∈{1,2})
 *   00013380  move.l  (0x3e,A2),(0x00400970).l    ; *0x400970 = struct[0x3e]
 *   00013388  move.l  A2,(0x00400974).l           ; *0x400974 = structPtr
 *   0001338e  cmpi.b  #0x2,(0x1e,A2)              ; struct[0x1e] == 2?
 *   00013394  bne.w   0x13446                     ;   no (i.e. ==1) → epilogue
 *                                                 ; (else fall through to compute)
 *   00013398  lea     (0xc,A2),A0                 ; compute:
 *   0001339c  move.w  (A0),(A1)                   ; *0x400690 = w0 = struct[0xC]
 *   0001339e  lea     (0x10,A2),A0
 *   000133a2  move.w  (A0),(A3)                   ; *0x400692 = w2 = struct[0x10]
 *   000133a4  move.w  (A3),D3w
 *   000133a6  sub.w   (A1),D3w                    ; D3w = w2 - w0
 *   000133a8  addi.w  #0x88,D3w                   ; D3w += 0x88
 *   000133ac  lea     (0x14,A2),A0
 *   000133b0  move.w  (A0),D0w                    ; D0w = w4
 *   000133b2  move.w  (0x0040097e).l,D2w          ; D2w = HUD_OFFSET
 *   000133b8  add.w   D0w,D2w                     ; D2w += w4
 *   000133ba  addi.w  #0x54,D2w                   ; D2w += 0x54
 *   000133be  move.w  (A3),D0w                    ; D0w = w2
 *   000133c0  ext.l   D0
 *   000133c2  move.w  (A1),D1w
 *   000133c4  ext.l   D1
 *   000133c6  add.l   D1,D0                       ; D0 = sext_l(w2)+sext_l(w0)
 *   000133c8  asr.l   #0x1,D0                     ; D0 >>= 1 (signed)
 *   000133ca  sub.w   D0w,D2w                     ; D2w -= avg.w
 *   000133cc  move.w  D2w,D0w
 *   000133ce  ext.l   D0
 *   000133d0  move.l  D0,D2
 *   000133d2  andi.l  #0xffff,D2                  ; D2 = D2w (zero high)
 *   000133d8  move.w  D3w,D0w
 *   000133da  ext.l   D0
 *   000133dc  move.l  D0,D1
 *   000133de  moveq   #0x10,D0
 *   000133e0  asl.l   D0,D1                       ; D1 = sext_l(D3w) << 16
 *   000133e2  add.l   D1,D2                       ; D2 = (D3w_signed<<16) | D2w
 *   000133e4  move.l  D2,(0x4e,A2)                ; struct[0x4E] = D2 (packed long)
 *   000133e8  cmpi.b  #0x6,(0x1f,A2)              ; struct[0x1f] == 6?
 *   000133ee  bne.b   0x13402                     ;   no → check_3
 *   000133f0  move.b  (0x25,A2),D1b
 *   000133f4  ext.w   D1w
 *   000133f6  ext.l   D1
 *   000133f8  move.l  D1,-(SP)                    ; push sext_l(struct[0x25])
 *   000133fa  jsr     0x0001d06a.l                ; FUN_1D06A(sext_l(byte))
 *   00013400  addq.l  #0x4,SP
 *   00013402  cmpi.b  #0x3,(0x1f,A2)              ; struct[0x1f] == 3?
 *   00013408  bne.b   0x13440                     ;   no → final_copy
 *   0001340a  move.l  (0x3e,A2),D0
 *   0001340e  sub.l   (0x46,A2),D0                ; D0 = struct[0x3e] - struct[0x46]
 *   00013412  lsr.l   #0x2,D0                     ; D0 >>= 2 (unsigned)
 *   00013414  lsr.l   #0x1,D0                     ; D0 >>= 1 → totale (>>3)
 *   00013416  move.w  D0w,D1w                     ; D1w = D0w (low 16)
 *   00013418  move.l  #0x21192,D0
 *   0001341e  cmp.l   (0x46,A2),D0                ; struct[0x46] == 0x21192?
 *   00013422  bne.b   0x13426                     ;   no → skip add
 *   00013424  addq.w  #0x7,D1w                    ;   yes → D1w += 7
 *   00013426  move.w  D1w,D0w
 *   00013428  movea.l #0x1df18,A0                 ; A0 = ROM table @ 0x1DF18
 *   0001342e  move.b  (0x0,A0,D0w*0x1),D1b        ; D1b = rom[0x1DF18 + sext_l(D0w)]
 *   00013432  ext.w   D1w
 *   00013434  ext.l   D1
 *   00013436  move.l  D1,-(SP)                    ; push sext_l(byte)
 *   00013438  jsr     0x00026b66.l                ; paletteQueuePush(byte)
 *   0001343e  addq.l  #0x4,SP
 *   00013440  move.l  (0x3e,A2),(0x42,A2)         ; struct[0x42] = struct[0x3e]
 *   00013446  movem.l (SP)+,{D2,D3,A2,A3}
 *   0001344a  rts
 *
 * **Five observable paths** (mode = `struct[0x1e]`):
 *
 *   - **mode ∉ {1,2}**: skip globals/short-circuit; execute compute + 2
 *     conditional dispatches + final copy.
 *   - **mode ∈ {1,2} AND `*struct[0x3e] == 0xFFFFFFFF`**: direct epilogue (no
 *   - **mode == 1 AND `*struct[0x3e] != -1`**: store globals → epilogue.
 *   - **mode == 2 AND `*struct[0x3e] != -1` AND `struct[0x1a] ∉ {1,2}`**:
 *     compute + dispatches + final copy (NO globals stored).
 *   - **mode == 2 AND `*struct[0x3e] != -1` AND `struct[0x1a] ∈ {1,2}`**:
 *     store globals + compute + dispatches + final copy.
 *
 * across the 4 call sites: `FUN_12896 @ 0x12990`, `FUN_13068 @ 0x131fe/0x1328a/0x132d2`
 *
 * **Side effects (`state.workRam`)**:
 *   - `0x690..0x691` (POS_X) ← w0 — only if compute executes.
 *   - `0x692..0x693` (POS_Y) ← w2 — only if compute executes.
 *   - `0x970..0x973` ← struct[0x3e] — only "store globals" path.
 *   - `0x974..0x977` ← structPtr — only "store globals" path.
 *   - `(arg+0x4E)..(arg+0x51)` ← packed long — only if compute executes.
 *   - `(arg+0x42)..(arg+0x45)` ← struct[0x3e] (long copy) — only if compute
 *     executes (path "final copy").
 *   - palette queue (byte+ptr to `0x400408`/`0x40040C-F`) — only `1f==3`.
 *
 * **External integration**:
 *     optional hooks let tests isolate `FUN_13334`, while the frame loop wires
 *     the TS replica.
 *
 * `packages/cli/src/test-object-render-update-13334-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { paletteQueuePush } from "./palette-queue.js";

/** Work RAM base (0x400000..0x401FFF). */
const WORK_RAM_BASE = 0x400000;

const POS_X_OFF = 0x690; // *0x400690 word
const POS_Y_OFF = 0x692; // *0x400692 word
const HUD_OFFSET_OFF = 0x97e; // *0x40097E word

const ACTIVE_RECORD_PTR_OFF = 0x970; // *0x400970 long ← struct[0x3E]
const ACTIVE_RECORD_SLOT_OFF = 0x974; // *0x400974 long ← structPtr

/** Offsets in the struct passed as arg1 (A2). */
const STRUCT_W0_OFF = 0x0c; // word @ A2+0xC  → POS_X
const STRUCT_W2_OFF = 0x10; // word @ A2+0x10 → POS_Y
const STRUCT_W4_OFF = 0x14; // word @ A2+0x14 → input HUD compute
const STRUCT_MODE_HI_OFF = 0x1a; // byte @ A2+0x1A (gating mode 2)
const STRUCT_MODE_OFF = 0x1e; // byte @ A2+0x1E (primary mode)
const STRUCT_KIND_OFF = 0x1f; // byte @ A2+0x1F (kind: 3 / 6 dispatch)
const STRUCT_PALETTE_BYTE_OFF = 0x25; // byte @ A2+0x25 (passed to FUN_1D06A)
const STRUCT_RECORD_PTR_OFF = 0x3e; // long @ A2+0x3E (active record ptr)
const STRUCT_FINAL_COPY_OFF = 0x42; // long @ A2+0x42 (← struct[0x3E])
const STRUCT_BASE_PTR_OFF = 0x46; // long @ A2+0x46 (subtracted base)
const STRUCT_PACKED_DST_OFF = 0x4e; // long @ A2+0x4E (packed coords)

/** ROM byte table indicizzata sul path `1f == 3`. */
export const PALETTE_INDEX_TABLE_ROM = 0x1df18 as const;

/** Magic constant compared with `struct[0x46]` for the +7 bonus. */
export const BASE_PTR_MAGIC = 0x21192 as const;

const RECORD_TOMBSTONE = 0xffffffff >>> 0;

// ─── Helpers ──────────────────────────────────────────────────────────────

function readU16(buf: Uint8Array, off: number): number {
  return (((buf[off] ?? 0) << 8) | (buf[off + 1] ?? 0)) & 0xffff;
}

function readU32(buf: Uint8Array, off: number): number {
  return (
    (((buf[off] ?? 0) << 24) |
      ((buf[off + 1] ?? 0) << 16) |
      ((buf[off + 2] ?? 0) << 8) |
      (buf[off + 3] ?? 0)) >>>
    0
  );
}

function writeU16(buf: Uint8Array, off: number, v: number): void {
  buf[off] = (v >>> 8) & 0xff;
  buf[off + 1] = v & 0xff;
}

function writeU32(buf: Uint8Array, off: number, v: number): void {
  const u = v >>> 0;
  buf[off] = (u >>> 24) & 0xff;
  buf[off + 1] = (u >>> 16) & 0xff;
  buf[off + 2] = (u >>> 8) & 0xff;
  buf[off + 3] = u & 0xff;
}

/**
 * sovrascritta dalle ext).
 */
function sext8_i32(byte: number): number {
  return ((byte & 0xff) << 24) >> 24;
}

/**
 */
function sext16_i32(word: number): number {
  return ((word & 0xffff) << 16) >> 16;
}

/**
 * (dereferenza `*A0` nel disasm). I record possono vivere sia in ROM
 * non distingue (m68k unified addressing). La replica accede ai due buffer
 */
function readU32Anywhere(
  state: GameState,
  rom: RomImage,
  addr: number,
): number {
  const a = addr >>> 0;
  if (a >= 0x400000 && a + 3 < 0x402000) {
    return readU32(state.workRam, a - WORK_RAM_BASE);
  }
  if (a < rom.program.length && a + 3 < rom.program.length) {
    return readU32(rom.program, a);
  }
  // Out-of-range: m68k leggerebbe garbage; ai fini parity il caller non
  return 0;
}

/**
 *
 * `rts` (`4E 75`) e usa una callback no-op qui.
 */
export type Inner1D06A = (paletteByteSigned: number) => void;

/** Interface stub injection. */
export interface ObjectRenderUpdate13334Subs {
  inner1D06A: Inner1D06A;
}

// ─── Replica ──────────────────────────────────────────────────────────────

/**
 *
 * @param state     GameState. Modifica `workRam` su POS_X/Y, active-record
 *                  globals, struct fields (+0x42, +0x4E), palette queue.
 * @param rom       ROM image (per leggere la table @ `0x1DF18` e per
 *                  dereferencing `struct[0x3e]` if it points into ROM).
 *                  su `(A2, ...)` toccano work RAM.
 * @param subs      Stub injection per `FUN_1D06A` (callback no-op in test).
 */
export function objectRenderUpdate13334(
  state: GameState,
  rom: RomImage,
  structPtr: number,
  subs: ObjectRenderUpdate13334Subs,
): number {
  const a2 = structPtr >>> 0;
  const argOff = (a2 - WORK_RAM_BASE) >>> 0;

  const modeByte = state.workRam[argOff + STRUCT_MODE_OFF] ?? 0;
  const modeHiByte = state.workRam[argOff + STRUCT_MODE_HI_OFF] ?? 0;

  // Track whether to skip compute (early epilogue).
  let skipCompute = false;
  // Track whether to perform store-globals (`*0x400970`/`*0x400974`).
  let storeGlobals = false;

  if (modeByte === 1 || modeByte === 2) {
    // Dereference struct[0x3e] long (record ptr) and check tombstone.
    const recordPtr = readU32(state.workRam, argOff + STRUCT_RECORD_PTR_OFF);
    const dereffed = readU32Anywhere(state, rom, recordPtr);

    if (dereffed === RECORD_TOMBSTONE) {
      return 0;
    }

    if (modeByte === 1) {
      storeGlobals = true;
      skipCompute = true;
    } else {
      // Mode 2: store-globals only if mode_hi ∈ {1,2}; still falls through to compute.
      if (modeHiByte === 1 || modeHiByte === 2) {
        storeGlobals = true;
      }
      // skipCompute = false → fall through to compute.
    }
  }

  if (storeGlobals) {
    const recordPtr = readU32(state.workRam, argOff + STRUCT_RECORD_PTR_OFF);
    writeU32(state.workRam, ACTIVE_RECORD_PTR_OFF, recordPtr);
    writeU32(state.workRam, ACTIVE_RECORD_SLOT_OFF, a2);
  }

  if (skipCompute) {
    // Mode 1 path "store globals → epilogue".
    return 0;
  }

  // ─── Compute coords (identical pattern a sprite-coords-jsr-150d0.ts) ───
  const w0 = readU16(state.workRam, argOff + STRUCT_W0_OFF);
  const w2 = readU16(state.workRam, argOff + STRUCT_W2_OFF);
  const w4 = readU16(state.workRam, argOff + STRUCT_W4_OFF);

  writeU16(state.workRam, POS_X_OFF, w0);
  writeU16(state.workRam, POS_Y_OFF, w2);

  // D3.w = (w2 - w0 + 0x88) (word arithmetic).
  const yMinusX = (((w2 - w0) | 0) + 0x88) & 0xffff;

  // D2.w = HUD_OFFSET + w4 + 0x54 (word arithmetic).
  const hudOff = readU16(state.workRam, HUD_OFFSET_OFF);
  let d2w = ((hudOff + w4) | 0) + 0x54;
  d2w = d2w & 0xffff;

  // D0 = sext_l(w2) + sext_l(w0); D0 >>= 1 (asr.l #1, signed).
  const yS = sext16_i32(w2);
  const xS = sext16_i32(w0);
  const avgLong = (yS + xS) >> 1; // signed shift
  d2w = (d2w - (avgLong & 0xffff)) & 0xffff;

  // D2 (long) = D2w (zero high) | (sext_l(D3w) << 16).
  const d2Long = d2w & 0xffff;
  const d3Signed = sext16_i32(yMinusX);
  const d1Long = ((d3Signed << 16) | 0) >>> 0;
  const packed = (d1Long + d2Long) >>> 0;

  // *(A2+0x4E) = D2 (long, big-endian).
  writeU32(state.workRam, argOff + STRUCT_PACKED_DST_OFF, packed);

  // ─── Conditional dispatch 1: struct[0x1f] == 6 ───
  const kindByte = state.workRam[argOff + STRUCT_KIND_OFF] ?? 0;
  if (kindByte === 6) {
    const palByte = state.workRam[argOff + STRUCT_PALETTE_BYTE_OFF] ?? 0;
    subs.inner1D06A(sext8_i32(palByte));
  }

  // ─── Conditional dispatch 2: struct[0x1f] == 3 ───
  if (kindByte === 3) {
    const recordPtr = readU32(state.workRam, argOff + STRUCT_RECORD_PTR_OFF);
    const basePtr = readU32(state.workRam, argOff + STRUCT_BASE_PTR_OFF);

    // sub.l (0x46,A2),D0; lsr.l #2; lsr.l #1 = unsigned >>3.
    const diff = ((recordPtr - basePtr) >>> 0) >>> 3; // long unsigned
    let d1w = diff & 0xffff;

    if (basePtr === BASE_PTR_MAGIC) {
      d1w = (d1w + 7) & 0xffff; // addq.w #7,D1w
    }

    // move.b (0x0, A0, D0w*1), D1b — index by sext_l(D0w).
    const indexSigned = sext16_i32(d1w);
    const tableAddr = (PALETTE_INDEX_TABLE_ROM + indexSigned) >>> 0;
    let cmdByte = 0;
    if (tableAddr < rom.program.length) {
      cmdByte = rom.program[tableAddr] ?? 0;
    }

    // Store the signed command byte in the queue. paletteQueuePush accepts a JS number.
    paletteQueuePush(state, sext8_i32(cmdByte));
  }

  // ─── Final copy: struct[0x42] = struct[0x3e] (long) ───
  const recordPtr = readU32(state.workRam, argOff + STRUCT_RECORD_PTR_OFF);
  writeU32(state.workRam, argOff + STRUCT_FINAL_COPY_OFF, recordPtr);

  return 0;
}
