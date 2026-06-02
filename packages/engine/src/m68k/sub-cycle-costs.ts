/**
 * sub-cycle-costs.ts - M68010 cycle estimates for subroutines called by the
 * ROM main-loop body (`FUN_10FCE`, orchestrated by `FUN_1101E` case 0/1, plus
 * post-body `FUN_26F3E`).
 *
 * Purpose: feed `main-tick`'s cycle counter so it can model the dynamic 30/60Hz
 * cadence observed in MAME. Fast bodies wait across two vsyncs; expensive paths
 * can overrun the vblank budget and run at 60Hz for short windows.
 *
 * **Methodology**:
 *   - Read each subroutine's `Disasm 0xXXXX..0xYYYY` header in the matching TS
 *     file, group instructions by category, and apply M68010 base cycles.
 *   - Looping subs multiply the observed attract/gameplay loop count and include
 *     taken/not-taken branch costs.
 *   - Gated subs have fast-path and full-path estimates; the main map keeps the
 *     full path and comments call out fast-path behavior where relevant.
 *
 * These numbers are approximate (+/-15%). The granularity is enough to
 * separate 30Hz from 60Hz paths, not to claim bit-perfect M68010 cycle timing.
 *
 * **Convention**:
 *   - Constants are branded `u32` cycle counts.
 *   - `_FAST` suffix = false gate or minimum loop count.
 *   - `_AVG` suffix = observed attract/gameplay average.
 *   - Default (no suffix) = `_AVG`.
 *
 * **Reference**:
 *   - M68010 Cycle Table: M68000PRM Appendix B (Motorola, 1992).
 *   - Disasm header for each sub: see TS files under
 *     `packages/engine/src/<sub-name>.ts`.
 *   - Drift baseline (sanity probe): `npx tsx packages/cli/src/
 *     probe-cluster-histogram.ts | head -1` → `f+99 workRam total diff
 *     = 387` (unchanged after adding this table).
 */
import { as_u32, type u32 } from "../wrap.js";

// ─── Reference constants ──────────────────────────────────────────────────

/**
 * Cycles per vblank at 60Hz with the M68010 at 7.16 MHz:
 *   7159000 cycles/sec / 60 fps ~= 119316.66
 * Below this threshold the body effectively runs at 30Hz; above it, it slips to
 * a single-vsync 60Hz cadence.
 */
export const CYCLES_PER_VBLANK: u32 = as_u32(119316);

/** Cycles per vblank at 30Hz (= 2 x 60Hz), used as a very-slow threshold. */
export const CYCLES_PER_VBLANK_30HZ: u32 = as_u32(238632);

// ─── Body subroutine cycle-cost estimates ─────────────────────────────────
//
// Range: most subroutines have conditional gates (`*0x400394 == N`,
// `*0x400760 != 0`, etc.). We keep the estimate for `*0x400394 == 4`
// (active gameplay), which is the loaded path. Attract-mode gated paths are
// significantly faster and are annotated with `_FAST`.

export const SUB_CYCLE_ESTIMATE: Readonly<Record<string, u32>> = {
  // FUN_10FCE: refreshFrame10FCE, body orchestrator, 80 bytes.
  //
  // Disasm 0x10FCE..0x1001C (19 instructions):
  //   - 12 × `jsr 0x........l`         (12 × 20) = 240
  //   -  2 × `addq.b #1,(0x4003F0).l`  (2  × 24) =  48
  //   -  1 × `rts`                      = 16
  //   Total prologue + epilogue orchestrator overhead: ~304 cycles plus called
  //   subroutine bodies, which are summed separately.
  //
  // FUN_10FCE overhead without the 12 called subroutines:
  "FUN_10FCE_OVERHEAD": as_u32(304),

  // ─── FUN_251DE: objectScanDispatch251DE (478 byte, ~120 istr) ───────────
  //
  // Outer loop: for each obj in [0..*0x400396) (typical count = 2 in attract,
  // 8-22 in gameplay):
  //   - loop prologue: 6 movem/lea/cmpi/branch ~= 30 cycles
  //   - cmpi.b #0 / beq -> continue when slot is empty: 12 + 10 = 22
  //   - cmpi.w #0x190 (0x6A,A2): 16 cycles
  //   - jsr FUN_253EC(obj): 20 + 80 (cycle estimate for FUN_253EC fast path
  //     dispatch JT) = 100
  //   - re-test cmpi.b: ~22 cycles
  //   - state-3/2 increment branch: ~20 cycles (most paths skip respawn)
  //
  // Respawn block (very narrow gate: count==2 + X range + level==4):
  //   practically never reached in attract. Average estimate: 0 cycles.
  //
  // For count=2 (attract): outer ~ 2 x (30+22+16+100+22+20) = ~420
  // For count=22 (heavy gameplay): outer ~ 22 x 210 = ~4620
  //
  // FUN_253EC inner is folded into this estimate: the jump table at 0x254BA
  // dispatches 12 entries; the s1a=0 path for obj0 calls helper253BC,
  // objectStep17F66, and helper121B8 (see below). With helper121B8 included,
  // FUN_253EC costs ~6500 for the player or ~150 for a non-player slot. We
  // model it as part of 251DE with an obj=2 average (both player slots).
  //
  // ATTRACT (count=2, gameplay path s1a=0, ELSE-branch in 158F6):
  //   2 × FUN_253EC = 2 × (overhead + helper253BC + objectStep17F66
  //                       + helper121B8)
  //   = 2 × (80 + 200 + 600 + 4500)
  //   = 2 × 5380 = 10760
  // Outer overhead: ~420
  // Total: ~11180 cycles (attract gameplay path)
  //
  // FAST (respawn gate skipped, no helper121B8 chain, count=2): ~700 cycles
  "FUN_251DE_FAST": as_u32(700),
  "FUN_251DE": as_u32(11180), // = AVG attract gameplay (count=2)
  "FUN_251DE_HEAVY": as_u32(60000), // count=8-12 con full helper121B8 chain

  // ─── FUN_189E2: processAllSprites (60 byte, ~14 istr loop) ──────────────
  //
  // Gate: *0x400394 == 0 -> skip when != 0 (`bne.w exit`). In gameplay
  // (*0x394 == 4) the gate is false and the routine skips completely. In
  // attract (*0x394 == 0 or transition value), the loop is active.
  //
  // Loop body per entry (count = *0x400396):
  //   move.l D3,D1; moveq #0xC,D0; add.l D0,D3; move.l D1,-(SP);
  //   jsr 0x18A1E; addq.l #4,SP; addq.b #1,D2;
  //   move.b D2,D0; ext.w D0; cmp.w (0x400396).l,D0w; bne.b loop
  //   = 4+4+4+12+20+8+4+4+4+16+10 = 90 cycles + cost(FUN_18A1E)
  //
  // FUN_18A1E (computeSpriteCoords_v1) estimate: ~120 cycles (4 long loads, 2
  // word store, 1 mul effective addr).
  //
  // For count=2 (attract): 2 x 210 + prologue 30 + epilogue 16 = ~470
  // For count=22: 22 x 210 + 50 = ~4670
  //
  // GATE OFF (game mode 4 = active gameplay): tst.w + bne.w + movem rts
  //   = 12 + 10 + 16 = 38 cycles, the fast path.
  "FUN_189E2_FAST": as_u32(40), // gate off (gameplay attivo)
  "FUN_189E2": as_u32(470), // attract count=2
  "FUN_189E2_HEAVY": as_u32(4670), // gameplay count=22

  // ─── FUN_158CC: objectUpdatePair158CC (42 byte, 12 istr loop) ───────────
  //
  // Loop 2 iter (P1/P2 slot pair):
  //   movem (12) + 2 × (move/moveq/add/move/jsr+rts/addq/addq/cmpi/bne)
  //   + movem rts
  //   Per iter: 4+4+4+12+20+8+4+4+12+10 = 82 + FUN_158F6 cost
  // Total overhead 158CC: 12 + 16 + 2×82 + 16 = 208 + 2×FUN_158F6
  //
  // FUN_158F6 estimate:
  //   - prologue: movem + movea = ~24
  //   - tst.b (0x18) / beq epilog: 16
  //   - if ELSE branch (default for attract, s18=1 → ELSE): calls
  //     helper253BC (200) + helper182BA (900) + helper121B8 (4500)
  //     + 3 × push/jsr/cleanup: ~80
  //   - epilog: ~20
  // FUN_158F6 ELSE: ~24+16+5680+20 = ~5740 cycles
  // FUN_158F6 STATE-2 (s18=2): ~24+16+helper25FC2(~400)+1B9CC(~150)
  //   +1281C(~300)+80 = ~970
  // FUN_158F6 EMPTY (s18=0): ~24+16+epilog20 = 60
  //
  // 158CC total (attract, both slot pairs active ELSE):
  //   ~208 + 2 × 5740 = ~11688
  // 158CC fast (slot pair both s18=0): ~208 + 2 × 60 = ~328
  "FUN_158CC_FAST": as_u32(330),
  "FUN_158CC": as_u32(11700), // attract gameplay (P1+P2 active ELSE)
  "FUN_158F6_ELSE": as_u32(5740),
  "FUN_158F6_STATE2": as_u32(970),
  "FUN_158F6_EMPTY": as_u32(60),

  // ─── FUN_1493C: slotArrayTick (42 byte, loop 4 iter) ────────────────────
  //
  // Same structure as 158CC but with 4 iterations; FUN_14966 is a minimal stub
  // (head-only ~100 cycles average; plus loop overhead ~80/iter).
  //   ~32 prologue + 4 × (80 + cost(FUN_14966)) + 16 epilog
  //
  // FUN_14966 stub: ~100 cycles (head-only path)
  // FUN_14966 full (slot 3 with queue drain): ~800
  // 1493C total attract: 32 + 4×180 + 16 = ~768
  // 1493C heavy: 32 + 4×880 + 16 = ~3568
  "FUN_1493C": as_u32(770),
  "FUN_1493C_HEAVY": as_u32(3570),

  // ─── FUN_17230: dispatchStrings17230 (42 byte, loop 7 iter) ─────────────
  //
  // 7-iteration loop, FUN_1725A estimate per inactive slot ~30 cycles (tst+beq+
  // epilog), per active slot ~300-500 (typo/anim step).
  //   ~32 prologue + 7 × (80 + cost(FUN_1725A)) + 16 epilog
  //
  // Attract (HUD strings: 1-2 active slots out of 7): average ~120/slot
  //   = 32 + 7 × 200 + 16 = ~1448
  // Gameplay (5-6 slot attivi): 32 + 7 × 500 + 16 = ~3548
  "FUN_17230": as_u32(1450),
  "FUN_17230_HEAVY": as_u32(3550),

  // ─── FUN_13EE6: refreshHelper13EE6 (1190 byte, scroll+decode) ───────────
  //
  // Main gate: *0x400006 == 0 -> jump to the final branch (path 0x1411c).
  // In attract steady-state, *0x400006 is almost always 0 -> fast path.
  //
  // Fast path (gate skip):
  //   - jsr FUN_1344C (slapsticDispatcher): ~120 cycles (simple clear)
  //   - tst.b / beq: 16+10
  //   - final branch loop (~36 obj scan): ~36 x 50 + sums = ~2000
  //   - update scroll velocity/position/flag: ~150
  //   Total: ~2300 cycles
  //
  // Full path (gate true, active scroll + bitstream decode):
  //   - + levelHelper2FFB8 (slapstic lookup): ~200
  //   - + calcolo scrollIdx: ~80
  //   - + decodeBitstream1A668: ~4500 (see below)
  //   - + blit buffer in PF RAM: ~400
  //   - + ramo finale loop come sopra: ~2000
  //   Total: ~7200 cycles
  //
  // GATE PROBABILITY:
  //   *0x400006 is set when scrolling is active (= run/blit pending).
  //   In attract: ~5-10% of frames. In gameplay: ~30-50% of frames.
  "FUN_13EE6_FAST": as_u32(2300),
  "FUN_13EE6": as_u32(2800), // attract media (90% fast + 10% full)
  "FUN_13EE6_HEAVY": as_u32(7200), // gameplay con scroll attivo

  // ─── FUN_1A668: decodeBitstream1A668 (304 byte, 36 word output) ─────────
  //
  // Loop over 36 output words. Per token (path A/B/C/D mix):
  //   - read ctrl long, asr.l, mask: ~40 cycles
  //   - dispatch path (3-4 cmpi/bne): ~30
  //   - path body (op ROM lookup + write): ~50
  //   Per-token average: ~120 cycles.
  // Total: 36 x 120 + movem prologue + epilogue = ~4400 cycles
  //
  // Called only when the FUN_13EE6 gate is active (above). The count is already
  // included in FUN_13EE6_HEAVY (4500 decode cycles plus surrounding work).
  "FUN_1A668": as_u32(4400),

  // ─── FUN_1912C: refreshHelper1912C (130 byte) ───────────────────────────
  //
  // Gate: *0x400394 == 4. If != 4, immediate rts (~40 cycles).
  // If == 4: slot scan (count = *0x400396, ~22 obj) + entity loop (9
  // entity × 0x28 stride).
  //   - Slot scan: 22 × (cmpi/beq/lea/cmpi/beq/cmpi/beq/moveq + tail
  //              ~50 cycles) = ~1100
  //   - Entity loop: 9 × (tst+addq+cmpi+beq+cmpi+threshold+cmp+
  //                     jsr FUN_199D6 estimate 200 + JSR FUN_194BA path
  //                     estimate 150) = 9 x 400 = 3600
  //   Total full: ~4700 cycles
  //
  // GATE: in attract *0x394 != 4 (= 0 attract title or 1 attract play
  //   menu), so this is almost always fast.
  "FUN_1912C_FAST": as_u32(40),
  "FUN_1912C": as_u32(4700), // gameplay (game mode = 4)

  // ─── FUN_19BAA: stateSub19BAA (490 byte) ────────────────────────────────
  //
  // Gate: *0x400394 == 4. Se != 4 → rts (~40).
  // Se == 4:
  //   - tst.b *0x400762; spawn dispatcher gate 1/8: stima ~50 + (occasion.
  //     1/8) FUN_19A40 ~600 = ~125 media
  //   - outer loop entity (10 × 0x38 stride):
  //     * tst entity[0x18] / beq next: ~22 cycles (skip if entity inactive)
  //     * if active: addq + cmp + bgt movement path + AI block
  //       - script terminator scan-others: 10 × 60 = 600 (raro)
  //       - movement block: ~300
  //       - jsr FUN_19E42 (marbleCellDispatch): ~400
  //     * average per active entity: ~700
  //   - per attract (1-2 entity attive su 10): 10 × (skip 22 + actives 1.5
  //     × 700) = 10 × 22 + 1050 = 1270
  //   - per gameplay (5-6 entity attive): 10 × 22 + 5 × 700 = ~3720
  //
  // Total full attract (*0x394 == 4 ma 1-2 entity): ~125 + 1270 = ~1400
  // Total full gameplay: ~3850
  "FUN_19BAA_FAST": as_u32(40),
  "FUN_19BAA": as_u32(1400),
  "FUN_19BAA_HEAVY": as_u32(3850),

  // ─── FUN_1844A: stateSub1844A (610 byte) ────────────────────────────────
  //
  // Gate: *0x400394 == 3 AND *0x400760 != 0. In attract: *0x394 == 0 → fast.
  // In gameplay: *0x394 == 4 → fast. Solo durante boss/transition (mode 3).
  //
  // Fast: ~40 cycles (link+movem+gate+epilog)
  //
  // Full (mode 3):
  //   - 36 entries × 0x10 stride:
  //     * read entry[0x2..0x3].w → sext: 18
  //     * decrement path (~80%): subq + tst + bra → ~40
  //     * pointer-walk path: addq + movea + cmp + jsr fun_18f46 ~300
  //       + reload timer ~50 = ~400 (rare ~5%)
  //     * sprite_check: cmpi + beq + jsr FUN_18972 ~200 (~70%)
  //   - media per entry: 40 + 0.05*400 + 0.7*200 = ~200
  //   - 36 × 200 = ~7200
  //   - post-loop 3-bucket sound dispatch: ~150 × 3 = 450
  //   Total: ~7700 cycles
  "FUN_1844A_FAST": as_u32(40),
  "FUN_1844A": as_u32(40), // attract: gate off
  "FUN_1844A_HEAVY": as_u32(7700), // mode 3 attivo

  // ─── FUN_12FD0: stateDispatch12FD0 (158 byte) ──────────────────────────
  //
  // Block 1: gate *0x400394 == 2 → scan player array for script. In attract
  // *0x394 == 0 → skip. Skip cost: ~30 (cmp + bne).
  // Block 2: tst *0x40075c + jsr FUN_11AC2 (rare): ~30 + (1/100) × 200 = 32
  // Block 3: loop 25 script-state slots × stride 0x56 (= 0x400A9C..):
  //   - 25 × (movem loop prologue ~10 + jsr fun_13068 ~150 + tail ~20) = 25
  //     × 180 = 4500
  //   - FUN_13068 (scriptSlotStep): ~150 cycles average (inactive slot ~30,
  //     active slot ~400; in attract 1-2 active slots).
  //
  // Total attract: 30 + 30 + 25 × 50 (mostly inactive) = ~1300
  // Total gameplay: 30 + 30 + 25 × 200 = ~5060
  "FUN_12FD0_FAST": as_u32(1300),
  "FUN_12FD0": as_u32(1300), // attract default
  "FUN_12FD0_HEAVY": as_u32(5060),

  // ─── FUN_28624: objDirtyDispatch28624 (140 byte) ───────────────────────
  //
  // Loop count = *0x400396 (= 2 in attract, 8-22 gameplay):
  //   - prologue per iter: moveq+move+asl+move+ext+ext+and+beq = ~30
  //   - bit-set path (rare, ~5% iter): tst+jsr FUN_28E3C (~400) = ~430
  //   - tail iter: move+add+movea+addq = ~14
  //   - loop test: move+ext+cmp+bne = ~30
  //   Total per iter: 30 + 0.05*430 + 14 + 30 = ~95 cycles
  //
  // count=2 attract: 2 × 95 + 16 prologue + 24 epilog + 6 clr = ~230
  // count=22 gameplay: 22 × 95 + 46 = ~2136
  "FUN_28624": as_u32(230), // attract count=2
  "FUN_28624_HEAVY": as_u32(2140), // gameplay count=22

  // ─── FUN_121B8: helper121B8 (1634 byte, 466 istr) ──────────────────────
  //
  // **MONSTER FUNCTION**: dominates body cost when called. Estimate based on
  // disassembly (movem 28 + dead stores 4x16 + global writes 6x20 +
  // asr.l #19 x2 + cmpa branch + jsr A3 (spritePosUpdate ~600)
  // + jsr 0x1CC62 (spriteProject ~400) + path INTEGRATE_VEL...
  //
  // INTEGRATE_VEL path (gameplay default for obj0):
  //   - 3 x long add (obj.x/y/z += vx/vy/vz): 3 x 32 = 96
  //   - jsr A3 (spritePosUpdate1BAB2 ~600), jsr 1C676 (spriteBracketLerp
  //     ~400)
  //   - velocity scaling + bounds: ~400
  //   - state dispatch chain: stateSub1B5C2 (~300) + 29CCE (~stub 30)
  //     + 1BC88 (~stub 30) + 1924E (~stub 30) + 25C74 (~stub 30)
  //   - bbox tests + slot insert sorted: ~600
  //   - render update (1365C): ~400
  //   - dispatch state 160F6: ~250
  //   Total: ~3700 cycles (with FUN_29CCE and related stubs)
  //
  // OUT_OF_RANGE path (rare, score event):
  //   - player branch: soundCommand + state25BAE: ~500
  //   - non-player: stateSub15BD0: ~300
  //
  // Average estimate: ~4500 cycles (INTEGRATE_VEL default in gameplay).
  // When called from player obj (obj0) through the 158F6 ELSE branch
  // (sub158F6 calls helper121B8 there), the INTEGRATE_VEL path is active.
  "FUN_121B8": as_u32(4500),

  // ─── FUN_253BC: helper253BC (15 istr) ──────────────────────────────────
  //
  // - movea (0x4,SP),A0: 12
  // - tst.b (0x36,A0) / bne epilog: 12 + 10 (fast path skip)
  // - 4 × move.l + 2 × asr.l #19 + 2 × move.w + 1 × move.b: ~200
  //
  // Fast (freeze flag set): ~30
  // Full (default, freeze=0): ~200
  "FUN_253BC": as_u32(200),

  // ─── FUN_17F66: objectStep17F66 (344 byte) ─────────────────────────────
  //
  // Dispatch: skip path / special / movement / stuck.
  // Default movement (gameplay obj0): ~600 cycles
  //   - 9 x cmpi.b whitelist: 9 x 22 = 198
  //   - jsr FUN_180BE (no-op stub): ~30
  //   - byte stores + jsr FUN_26196 (flagScaledMagnitude): ~400
  // Stuck (obj0 falling): ~250
  // Skip (s18 in {2,3}): ~30
  "FUN_17F66": as_u32(600),

  // ─── FUN_182BA: helper182BA (~100 istr) ────────────────────────────────
  //
  // For the non-player obj ELSE branch called by 158F6:
  //   - jsr FUN_15DB6 (stateValidateGrid): ~500 (grid bitmap check)
  //   - gate 0x36 == 2: skip-seek (gravity path): ~80
  //   - target lookup ROM + Manhattan compute: ~300
  //   - divs.w D1,D2 / D1,D3: 2 x 140 = 280 (worst case)
  //   - scaled velocity + clamp: ~200
  //   - jsr FUN_26196: ~400
  // Total: ~1760 cycles
  //
  // Path gravity only (no seek): ~80 + 400 = 480
  "FUN_182BA": as_u32(1760),
  "FUN_182BA_GRAVITY": as_u32(480),

  // FUN_26F3E: lateGameLogic26F3E (4848 bytes).
  //
  // Called AFTER the 10FCE/1101E body (main thread post-body).
  // 3 phases:
  //   1. bufferFill1B12A for each entity in [0x3BC..0x3DB]: 32 x 60 = ~2000
  //   2. sortAdjacentObjects 3x (stride 1/2/3): 3 x 800 = 2400
  //   3. setup cursors + entity sprite dispatch: ~3000
  // Total: ~7400 cycles (gameplay, *0x3E2 != 0 -> phase 2 active)
  // Fast (no end-screen, *0x3E2 == 0): only phase 1 + minimum setup = ~2200
  "FUN_26F3E_FAST": as_u32(2200),
  "FUN_26F3E": as_u32(7400),

  // FUN_1101E: mainLoopInit1101E (dispatcher orchestrator).
  //
  // Gate: stateWord = *0x400390. Attract path = stateWord == 0 → calls
  // refreshFrame10FCE direttamente.
  //
  // Dispatch + jsr 10FCE cost, excluding the 10FCE body: ~40 cycles.
  // Cases 1/2/3/4/5/6 have different costs, but case 0 is the dominant
  // steady-state fast path.
  "FUN_1101E_OVERHEAD": as_u32(40),
};

// ─── Total body iteration (sanity check) ──────────────────────────────────

/**
 * Sum of estimates for a "normal" body iteration (fast/attract path,
 * stateWord==0, *0x394 attract).
 *
 *   FUN_1101E overhead             40
 *   FUN_10FCE overhead            304
 *   FUN_13EE6 fast              2300
 *   FUN_251DE attract gameplay 11180
 *   FUN_189E2 fast (gate off)     40
 *   FUN_158CC attract           11700
 *   FUN_1493C                    770
 *   FUN_17230                   1450
 *   FUN_1912C fast (gate off)     40
 *   FUN_19BAA fast (gate off)     40
 *   FUN_1844A fast (gate off)     40
 *   FUN_12FD0                   1300
 *   FUN_28624 attract            230
 *   (FUN_26F3E post-body fast)  2200
 *  ─────────────────────────────────
 *                              31634 cycles
 *
 * <<< CYCLES_PER_VBLANK (119316): the body completes in ~26% of one vblank,
 * then spin-waits 28DEA x2, yielding a 30Hz cadence. This matches the MAME
 * oracle.
 */
export const BODY_ITER_ESTIMATE_FAST: u32 = as_u32(31634);

/**
 * Sum estimate for a "slow" body (active gameplay, all gates ON):
 *
 *   FUN_1101E overhead             40
 *   FUN_10FCE overhead            304
 *   FUN_13EE6 heavy (scroll)    7200
 *   FUN_251DE heavy            60000
 *   FUN_189E2 fast (gate off)     40   (gate *0x394 != 0 in gameplay)
 *   FUN_158CC                  11700
 *   FUN_1493C heavy             3570
 *   FUN_17230 heavy             3550
 *   FUN_1912C (game mode 4)     4700
 *   FUN_19BAA heavy             3850
 *   FUN_1844A heavy (rare!)     7700
 *   FUN_12FD0 heavy             5060
 *   FUN_28624 heavy             2140
 *   FUN_26F3E                   7400
 *  ─────────────────────────────────
 *                             117254 cycles
 *
 * Marginally < CYCLES_PER_VBLANK (119316): in heavy gameplay the body fits
 * inside one vblank with a narrow margin. Adding 1-2 object scans with the full
 * helper121B8 chain would exceed the budget and slip to 60Hz for a few frames.
 *
 * Paths above one vblank (= 60Hz triggered):
 *   - *0x394 == 4 AND *0x396 > 2 (multi-player or multi-enemy active):
 *     FUN_251DE_HEAVY scales linearly with count. Count=8: ~60000;
 *     count=12: ~110000; count=15: ~140000 cycles on its own. Added to the
 *     rest, this is >180000 cycles, so the body slips to 60Hz for >1
 *     vblank.
 *   - + FUN_1844A_HEAVY (mode 3 active, boss transition): adds 7700 cycles.
 *   - + FUN_13EE6_HEAVY (active scroll + decodeBitstream): adds ~5000
 *     incremental cycles.
 *
 * In short: the body forces 60Hz when `count > ~10` (8-22 objects with the full
 * helper121B8 chain), matching intense gameplay windows with simultaneous
 * multi-marble and multi-enemy activity.
 */
export const BODY_ITER_ESTIMATE_HEAVY: u32 = as_u32(117254);

/**
 * "60Hz spill" threshold: body_cycles >= CYCLES_PER_VBLANK means the main
 * thread cannot finish one iteration inside a vblank. The following `jsr 28DEA`
 * sees `*0x400016 != 0` (vblank already passed), skips the spin-wait, and
 * enters the next iteration directly, creating a transient 60Hz cadence.
 */
export const BODY_ITER_SPILL_THRESHOLD: u32 = CYCLES_PER_VBLANK;

// ─── Sub list helpers ─────────────────────────────────────────────────────

/**
 * Subroutines called directly from the FUN_10FCE body (12 JSR + addq x2 + rts):
 *   1.  FUN_13EE6  — refreshHelper13EE6 (scroll/decode)
 *   2.  FUN_251DE  — objectScanDispatch251DE (obj iter)
 *   3.  FUN_189E2  — processAllSprites
 *   4.  FUN_158CC  — objectUpdatePair158CC (calls FUN_158F6 × 2)
 *   5.  FUN_1493C  — slotArrayTick (calls FUN_14966 × 4)
 *   6.  FUN_17230  — dispatchStrings (calls FUN_1725A × 7)
 *   7.  FUN_1912C  — refreshHelper1912C (entity ticker)
 *   8.  FUN_19BAA  — stateSub19BAA (per-frame entity)
 *   9.  FUN_1844A  — stateSub1844A (slot table tick)
 *  10.  FUN_12FD0  — stateDispatch12FD0
 *  11.  FUN_28624  — objDirtyDispatch
 *
 *  Plus addq.b x2 (frame counter +1) and rts.
 */
export const FUN_10FCE_SUB_LIST: readonly string[] = [
  "FUN_13EE6",
  "FUN_251DE",
  "FUN_189E2",
  "FUN_158CC",
  "FUN_1493C",
  "FUN_17230",
  "FUN_1912C",
  "FUN_19BAA",
  "FUN_1844A",
  "FUN_12FD0",
  "FUN_28624",
];

/**
 * Subroutines called by the main-thread body after FUN_10FCE (= FUN_1101E + post):
 *   - FUN_1101E    dispatcher (overhead)
 *   - FUN_26F3E    lateGameLogic (called after 10FCE in the main thread)
 */
export const BODY_POST_SUB_LIST: readonly string[] = [
  "FUN_1101E_OVERHEAD",
  "FUN_26F3E",
];
