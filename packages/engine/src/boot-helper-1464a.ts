/**
 * boot-helper-1464a.ts — replica bit-perfect di `FUN_0001464A`.
 *
 * Chiamata da FUN_117B2 (main loop init prefix) @ 0x117DC come primo passo
 * della sequenza di inizializzazione del main loop.
 *
 * **Cosa fa**:
 *   1. Azzera registri MMIO (scroll, MO, Alpha) — side-effect su hardware,
 *      ignorati nel modello TS.
 *   2. Inizializza 2 player object slot @ 0x400018 e 0x4000FA (stride 0xE2):
 *      - byte 0x18 = 0 (slot active flag)
 *      - byte 0x6E = 0xFF
 *      - byte 0x71 = 0xFF, byte 0x70 = 0xFF
 *      - byte 0xC0..0xC2 = 0x41
 *      - Per ciascun slot i (0..1): workRam[0x4009A4 + i*0x7C + 0x18] = 0
 *        (formula: D0 = D2*4*32 - D2*4 = D2*0x7C)
 *   3. Scrive globals workRam: 0x4003A2=0xFF, 0x400008=0, 0x400006=0,
 *      0x40000A=0, 0x400396=1, 0x40039C=0, 0x4003A8=0xFF, 0x4003AA=0xFF,
 *      0x4003AC=0, 0x40045C=0, 0x4003E2=0, 0x40045E=0, 0x400460=0xFF,
 *      0x4003B4=0, 0x4003B2=0, 0x4003EE=0, 0x4003EA=0x0000, 0x4003E6=0,
 *      0x400408=0x40040C (long pointer)
 *   4. JSR subs (injectable): enableIrq1010A, slotArrayBulkInit10392,
 *      gameStateBanner26B2A, initFnPointers28580, textPrint0118, textRender100,
 *      vblankAck28DEA, clearPaletteRam121A6, wait28DB8, softReset100E0,
 *      readSwitches1A8, coinRead1C0, coinWrite1B4, gameDispatch1AE,
 *      dispatchTable11AD8, soundCmd158AC.
 *   5. addq.b 1,(0x4003F0) × 2 durante l'esecuzione.
 *   6. Imposta 0x40039E=0x001E, 0x4003A0=0, 0x4003A2=0 (via A3 = 0x40039E).
 *   7. Imposta 0x4003DE (da readSwitches1A8 result), 0x4003EA (se result >=
 *      0xE0), 0x4003DC (da secondo readSwitches1A8 result).
 *
 * **Indirizzi sub** (tutti injectable come stubs per test parità):
 *   0x1010A = enableIrq1010A (move SR=0x2000 + rts; no RAM effect)
 *   0x10392 = slotArrayBulkInit
 *   0x26B2A = gameStateBanner26B2A
 *   0x28580 = initFnPointers28580
 *   0x28DEA = vblankAck28DEA
 *   0x121A6 = clearPaletteRam121A6
 *   0x100E0 = softReset100E0
 *   0x100   = textRender100
 *   0x118   = textPrint0118
 *   0x28DB8 = wait28DB8
 *   0x1A8   = readSwitches1A8   (→ jmp 0x40D8)
 *   0x1C0   = coinRead1C0       (→ jmp 0x4420)
 *   0x1B4   = coinWrite1B4      (→ jmp 0x428E)
 *   0x1AE   = gameDispatch1AE   (→ jmp 0x41C8)
 *   0x11AD8 = dispatchTable11AD8
 *   0x158AC = soundCmd158AC
 */

import type { GameState } from "./state.js";
import { slotArrayBulkInit } from "./slot-array-init.js";

export const BOOT_HELPER_1464A_ADDR = 0x0001464a as const;

const WRAM = 0x00400000;

function off(addr: number): number {
  return addr - WRAM;
}

function rb(state: GameState, addr: number): number {
  return state.workRam[off(addr)] ?? 0;
}

function wb(state: GameState, addr: number, value: number): void {
  state.workRam[off(addr)] = value & 0xff;
}

function rw(state: GameState, addr: number): number {
  return (((state.workRam[off(addr)] ?? 0) << 8) | (state.workRam[off(addr) + 1] ?? 0)) & 0xffff;
}

function ww(state: GameState, addr: number, value: number): void {
  state.workRam[off(addr)] = (value >>> 8) & 0xff;
  state.workRam[off(addr) + 1] = value & 0xff;
}

function wl(state: GameState, addr: number, value: number): void {
  const v = value >>> 0;
  state.workRam[off(addr)] = (v >>> 24) & 0xff;
  state.workRam[off(addr) + 1] = (v >>> 16) & 0xff;
  state.workRam[off(addr) + 2] = (v >>> 8) & 0xff;
  state.workRam[off(addr) + 3] = v & 0xff;
}

function addByte(state: GameState, addr: number, delta: number): void {
  wb(state, addr, rb(state, addr) + delta);
}

/**
 * Subs iniettabili. Tutte opzionali — il default è no-op per la maggior parte,
 * oppure l'implementazione canonica per slotArrayBulkInit.
 *
 * `readSwitches1A8` ritorna il valore raw 8-bit dal dipswitch selezionato
 * (slot passato come arg). Nel binario legge da MMIO F20000+.
 *
 * `gameDispatch1AE` ritorna un puntatore long (D0) che viene dereferenziato
 * per decidere il path di dispatchTable11AD8. Default = 0 → null pointer →
 * path che chiama dispatchTable11AD8(0).
 */
export interface BootHelper1464ASubs {
  /** FUN_1010A: enable interrupts (SR=0x2000). No RAM side effects. */
  enableIrq1010A?: (state: GameState) => void;
  /** FUN_10392: bulk init delle slot array di oggetti. */
  slotArrayBulkInit10392?: (state: GameState) => void;
  /** FUN_26B2A: mostra banner stato gioco. */
  gameStateBanner26B2A?: (state: GameState, mode: number) => void;
  /** FUN_28580: inizializza puntatori funzione @ 0x400412 etc. */
  initFnPointers28580?: (state: GameState) => void;
  /** FUN_28DEA: vblank acknowledge (write 0 a 0x400016, aspetta che torni 1). */
  vblankAck28DEA?: (state: GameState) => void;
  /** FUN_121A6: azzera palette RAM (0xB00000, 0x200 long). */
  clearPaletteRam121A6?: (state: GameState) => void;
  /** FUN_100E0: soft reset (incrementa 0x4003B6, imposta 0x4003B8=0x12C, ecc.). */
  softReset100E0?: (state: GameState) => void;
  /** FUN_100: text render con tilebase+ptr+flags. */
  textRender100?: (state: GameState, textPtr: number, tileBase: number, flags: number) => void;
  /** FUN_118: text print con ptr. */
  textPrint0118?: (state: GameState, textPtr: number) => void;
  /** FUN_28DB8: attende N frame. */
  wait28DB8?: (state: GameState, frames: number) => void;
  /**
   * FUN_1A8 (→ jmp 0x40D8): legge dipswitch/coin slot selezionato dal arg.
   * Arg 0xb = numero di monete P1, 0xc = ?? .
   * Returns raw byte value.
   */
  readSwitches1A8?: (state: GameState, slot: number) => number;
  /** FUN_1C0 (→ jmp 0x4420): coin counter write. */
  coinRead1C0?: (state: GameState, slot: number, value: number) => void;
  /** FUN_1B4 (→ jmp 0x428E): coin/io write con puntatore e arg. */
  coinWrite1B4?: (state: GameState, ptr: number, zero: number) => void;
  /**
   * FUN_1AE (→ jmp 0x41C8): game dispatch con arg slot.
   *
   * Nel binario ritorna D0 = puntatore a un long. Il caller verifica
   * `*(D0) == 0` per decidere se chiamare dispatchTable11AD8.
   * In questa astrazione, la callback restituisce direttamente il valore
   * dereferenziato (0 = "non inizializzato → chiama dispatchTable",
   * non-zero = "già inizializzato → salta dispatchTable").
   *
   * Default: ritorna non-zero (simula oggetto già inizializzato → skip).
   */
  gameDispatch1AE?: (state: GameState, slot: number) => number;
  /** FUN_11AD8: imposta dispatch table entry per slot. */
  dispatchTable11AD8?: (state: GameState, slot: number) => void;
  /** FUN_158AC: invia sound command. */
  soundCmd158AC?: (state: GameState, cmd: number) => void;
}

/**
 * Replica bit-perfect di `FUN_0001464A` — boot helper per il main loop init.
 *
 * Inizializza workRam globals e slot oggetti player durante il transiente di
 * boot (prima che il game state machine entri nel loop principale).
 */
export function bootHelper1464A(
  state: GameState,
  subs: BootHelper1464ASubs = {},
): void {
  // A3 = 0x40039E, A2 = 0x4003B8, A4 = 0x4003DE (saved registers for use below)

  // --- MMIO clears (hardware only, no workRam effect) ---
  // clr.w (0x400000).l  ; workRam[0] = 0  ← questi sono workRam + MMIO scroll
  // clr.w (0x400002).l  ; workRam[2] = 0
  // clr.w (0x800000).l  ; MMIO scroll → ignored
  // clr.w (0x820000).l  ; MMIO MO    → ignored
  // clr.w (0x880000).l  ; MMIO alpha → ignored
  // Note: 0x400000 e 0x400002 sono workRam reale in questo contesto
  ww(state, 0x00400000, 0);
  ww(state, 0x00400002, 0);
  // 0x800000, 0x820000, 0x880000 sono MMIO puri → no workRam

  // --- Loop D2=0..1: init player object slots ---
  // A1 base = 0x400018, stride = 0xE2
  // Slot i has base at 0x400018 + i*0xE2
  // A0 = 0x4009A4 (separate array), index D0 = D2*(4*32 - 4) = D2*0x7C
  for (let d2 = 0; d2 < 2; d2++) {
    const a1 = 0x400018 + d2 * 0xe2;

    // clr.b (0x18,A1) — slot active flag = 0
    wb(state, a1 + 0x18, 0);
    // move.b #-1,(0x6E,A1)
    wb(state, a1 + 0x6e, 0xff);
    // move.b #-1,(0x71,A1) and (0x70,A1)
    wb(state, a1 + 0x71, 0xff);
    wb(state, a1 + 0x70, 0xff);
    // move.b #0x41,(0xC2,A1), (0xC1,A1), (0xC0,A1)
    wb(state, a1 + 0xc2, 0x41);
    wb(state, a1 + 0xc1, 0x41);
    wb(state, a1 + 0xc0, 0x41);

    // D0 = D2 (ext.l) * 4 * 32 - D2 * 4 = D2 * 0x7C
    // Disasm: D0=D2, ext.l, asl.l #2 → D0=D2*4, D1=D2*4, asl.l #5 → D0=D2*128,
    //         sub.l D1,D0 → D0 = D2*128 - D2*4 = D2*124 = D2*0x7C
    const d0 = (d2 * 0x7c) >>> 0;
    // clr.b (0x18, A0, D0*1) where A0=0x4009A4
    wb(state, 0x4009a4 + 0x18 + d0, 0);
  }

  // --- After loop: MMIO clear (again) + workRam globals ---
  // clr.w (0x880000).l → MMIO, ignore
  // move.b #-1,(0x4,A3) where A3=0x40039E → (0x4003A2) = 0xFF
  wb(state, 0x004003a2, 0xff);

  // clr.b D0; move.b to (0x400008), (0x400006), (0x40000A)
  wb(state, 0x00400008, 0);
  wb(state, 0x00400006, 0);
  wb(state, 0x0040000a, 0);

  // move.w #1,(0x400396).l
  ww(state, 0x00400396, 1);
  // clr.b (0x40039C).l
  wb(state, 0x0040039c, 0);
  // move.b #-1 to (0x4003A8) and (0x4003AA)
  wb(state, 0x004003a8, 0xff);
  wb(state, 0x004003aa, 0xff);
  // clr.b (0x4003AC).l
  wb(state, 0x004003ac, 0);
  // clr.w (0x40045C).l
  ww(state, 0x0040045c, 0);
  // clr.b (0x4003E2).l
  wb(state, 0x004003e2, 0);
  // clr.b (0x40045E).l
  wb(state, 0x0040045e, 0);
  // move.b #-1,(0x400460).l
  wb(state, 0x00400460, 0xff);
  // clr.b (0x4003B4).l, clr.b (0x4003B2).l
  wb(state, 0x004003b4, 0);
  wb(state, 0x004003b2, 0);
  // clr.b D0; move.b to (0x4003EE)
  wb(state, 0x004003ee, 0);
  // ext.w D0; move.w to (0x4003EA)
  ww(state, 0x004003ea, 0);
  // clr.b (0x4003E6).l
  wb(state, 0x004003e6, 0);
  // move.l #0x40040C,(0x400408).l
  wl(state, 0x00400408, 0x0040040c);

  // JSR 0x1010A — enable interrupts (SR=0x2000), no workRam effect
  (subs.enableIrq1010A ?? (() => undefined))(state);

  // addq.b 1,(0x4003F0)
  addByte(state, 0x004003f0, 1);

  // JSR 0x10392 — slotArrayBulkInit
  (subs.slotArrayBulkInit10392 ?? slotArrayBulkInit)(state);

  // tst.b (0x40000E) — test service/self-test mode
  const serviceByte = rb(state, 0x0040000e);
  const serviceMode = (serviceByte & 0x80) !== 0; // blt = signed less than 0 = bit7 set

  if (!serviceMode) {
    // --- Normal (non-service) path ---
    // clr.w (0x400390).l
    ww(state, 0x00400390, 0);
    // push 0, jsr 0x26B2A (gameStateBanner with mode=0)
    subs.gameStateBanner26B2A?.(state, 0);

    // tst.b (0x40000E); bne skip-print
    const svcByte2 = rb(state, 0x0040000e);
    if ((svcByte2 & 0xff) === 0) {
      // JSR 0x28580 — initFnPointers28580
      subs.initFnPointers28580?.(state);
      // pea 0x28, pea 0x3400, pea 0x22A1A; jsr 0x100
      subs.textRender100?.(state, 0x00022a1a, 0x3400, 0x28);
    }

    // clr.b (0x4003AC)
    wb(state, 0x004003ac, 0);
    // move.w #0x1E,(A3) where A3=0x40039E
    ww(state, 0x0040039e, 0x1e);
    // clr.b (0x2,A3) = 0x4003A0
    wb(state, 0x004003a0, 0);
    // clr.b (0x4,A3) = 0x4003A2
    wb(state, 0x004003a2, 0);

    // Loop: while (0x4003AC & 3) == 0 && (0x40039E) != 0xFFFF: vblankAck
    // 147C6: move.b (0x4003AC),D0; ext.w; ext.l; and.l #3,D0
    //   bne 147E4  (if D0 != 0, exit loop)
    // 147D6: moveq -1,D0; cmp.w (A3),D0; beq 147E4 (if A3 == 0xFFFF, exit)
    // 147DC: jsr 28DEA; bra 147C6
    //
    // NOTE: in the real hardware vblankAck blocks until the vblank ISR sets
    // 0x400016, and eventually the ISR or game logic sets 0x4003AC to a
    // non-zero value. Without a real vblank source (unit tests, stub mode)
    // we skip the loop entirely when no vblankAck sub is provided.
    if (subs.vblankAck28DEA !== undefined) {
      for (;;) {
        const ac = rb(state, 0x004003ac) & 0xff;
        const d0 = ac & 3;
        if (d0 !== 0) break;
        // cmp.w #-1,(0x40039E)
        if (rw(state, 0x0040039e) === 0xffff) break;
        subs.vblankAck28DEA(state);
      }
    }

    // tst.b (0x40000E); bne skip-textprint
    const svcByte3 = rb(state, 0x0040000e);
    if ((svcByte3 & 0xff) === 0) {
      // pea 0x22A1A; jsr 0x118 (textPrint)
      subs.textPrint0118?.(state, 0x00022a1a);
    }

    // JSR 0x121A6 — clearPaletteRam
    subs.clearPaletteRam121A6?.(state);
  }

  // --- Common path (both service and normal) ---
  // 0x14800:
  // JSR 0x28580 — initFnPointers28580
  subs.initFnPointers28580?.(state);
  // pea 0x3C; jsr 0x28DB8 (wait 60 frames)
  subs.wait28DB8?.(state, 0x3c);

  // tst.w (A2) where A2=0x4003B8; beq 0x14866
  const a2val = rw(state, 0x004003b8);
  if (a2val !== 0) {
    // Non-zero path: gameStateBanner + countdown
    // push 0; jsr 0x26B2A
    subs.gameStateBanner26B2A?.(state, 0);
    // pea 0x28, pea 0x3400, pea 0x228E2; jsr 0x100
    subs.textRender100?.(state, 0x000228e2, 0x3400, 0x28);

    // Loop: while (0x4003B8) != 0:
    //   if 0: break
    //   vblankAck; test again; if 0: break; 0x4003B8--; if != 0: continue
    //   else softReset100E0 + continue loop
    for (;;) {
      const bval = rw(state, 0x004003b8);
      if (bval === 0) break;
      subs.vblankAck28DEA?.(state);
      const bval2 = rw(state, 0x004003b8);
      if (bval2 === 0) break;
      // subq.w 1,(A2) — decrement
      ww(state, 0x004003b8, (rw(state, 0x004003b8) - 1) & 0xffff);
      if (rw(state, 0x004003b8) !== 0) continue;
      // Counter reached 0 → soft reset + loop back to tst.w (0x14836)
      subs.softReset100E0?.(state);
      // bra 0x14836: loop continues (tst.w again will be 0 → exit)
      // Actually after softReset the counter may change, but in the binary
      // it goes bra 0x14836 which retests. If 0x4003B8 is still 0 it exits.
      continue;
    }

    // 0x14852:
    // pea 0x228E2; jsr 0x118 (textPrint)
    subs.textPrint0118?.(state, 0x000228e2);
    // JSR 0x121A6 — clearPaletteRam
    subs.clearPaletteRam121A6?.(state);
    // addq.l 4,SP (implicit, no workRam effect)
  }

  // --- 0x14866: always ---
  // pea 0xB; jsr 0x1A8 (readSwitches with arg 0xB)
  const sw0b = (subs.readSwitches1A8?.(state, 0xb) ?? 0) & 0xff;
  // andi.w #0xFF,D0; move.w D0,(A4) where A4=0x4003DE
  // then cmpi.w #0xE0,(A4); addq.l 4,SP; blt 0x1488A
  if (sw0b >= 0xe0) {
    // moveq -1,D0; move.w to (0x4003EA) and (A4=0x4003DE)
    ww(state, 0x004003ea, 0xffff);
    ww(state, 0x004003de, 0xffff);
    // bra 0x1488E
  } else {
    // andi.w #3,(A4) — 0x4003DE &= 3
    ww(state, 0x004003de, sw0b & 3);
  }

  // --- 0x1488E ---
  // addq.b 1,(0x4003F0)
  addByte(state, 0x004003f0, 1);

  // pea 0xC; jsr 0x1A8 (readSwitches with arg 0xC)
  const sw0c = subs.readSwitches1A8?.(state, 0xc) ?? 0;
  // move.w D0,(0x4003DC)
  ww(state, 0x004003dc, sw0c & 0xffff);

  // move.w (0x4003DC),D0; ext.l D0; andi.l #0x8000,D0; beq 0x148E6
  const dc = rw(state, 0x004003dc);
  const dcSigned = (dc & 0xffff) | 0;
  const bit15 = ((dcSigned << 16) >>> 16) & 0x8000;
  if (bit15 !== 0) {
    // andi.w #0x7FFF,(0x4003DC) — clear bit 15
    ww(state, 0x004003dc, dc & 0x7fff);
    // move.w (0x4003DC),D1; ext.l D1
    const d1 = dc & 0x7fff;
    // push D1, push 0xC; jsr 0x1C0 (coinRead with slot 0xC, value d1)
    subs.coinRead1C0?.(state, 0xc, d1);

    // lea (-8,A6),A0; clr.l (A0); push A0; push 0; jsr 0x1B4 (coinWrite)
    // In TS context: A6 is frame pointer; we don't have a frame pointer.
    // The binary pushes a local var pointer and 0.
    // Effect on workRam: the local var is at stack, not workRam — no workRam write.
    subs.coinWrite1B4?.(state, 0, 0);
  }

  // --- 0x148E6 ---
  // clr.l -(SP); jsr 0x1AE (gameDispatch with arg 0)
  // D0 = return value; A0 = D0; test *(A0): if 0, call dispatchTable
  // The callback returns the DEREFERENCED value (0 = uninit → call dispatchTable;
  // non-zero = already init → skip). Default non-zero = skip (safe default for boot).
  const deref0 = subs.gameDispatch1AE?.(state, 0) ?? 1;
  if (deref0 === 0) {
    // *(D0) == 0 → call dispatchTable(0)
    subs.dispatchTable11AD8?.(state, 0);
    // bra 0x14920
  } else {
    // *(D0) != 0 → check arg 4 path
    // pea 4; jsr 0x1AE (gameDispatch with arg 4)
    const deref4 = subs.gameDispatch1AE?.(state, 4) ?? 1;
    // if *(ptr4) == 0 → dispatchTable11AD8(4)
    if (deref4 === 0) {
      subs.dispatchTable11AD8?.(state, 4);
    }
    // else: both non-zero → skip dispatchTable entirely
  }

  // --- 0x14920 ---
  // addq.b 1,(0x4003F0)
  addByte(state, 0x004003f0, 1);

  // pea 0x61; jsr 0x158AC (sound command 0x61)
  subs.soundCmd158AC?.(state, 0x61);
}

/**
 * Default implementation per il wiring in mainLoopInit117B2.
 *
 * Usa slotArrayBulkInit canonico; tutte le altre subs sono no-op (appropriato
 * per boot transient prima che i sub-system siano completamente inizializzati).
 */
export function bootHelper1464ADefault(state: GameState): void {
  bootHelper1464A(state, {
    slotArrayBulkInit10392: slotArrayBulkInit,
  });
}
