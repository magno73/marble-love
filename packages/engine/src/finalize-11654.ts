/**
 * Bit-perfect port of `FUN_00011654`.
 *
 * Finalize/attract-sequence renderer. It reads the mode word at `0x400392`
 * and the counter at `0x4003EA`, renders one or more string-chain entries via
 * the text trampolines, optionally waits between them, and writes `0x4003EE`
 * to mark which attract text path was emitted.
 *
 * **Disasm 0x11654..0x117B1** (92 byte, no args, no return value):
 *
 *   00011654  movem.l {A4 A3 A2 D2},-(SP)
 *   00011658  movea.l #0x100,A2          ; A2 = textRender100 (FUN_2A24)
 *   0001165E  movea.l #0x4003EA,A4       ; A4 = &workRam[0x3EA]
 *   00011664  movea.l #0x28DB8,A3        ; A3 = waitVblankStateGated
 *   0001166A  moveq  #2,D0
 *   0001166C  cmp.w  (0x400392).l,D0w   ; mode == 2?
 *   00011672  bne.b  0x1167C
 *   00011674  move.l #0x2000,D0          ; yes → D0 = 0x2000
 *   0001167A  bra.b  0x1167E
 *   0001167C  moveq  #0,D0              ; no  → D0 = 0
 *   0001167E  move.w D0w,D2w            ; D2 = palette selector (0 or 0x2000)
 *   00011680  bne.b  0x11694            ; if D2 != 0, skip first renderString
 *   00011682  pea    (0x1800).w
 *   00011686  pea    (0x22A26).l
 *   0001168C  jsr    0x142              ; renderString0142(0x22A26, 0x1800)
 *   00011692  addq.l #8,SP
 *   00011694  move.l #0x3000,D1
 *   0001169A  move.w D2w,D0w; ext.l D0; sub.l D0,D1  → D1 = 0x3000 - D2
 *   000116A0  move.l D1,-(SP)
 *   000116A2  pea    (0x22A32).l
 *   000116A8  jsr    0x142              ; renderString0142(0x22A32, 0x3000-D2)
 *   000116AE  moveq  #3,D0
 *   000116B0  cmp.w  (0x400392).l,D0w  ; mode == 3?
 *   000116B6  addq.l #8,SP
 *   000116B8  beq.w  0x117AC            ; yes → epilogue
 *   000116BC  moveq  -1,D0
 *   000116BE  cmp.w  (A4),D0w           ; (A4) == 0xFFFF?
 *   000116C0  beq.w  0x116CC            ; yes → path A
 *   000116C4  moveq  #0x18,D0
 *   000116C6  cmp.w  (A4),D0w           ; 24 > (A4)?
 *   000116C8  bgt.w  0x11736            ; yes → path B (12 ≤ (A4) ≤ 23)
 *
 *   ; path A: (A4)==0xFFFF OR (A4)>=24
 *   000116CC  pea  (0x1E).w; push D1=(0x3800-D2); pea 0x22A7A; jsr (A2)  → textRender100
 *   000116E6  pea (0xA); jsr (A3)                                          → wait 10
 *   000116EC  pea  (0x1E).w; push D1=(0x3000-D2); pea 0x22A86; jsr (A2)
 *   00011706  pea (0xA); jsr (A3)
 *   0001170C  pea  (0x1E).w; push D1=(0x3C00-D2); pea 0x22A92; jsr (A2)
 *   00011726  move.b #0x2,(0x4003EE).l   ; 3-string path: set 0x4003EE = 2
 *   0001172E  lea (0x2C,SP),SP
 *   00011732  bra.w 0x117AC
 *
 *   ; path B: 12 ≤ (A4) ≤ 23
 *   00011736  moveq #0xC,D0; cmp.w (A4),D0w; bgt 0x117AC  → (A4)<=11 → epilogue
 *   0001173E  moveq #0x18,D0; cmp.w (A4),D0w; ble 0x117AC → (A4)>=24 → epilogue
 *   00011746  pea (0x1E).w; push D1=(0x3800-D2); pea 0x22A56; jsr (A2)
 *   00011760  pea (0xA); jsr (A3)
 *   00011766  pea (0x1E).w; push D1=(0x3000-D2); pea 0x22A62; jsr (A2)
 *   00011780  pea (0xA); jsr (A3)
 *   00011786  pea (0x1E).w; push D1=(0x3C00-D2); pea 0x22A6E; jsr (A2)
 *   000117A0  move.b #0x1,(0x4003EE).l   ; 3-string path B: set 0x4003EE = 1
 *   000117A8  lea (0x2C,SP),SP
 *
 *   ; epilogue
 *   000117AC  movem.l (SP)+,{D2 A2 A3 A4}
 *   000117B0  rts
 *
 * Injectable subs used by parity tests:
 *   - `renderString0142` (0x142 -> FUN_2572): 2 args (textPtr, tileBase)
 *   - `textRender100` (0x100 -> FUN_2A24 -> FUN_2572): 3 args (textPtr, tileBase, flags)
 *   - `waitVblankStateGated` (0x28DB8): 1 arg (frames)
 */

import type { GameState } from "./state.js";

const WRAM = 0x00400000;

function off(addr: number): number {
  return addr - WRAM;
}

function wb(state: GameState, addr: number, value: number): void {
  state.workRam[off(addr)] = value & 0xff;
}

function rw(state: GameState, addr: number): number {
  return (((state.workRam[off(addr)] ?? 0) << 8) | (state.workRam[off(addr) + 1] ?? 0)) & 0xffff;
}

/** Sign-extend a 16-bit word to a JS number (for use in arithmetic). */
function sextW(v: number): number {
  const w = v & 0xffff;
  return w >= 0x8000 ? w - 0x10000 : w;
}

export interface Finalize11654Subs {
  /**
   * FUN_2572 via trampoline 0x142: renderString / renderStringChain.
   * Args: (state, textPtr, tileBase). Default: no-op.
   */
  renderString0142?: (state: GameState, textPtr: number, tileBase: number) => void;
  /**
   * FUN_2A24 via trampoline 0x100: textRender / string slot allocator.
   * Args: (state, textPtr, tileBase, flags). Default: no-op.
   */
  textRender100?: (state: GameState, textPtr: number, tileBase: number, flags: number) => void;
  /**
   * FUN_28DB8: waitVblankStateGated.
   * Args: (state, frames). Default: no-op.
   */
  waitVblankStateGated?: (state: GameState, frames: number) => void;
}

/**
 * Port of `FUN_00011654`, the attract-sequence string renderer/finalizer.
 *
 * The two main branches match the ROM counter windows: `0xffff` or `>= 24`
 * renders attract path A and writes 2; `12..23` renders attract path B and
 * writes 1. Mode 3 returns after the common header strings.
 */
export function finalize11654(
  state: GameState,
  _rom?: unknown,
  subs: Finalize11654Subs = {},
): void {
  // D2 = palette selector based on mode
  const mode = rw(state, 0x00400392);
  const d2 = mode === 2 ? 0x2000 : 0;

  // If D2 == 0: renderString0142(0x22A26, 0x1800)
  if (d2 === 0) {
    subs.renderString0142?.(state, 0x00022a26, 0x1800);
  }

  // Always: renderString0142(0x22A32, 0x3000 - sext(D2))
  const tileBase3000 = (0x3000 - sextW(d2)) >>> 0;
  subs.renderString0142?.(state, 0x00022a32, tileBase3000);

  // If mode == 3: early return
  if (mode === 3) return;

  // Read counter word at 0x4003EA
  const counter = rw(state, 0x004003ea);
  const counterSigned = sextW(counter);

  // Determine which render path to take:
  //   path A: counter == 0xFFFF (-1) OR counter >= 24 (signed)
  //   path B: 12 <= counter <= 23 (signed, after excluding -1)
  //   else: epilogue (no strings rendered)
  if (counter === 0xffff || counterSigned >= 24) {
    // Path A — "attract A" strings
    const tb3800 = (0x3800 - sextW(d2)) >>> 0;
    subs.textRender100?.(state, 0x00022a7a, tb3800, 0x1e);
    subs.waitVblankStateGated?.(state, 0xa);

    const tb3000a = (0x3000 - sextW(d2)) >>> 0;
    subs.textRender100?.(state, 0x00022a86, tb3000a, 0x1e);
    subs.waitVblankStateGated?.(state, 0xa);

    const tb3c00 = (0x3c00 - sextW(d2)) >>> 0;
    subs.textRender100?.(state, 0x00022a92, tb3c00, 0x1e);

    // move.b #0x2,(0x4003EE)
    wb(state, 0x004003ee, 0x02);
  } else if (counterSigned >= 12 && counterSigned < 24) {
    // Path B — "attract B" strings (12 <= counter <= 23)
    const tb3800 = (0x3800 - sextW(d2)) >>> 0;
    subs.textRender100?.(state, 0x00022a56, tb3800, 0x1e);
    subs.waitVblankStateGated?.(state, 0xa);

    const tb3000b = (0x3000 - sextW(d2)) >>> 0;
    subs.textRender100?.(state, 0x00022a62, tb3000b, 0x1e);
    subs.waitVblankStateGated?.(state, 0xa);

    const tb3c00 = (0x3c00 - sextW(d2)) >>> 0;
    subs.textRender100?.(state, 0x00022a6e, tb3c00, 0x1e);

    // move.b #0x1,(0x4003EE)
    wb(state, 0x004003ee, 0x01);
  }
  // else: counter <= 11 (path C): epilogue, no writes
}

export const FINALIZE_11654_ADDR = 0x00011654 as const;
