/**
 * refresh-helper-13ee6.ts — replica `FUN_00013EE6` bit-perfect.
 *
 * **Semantica**: aggiornamento scroll orizzontale + decodifica tilemap per
 * il frame corrente. Unico chiamante: `FUN_10FCE` (refresh-frame handler).
 *
 * La funzione:
 *   1. Chiama `FUN_1344C` (init scroll decode, stub).
 *   2. Se `*0x400006 == 0` salta al ramo finale (0x1411c).
 *   3. Chiama `levelHelper2FFB8(*0x400664)` (slapstic lookup).
 *   4. Calcola `scrollIdx = (((*0x40097c - sext(*ptr+0x10)) >> 3) & 0x7fff) - 1`.
 *   5. Se `*0x400004 == 1`: scrollIdx += 0x20.
 *   6. Decodifica bitstream e scrive buffer @ 0x400706.
 *   7. Eventuale blit del buffer in PF RAM.
 *   8. Ramo finale (0x1411c): loop slot → trova candidato scroll D3.
 *   9. Aggiorna velocità scroll, posizione, flag.
 *
 * **JSR non ancora replicati** (stubbati no-op):
 *   - `0x1344c` (`FUN_1344C`): init scroll decode.
 *   - `0x144e4` (`FUN_144E4`): scroll row transition.
 *
 * **Side effects** in workRam:
 *   0x400000 (PF X scroll word), 0x400004 (dir byte), 0x400006 (active byte),
 *   0x400008 (run byte), 0x40000c (accum word), 0x400706..+0x48 (decode buf),
 *   0x40097c (target long).
 *
 * **Side effects** in playfieldRam:
 *   Fino a 0x24 word nella riga di scroll target (0xA00000-area).
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { levelHelper2FFB8 } from "./level-helper-2ffb8.js";
import { decodeBitstream1A668 } from "./decode-bitstream-1a668.js";

// ─── Export principale ────────────────────────────────────────────────────────

/** Indirizzo assoluto M68k di `FUN_00013EE6`. */
export const REFRESH_HELPER_13EE6_ADDR = 0x00013ee6 as const;

// ─── Costanti ROM ─────────────────────────────────────────────────────────────

/** Base della scroll-range table ROM @ 0x1F1CA. */
const ROM_RANGE_BASE = 0x1f1ca as const;
// 0x1f1ca  step_small  (word, 0x0100)
// 0x1f1cc  step_large  (word, 0x0200)
// 0x1f1ce  step_max    (word, 0x0400)
// 0x1f1d0  target_ctr  (word, 0x0048)
// 0x1f1d2  pos_max     (word, 0x00a8)
// 0x1f1d4  delta_near  (word, 0x0010)
// 0x1f1d6  delta_far   (word, 0x0030)

/** Base-ptr del ctrl stream: D1 += 0x800e4. */
const CTRL_BASE = 0x800e4 as const;
/** Base-ptr dell'extra-byte stream: D1 += 0x2be18. */
const EXT_BASE = 0x2be18 as const;
/** Numero di word nel decode output buffer. */
const BUF_WORDS = 0x24 as const;

// ─── Offsets workRam ─────────────────────────────────────────────────────────

const OFF_XSCROLL  = 0x0000; // *0x400000 word   PF X scroll target
const OFF_DIR      = 0x0004; // *0x400004 byte   direction: 1=fwd, -1=rev, 0=none
const OFF_ACTIVE   = 0x0006; // *0x400006 byte   blit-active flag
const OFF_RUN      = 0x0008; // *0x400008 byte   scroll-running flag
const OFF_SPEED    = 0x000a; // *0x40000a byte   scroll speed
const OFF_ACCUM    = 0x000c; // *0x40000c word   scroll accumulator
const OFF_EVFLAGS  = 0x0010; // *0x400010 long   event flags
const OFF_SLOTBASE = 0x0018; // *0x400018        first slot struct
const OFF_SLOTCNT  = 0x0394; // *0x400394 word   player slot count (mode)
const OFF_SLOTNR   = 0x0396; // *0x400396 word   total slots to scan
const OFF_LVLPTR   = 0x0474; // *0x400474 long   level-header ptr (M68k abs)
const OFF_SLAPIDX  = 0x0662; // *0x400662 word   slapstic index
const OFF_LVLCTR   = 0x0664; // *0x400664 word   level counter
const OFF_DECBUF   = 0x0706; // *0x400706        decode output buffer (0x48 bytes)
// const OFF_SRDECPTR = 0x0970; // *0x400970 long   scroll-record decode ptr (unused here)
const OFF_SLOTPTR  = 0x0974; // *0x400974 long   current slot ptr
const OFF_DECNEXT  = 0x0978; // *0x400978 long   decode next ptr
const OFF_HUDOFF   = 0x097e; // *0x40097e word   HUD offset
const OFF_SRTGT    = 0x097c; // *0x40097c long   scroll row target

// ─── Offsets header livello (puntato da *0x400474) ───────────────────────────

const LV_OFF_XBASE  = 0x10; // word — base X scroll position
const LV_OFF_XRANGE = 0x12; // word — X scroll range
const LV_OFF_TILETB = 0x04; // long — tile word table ptr
const LV_OFF_EXTTB  = 0x2a; // long — extra-byte table ptr
// LV_OFF_SL28 / LV_OFF_SL26 accessed via SL_OFF_W28 / SL_OFF_W26 from slotPtr directly

// ─── Stride slot e offset interni ────────────────────────────────────────────

const SLOT_STRIDE   = 0xe2;
const SL_OFF_LONG8  = 0x08;
const SL_OFF_FLAG18 = 0x18;
const SL_OFF_FLAG1A = 0x1a;
const SL_OFF_W1F    = 0x1f;
const SL_OFF_W20    = 0x20;
const SL_OFF_W26    = 0x26;
const SL_OFF_W28    = 0x28;
const SL_OFF_FLAG36 = 0x36;

// ─── Basi memoria ────────────────────────────────────────────────────────────

const WORK_RAM_BASE = 0x400000 as const;
const PF_RAM_BASE   = 0xa00000 as const;
const PF_RAM_END    = 0xa02000 as const;

// ─── BE I/O helpers ──────────────────────────────────────────────────────────

function rb(a: Uint8Array, o: number): number { return (a[o] ?? 0) & 0xff; }
function rw(a: Uint8Array, o: number): number {
  return (((a[o] ?? 0) << 8) | (a[o + 1] ?? 0)) & 0xffff;
}
function rl(a: Uint8Array, o: number): number {
  return (
    ((a[o] ?? 0) * 0x1000000) +
    (((a[o + 1] ?? 0) << 16) >>> 0) +
    ((a[o + 2] ?? 0) << 8) +
    (a[o + 3] ?? 0)
  ) >>> 0;
}
function wb(a: Uint8Array, o: number, v: number): void { a[o] = v & 0xff; }
function ww(a: Uint8Array, o: number, v: number): void {
  a[o] = (v >>> 8) & 0xff; a[o + 1] = v & 0xff;
}
function wl(a: Uint8Array, o: number, v: number): void {
  const u = v >>> 0;
  a[o] = (u >>> 24) & 0xff; a[o + 1] = (u >>> 16) & 0xff;
  a[o + 2] = (u >>> 8) & 0xff; a[o + 3] = u & 0xff;
}
function sx16(v: number): number { return (v & 0x8000) ? (v | 0xffff0000) | 0 : v & 0xffff; }
function sx8(v: number): number  { return (v & 0x80) ? (v | 0xffffff00) | 0 : v & 0xff; }

/** Legge word BE da ROM program (o workRam se in range). */
function readW(state: GameState, rom: RomImage, abs: number): number {
  const a = abs >>> 0;
  if (a < 0x88000) return (((rom.program[a] ?? 0) << 8) | (rom.program[a + 1] ?? 0)) & 0xffff;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_BASE + 0x2000) return rw(state.workRam, a - WORK_RAM_BASE);
  return 0;
}
/** Legge byte BE da ROM program (o workRam se in range). */
function readB(state: GameState, rom: RomImage, abs: number): number {
  const a = abs >>> 0;
  if (a < 0x88000) return (rom.program[a] ?? 0) & 0xff;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_BASE + 0x2000) return rb(state.workRam, a - WORK_RAM_BASE);
  return 0;
}
/** Legge long BE da ROM program (o workRam se in range). */
function readL(state: GameState, rom: RomImage, abs: number): number {
  const a = abs >>> 0;
  if (a < 0x88000) {
    return (((rom.program[a] ?? 0) * 0x1000000) +
      (((rom.program[a + 1] ?? 0) << 16) >>> 0) +
      ((rom.program[a + 2] ?? 0) << 8) +
      (rom.program[a + 3] ?? 0)) >>> 0;
  }
  if (a >= WORK_RAM_BASE && a < WORK_RAM_BASE + 0x2000) return rl(state.workRam, a - WORK_RAM_BASE);
  return 0;
}

/** Scrive word in playfieldRam (assoluto 0xA00000-0xA01FFF, con wrap). */
function pfww(state: GameState, absAddr: number, v: number): void {
  const off = ((absAddr - PF_RAM_BASE) >>> 0) & (PF_RAM_END - PF_RAM_BASE - 1);
  ww(state.playfieldRam, off, v);
}

// ─── Interfaccia subs ─────────────────────────────────────────────────────────

/**
 * Subs iniettabili per dependency injection nei test.
 * I JSR non ancora replicati sono stub no-op per default.
 */
export interface RefreshHelper13EE6Subs {
  /**
   * `FUN_1344C` — init scroll decode.
   * Stub default: no-op. Il test deve iniettare `*0x400974` / `*0x400978`
   * direttamente prima della chiamata.
   */
  fun1344c?: (state: GameState, rom: RomImage) => void;
  /**
   * `FUN_144E4` — scroll row transition.
   * Riceve gli stessi 2 long che il binario spinge sullo stack:
   *   arg1 = vecchio target (long), arg2 = nuovo target (long).
   * Stub default: no-op.
   */
  fun144e4?: (state: GameState, rom: RomImage, oldTarget: number, newTarget: number) => void;
}

// ─── Implementazione ──────────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00013EE6`.
 *
 * @param state  GameState (mutato in-place).
 * @param rom    ROM image.
 * @param subs   Override opzionali per JSR stub (default: no-op).
 */
export function refreshHelper13EE6(
  state: GameState,
  rom: RomImage,
  subs: RefreshHelper13EE6Subs = {},
): void {
  const wr = state.workRam;

  // === Prologo ===
  // link.w A6,-0x2; movem.l {A5..A2,D7..D2},-(SP)
  // A2=0x40000a, A3=0x400004, A4=0x40000c (set via movea.l immediates)

  // 0x13f00: jsr FUN_1344C
  if (subs.fun1344c) subs.fun1344c(state, rom);

  // 0x13f06: tst.b (*0x400006); beq.w 0x1411c
  if (rb(wr, OFF_ACTIVE) === 0) {
    _tail(state, rom, subs);
    return;
  }

  // 0x13f10: D1 = sext16(*0x400664); push D1; jsr levelHelper2FFB8; addq 4,SP
  levelHelper2FFB8(rom, sx16(rw(wr, OFF_LVLCTR)));

  // 0x13f20: D0 = *0x40097c (long)
  // 0x13f26: A0 = *0x400474 (long → ptr into ROM/work)
  // 0x13f2c: D1 = sext16(*(A0+0x10))
  // 0x13f32: D0 -= D1; asr.l #3,D0
  // 0x13f36: D3w = D0w; andi.w #0x7fff,D3w; subq.w 1,D3w; tst.w D3w
  // 0x13f42: blt.w 0x14104
  const srtgt  = rl(wr, OFF_SRTGT);   // *0x40097c
  const lvlPtr = rl(wr, OFF_LVLPTR);  // *0x400474
  const xbase  = sx16(readW(state, rom, lvlPtr + LV_OFF_XBASE));
  let scrollIdx = (((srtgt | 0) - xbase) >> 3) & 0x7fff;
  scrollIdx = (scrollIdx - 1) & 0xffff;
  // addq.l 4,SP (cleanup from jsr push)
  if (sx16(scrollIdx) < 0) {
    _blit104(state, rom, subs);
    return;
  }

  // 0x13f46: cmpi.b #1,(A3=*0x400004); bne → 0x13f50; addi.w #0x20,D3w
  if (rb(wr, OFF_DIR) === 1) {
    scrollIdx = (scrollIdx + 0x20) & 0xffff;
  }

  // 0x13f50..0x13f60: A5 = *(*0x400474 + 4) + D3*2  [tile word table]
  // D0 = sext(D3); A0 = *(lvlPtr+4); A5 = A0 + D0*2
  const tileTablePtr = readL(state, rom, lvlPtr + LV_OFF_TILETB);
  const tileWordAddr = (tileTablePtr + sx16(scrollIdx) * 2) >>> 0;

  // 0x13f62: D1w = sext16(*A5); ext.l D1
  // 0x13f66: D1 += 0x800e4  → ctrl stream ptr
  // 0x13f6c: D2 = D1
  const tileWord = readW(state, rom, tileWordAddr);
  const ctrlStream = ((sx16(tileWord) + CTRL_BASE) >>> 0);
  const d2ctrl = ctrlStream;

  // 0x13f6e: D0w = D3w; ext.l D0
  // 0x13f72: A0 = *(lvlPtr + 0x2a)   (ext-byte table ptr)
  // 0x13f78: add.l D0,D0 → NO: move.w D3w,D0w; ext.l D0; A5 = *(lvlPtr+0x2a)+D0
  // 0x13f7c: moveq 0,D1; move.b (A5),D1b   (zero-extend byte from ext table)
  // 0x13f82: D1 += 0x2be18   → extra-byte stream ptr
  // 0x13f88: A1 = D1
  const extTablePtr = readL(state, rom, lvlPtr + LV_OFF_EXTTB);
  const extByteOff  = (extTablePtr + sx16(scrollIdx)) >>> 0;
  const extByte     = readB(state, rom, extByteOff);
  const extStream   = (extByte + EXT_BASE) >>> 0;

  // 0x13f8a: A0 = 0x400706 (output buffer)
  // 0x13f90: push A1=extStream, D2=ctrlStream, A0=0x400706
  // 0x13f96: jsr decodeBitstream1A668
  const outBufAbs = (WORK_RAM_BASE + OFF_DECBUF) >>> 0;
  decodeBitstream1A668(state, rom, outBufAbs, d2ctrl, extStream);

  // 0x13f9c: tst.l (*0x400978); lea (0xc,SP),SP; beq.w 0x14094
  const decNext = rl(wr, OFF_DECNEXT);
  if (decNext === 0) {
    _pf094(state, rom, subs, sx16(scrollIdx));
    return;
  }

  // === Sezione 0x13faa: blit con decode-next ===
  // A1 = *0x400974 (slot ptr)
  // A0 = *0x400978 (decode-next ptr)
  // D3 = *(A0) (long) — tile data ptr
  const slotPtr = rl(wr, OFF_SLOTPTR);
  const tileDataPtr = readL(state, rom, decNext);

  // 0x13fb8: cmpi.b #0x19,(A1+0x1f); bne → 0x13fc6
  const typeAt1F = readB(state, rom, slotPtr + SL_OFF_W1F);

  let d2tile: number;
  let d4tile: number;
  let d3ptr: number;

  if (typeAt1F === 0x19) {
    // 0x13fc0: moveq 0x24,D2; moveq 0x1e,D4
    d2tile = 0x24;
    d4tile = 0x1e;
    d3ptr  = tileDataPtr;
  } else {
    // 0x13fc6..0x13fd2: D2b = *(A5); D4b = *(A5+1); D3 += 2
    // A5 = D3 (tileDataPtr)
    d2tile = readB(state, rom, tileDataPtr);
    d4tile = readB(state, rom, (tileDataPtr + 1) >>> 0);
    d3ptr  = (tileDataPtr + 2) >>> 0;
  }

  // 0x13fd4: D0 = (*0x40097c - sext(*(lvlPtr+0x10))) >> 3
  // 0x13fe8: D5w = D0w; D5 -= *(A1+0x28); D5 -= 1
  const xbase2 = sx16(readW(state, rom, lvlPtr + LV_OFF_XBASE));
  let d5 = (((rl(wr, OFF_SRTGT) | 0) - xbase2) >> 3) & 0xffff;
  d5 = (d5 - rw(state.workRam, OFF_SLOTBASE + SL_OFF_W28) - 1) & 0xffff;
  // Note: (A1+0x28) reads from the slot ptr — we use the actual slotPtr here.
  d5 = (sx16(readW(state, rom, slotPtr + SL_OFF_W28)) - 1) & 0xffff; // re-read correctly

  // Actually let me re-read: D0 was from the srtgt computation; D5 = D0 - *(A1+0x28) - 1
  // Redo:
  {
    const d0row = ((((rl(wr, OFF_SRTGT) | 0) - xbase2) >> 3)) | 0;
    const sl28  = sx16(readW(state, rom, slotPtr + SL_OFF_W28));
    d5 = ((d0row - sl28 - 1) & 0xffff);
  }

  // 0x13f2..0x13f6: cmpi.b #1,(A3); bne → 0x13ffc; addi.w #0x20,D5w
  if (rb(wr, OFF_DIR) === 1) {
    d5 = (d5 + 0x20) & 0xffff;
  }

  // 0x13ffc: tst.w D5; blt → 0x14094
  if (sx16(d5) < 0) {
    _pf094(state, rom, subs, sx16(scrollIdx));
    return;
  }

  // 0x14002: move.b D4b,D0b; ext.w D0w; cmp.w D5w,D0w; ble → 0x14094
  const d4w = sx16(d4tile & 0xff);
  if (d4w <= sx16(d5)) {
    _pf094(state, rom, subs, sx16(scrollIdx));
    return;
  }

  // 0x1400c: D0 = sext((A1+0x26)); D0*2; D1 = D0 + 0x400706; A0=D1
  const sl26  = sx16(readW(state, rom, slotPtr + SL_OFF_W26));
  const a0buf = (sl26 * 2 + (WORK_RAM_BASE + OFF_DECBUF)) >>> 0;

  // 0x1401e: cmpi.b #0x19,(A1+0x1f); bne → 0x14078
  if (typeAt1F === 0x19) {
    // === Path "type 0x19" @ 0x14026 ===
    // A1 = *(0x0002be14).l  (a second level ptr from ROM)
    const altLvlPtr = readL(state, rom, 0x2be14);

    // D0 = D3w (tile idx) ext.l; D1 = D5w ext.l; D0 = (D0+D1)*2
    // add.l D1,D0; add.l D0,D0; add.l *(A1+4),D0 → A5 = D0
    const d0idx = sx16(d3ptr & 0xffff);
    const d1row = sx16(d5);
    let d0alt = (d0idx + d1row) * 2;
    const altTileTable = readL(state, rom, (altLvlPtr + 4) >>> 0);
    const altTileAddr  = (altTileTable + d0alt) >>> 0;
    const altTileWord  = readW(state, rom, altTileAddr);
    const altCtrl      = ((sx16(altTileWord) + CTRL_BASE) >>> 0);

    // D0 = D5w ext.l; D1 = *(A1+0x2a) long; D0+0x4e+D1 → A1
    // moveq 0,D1; move.b (A1),D1b; D1 += 0x2be18 → ext stream
    const altExtBase = readL(state, rom, (altLvlPtr + 0x2a) >>> 0);
    const altExtAddr = (altExtBase + 0x4e + sx16(d5)) >>> 0;
    const altExtByte = readB(state, rom, altExtAddr);
    const altExt     = (altExtByte + EXT_BASE) >>> 0;

    // jsr decodeBitstream1A668(a0buf, altCtrl, altExt)
    decodeBitstream1A668(state, rom, a0buf, altCtrl, altExt);

    // bra → 0x14094
    _pf094(state, rom, subs, sx16(scrollIdx));
    return;
  }

  // === Path normal blit @ 0x14078 ===
  // D0b = D2b; ext.w D0w; muls.w D5w,D0  → D0 = sext(D2) * sext(D5)
  // D1 = D0; add.l D1,D1; add.l D1,D3   → D3 = d3ptr + D0*2
  // D0b = 0; loop: *(A0)+ = *(A5=D3)+; D0++; cmp D2b,D0b; bne
  {
    const d2s  = sx16(d2tile & 0xff); // muls.w D5w,D0 → D0 = d2s * d5s
    const d5s  = sx16(d5);
    const d0mul = (d2s * d5s) | 0;   // muls.w → signed 32
    // D1 = D0; D1 += D1 → D1 = D0*2; D3 = d3ptr + D1
    const srcBase = (d3ptr + d0mul * 2) >>> 0;
    let d0l = 0;
    let a5l = srcBase;
    let a0l = a0buf;
    const limit = d2tile & 0xff;
    // safety cap
    const cap = Math.min(limit, 256);
    while ((d0l & 0xff) !== (limit & 0xff)) {
      if (d0l >= cap) break;
      const srcWord = readW(state, rom, a5l);
      // write to workRam (a0l should be in workRam range)
      if (a0l >= WORK_RAM_BASE && a0l < WORK_RAM_BASE + 0x2000) {
        ww(wr, a0l - WORK_RAM_BASE, srcWord);
      }
      a5l = (a5l + 2) >>> 0;
      a0l = (a0l + 2) >>> 0;
      d0l++;
    }
  }

  _pf094(state, rom, subs, sx16(scrollIdx));
}

// ─── Sezione 0x14094: write decoded tiles to PF RAM ──────────────────────────

function _pf094(
  state: GameState,
  rom: RomImage,
  subs: RefreshHelper13EE6Subs,
  _scrollIdxSigned: number,
): void {
  const wr = state.workRam;

  // 0x14094: D0 = sext(*0x400000); asr.l #3,D0; asl.l #6,D0; D0*=2
  // D0 += 0xa00000; D1 = D0; D0 = -0x7a (moveq -0x7a); D1 += D0 → A0
  const xscroll = sx16(rw(wr, OFF_XSCROLL));
  let d0pf = (xscroll >> 3) << 6; // asr.l #3 then asl.l #6 = multiply by 8
  d0pf = d0pf * 2;                 // add.l D0,D0
  d0pf = (d0pf + 0xa00000) | 0;
  d0pf = (d0pf - 0x7a) | 0;       // moveq -0x7a; D1=D0; D0= -0x7a; add D0,D1 → same
  let a0pf = d0pf >>> 0;

  // 0x140b0: cmpi.b #1,(A3=0x400004); bne → 0x140d8
  if (rb(wr, OFF_DIR) === 1) {
    // 0x140b6..0x140d4: a0pf += 0x1000; wrap if > 0xa01fff
    a0pf = (a0pf + 0x1000) >>> 0;
    // exg D7,A0; cmpi.l #0xa01fff,D7; exg D7,A0; ble → 0x140ee
    if (a0pf > 0xa01fff) {
      // subi.l #0x2000
      a0pf = (a0pf - 0x2000) >>> 0;
    }
  } else {
    // 0x140d8..0x140ec: if a0pf < 0xa00000: a0pf += 0x2000
    // exg D7,A0; cmpi.l #0xa00000,D7; exg D7,A0; bge → 0x140ee
    if (a0pf < 0xa00000) {
      a0pf = (a0pf + 0x2000) >>> 0;
    }
  }

  // 0x140ee..0x14102: D2 = 0x400706; clr D0; loop: *(A0)+ = *(A5=D2)+; D0++; cmpi #0x24,D0; bne
  // (writes 0x24 words = 0x48 bytes from decode buffer to PF RAM at a0pf)
  for (let i = 0; i < BUF_WORDS; i++) {
    const word = rw(wr, OFF_DECBUF + i * 2);
    pfww(state, (a0pf + i * 2) >>> 0, word);
  }

  // fall through to 0x14104
  _blit104(state, rom, subs);
}

// ─── Sezione 0x14104: clear active, level helper, tail ───────────────────────

function _blit104(
  state: GameState,
  rom: RomImage,
  subs: RefreshHelper13EE6Subs,
): void {
  const wr = state.workRam;

  // 0x14104: clr.b (*0x400006)
  wb(wr, OFF_ACTIVE, 0);

  // 0x1410a: D1 = sext16(*0x400662); push; jsr levelHelper2FFB8; addq 4,SP
  levelHelper2FFB8(rom, sx16(rw(wr, OFF_SLAPIDX)));

  // fall through to 0x1411c
  _tail(state, rom, subs);
}

// ─── Sezione 0x1411c: tail — max/min scroll delta scan + update ──────────────
//
// Disasm key:
//   0x14204-0x14290: D3 init (accum lookup based on speed byte)
//   0x14294:         clr accum (D3 != initD3 path)
//   0x14296:         D5=xscroll, D6=hudOff
//   0x142a4:         cmp D3 vs center; bge → pos path (0x142b4)
//   0x142ac:         D3<center: if D3!=initD3 → 0x142c6 (pos update, no guards)
//   0x142b4:         pos guards: scrollRun + dir=1 → 0x142c6 or → 0x14386
//   0x142c6-0x14330: positive scroll update (speed select + D5/D6 += speed, D4=1)
//   0x14330-0x14382: positive limit check + active flag
//   0x14386:         neg path entry: D3 > posMax AND D3!=initD3 → 0x143a8
//                    else scrollRun!=0 AND dir=-1 → 0x143a8; else end
//   0x143a8-0x1443e: negative scroll update (speed select + D5/D6 -= speed, D4=-1)
//   0x14448-0x144d4: final write (only if D6 changed)
//
// Speed byte convention: ROM stores words (0x0100/0x0200/0x0400) big-endian.
//   cmp.b (addr).l, D0b reads the FIRST byte (high byte of word).
//   ROM[0x1f1ca]=0x01, ROM[0x1f1cc]=0x02, ROM[0x1f1ce]=0x04.
//   We use rom.program[addr] to get the byte.

function _tail(
  state: GameState,
  rom: RomImage,
  subs: RefreshHelper13EE6Subs,
): void {
  const wr = state.workRam;

  // 0x1411c: D0 = *0x400010; D1=7; D0 &= D1; beq → 0x14132
  // 0x14128: tst.b *0x400008; beq.w → end
  const evFlags = rl(wr, OFF_EVFLAGS);
  if ((evFlags & 7) !== 0) {
    if (rb(wr, OFF_RUN) === 0) return;
  }

  // 0x14132: init D3 based on slotMode
  const slotMode = rw(wr, OFF_SLOTCNT);
  let d3: number = (slotMode === 4) ? 0x9000 : 0x7000;
  const initD3 = d3; // (-0x2,A6) frame local

  // 0x1414e: slot scan loop
  {
    let a0o = OFF_SLOTBASE;
    let d1i = 0;
    const slotNr = Math.min(rw(wr, OFF_SLOTNR) & 0xffff, 256);

    while (d1i !== slotNr) {
      const d4 = rw(wr, a0o + SL_OFF_W20);
      const d2 = sx8(rb(wr, a0o + SL_OFF_FLAG1A));

      if (rb(wr, a0o + SL_OFF_FLAG18) !== 1) { a0o += SLOT_STRIDE; d1i++; continue; }
      if (rb(wr, a0o + SL_OFF_FLAG36) === 2) {
        if ((rl(wr, a0o + SL_OFF_LONG8) | 0) <= 0) { a0o += SLOT_STRIDE; d1i++; continue; }
      }

      const d2w = (d2 + 0x10000) & 0xffff;
      const d2ok = (d2w === 0 || d2w === 1 || d2w === 3 || d2w === 4 || d2w === 5);
      if (!d2ok) { a0o += SLOT_STRIDE; d1i++; continue; }

      if (slotMode !== 4) {
        if (sx16(d4) < sx16(d3)) d3 = d4; // min(D3, D4)
      } else {
        if (sx16(d4) > sx16(d3)) d3 = d4; // max(D3, D4)
      }

      a0o += SLOT_STRIDE; d1i++;
    }
  }

  // 0x141e4: cmp.w (-2,A6),D3w; bne → 0x141f4
  if (d3 === initD3) {
    // 0x141ea: tst.b scrollRun; beq → end
    if (rb(wr, OFF_RUN) === 0) return;
    // fall through to 0x141f4 with d3 still == initD3
  }

  // 0x141f4: cmp.w (-2,A6),D3w; bne → 0x14294
  if (d3 !== initD3) {
    // 0x14294: clr.w (A4)
    ww(wr, OFF_ACCUM, 0);
    // fall to 0x14296
  } else {
    // 0x141f8: tst.w (A4); bne → 0x14290
    const accum = rw(wr, OFF_ACCUM);
    if (accum !== 0) {
      // 0x14290: move.w (A4),D3w
      d3 = accum & 0xffff;
    } else {
      // 0x14202: look up accum target from current speed byte + ROM constants
      // Speed byte comparisons: cmp.b (rom_addr),D0b — reads HIGH byte of ROM word.
      // ROM word at 0x1f1ce = 0x0400 → byte = 0x04
      // ROM word at 0x1f1cc = 0x0200 → byte = 0x02
      const speed  = rb(wr, OFF_SPEED);
      const sMax   = rom.program[ROM_RANGE_BASE + 4] ?? 0; // 0x04
      const sLrg   = rom.program[ROM_RANGE_BASE + 2] ?? 0; // 0x02
      const center = sx16(rw_rom(rom, ROM_RANGE_BASE + 6)); // target_ctr
      const posMax = sx16(rw_rom(rom, ROM_RANGE_BASE + 8)); // pos_max
      const dNear  = sx16(rw_rom(rom, ROM_RANGE_BASE + 10)); // delta_near
      const dFar   = sx16(rw_rom(rom, ROM_RANGE_BASE + 12)); // delta_far
      const dir    = rb(wr, OFF_DIR);

      let d1step: number;
      if (speed === sMax) {
        d1step = (dir === 1)
          ? (center - dFar) & 0xffff
          : (dFar + posMax) & 0xffff;
      } else if (speed === sLrg) {
        d1step = (dir === 1)
          ? (center - dNear) & 0xffff
          : (dNear + posMax) & 0xffff;
      } else {
        d1step = (dir === 1) ? center & 0xffff : posMax & 0xffff;
      }
      ww(wr, OFF_ACCUM, d1step);
      d3 = rw(wr, OFF_ACCUM);
    }
  }

  // === 0x14296: main scroll update with D3, D5=xscroll, D6=hudOff ===
  let d4flag = 0;
  let d5 = rw(wr, OFF_XSCROLL);
  let d6 = rw(wr, OFF_HUDOFF);

  // ROM constants (byte = high byte of word)
  const sSml   = rom.program[ROM_RANGE_BASE + 0] ?? 0; // 0x01
  const sLrgB  = rom.program[ROM_RANGE_BASE + 2] ?? 0; // 0x02
  const sMaxB  = rom.program[ROM_RANGE_BASE + 4] ?? 0; // 0x04
  const center = sx16(rw_rom(rom, ROM_RANGE_BASE + 6));
  const posMax = sx16(rw_rom(rom, ROM_RANGE_BASE + 8));
  const dNear  = sx16(rw_rom(rom, ROM_RANGE_BASE + 10));
  const dFar   = sx16(rw_rom(rom, ROM_RANGE_BASE + 12));

  // 0x142a4: cmp.w (center),D3w; bge → 0x142b4 (pos path)
  const d3s = sx16(d3);
  if (d3s >= center) {
    // === Positive update path ===
    // 0x142b4: tst.b scrollRun; beq → 0x14386
    if (rb(wr, OFF_RUN) === 0) {
      _sec14386(state, rom, subs, d3, initD3, d5, d6, d4flag, center, posMax, dNear, dFar, sSml, sLrgB, sMaxB);
      return;
    }
    // 0x142be: cmpi.b #1,(A3); bne → 0x14386
    if (rb(wr, OFF_DIR) !== 1) {
      _sec14386(state, rom, subs, d3, initD3, d5, d6, d4flag, center, posMax, dNear, dFar, sSml, sLrgB, sMaxB);
      return;
    }
    // 0x142c6: select speed + update D5/D6
    _posUpdate(state, rom, subs, d3, initD3, d5, d6, d4flag, center, posMax, dNear, dFar, sSml, sLrgB, sMaxB);
    return;
  }

  // D3 < center:
  // 0x142ac: cmp.w (-2,A6),D3w; bne → 0x142c6  (D3 != initD3 → immediate pos update)
  if (d3 !== initD3) {
    // 0x142c6: pos update (no guards)
    _posUpdate(state, rom, subs, d3, initD3, d5, d6, d4flag, center, posMax, dNear, dFar, sSml, sLrgB, sMaxB);
    return;
  }

  // D3 < center AND D3 == initD3 → check same pos guards
  // 0x142b4: tst.b scrollRun; beq → 0x14386
  if (rb(wr, OFF_RUN) === 0) {
    _sec14386(state, rom, subs, d3, initD3, d5, d6, d4flag, center, posMax, dNear, dFar, sSml, sLrgB, sMaxB);
    return;
  }
  // 0x142be: cmpi.b #1,(A3); bne → 0x14386
  if (rb(wr, OFF_DIR) !== 1) {
    _sec14386(state, rom, subs, d3, initD3, d5, d6, d4flag, center, posMax, dNear, dFar, sSml, sLrgB, sMaxB);
    return;
  }
  // Guards passed → 0x142c6 pos update
  _posUpdate(state, rom, subs, d3, initD3, d5, d6, d4flag, center, posMax, dNear, dFar, sSml, sLrgB, sMaxB);
}

// ─── 0x142c6: positive scroll update ─────────────────────────────────────────

function _posUpdate(
  state: GameState,
  rom: RomImage,
  subs: RefreshHelper13EE6Subs,
  d3: number,
  initD3: number,
  d5: number,
  d6: number,
  d4flag: number,
  center: number,
  _posMax: number,
  dNear: number,
  dFar: number,
  sSml: number,
  sLrgB: number,
  sMaxB: number,
): void {
  const wr = state.workRam;
  // 0x142c6: speed selection
  // D1 = center - delta_far; if D0 < D1 → step_max  (bge: D0>=D1 → skip step_max)
  // D1 = center - delta_near; if D0 < D1 → step_large
  // if D0 > center → step_small
  const d0 = sx16(d3);
  if (d0 < (center - dFar)) {
    wb(wr, OFF_SPEED, sMaxB);
  } else if (d0 < (center - dNear)) {
    wb(wr, OFF_SPEED, sLrgB);
  } else if (d0 > center) {
    wb(wr, OFF_SPEED, sSml);
  }

  // 0x14318: D0 = sx8(speed); D5 += D0; wrap if > 0x1ff; D6 += D0; D4 = 1
  const spd = sx8(rb(wr, OFF_SPEED));
  d5 = (sx16(d5) + spd) & 0xffff;
  if (sx16(d5) > 0x1ff) d5 = (d5 - 0x200) & 0xffff;
  d6 = (sx16(d6) + spd) & 0xffff;
  d4flag = 1;

  // 0x14350: upper limit check
  const lvlPtr = rl(wr, OFF_LVLPTR);
  const lxbase = sx16(readW(state, rom, lvlPtr + LV_OFF_XBASE));
  const lxrng  = sx16(readW(state, rom, lvlPtr + LV_OFF_XRANGE));
  if (sx16(d6) > lxbase + lxrng) {
    wb(wr, OFF_RUN, 0);
    d6 = rw(wr, OFF_HUDOFF);
    d5 = rw(wr, OFF_XSCROLL);
    _scrollFinal(state, rom, subs, d3, initD3, d5, d6, d4flag);
    return;
  }

  // 0x14368: if scroll position changed: set active
  if ((rw(wr, OFF_XSCROLL) >> 3) !== ((d5 & 0xffff) >> 3)) wb(wr, OFF_ACTIVE, 1);
  _scrollFinal(state, rom, subs, d3, initD3, d5, d6, d4flag);
}

// ─── 0x14386: negative scroll entry ──────────────────────────────────────────

function _sec14386(
  state: GameState,
  rom: RomImage,
  subs: RefreshHelper13EE6Subs,
  d3: number,
  initD3: number,
  d5: number,
  d6: number,
  d4flag: number,
  _center: number,
  posMax: number,
  dNear: number,
  dFar: number,
  sSml: number,
  sLrgB: number,
  sMaxB: number,
): void {
  const wr = state.workRam;
  // 0x14386: cmp.w (posMax),D3w; ble → 0x14396  (D3 <= posMax → check neg guards)
  // else (D3 > posMax): cmp.w (-2,A6),D3w; bne → 0x143a8 (D3 != initD3 → neg update)
  const d3s = sx16(d3);
  if (d3s > posMax) {
    if (d3 !== initD3) {
      _negUpdate(state, rom, subs, d3, initD3, d5, d6, d4flag, posMax, dNear, dFar, sSml, sLrgB, sMaxB);
      return;
    }
    // D3 > posMax AND D3 == initD3 → check neg guards too
  }
  // 0x14396: tst.b scrollRun; beq → end
  if (rb(wr, OFF_RUN) === 0) return;
  // 0x143a0: cmpi.b #-1,(A3); bne → end
  if ((rb(wr, OFF_DIR) & 0xff) !== 0xff) return;
  // 0x143a8: negative update
  _negUpdate(state, rom, subs, d3, initD3, d5, d6, d4flag, posMax, dNear, dFar, sSml, sLrgB, sMaxB);
}

// ─── 0x143a8: negative scroll update ─────────────────────────────────────────

function _negUpdate(
  state: GameState,
  rom: RomImage,
  subs: RefreshHelper13EE6Subs,
  d3: number,
  initD3: number,
  d5: number,
  d6: number,
  d4flag: number,
  posMax: number,
  dNear: number,
  dFar: number,
  sSml: number,
  sLrgB: number,
  sMaxB: number,
): void {
  const wr = state.workRam;
  // 0x143a8: speed selection
  // D1 = posMax + delta_far; if D0 > D1 → step_max  (ble: skip step_max if D0 <= D1)
  // D1 = posMax + delta_near; if D0 > D1 → step_large
  // if D0 < posMax → step_small (bge: skip if D0 >= posMax)
  const d0 = sx16(d3);
  if (d0 > posMax + dFar) {
    wb(wr, OFF_SPEED, sMaxB);
  } else if (d0 > posMax + dNear) {
    wb(wr, OFF_SPEED, sLrgB);
  } else if (d0 < posMax) {
    wb(wr, OFF_SPEED, sSml);
  }

  // 0x143fa: D0 = sx8(speed); D5 -= D0; wrap if < 0; D6 -= D0; D4 = -1
  const spd = sx8(rb(wr, OFF_SPEED));
  d5 = (sx16(d5) - spd) & 0xffff;
  if (sx16(d5) < 0) d5 = (d5 + 0x200) & 0xffff;
  d6 = (sx16(d6) - spd) & 0xffff;
  d4flag = 0xffff;

  // 0x14416: lower limit check
  const lvlPtr = rl(wr, OFF_LVLPTR);
  const lxbase = sx16(readW(state, rom, lvlPtr + LV_OFF_XBASE));
  if (sx16(d6) < lxbase) {
    wb(wr, OFF_RUN, 0);
    d6 = rw(wr, OFF_HUDOFF);
    d5 = rw(wr, OFF_XSCROLL);
    _scrollFinal(state, rom, subs, d3, initD3, d5, d6, d4flag);
    return;
  }

  // 0x14430: if scroll position changed: set active
  if ((rw(wr, OFF_XSCROLL) >> 3) !== ((d5 & 0xffff) >> 3)) wb(wr, OFF_ACTIVE, 1);
  _scrollFinal(state, rom, subs, d3, initD3, d5, d6, d4flag);
}

// ─── Sezione 0x14448: scroll final write ─────────────────────────────────────

function _scrollFinal(
  state: GameState,
  rom: RomImage,
  subs: RefreshHelper13EE6Subs,
  d3: number,
  initD3: number,
  d5: number,
  d6: number,
  d4flag: number,
): void {
  const wr = state.workRam;

  // 0x14448: cmp.l (*0x40097c),sext(D6); beq → 0x1449a (no change)
  const oldTarget = rl(wr, OFF_SRTGT);
  const d6ext = (sx16(d6) >>> 0);

  if (d6ext !== oldTarget) {
    // 0x14454: jsr FUN_144e4(oldTarget, sext(D6))
    if (subs.fun144e4) subs.fun144e4(state, rom, oldTarget, sx16(d6));

    // 0x14466: *0x400000 = D5
    ww(wr, OFF_XSCROLL, d5 & 0xffff);

    // 0x1446c: *0x40097c = sext(D6)
    wl(wr, OFF_SRTGT, sx16(d6) >>> 0);

    // 0x14476: if accum != 0: accum +/- speed (based on dir)
    const accum = rw(wr, OFF_ACCUM);
    if (accum !== 0) {
      const sp = sx8(rb(wr, OFF_SPEED));
      if (rb(wr, OFF_DIR) === 1) {
        ww(wr, OFF_ACCUM, (sx16(accum) + sp) & 0xffff);
      } else {
        ww(wr, OFF_ACCUM, (sx16(accum) - sp) & 0xffff);
      }
    }

    // 0x14490: *0x400008 = 1 (scrollRun)
    wb(wr, OFF_RUN, 1);

    // 0x14498: *0x400004 = D4b (direction)
    wb(wr, OFF_DIR, d4flag & 0xff);
  }

  // 0x1449a: cmp.w (-2,A6),D3w; beq → 0x144dc (if D3 == initD3: skip boundary check)
  if (d3 === initD3) return;

  // 0x144a0: D3 != initD3: boundary checks
  const center2 = sx16(rw_rom(rom, ROM_RANGE_BASE + 6));
  const posMax2  = sx16(rw_rom(rom, ROM_RANGE_BASE + 8));

  // 0x144a4: if D3 > center + 0x10 AND dir==1 → clr scrollRun
  if ((sx16(d3) | 0) > (center2 + 0x10)) {
    if (rb(wr, OFF_DIR) === 1) {
      wb(wr, OFF_RUN, 0);
      return;
    }
  }

  // 0x144bc: if D3 < posMax - 0x10 AND dir==-1 → clr scrollRun
  if ((sx16(d3) | 0) < (posMax2 - 0x10)) {
    if ((rb(wr, OFF_DIR) & 0xff) === 0xff) {
      wb(wr, OFF_RUN, 0);
    }
  }
}

// ─── Utility ROM word reader ──────────────────────────────────────────────────

function rw_rom(rom: RomImage, abs: number): number {
  const a = abs >>> 0;
  return (((rom.program[a] ?? 0) << 8) | (rom.program[a + 1] ?? 0)) & 0xffff;
}
