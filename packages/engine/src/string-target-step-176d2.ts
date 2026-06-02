/**
 * string-target-step-176d2.ts — `FUN_000176D2` replica (188 bytes).
 *
 * `FUN_000253ec` (1 xref @ `0x25850`, JSR.L) as part of the update pipeline.
 *
 *
 * **Disasm 0x176D2..0x1778E** (188 byte, 1 arg long, 0 ret):
 *
 *   000176d2   movem.l { D2 D3 D4 D5 A2 }, -(SP)   ; save 5 regs (20 bytes)
 *   000176d6   movea.l (0x18, SP), A1               ; A1 = arg long (objPtr)
 *   000176da   move.b  (0x58, A1), D0b              ; D0b = obj[+0x58] (slot index byte)
 *   000176de   ext.w   D0w
 *   000176e0   ext.l   D0
 *   000176e2   add.l   D0, D0                       ; D0 = idx * 2
 *   000176e4   move.l  D0, D1                       ; D1 = idx * 2
 *   000176e6   asl.l   #5, D0                       ; D0 = idx * 64
 *   000176e8   add.l   D1, D0                       ; D0 = idx * 66 = idx * 0x42
 *   000176ea   movea.l #0x401482, A0
 *   000176f0   adda.l  D0, A0                       ; A0 = slotBase + idx * stride
 *   000176f2   movea.l A0, A2                       ; A2 = slotPtr
 *   000176f4   movea.l (0x3a, A2), A0               ; A0 = *(slot + 0x3a) = bboxPtrPtr
 *   000176f8   movea.l (A0), A0                     ; A0 = *bboxPtrPtr      = bboxPtr
 *   000176fa   moveq   #-1, D0                      ; D0 = 0xFFFFFFFF
 *   000176fc   cmp.l   A0, D0
 *   000176fe   bne.b   readBbox                     ; if bboxPtr != -1
 *
 *   ;-- elseDefault (bboxPtr == 0xFFFFFFFF) --
 *   00017700   moveq   #-2, D1                      ; D1 = 0xFFFFFFFE
 *   00017702   move.w  D1w, D4w                     ; D4w = 0xFFFE  (D4 upper word = saved/old, hi untouched)
 *   00017704   moveq   #0xC, D0                     ; D0 = 0x0000000C
 *   00017706   move.w  D0w, D2w                     ; D2w = 0x000C
 *   00017708   bra.b   computeTarget
 *
 *   readBbox:
 *   0001770a   move.b  (0x4, A0), D1b ; ext.w D1w   ; D1w = sext(byte @ bboxPtr+4)  = xMin
 *   00017710   move.b  (0x5, A0), D4b ; ext.w D4w   ; D4w = sext(byte @ bboxPtr+5)  = yMin
 *   00017716   move.b  (0x6, A0), D0b ; ext.w D0w   ; D0w = sext(byte @ bboxPtr+6)  = width
 *   0001771c   move.b  (0x7, A0), D2b ; ext.w D2w   ; D2w = sext(byte @ bboxPtr+7)  = height
 *
 *   computeTarget:
 *   00017722   move.w  D0w, D3w                     ; D3w = width
 *   00017724   asr.w   #1, D3w                      ; D3w = width / 2 (signed asr)
 *   00017726   add.w   D1w, D3w                     ; D3w += xMin
 *   00017728   lea     (0xC, A2), A0
 *   0001772c   add.w   (A0), D3w                    ; D3w += word @ slot+0xC
 *   ;     → D3w = (width >> 1) + xMin + slot[+0xC].w  =  targetX
 *   0001772e   move.w  D2w, D1w                     ; D1w = height
 *   00017730   asr.w   #1, D1w
 *   00017732   add.w   D4w, D1w                     ; D1w += yMin
 *   00017734   lea     (0x10, A2), A0
 *   00017738   add.w   (A0), D1w                    ; D1w += word @ slot+0x10
 *   ;     → D1w = (height >> 1) + yMin + slot[+0x10].w = targetY
 *
 *   0001773a   lea     (0xC, A1), A0
 *   0001773e   move.w  (A0), D5w                    ; D5w = obj[+0xC].w   = curX
 *   00017740   lea     (0x10, A1), A0
 *   00017744   move.w  (A0), D4w                    ; D4w = obj[+0x10].w  = curY
 *
 *   00017746   clr.w   D0w
 *   00017748   move.w  D0w, D2w                     ; D0w = D2w = 0
 *
 *   ;-- sign(targetX − curX): D0 = -1 / 0 / +1 (signed cmp.w D5w, D3w; cur ▷ tgt → −1) --
 *   0001774a   cmp.w   D3w, D5w
 *   0001774c   ble.b   0x17752                      ; curX <= targetX → skip set −1
 *   0001774e   moveq   #-1, D0                      ; curX > targetX  → step −1
 *   00017750   bra.b   0x17758
 *   00017752   cmp.w   D3w, D5w
 *   00017754   bge.b   0x17758                      ; curX >= targetX → skip set +1
 *   00017756   moveq   #1, D0                       ; curX < targetX  → step +1
 *
 *   ;-- sign(targetY − curY) → D2 --
 *   00017758   cmp.w   D1w, D4w
 *   0001775a   ble.b   0x17760
 *   0001775c   moveq   #-1, D2
 *   0001775e   bra.b   0x17766
 *   00017760   cmp.w   D1w, D4w
 *   00017762   bge.b   0x17766
 *   00017764   moveq   #1, D2
 *
 *   ;-- write obj[+0xC] = ((stepX + curX) << 16) (long; lower 16 = 0) --
 *   00017766   ext.l   D0                            ; D0 = sext_l(stepX word)
 *   00017768   move.w  D5w, D1w
 *   0001776a   ext.l   D1                            ; D1 = sext_l(curX word)
 *   0001776c   add.l   D1, D0                        ; D0 = stepX + curX (long)
 *   0001776e   moveq   #0x10, D1
 *   00017770   asl.l   D1, D0                        ; D0 = (stepX + curX) << 16
 *   00017772   move.l  D0, (0xC, A1)                 ; obj[+0xC..+0xF] = D0
 *
 *   ;-- write obj[+0x10] = ((stepY + curY) << 16) (long; lower 16 = 0) --
 *   00017776   move.w  D2w, D0w
 *   00017778   ext.l   D0                            ; D0 = sext_l(stepY word)
 *   0001777a   move.w  D4w, D1w
 *   0001777c   ext.l   D1                            ; D1 = sext_l(curY word)
 *   0001777e   add.l   D1, D0                        ; D0 = stepY + curY (long)
 *   00017780   moveq   #0x10, D1
 *   00017782   asl.l   D1, D0                        ; D0 = (stepY + curY) << 16
 *   00017784   move.l  D0, (0x10, A1)                ; obj[+0x10..+0x13] = D0
 *
 *   00017788   movem.l (SP)+, { D2 D3 D4 D5 A2 }
 *   0001778c   rts
 *
 * **Algoritmo riassunto**:
 *   1. Index = workRam[obj+0x58]
 *   2. slot  = 0x401482 + Index * 0x42
 *   3. bboxPtrPtr = workRam.long_at(slot + 0x3A)
 *      bboxPtr    = workRam.long_at(bboxPtrPtr)
 *   4. Se bboxPtr == 0xFFFFFFFF:
 *        xMin = -2, yMin = -2, width = 12, height = 12  (default)
 *        xMin   = sext(byte @ bboxPtr+4)
 *        yMin   = sext(byte @ bboxPtr+5)
 *        width  = sext(byte @ bboxPtr+6)
 *        height = sext(byte @ bboxPtr+7)
 *   5. targetX = (width  >> 1) + xMin + slot[+0xC].w  (word arithmetic, signed)
 *      targetY = (height >> 1) + yMin + slot[+0x10].w (word arithmetic, signed)
 *   6. curX    = obj[+0xC].w   (word, signed)
 *      curY    = obj[+0x10].w  (word, signed)
 *   7. stepX   = sign(targetX − curX) ∈ {−1, 0, +1}
 *      stepY   = sign(targetY − curY) ∈ {−1, 0, +1}
 *   8. obj[+0xC..+0xF]  = ((stepX + curX) << 16) >>> 0  (low 16 bits cleared)
 *      obj[+0x10..+0x13] = ((stepY + curY) << 16) >>> 0
 *
 * **Side effects**:
 *     (bboxPtrPtr long), 0 o 4 byte (bbox+4..+7), 4 byte (slot+0xC..+0xF
 *     word + word "tail"), 4 byte (obj+0xC..+0xF word + word tail), 4 byte
 *     (obj+0x10..+0x13 word + word tail).
 *
 * `state` as the usual reference and accesses workRam directly through
 */

import type { RomImage } from "./bus.js";
import type { GameState } from "./state.js";

/** Base of the work RAM (0x400000..0x401FFF, 8 KB). */
const WORK_RAM_BASE = 0x400000;
/** End of the work RAM (exclusive). */
const WORK_RAM_END = 0x402000;

export const SLOT_BASE_ADDR = 0x401482 as const;
/** Byte stride between consecutive slots (= idx*2 + idx*64 = idx*66 = idx*0x42). */
export const SLOT_STRIDE = 0x42 as const;
export const OBJ_INDEX_BYTE_OFF = 0x58 as const;
/** Offset of the bbox pointer-to-pointer long in the slot (`movea.l (0x3a, A2), A0`). */
export const SLOT_BBOX_PTRPTR_OFF = 0x3a as const;
/** Offset of the slot's "extra" center-X word (`lea (0xc, A2), A0; add.w (A0), D3w`). */
export const SLOT_CENTER_X_WORD_OFF = 0x0c as const;
/** Offset of the slot's "extra" center-Y word (`lea (0x10, A2), A0; add.w (A0), D1w`). */
export const SLOT_CENTER_Y_WORD_OFF = 0x10 as const;
export const OBJ_X_LONG_OFF = 0x0c as const;
export const OBJ_Y_LONG_OFF = 0x10 as const;
export const BBOX_XMIN_OFF = 4 as const;
export const BBOX_YMIN_OFF = 5 as const;
export const BBOX_WIDTH_OFF = 6 as const;
export const BBOX_HEIGHT_OFF = 7 as const;
/** Defaults used when `*(*slot+0x3a) == 0xFFFFFFFF`: xMin=-2, yMin=-2, width=12, height=12. */
export const DEFAULT_XMIN = -2 as const;
export const DEFAULT_YMIN = -2 as const;
export const DEFAULT_WIDTH = 12 as const;
export const DEFAULT_HEIGHT = 12 as const;
export const BBOX_SENTINEL = 0xffffffff as const;

/** Read byte from workRam (returns 0 if out-of-range). */
function rb(state: GameState, addr: number): number {
  const off = (addr >>> 0) - WORK_RAM_BASE;
  if (off < 0 || off >= WORK_RAM_END - WORK_RAM_BASE) return 0;
  return state.workRam[off] ?? 0;
}

/** Read big-endian unsigned word (16-bit) from workRam. */
function rwU(state: GameState, addr: number): number {
  return ((rb(state, addr) << 8) | rb(state, addr + 1)) >>> 0;
}

/** Read big-endian unsigned long (32-bit) from workRam. */
function rlU(state: GameState, addr: number): number {
  return (
    (((rb(state, addr) << 24) >>> 0) |
      (rb(state, addr + 1) << 16) |
      (rb(state, addr + 2) << 8) |
      rb(state, addr + 3)) >>>
    0
  );
}

function rbAbs(state: GameState, rom: RomImage | undefined, addr: number): number {
  const a = addr >>> 0;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) return rb(state, a);
  if (rom !== undefined && a < rom.program.length) return rom.program[a] ?? 0;
  return 0;
}

function rlAbs(state: GameState, rom: RomImage | undefined, addr: number): number {
  return (
    (((rbAbs(state, rom, addr) << 24) >>> 0) |
      (rbAbs(state, rom, addr + 1) << 16) |
      (rbAbs(state, rom, addr + 2) << 8) |
      rbAbs(state, rom, addr + 3)) >>>
    0
  );
}

/** Sign-extend byte (0..255) → signed 32-bit (−128..127). */
function sextB(b: number): number {
  const v = b & 0xff;
  return v & 0x80 ? v - 0x100 : v;
}

/** Sign-extend word (0..65535) → signed 32-bit (−32768..32767). */
function sextW(w: number): number {
  const v = w & 0xffff;
  return v & 0x8000 ? v - 0x10000 : v;
}

/** Signed compare ⇒ −1 / 0 / +1. Mimica:
 *   if a > b → −1   (cmp.w b,a; ble skip; moveq #-1)
 *   if a < b → +1   (cmp.w b,a; bge skip; moveq #+1)
 *   if a == b → 0
 */
function signTowards(cur: number, target: number): number {
  if (cur > target) return -1;
  if (cur < target) return 1;
  return 0;
}

/** Write big-endian long (32-bit) into workRam[addr..addr+3]. */
function wlU(state: GameState, addr: number, v: number): void {
  const u = v >>> 0;
  const off = (addr >>> 0) - WORK_RAM_BASE;
  if (off < 0 || off + 3 >= WORK_RAM_END - WORK_RAM_BASE) return;
  state.workRam[off] = (u >>> 24) & 0xff;
  state.workRam[off + 1] = (u >>> 16) & 0xff;
  state.workRam[off + 2] = (u >>> 8) & 0xff;
  state.workRam[off + 3] = u & 0xff;
}

/**
 *
 */
export interface BboxResolved {
  isDefault: boolean;
  xMin: number;
  yMin: number;
  width: number;
  height: number;
  bboxAddr: number;
}

/**
 * `slot = SLOT_BASE_ADDR + idx*SLOT_STRIDE`, dereferences twice
 *
 */
export function resolveBbox(state: GameState, objAddr: number, rom?: RomImage): BboxResolved {
  // base (es. idx=-1 → 0x401482 - 0x42 = 0x401440).
  const idx = sextB(rb(state, objAddr + OBJ_INDEX_BYTE_OFF));
  const slotAddr = ((SLOT_BASE_ADDR + idx * SLOT_STRIDE) >>> 0);
  const bboxPtrPtr = rlU(state, slotAddr + SLOT_BBOX_PTRPTR_OFF);
  const bboxPtr = rlAbs(state, rom, bboxPtrPtr);
  if (bboxPtr === BBOX_SENTINEL) {
    return {
      isDefault: true,
      xMin: DEFAULT_XMIN,
      yMin: DEFAULT_YMIN,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      bboxAddr: BBOX_SENTINEL,
    };
  }
  return {
    isDefault: false,
    xMin: sextB(rbAbs(state, rom, bboxPtr + BBOX_XMIN_OFF)),
    yMin: sextB(rbAbs(state, rom, bboxPtr + BBOX_YMIN_OFF)),
    width: sextB(rbAbs(state, rom, bboxPtr + BBOX_WIDTH_OFF)),
    height: sextB(rbAbs(state, rom, bboxPtr + BBOX_HEIGHT_OFF)),
    bboxAddr: bboxPtr,
  };
}

/**
 * Replica `FUN_000176D2` — `stringTargetStep176D2(state, objAddr)`.
 *
 *
 * @param state    GameState (work RAM modified in-place).
 */
export function stringTargetStep176D2(
  state: GameState,
  objAddr: number,
  rom?: RomImage,
): void {
  const obj = objAddr >>> 0;

  // Resolve bbox via slot index + double deref.
  const bbox = resolveBbox(state, obj, rom);
  const xMin = bbox.xMin;
  const yMin = bbox.yMin;
  const width = bbox.width;
  const height = bbox.height;

  // slot per leggere i word (xCenter, yCenter "extra"): ricaviamo l'addr una
  const idx = sextB(rb(state, obj + OBJ_INDEX_BYTE_OFF));
  const slotAddr = ((SLOT_BASE_ADDR + idx * SLOT_STRIDE) >>> 0);

  // (asr.w #1 = signed >> 1; add.w wrap a 16 bit).
  const slotCx = sextW(rwU(state, slotAddr + SLOT_CENTER_X_WORD_OFF));
  const slotCy = sextW(rwU(state, slotAddr + SLOT_CENTER_Y_WORD_OFF));

  const widthAsr = sextW((width >> 1) & 0xffff);
  const heightAsr = sextW((height >> 1) & 0xffff);

  const targetX = sextW((widthAsr + xMin + slotCx) & 0xffff);
  const targetY = sextW((heightAsr + yMin + slotCy) & 0xffff);

  // curX, curY: word a obj+0xC, obj+0x10
  const curX = sextW(rwU(state, obj + OBJ_X_LONG_OFF));
  const curY = sextW(rwU(state, obj + OBJ_Y_LONG_OFF));

  // step ∈ {−1, 0, +1}
  const stepX = signTowards(curX, targetX);
  const stepY = signTowards(curY, targetY);

  // obj[+0xC]  = ((stepX + curX) << 16) >>> 0
  // obj[+0x10] = ((stepY + curY) << 16) >>> 0
  const newX = (((stepX + curX) & 0xffff) << 16) >>> 0;
  const newY = (((stepY + curY) & 0xffff) << 16) >>> 0;
  wlU(state, obj + OBJ_X_LONG_OFF, newX);
  wlU(state, obj + OBJ_Y_LONG_OFF, newY);
}
