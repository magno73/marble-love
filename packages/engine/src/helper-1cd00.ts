/**
 * Bit-perfect port of `FUN_0001CD00`.
 *
 * Marble-vs-wall 3D bounding-box collision and velocity response. The routine
 * receives the marble entity pointer, a tile/shape source struct pointer, and
 * a shape index, then evaluates the shape entry list against two transformed
 * marble positions.
 *          (`*0x400690`, `*0x400692`, `*0x400694`).
 *        - **Set 2** (`x2, y2, z2`): like set 1 but subtracting vectors from
 *          `*0x40068C.w`).
 *      `nx -= 0x1000`, `wrapFlag = 1` (entry terminale). Se `nx <= 0x800`:
 *      and all 6 comparisons pass, `hit1 = 1`.
 *   7. **Bbox hit-test 2** (`x2/y2/z2` vs stessi bounds): → `hit2 = 1`.
 *      - `D5 = nx*(x1-cx) + ny*(y1-cy) + nz*(z1-cz)` (usando set 1)
 *      - `D6 = nx*(x2-cx) + ny*(y2-cy) + nz*(z2-cz)` (usando set 2)
 *      where `nx = entry[-2]`, `ny = entry[2..3]`, `nz = entry[4..5]`,
 *      `cx = entry[0xC]`, `cy = entry[0xD]`, `cz = entry[0xE]`.
 *      loop-next; different signs continue processing.
 *      `A2[0x36] == 2` checks `absLong(A2[0x14] - A2[0x2A])`:
 *          `*0x400684`, `*0x400688`, `*0x40068C` in `A2[0xC..0x14]`.
 *  13. **Loop-next**: `A0 += 16`; if `wrapFlag == 0`, loop to step 5.
 *
 *   ```
 *   jsr FUN_0001CD00(entityPtr, shapeBasePtr, indexLong)
 *   ```
 *   - `entityPtr`   (long) -> A2 = absolute work RAM address of the marble struct.
 *   - `shapeBasePtr`(long) -> A1 = absolute work RAM address of the tile/shape struct
 *     `[0x14..0x15]` worldZ sext-word.
 *   - `indexLong`   (long) → D1.b = low byte = shape index (0..6 o 0xFF).
 *
 * Return: signed long D0, 1 for the fatal/reset collision path.
 *
 * **Sub injection** (`Helper1CD00Subs`):
 *   - `absLong`              — `FUN_0001216A`, default: replica TS.
 *   - `soundPair15884`       — `FUN_00015884`, default: no-op.
 *   - `soundCmdSend158AC`    — `FUN_000158AC`, default: no-op.
 *   - `stateSub15BD0`        — `FUN_00015BD0`, default: no-op.
 *   - `objectStateEntry25BAE`— `FUN_00025BAE`, default: no-op.
 *
 * Side effects in `state.workRam`, excluding injected subcalls:
 *
 * ROM tables:
 *   - Pointer table `SHAPE_PTR_TABLE_ADDR = 0x24C5E` (7 longs), embedded as
 *     `SHAPE_PTR_TABLE`.
 *   - Shape-entry bytes embedded as `SHAPE_ENTRIES_ROM`.
 *
 *   `0x02A3B8`, `0x02A550`, `0x02A596`, `0x02A5D2`, `0x02A63E`, `0x02A724`,
 *   `0x02A866`, `0x02A98E`.
 *
 */

import type { GameState } from "./state.js";

// ─── Address constants ─────────────────────────────────────────────────────

/** ROM address of `FUN_0001CD00`. */
export const HELPER_1CD00_ADDR = 0x0001cd00 as const;

/** Absolute workRam base. */
const WORK_RAM_BASE = 0x00400000 as const;

/** Offset workRam: `*0x400690` = marble world X word. */
const WORLD_X_OFF = 0x690 as const;
/** Offset workRam: `*0x400692` = marble world Y word. */
const WORLD_Y_OFF = 0x692 as const;
/** Offset workRam: `*0x400694` = marble world Z word. */
const WORLD_Z_OFF = 0x694 as const;

/**
 * Offset workRam: `*0x400684` = normal/global long 0 (copied to entity[0xC]).
 * NOTE: sub.w (A3) reads only the HIGH word (big-endian offset 0x684..0x685).
 */
const GLOBAL_684_OFF = 0x684 as const;
/**
 * Offset workRam: `*0x400688` = normal/global long 1 (copied to entity[0x10]).
 * sub.w reads word at 0x688..0x689.
 */
const GLOBAL_688_OFF = 0x688 as const;
/**
 * Offset workRam: `*0x40068C` = normal/global long 2 (copied to entity[0x14]).
 * suba.w/sub.w reads word at 0x68C..0x68D.
 */
const GLOBAL_68C_OFF = 0x68c as const;

/** ROM address of shape pointer table. */
export const SHAPE_PTR_TABLE_ADDR = 0x00024c5e as const;

// ─── ROM shape data (embedded from marble_program.bin) ────────────────────

/**
 * Shape pointer table (7 entries × 4 bytes = 28 bytes) @ 0x24C5E.
 * Each entry points to the first 16-byte shape-entry block for that index.
 * Source: `ghidra_project/marble_program.bin` @ 0x24C5E.
 */
export const SHAPE_PTR_TABLE: readonly number[] = [
  0x00024b5e, // shape[0]
  0x00024b6e, // shape[1]
  0x00024b9e, // shape[2]
  0x00024bbe, // shape[3]
  0x00024bee, // shape[4]
  0x00024bfe, // shape[5]
  0x00024c2e, // shape[6]
] as const;

/**
 * Shape entry data (16 bytes per entry, variable number of entries per shape).
 * Indexed by ROM pointer → offset = romAddr - 0x24B5E.
 * Source: `ghidra_project/marble_program.bin` @ 0x24B5E..0x24C4F.
 *
 * Layout of each 16-byte entry:
 *   [0..1]  nx word (raw; if raw > 0x800: nx_adj = raw - 0x1000, terminal; else nx_adj = raw)
 *   [2..3]  ny word (signed)
 *   [4..5]  nz word (signed)
 *   [6]     xmin signed byte
 *   [7]     xmax signed byte
 *   [8]     ymin signed byte
 *   [9]     ymax signed byte
 *   [0xA]   zmin signed byte
 *   [0xB]   zmax signed byte
 *   [0xC]   cx signed byte (center subtract for dot product X)
 *   [0xD]   cy signed byte (center subtract for dot product Y)
 *   [0xE]   cz signed byte (center subtract for dot product Z)
 *   [0xF]   (unused)
 *
 * All shape data at 0x24B5E..0x24C4F (242 bytes → 15.125 entries, but
 * actual entries are aligned to 16 bytes, so up to 0x24C4F = 15 entries).
 */
const SHAPE_DATA_ROM_OFFSET = 0x00024b5e as const;
// prettier-ignore
const SHAPE_DATA_ROM: readonly number[] = [
  // 0x24B5E — shape[0].entry[0] (terminal: nx_raw=0x1100>0x800)
  0x11, 0x00,  0x00, 0x00,  0x00, 0x00,  0xF8, 0x08,  0xFC, 0x24,  0xF0, 0x20,  0x00, 0x00, 0x00, 0x00,
  // 0x24B6E — shape[1].entry[0] (terminal: nx_raw=0xFF00>0x800)
  0xFF, 0x00,  0x00, 0x00,  0x00, 0x00,  0x18, 0x28,  0x00, 0x20,  0xF0, 0x02,  0x20, 0x10, 0x00, 0x00,
  // 0x24B7E — (between shape[1] and shape[2]; terminal: nx_raw=0xFF8E>0x800)
  0xFF, 0x8E,  0x00, 0xE5,  0x00, 0x00,  0xF8, 0x24,  0xF8, 0x18,  0xF0, 0x02,  0x00, 0x00, 0x00, 0x00,
  // 0x24B8E — (padding; terminal: nx_raw=0x0FC2>0x800)
  0x0F, 0xC2,  0xFF, 0x08,  0x00, 0x00,  0xFC, 0x24,  0x10, 0x28,  0xF0, 0x02,  0x00, 0x20, 0x00, 0x00,
  // 0x24B9E — shape[2].entry[0] (terminal: nx_raw=0xFF00>0x800)
  0xFF, 0x00,  0x00, 0x00,  0x00, 0x00,  0x10, 0x20,  0x00, 0x13,  0xF0, 0x02,  0x18, 0x00, 0x00, 0x00,
  // 0x24BAE — (terminal: nx_raw=0x1100>0x800)
  0x11, 0x00,  0x00, 0x00,  0x00, 0x00,  0xF8, 0x08,  0x00, 0x13,  0xF0, 0x02,  0x00, 0x00, 0x00, 0x00,
  // 0x24BBE — shape[3].entry[0] (terminal: nx_raw=0xFF03>0x800)
  0xFF, 0x03,  0xFF, 0xD6,  0x00, 0x00,  0x08, 0x20,  0xFC, 0x20,  0xF0, 0x02,  0x18, 0x00, 0x00, 0x00,
  // 0x24BCE — (non-terminal: nx_raw=0x0100<=0x800)
  0x01, 0x00,  0x00, 0x00,  0x00, 0x00,  0xF8, 0x08,  0xFC, 0x20,  0xF0, 0x02,  0x00, 0x00, 0x00, 0x00,
  // 0x24BDE — (terminal: nx_raw=0x1000>0x800)
  0x10, 0x00,  0xFF, 0x00,  0x00, 0x00,  0x00, 0x10,  0x18, 0x28,  0xF0, 0x02,  0x00, 0x20, 0x00, 0x00,
  // 0x24BEE — shape[4].entry[0] (terminal: nx_raw=0x1100>0x800)
  0x11, 0x00,  0x00, 0x00,  0x00, 0x00,  0xF8, 0x08,  0x00, 0x0E,  0xF0, 0x02,  0x00, 0x00, 0x00, 0x00,
  // 0x24BFE — shape[5].entry[0] (non-terminal: nx_raw=0x0100<=0x800)
  0x01, 0x00,  0x00, 0x00,  0x00, 0x00,  0xF8, 0x08,  0xFC, 0x14,  0xF0, 0x02,  0x00, 0x00, 0x00, 0x00,
  // 0x24C0E — shape[5].entry[1] (non-terminal: nx_raw=0x0100<=0x800)
  0x01, 0x00,  0x00, 0x00,  0x00, 0x00,  0x10, 0x20,  0xFC, 0x14,  0xF0, 0x02,  0x18, 0x00, 0x00, 0x00,
  // 0x24C1E — shape[5].entry[2] (terminal: nx_raw=0x1000>0x800)
  0x10, 0x00,  0x01, 0x00,  0x00, 0x00,  0xFC, 0x1C,  0xF8, 0x08,  0xF0, 0x02,  0x00, 0x00, 0x00, 0x00,
  // 0x24C2E — shape[6].entry[0] (non-terminal: nx_raw=0x0000<=0x800)
  0x00, 0x00,  0x01, 0x00,  0x00, 0x00,  0xFC, 0x1C,  0xF8, 0x08,  0xF0, 0x18,  0x00, 0x00, 0x00, 0x00,
  // 0x24C3E — shape[6].entry[1] (non-terminal: nx_raw=0x0000<=0x800)
  0x00, 0x00,  0x01, 0x00,  0x00, 0x00,  0xFC, 0x1C,  0x08, 0x18,  0xF0, 0x18,  0x00, 0x10, 0x00, 0x00,
  // 0x24C4E — shape[6].entry[2] (terminal: nx_raw=0x1100>0x800)
  0x11, 0x00,  0x00, 0x00,  0x00, 0x00,  0x0C, 0x1C,  0xFC, 0x14,  0xF0, 0x18,  0x14, 0x00, 0x00, 0x00,
] as const;

// ─── Sub injection interface ───────────────────────────────────────────────

/**
 * Sub injection for `FUN_0001CD00`.
 *
 * available). The parity test patches them with stubs that log calls.
 */
export interface Helper1CD00Subs {
  /**
   * `FUN_0001216A` — `abs(arg: number): number`.
   * Default: TS replica from `math-helpers.ts`.
   */
  absLong?: (arg: number) => number;

  /**
   * `FUN_00015884` — `soundPair15884(state: GameState): void`.
   * Default: no-op.
   */
  soundPair15884?: (state: GameState) => void;

  /**
   * `FUN_000158AC` — `soundCmdSend158AC(state: GameState, cmd: number): void`.
   * Default: no-op.
   */
  soundCmdSend158AC?: (state: GameState, cmd: number) => void;

  /**
   * `FUN_00015BD0` — `stateSub15BD0(state, entityPtr, arg2, arg3): void`.
   * Default: no-op.
   */
  stateSub15BD0?: (
    state: GameState,
    entityPtr: number,
    arg2Long: number,
    arg3Long: number,
  ) => void;

  /**
   * `FUN_00025BAE` — `objectStateEntry25BAE(state, entityPtr, modeLong): void`.
   * Default: no-op.
   */
  objectStateEntry25BAE?: (
    state: GameState,
    entityPtr: number,
    modeLong: number,
  ) => void;
}

// ─── Internal helpers ──────────────────────────────────────────────────────

/** Read unsigned 16-bit big-endian from `workRam` at relative offset `off`. */
function readU16(r: Uint8Array, off: number): number {
  return (((r[off] ?? 0) << 8) | (r[off + 1] ?? 0)) & 0xffff;
}

/** Read signed 32-bit big-endian from `workRam` at relative offset `off`. */
function readS32(r: Uint8Array, off: number): number {
  const hi = readU16(r, off);
  const lo = readU16(r, off + 2);
  const u = ((hi << 16) | lo) >>> 0;
  return u | 0; // signed 32-bit
}

/** Write signed 32-bit big-endian to `workRam` at relative offset `off`. */
function writeS32(r: Uint8Array, off: number, value: number): void {
  const v = value >>> 0;
  r[off] = (v >>> 24) & 0xff;
  r[off + 1] = (v >>> 16) & 0xff;
  r[off + 2] = (v >>> 8) & 0xff;
  r[off + 3] = v & 0xff;
}

/** Sign-extend byte to i32. */
function sext8(b: number): number {
  const byte_ = b & 0xff;
  return byte_ >= 0x80 ? byte_ - 0x100 : byte_;
}

/** Sign-extend 16-bit word to i32. */
function sext16(w: number): number {
  const word = w & 0xffff;
  return word >= 0x8000 ? word - 0x10000 : word;
}

/** Truncate to signed 32-bit. */
function asI32(v: number): number {
  return v | 0;
}

/**
 * Read a shape entry byte from the ROM data using an absolute ROM address.
 * The shape data is stored in `SHAPE_DATA_ROM` starting from `SHAPE_DATA_ROM_OFFSET`.
 */
function readShapeByte(romAddr: number, byteOff: number): number {
  const idx = (romAddr - SHAPE_DATA_ROM_OFFSET) + byteOff;
  return (SHAPE_DATA_ROM[idx] ?? 0) & 0xff;
}

/**
 * Read a shape entry word (big-endian) from the ROM data.
 */
function readShapeWord(romAddr: number, byteOff: number): number {
  const hi = readShapeByte(romAddr, byteOff);
  const lo = readShapeByte(romAddr, byteOff + 1);
  return ((hi << 8) | lo) & 0xffff;
}

/** Default absLong: abs(long). Mirrors `FUN_0001216A`. */
function defaultAbsLong(v: number): number {
  const s = v | 0;
  return s < 0 ? asI32(-s) : asI32(s);
}

// ─── Main function ─────────────────────────────────────────────────────────

/**
 *
 * Marble-vs-wall 3D bounding-box collision + velocity response.
 *
 * @param state         GameState (mutates workRam in place).
 * @param subs          Sub injection (default: no-op).
 *
 */
export function helper1CD00(
  state: GameState,
  entityPtr: number,
  shapeBasePtr: number,
  indexLong: number,
  subs?: Helper1CD00Subs,
): number {
  const r = state.workRam;

  // ── Args ────────────────────────────────────────────────────────────────
  const entityOff = (entityPtr - WORK_RAM_BASE) >>> 0;
  const shapeOff = (shapeBasePtr - WORK_RAM_BASE) >>> 0;

  // D1.b = low byte of indexLong (move.b $13(a6), d1)
  const indexByte = indexLong & 0xff;

  // ── Early exit ──────────────────────────────────────────────────────────
  // cmpi.b #$FF, d1; bne.b $1CD32; moveq #$0,d0; bra.w $1D062
  if (indexByte === 0xff) {
    return 0;
  }

  // ── Save velocities A2[0..11] to locals ─────────────────────────────────
  // move.l (a2), -$1a(a6)  ; savedVX
  // move.l $4(a2), -$16(a6); savedVY
  // move.l $8(a2), -$12(a6); savedVZ
  const savedVX = readS32(r, entityOff + 0);
  const savedVY = readS32(r, entityOff + 4);
  const savedVZ = readS32(r, entityOff + 8);

  // ── Load world positions from shapeBasePtr (A1) ─────────────────────────
  // Disasm sequence:
  //   lea $c(a1), a0; move.w (a0), d0; ext.l d0; addq.l #$8, d0
  //   move.w d0, -$4(a6)       ; local[-4] = (sext(A1[0xC]) + 8)
  //   move.w -$4(a6), -$8(a6)  ; local[-8] = same (COPY, NOT worldX-adjusted!)
  //   ...
  //   move.w -$4(a6), d7; sub.w worldX, d7; move.w d7, -$4(a6)  ; local[-4] -= worldX
  //   (local[-8] is NOT adjusted for worldX)
  //
  // So: set 1 values are world-adjusted; set 2 values are raw (A1[offset]+8) minus normals.
  //
  // Raw (pre-worldXYZ) values:
  const rawX = (sext16(readU16(r, shapeOff + 0x0c)) + 8) & 0xffff; // local[-4] before worldX sub
  const rawY = (sext16(readU16(r, shapeOff + 0x10)) + 8) & 0xffff; // local[-6] before worldY sub
  // movea.w (a0), a1: sign-extends the 16-bit word to A1 (32-bit)
  const rawZ = sext16(readU16(r, shapeOff + 0x14)); // A1 value = local[-0xC] before worldZ sub

  // ── Subtract marble world position (Set 1: relative to marble) ──────────
  // local[-4] -= worldX → x1 (word, signed)
  // local[-6] -= worldY → y1 (word, signed)
  // A1       -= worldZ (suba.w sign-extends worldZ word) → z1 (long→word comparison)
  const x1 = sext16((rawX - readU16(r, WORLD_X_OFF)) & 0xffff);
  const y1 = sext16((rawY - readU16(r, WORLD_Y_OFF)) & 0xffff);
  // suba.w $400694.l, a1: A1 = rawZ - sext16(worldZ_word)
  // Since rawZ = sext16(A1[0x14]) and worldZ_word is unsigned from readU16,
  // suba.w sign-extends the operand: A1 = rawZ - sext16(readU16(worldZ))
  const z1_word = asI32(rawZ - sext16(readU16(r, WORLD_Z_OFF)));
  // cmp.w a1, d0 uses the low 16 bits of A1; the long is used for dot-product

  // ── Subtract normals from set 2 ─────────────────────────────────────────
  // IMPORTANT: Set 2 values start from the RAW (pre-worldXYZ) values, NOT from set 1!
  //   local[-8] = rawX (copy of pre-worldX local[-4])
  //   local[-0xA] = rawY (copy of pre-worldY local[-6])
  //   local[-0xC] = rawZ (= A1.w after movea.w, BEFORE suba.w worldZ)
  //
  //   local[-8]  -= *0x400684.w  → x2
  //   local[-0xA] -= *0x400688.w → y2
  //   local[-0xC] -= *0x40068C.w → z2
  //
  // All subtractions are 16-bit (sub.w), result is stored as word.
  const x2 = sext16((rawX - readU16(r, GLOBAL_684_OFF)) & 0xffff);
  const y2 = sext16((rawY - readU16(r, GLOBAL_688_OFF)) & 0xffff);
  // For z2: local[-0xC] starts as rawZ (16-bit word from movea.w).
  // sub.w (a4), d7 where a4=0x40068C: d7.w -= *0x40068C.w
  const z2 = sext16((rawZ - readU16(r, GLOBAL_68C_OFF)) & 0xffff);

  // ── Look up shape pointer from table ────────────────────────────────────
  // move.b d1, d0; ext.w d0; asl.w #$2, d0 → D0.w = indexByte * 4
  // movea.l #0x24c5e, a0; movea.l (a0, d0.w), a0 → A0 = table[indexByte]
  const shapePtr = SHAPE_PTR_TABLE[indexByte] ?? SHAPE_PTR_TABLE[0]!;

  // ── Loop over shape entries ──────────────────────────────────────────────
  let entryRomAddr = shapePtr;

  while (true) {
    // L_01CDCC: move.w (a0), -$2(a6) → scale = shape[0..1]
    const nxRaw = readShapeWord(entryRomAddr, 0);

    // clr.w -$e(a6) → wrapFlag = 0
    let wrapFlag = 0;

    // cmpi.w #$800, -$2(a6); ble.b $1cde6
    // NOTE: ble.b is a SIGNED comparison. sext16(nxRaw) <= 0x800 → skip adjust (non-terminal).
    // sext16(nxRaw) > 0x800 → adjust (terminal).
    const nxSigned = sext16(nxRaw);
    let nx: number;
    if (nxSigned > 0x800) {
      // subi.w #$1000, -$2(a6); addq.w #$1, -$e(a6)
      nx = sext16((nxRaw - 0x1000) & 0xffff);
      wrapFlag = 1;
    } else {
      nx = nxSigned; // already sext16
    }

    // ── Read shape fields ─────────────────────────────────────────────────
    const ny = sext16(readShapeWord(entryRomAddr, 2));
    const nz = sext16(readShapeWord(entryRomAddr, 4));
    const xmin = sext8(readShapeByte(entryRomAddr, 6));
    const xmax = sext8(readShapeByte(entryRomAddr, 7));
    const ymin = sext8(readShapeByte(entryRomAddr, 8));
    const ymax = sext8(readShapeByte(entryRomAddr, 9));
    const zmin = sext8(readShapeByte(entryRomAddr, 0xa));
    const zmax = sext8(readShapeByte(entryRomAddr, 0xb));
    const cx = sext8(readShapeByte(entryRomAddr, 0xc));
    const cy = sext8(readShapeByte(entryRomAddr, 0xd));
    const cz = sext8(readShapeByte(entryRomAddr, 0xe));

    // ── Hit test 1 (x1/y1/z1_word) ─────────────────────────────────────
    // All comparisons use signed 16-bit (cmp.w)
    let hit1 = false;
    {
      const x = x1;
      const y = y1;
      const z = z1_word; // cmp.w a1, d0 compares word vs A1 low word

      if (
        xmin <= x && x <= xmax &&
        ymin <= y && y <= ymax &&
        zmin <= z && z <= zmax
      ) {
        hit1 = true;
      }
    }

    // clr.b d1 → D1.b = 0 (second hit flag)
    // ── Hit test 2 (x2/y2/z2) ──────────────────────────────────────────
    let hit2 = false;
    {
      const x = x2;
      const y = y2;
      const z = z2;

      if (
        xmin <= x && x <= xmax &&
        ymin <= y && y <= ymax &&
        zmin <= z && z <= zmax
      ) {
        hit2 = true;
      }
    }

    // tst.b d1; bne.b $1ce84 (hit2 → common calc)
    // tst.b d3; beq.w $1d054 (neither hit → loop-next)
    if (!hit2 && !hit1) {
      // No hit from either set → loop-next
    } else {
      // ── Common hit calculation ─────────────────────────────────────
      // D5 = dot product for set 1: nx*(x1-cx) + ny*(y1-cy) + nz*(z1-cz)
      // D6 = dot product for set 2: nx*(x2-cx) + ny*(y2-cy) + nz*(z2-cz)

      // Set 1:
      const dx1 = sext16((x1 - cx) & 0xffff);
      const dy1 = sext16((y1 - cy) & 0xffff);
      const dz1 = sext16((z1_word - cz) & 0xffff);
      // move.w $4(a0), d0; muls.w d1, d0 → nz * dz1
      // move.w $2(a0), d1; muls.w d4, d1 → ny * dy1
      // move.w -$2(a6), d0; muls.w d3, d0 → nx * dx1 (nx is local[-2])
      const d5 = asI32(
        asI32(nz * dz1) +
        asI32(ny * dy1) +
        asI32(nx * dx1),
      );

      // Set 2:
      const dx2 = sext16((x2 - cx) & 0xffff);
      const dy2 = sext16((y2 - cy) & 0xffff);
      const dz2 = sext16((z2 - cz) & 0xffff);
      const d6 = asI32(
        asI32(nz * dz2) +
        asI32(ny * dy2) +
        asI32(nx * dx2),
      );

      // Absolute values: |D5| and |D6|
      const absD5 = defaultAbsLong(d5);
      const absD6 = defaultAbsLong(d6);

      // cmpi.l #$400, d1 (d1 = absD5); blt.b $1cf36
      // cmpi.l #$400, d3 (d3 = absD6); blt.b $1cf36
      // move.l d6, d0; move.l d5, d1; eor.l d1, d0; andi.l #$80000000, d0
      // beq.w $1d054 → same sign → no collision
      if (absD5 >= 0x400 && absD6 >= 0x400) {
        // Check sign: if same sign → no-collision (beq.w to loop-next)
        // eor gives 0x80000000 if signs differ, 0 if same
        const signDiff = ((d6 ^ d5) >>> 0) & 0x80000000;
        if (signDiff === 0) {
          // Same sign → no collision (loop-next)
        } else {
          // Different signs → fall through to L_01CF36
          const result = processCollision(
            state, r, entityOff, entityPtr,
            nx, ny, nz,
            absD6,
            savedVX, savedVY, savedVZ,
            subs,
          );
          if (result >= 0) return result;
        }
      } else {
        // L_01CF36 path (|D6| or |D5| < 0x400)
        const result = processCollision(
          state, r, entityOff, entityPtr,
          nx, ny, nz,
          absD6,
          savedVX, savedVY, savedVZ,
          subs,
        );
        if (result >= 0) return result;
      }
    }

    // ── L_01D054 loop-next ─────────────────────────────────────────────
    // moveq #$10, d0; adda.l d0, a0 → A0 += 16
    entryRomAddr += 16;
    // tst.w -$e(a6); beq.w $1cdcc → if wrapFlag==0 loop; else fall through
    if (wrapFlag !== 0) {
      // wrapFlag != 0 → exit loop, return 0
      break;
    }
    // else: loop back to L_01CDCC
  }

  return 0;
}

// ─── Collision response helper ─────────────────────────────────────────────

/**
 * Handles the collision response once the dot products are computed.
 * Corresponds to the code from `L_01CF36` onwards.
 *
 * Returns:
 *  - 0 or 1 to immediately return that value from `helper1CD00`.
 *  - -1 if no immediate return (loop-next).
 */
function processCollision(
  state: GameState,
  r: Uint8Array,
  entityOff: number,
  entityPtr: number,
  nx: number,
  ny: number,
  nz: number,
  absD6: number,
  savedVX: number,
  savedVY: number,
  savedVZ: number,
  subs?: Helper1CD00Subs,
): number {
  // L_01CF36: cmpi.l #$400, d3 (d3=absD6); bge.w $1cfec
  if (absD6 >= 0x400) {
    // ── L_01CFEC: reflection path ────────────────────────────────────────
    // move.l (a3), $c(a2)   ; entity[0xC] = *0x400684 (long)
    // movea.l d2, a5; move.l (a5), $10(a2) ; entity[0x10] = *0x400688 (long)
    // move.l (a4), $14(a2)  ; entity[0x14] = *0x40068C (long)
    writeS32(r, entityOff + 0x0c, readS32(r, GLOBAL_684_OFF));
    writeS32(r, entityOff + 0x10, readS32(r, GLOBAL_688_OFF));
    writeS32(r, entityOff + 0x14, readS32(r, GLOBAL_68C_OFF));

    // Reflection velocity update:
    // vX = entity[0..3] long, asr.l #7 → shift right 7, sign-preserving
    // D0.w = (vX >> 7).low_word; muls.w nx → D3 = nx * (vX>>7).w
    // D0 = ny word; D1 = (vY>>7).w; muls.w D1 → D4 = ny * (vY>>7).w
    // D0 = nz word; D1 = (vZ>>7).w; muls.w D1 → D1 = nz * (vZ>>7).w
    // D0 = D4 + D3 + D1 (total dot product with velocity/128)
    // D0 >>= 8 (asr.l #8)
    // D1 = D0.w (word)
    // Then: entity[0] -= nx * D1; entity[4] -= ny * D1; entity[8] -= nz * D1

    const vX = readS32(r, entityOff + 0);
    const vY = readS32(r, entityOff + 4);
    const vZ = readS32(r, entityOff + 8);

    // asr.l #7 → arithmetic shift right 7 bits (signed)
    const vXs7 = asI32(vX >> 7);
    const vYs7 = asI32(vY >> 7);
    const vZs7 = asI32(vZ >> 7);

    // move.w d1, d0 → D0.w = low word of shifted value
    // muls.w nx, d0 → D3 = sext16(vXs7.w) * nx (already signed)
    const vXw = sext16(vXs7 & 0xffff);
    const vYw = sext16(vYs7 & 0xffff);
    const vZw = sext16(vZs7 & 0xffff);

    // D3 = nx * vXw; D4 = ny * vYw; D1 = nz * vZw
    const dotNx = asI32(nx * vXw);  // move.w -$2(a6),d0; muls.w d1 (d1=vXw)
    const dotNy = asI32(ny * vYw);  // move.w $2(a0),d0; move.l $4(a2),d1;... muls.w d1
    const dotNz = asI32(nz * vZw);  // move.w $4(a0),d0; move.l $8(a2),d1;... muls.w d1

    // D0 = D4 + D3 + D1
    let dot = asI32(asI32(dotNy + dotNx) + dotNz);

    // asr.l #8, d0
    dot = asI32(dot >> 8);

    // move.w d0, d1 → D1 = D0.w (word)
    const dotW = sext16(dot & 0xffff);

    // entity[0] -= nx * dotW
    // entity[4] -= ny * dotW
    // entity[8] -= nz * dotW
    const dVX = asI32(nx * dotW); // move.w -$2(a6),d0; muls.w d1 → D3
    const dVY = asI32(ny * dotW); // move.w $2(a0),d0; muls.w d1 → D4
    const dVZ = asI32(nz * dotW); // move.w $4(a0),d0; muls.w d1 → D1

    // sub.l d0, (a2) [uses d0=D3] etc.
    writeS32(r, entityOff + 0, asI32(vX - dVX));
    writeS32(r, entityOff + 4, asI32(vY - dVY));
    writeS32(r, entityOff + 8, asI32(vZ - dVZ));

    // Fall to L_01D054 (loop-next), but we return from caller
    // Actually in the disasm: after L_01CFEC it does NOT branch to return,
    // it falls through to L_01D054 (loop-next path).
    // So we return -1 to indicate "continue loop" behavior.
    return -1;
  }

  // ── |D6| < 0x400 → direct collision path ───────────────────────────────
  // L_01CF36 + !bge → here: cmpi.b #$2, $36(a2); bne.w $1cfbc
  const mode36 = r[entityOff + 0x36] ?? 0;
  if (mode36 === 2) {
    // jsr absLong(A2[0x14] - A2[0x2A])
    // move.l $14(a2), d1; sub.l $2a(a2), d1; move.l d1, -(a7); jsr $1216a
    const val14 = readS32(r, entityOff + 0x14);
    const val2a = readS32(r, entityOff + 0x2a);
    const diffLong = asI32(val14 - val2a);
    const absDiff = (subs?.absLong ?? defaultAbsLong)(diffLong);

    // cmpi.l #$100000, d0; addq.l #$4, a7
    // ble.b $1cfbc → if absLong <= 0x100000, goto negVelocity path
    if (absDiff > 0x100000) {
      // jsr $15884.l (soundPair15884)
      subs?.soundPair15884?.(state);

      // pea.l $46.l; jsr $158ac.l; addq.l #$4, a7
      subs?.soundCmdSend158AC?.(state, 0x46);

      // cmpa.l #$400018, a2; beq.w $1cfa2
      // cmpa.l #$4000fa, a2; beq.w $1cfa2
      const isSpecial =
        entityPtr === 0x00400018 || entityPtr === 0x004000fa;

      if (isSpecial) {
        // L_01CFA2: move.b #$64, $57(a2)
        r[entityOff + 0x57] = 0x64;

        // pea.l $4.w; move.l a2, -(a7); jsr $25bae.l; addq.l #$8, a7
        subs?.objectStateEntry25BAE?.(state, entityPtr, 4);
      } else {
        // pea.l $1.w; pea.l $1.w; move.l a2, -(a7)
        // jsr $15bd0.l; lea.l $c(a7), a7
        subs?.stateSub15BD0?.(state, entityPtr, 1, 1);
      }

      // L_01CFB6: moveq #$1, d0; bra.w $1d062
      return 1;
    }
    // else ble.b $1cfbc → fall through to negate velocity path
  }

  // L_01CFBC: negate velocities + copy globals
  // move.l -$1a(a6), d0; neg.l d0; move.l d0, (a2)  ; entity[0] = -savedVX
  // move.l -$16(a6), d0; neg.l d0; move.l d0, $4(a2) ; entity[4] = -savedVY
  // move.l -$12(a6), d0; neg.l d0; move.l d0, $8(a2) ; entity[8] = -savedVZ
  writeS32(r, entityOff + 0, asI32(-savedVX));
  writeS32(r, entityOff + 4, asI32(-savedVY));
  writeS32(r, entityOff + 8, asI32(-savedVZ));

  // move.l (a3), $c(a2)   ; entity[0xC] = *0x400684 (long)
  // movea.l d2, a5; move.l (a5), $10(a2) ; entity[0x10] = *0x400688 (long)
  // move.l (a4), $14(a2)  ; entity[0x14] = *0x40068C (long)
  writeS32(r, entityOff + 0x0c, readS32(r, GLOBAL_684_OFF));
  writeS32(r, entityOff + 0x10, readS32(r, GLOBAL_688_OFF));
  writeS32(r, entityOff + 0x14, readS32(r, GLOBAL_68C_OFF));

  // moveq #$0, d0; bra.w $1d062 → return 0
  return 0;
}
