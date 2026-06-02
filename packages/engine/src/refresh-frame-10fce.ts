/**
 * refresh-frame-10fce.ts — `FUN_00010FCE` replica (19 instr, ~80 bytes).
 *
 *
 * **Disasm 0x10FCE..0x1001C** (80 bytes, 19 instructions):
 *
 *   00010FD4  jsr 0x000251DE    ; objectScanDispatch251DE
 *   00010FDA  jsr 0x000189E2    ; processAllSprites
 *   00010FE0  jsr 0x000158CC    ; objectUpdatePair158CC
 *   00010FE6  jsr 0x0001493C    ; slotArrayTick
 *   00010FEC  addq.b #1, (0x004003F0).l   ; frame-counter++
 *   00010FF2  jsr 0x00017230    ; dispatchStrings17230
 *   00010FFE  jsr 0x00019BAA    ; stateSub19BAA
 *   00011004  jsr 0x0001844A    ; stateSub1844A
 *   0001100A  jsr 0x00012FD0    ; stateDispatch12FD0
 *   00011010  addq.b #1, (0x004003F0).l   ; frame-counter++ (second)
 *   00011016  jsr 0x00028624    ; objDirtyDispatch28624
 *   0001101C  rts
 *
 *
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { addCpuCycles } from "./m68k/clock.js";
import { SUB_CYCLE_ESTIMATE } from "./m68k/sub-cycle-costs.js";
import { as_u32 } from "./wrap.js";
import { objectScanDispatch251DE } from "./object-scan-dispatch-251de.js";
import { objectStep17F66 } from "./object-step-17f66.js";
import { flagScaledMagnitudeDispatch } from "./flag-scaled-magnitude-dispatch.js";
import { fun261BC } from "./sub-261bc.js";
import { waypointListStep1815A } from "./waypoint-list-step-1815a.js";
import { helper253BC } from "./helper-253bc.js";
import { helper25FC2 } from "./helper-25fc2.js";
import { helper121B8 } from "./helper-121b8.js";
import { fun158F6 } from "./sub-158f6.js";
import { spritePosUpdate1BAB2 } from "./sprite-pos-update-1bab2.js";
import { sub1CABATileRedraw } from "./sub-1caba-tile-redraw.js";
import { soundPair15884 } from "./sound-pair-15884.js";
import { soundCmdSend158AC } from "./sound-cmd-send-158ac.js";
import { spriteRotate1C014 } from "./sprite-rotate-1c014.js";
import { spriteProject1CC62 } from "./sprite-project-1cc62.js";
import { spriteHelper1B9CC } from "./sprite-helper-1b9cc.js";
import { processAllSprites } from "./process-all-sprites-189e2.js";
import { objectUpdatePair158CC } from "./object-update-pair-158cc.js";
import { slotArrayTick } from "./slot-array-tick.js";
import { runWarmSlotArrayReplayTick } from "./slot-array-replay.js";
import { sub14966 } from "./sub-14966.js";
import { dispatchStrings17230 } from "./dispatch-strings-17230.js";
import { stringStep1725A } from "./string-step-1725a.js";
import { stateSub19BAA } from "./state-sub-19baa.js";
import { marbleCellDispatch19E42 } from "./marble-cell-dispatch-19e42.js";
import { stateSub1844A } from "./read-abs-long-1844a.js";
import { stateDispatch12FD0 } from "./state-dispatch-12fd0.js";
import { objDirtyDispatch28624 } from "./obj-dirty-dispatch-28624.js";
import { renderScore28E3C } from "./render-score-28e3c.js";
import { renderStringEntry28F62 } from "./render-string-entry-28f62.js";
import { stateSub2572 } from "./state-sub-2572.js";
import { scheduleStateMachine1 } from "./state-machine-schedule.js";
import { formatNumber3874 } from "./string-format.js";
import { refreshHelper1912C } from "./refresh-helper-1912c.js";
import { refreshHelper13EE6 } from "./refresh-helper-13ee6.js";
import { slapsticDispatcher1344C } from "./slapstic-dispatcher-1344c.js";
import { scrollRange144E4 } from "./scroll-range-144e4.js";
import { scriptSlotStep13068 } from "./script-slot-step-13068.js";
import { helper12896 } from "./helper-12896.js";
import { terrainWaveUpdate1D06A } from "./terrain-wave-update-1d06a.js";
import { slotSpawnPattern13D38 } from "./slot-spawn-pattern-13d38.js";
import { claimScriptSlot } from "./script-slot-claim.js";
import { objectOrbitEmit13ADE } from "./object-orbit-emit-13ade.js";
import { stringHelper17CB8 } from "./string-helper-17cb8.js";
import { stringTargetStep176D2 } from "./string-target-step-176d2.js";
import { recordObjectStateEntryDebug } from "./object-state-debug.js";
import { objectStateEntry25BAE } from "./object-state-entry-25bae.js";
import { objectInit2591A } from "./object-init-2591a.js";
import { objectTargetInit262B2 } from "./object-target-init-262b2.js";
import { objectArrayInit25B40 } from "./object-array-init-25b40.js";
import { pickObjLarger } from "./obj-pick-larger.js";
import { fun29CCE } from "./sub-29cce.js";
import { objectEnter1281C } from "./object-enter-1281c.js";
import { fun264AA } from "./fun-264aa.js";
import { helper18F46 } from "./helper-18f46.js";
import { helper285B0 } from "./helper-285b0.js";
import { slotInsertSorted18E6C } from "./slot-insert-sorted-18e6c.js";
import { computeSpriteCoords_v2, computeSpriteCoords_v4 } from "./sprite-coords.js";
import { postStateChange13966 } from "./post-state-change-13966.js";
import { objectTypeDispatch194BA } from "./object-type-dispatch-194ba.js";
import { stateSub1960E } from "./state-sub-1960e.js";
import { stateSub1953E } from "./state-sub-1953e.js";
import { stateSub198BC } from "./state-sub-198bc.js";
import { sub19692 } from "./sub-19692.js";
import { sub19976 } from "./sub-19976.js";
import { sub1937C } from "./sub-1937c.js";

const WRAM = 0x00400000;

function off(addr: number): number {
  return addr - WRAM;
}

function rb(state: GameState, addr: number): number {
  return state.workRam[off(addr)] ?? 0;
}

function rw(state: GameState, addr: number): number {
  const o = off(addr);
  return (((state.workRam[o] ?? 0) << 8) | (state.workRam[o + 1] ?? 0)) & 0xffff;
}

function rl(state: GameState, addr: number): number {
  const o = off(addr);
  return (
    (((state.workRam[o] ?? 0) << 24) |
      ((state.workRam[o + 1] ?? 0) << 16) |
      ((state.workRam[o + 2] ?? 0) << 8) |
      (state.workRam[o + 3] ?? 0)) >>>
    0
  );
}

function s8(value: number): number {
  const b = value & 0xff;
  return b & 0x80 ? b - 0x100 : b;
}

function runArray9ObjectDispatch194BA(state: GameState, rom: RomImage, entityAddr: number): void {
  const move = (st: GameState, addr: number): void => {
    sub19976(st, rom, addr);
  };
  const validate = (st: GameState, addr: number): number => {
    return sub1937C(st, rom, addr);
  };

  objectTypeDispatch194BA(state, entityAddr, {
    fun_1960e: (objAddr, st) => {
      stateSub1960E(st, objAddr, {
        fun_19692: (st2, addr) => {
          sub19692(st2, addr, {
            fun_19976: move,
            fun_1937c: validate,
          });
        },
      });
    },
    fun_1973c: (objAddr, st) => {
      stateSub198BC(st, objAddr, {
        fun_19976: move,
        fun_1937c: validate,
      });
    },
    fun_1953e: (objAddr, st) => {
      stateSub1953E(st, objAddr);
    },
  });
}

function wb(state: GameState, addr: number, value: number): void {
  state.workRam[off(addr)] = value & 0xff;
}

function ww(state: GameState, addr: number, value: number): void {
  const o = off(addr);
  const v = value & 0xffff;
  state.workRam[o] = (v >>> 8) & 0xff;
  state.workRam[o + 1] = v & 0xff;
}

function wl(state: GameState, addr: number, value: number): void {
  const o = off(addr);
  const v = value >>> 0;
  state.workRam[o] = (v >>> 24) & 0xff;
  state.workRam[o + 1] = (v >>> 16) & 0xff;
  state.workRam[o + 2] = (v >>> 8) & 0xff;
  state.workRam[o + 3] = v & 0xff;
}

function isWorkRamAddr(state: GameState, addr: number): boolean {
  return addr >= WRAM && addr < WRAM + state.workRam.length;
}

function readAbsU8(state: GameState, rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (isWorkRamAddr(state, a)) return rb(state, a);
  if (a < rom.program.length) return rom.program[a] ?? 0;
  return 0;
}

function readAbsU32(state: GameState, rom: RomImage, addr: number): number {
  return (
    ((readAbsU8(state, rom, addr) << 24) |
      (readAbsU8(state, rom, addr + 1) << 16) |
      (readAbsU8(state, rom, addr + 2) << 8) |
      readAbsU8(state, rom, addr + 3)) >>>
    0
  );
}

function writeAbsU32IfWorkRam(state: GameState, addr: number, value: number): void {
  if (isWorkRamAddr(state, addr) && isWorkRamAddr(state, addr + 3)) {
    wl(state, addr, value);
  }
}

function addByte(state: GameState, addr: number, delta: number): void {
  wb(state, addr, rb(state, addr) + delta);
}

function objDirtyDispatch28624Default(state: GameState, rom: RomImage): void {
  const renderStringChain = (s: GameState, structAddr: number, attrWord: number): void => {
    stateSub2572(s, rom, structAddr, attrWord);
  };

  objDirtyDispatch28624(state, rom.program.subarray(0x23d3a, 0x23d3a + 16), {
    renderStringHelper: (s, arg1, arg2, arg3, arg4, arg5, arg6) => {
      renderScore28E3C(s, arg1, arg2, arg3, arg4, arg5, arg6, {
        numberFormatter: (st, value, bufEnd, fmtMode, width, fillExtra) => {
          formatNumber3874(st, value, bufEnd, fmtMode, width, fillExtra);
        },
        renderStringEntry28F62: (st, col, tickOff, attr) => {
          renderStringEntry28F62(st, col, tickOff, attr, {
            renderStringChain: (structAddr, attrWord) => {
              renderStringChain(st, structAddr, attrWord);
            },
          });
        },
      });
    },
  });
}

/** Frame-counter global byte address (addq.b #1 target). */
export const FRAME_CTR_ADDR = 0x004003f0 as const;

/**
 * `FUN_253EC` dispatcher replica (0x253EC..0x25918) — minimal version
 * focused on paths observed for obj0 and other object slots in demo gameplay.
 *
 * Based on the disassembly:
 *   - Prologue: tst.b (0xd8,A2). If !=0, execute the intermediate body (0x25416..),
 *   - JT @ 0x254BA dispatcha per s1a (= (0x1a,A2).b ext.w). Bound 0..0xb.
 *   - For s1a=0 (NORMAL path for obj0): if (0xcb,A2)==0 -> chain
 *     helper253BC + objectStep17F66 + helper121B8.
 *
 * vs /tmp/mame_100f.json frame 12000..12099).
 */
export function fun253ECDispatch(state: GameState, rom: RomImage, a2: number): void {
  const wr = state.workRam;
  const objOff = (a2 - 0x00400000) >>> 0;
  if (objOff + 0xe2 > wr.length) return;

  const s1a = wr[objOff + 0x1a] ?? 0;
  const sd8 = wr[objOff + 0xd8] ?? 0;
  const scb = wr[objOff + 0xcb] ?? 0;
  const updateSpritePos = (s: GameState, objAddr: number): void => {
    spritePosUpdate1BAB2(s, objAddr, {
      fun_1CABA: (st) => { sub1CABATileRedraw(st, rom); },
    });
  };
  const updateSpriteProject = (s: GameState, argLong: number): number =>
    spriteProject1CC62(s, argLong, {
      fun_1CABA: (st) => { sub1CABATileRedraw(st, rom); },
    });
  const helper1B9CC = (s: GameState, objAddr: number, flagLong: number): void => {
    spriteHelper1B9CC(s, objAddr, flagLong, {
      fun_1bab2: updateSpritePos,
    });
  };
  const enterObjectState = (s: GameState, objAddr: number, code: number): void => {
    objectStateEntry25BAE(s, objAddr, code, {
      soundCommand: (cmd) => { soundCmdSend158AC(s, cmd); },
      fun_2591A: (st, initObj) => {
        objectInit2591A(st, initObj, {
          fun_262B2: (st2, ptr) => {
            // Gameplay dispatch needs the real target scan for respawn; attract
            // segments keep their staged long-demo model until that path is closed.
            if ((st2.workRam[0x390] ?? 0) === 0 && (st2.workRam[0x391] ?? 0) === 0) {
              objectTargetInit262B2(st2, rom, ptr);
            }
          },
          fun_1BAB2: updateSpritePos,
          fun_1CC62: updateSpriteProject,
          fun_25B40: (st2, ptr) => { objectArrayInit25B40(st2, rom, ptr); },
          fun_1B9CC: helper1B9CC,
          fun_13966: (st2, ptr) => { postStateChange13966(st2, rom, ptr); },
        });
      },
    });
  };
  const enterObjectStateFrom = (source: string) =>
    (s: GameState, objAddr: number, code: number): void => {
      const existing = s.debug?.lastObjectStateEntry;
      const alreadyRecorded =
        existing !== undefined &&
        existing.frame === Number(s.clock.frame ?? 0) &&
        existing.entityAddr === (objAddr >>> 0) &&
        existing.code === (code & 0xff);
      if (!alreadyRecorded) {
        recordObjectStateEntryDebug(s, objAddr, code, source);
      }
      enterObjectState(s, objAddr, code);
    };
  const enterObject1281C = (s: GameState, objAddr: number): number =>
    objectEnter1281C(s, objAddr, (ptr, mode) => fun264AA(s, rom, ptr, mode));
  const runTerrainCollision = (s: GameState, objAddr: number): void => {
    fun29CCE(s, objAddr, rom);
  };
  const stepAnimation25FC2 = (s: GameState, objAddr: number): void => {
    helper25FC2(s, rom, objAddr, {
      soundCommand: (cmd) => { soundCmdSend158AC(s, cmd); },
      soundPair15884: (st) => { soundPair15884(st); },
      objectStateEntry25BAE: enterObjectStateFrom("FUN_25FC2"),
      helper18F46: (st, r, typeCode, subIdx) => {
        helper18F46(st, r, typeCode, subIdx);
      },
    });
  };
  const stepWaypointList = (s: GameState, objAddr: number): void => {
    waypointListStep1815A(s, objAddr, {
      fun_012a: (threshold, attrWord, textPtr) => {
        scheduleStateMachine1(s, rom, stateSub2572, textPtr, attrWord, threshold);
      },
      fun_26196: (st, a2Addr) => {
        flagScaledMagnitudeDispatch(
          st,
          a2Addr,
          (structPtr, magnitude) => fun261BC(st, structPtr, magnitude, rom.program),
        );
      },
      lookupSoundTable: (idx) => {
        const addr = 0x242aa + ((idx & 0xffff) << 2);
        return (
          ((rom.program[addr] ?? 0) << 24) |
          ((rom.program[addr + 1] ?? 0) << 16) |
          ((rom.program[addr + 2] ?? 0) << 8) |
          (rom.program[addr + 3] ?? 0)
        ) >>> 0;
      },
    }, rom);
  };

  // 0x25416..0x25488: transitional wobble for active carried/eaten states.
  // This runs before the state jump table when obj+0xD8 is set, except for
  // states 2/4/7/10/11. It drives obj+0x68, which late-game sprite emission
  // uses as the small X offset for the state-6 tail block.
  if (sd8 !== 0 && s1a !== 2 && s1a !== 4 && s1a !== 7 && s1a !== 10 && s1a !== 11) {
    wb(state, a2 + 0x68, rb(state, a2 + 0x68) + rb(state, a2 + 0x69));
    if (s8(rb(state, a2 + 0x68)) > 2) {
      wb(state, a2 + 0x68, 2);
      wb(state, a2 + 0x69, 0xff);
    } else if (s8(rb(state, a2 + 0x68)) < -0x16) {
      wb(state, a2 + 0x68, 0xea);
      wb(state, a2 + 0x69, 1);
    }

    if ((rb(state, a2 + 0x68) & 1) !== 0) {
      wb(state, a2 + 0x70, rb(state, a2 + 0x70) + 1);
      if (s8(rb(state, a2 + 0x70)) > 0x28) {
        wb(state, a2 + 0x70, 0xff);
        wb(state, a2 + 0xd8, 0);
      }
    }
  }

  // NORMAL path for s1a=0, gated ONLY on cb==0 (per the disasm: JT[0]=0x256d2
  // does `tst.b (0xcb,A2); beq → 0x25730 NORMAL chain`). The 0xd8 guard
  // (0x25412) only controls the "intermediate body" wobble above and then FALLS
  // THROUGH to the JT — so helper121B8 (physics) runs even while 0xd8!=0. The
  // marble does the squash wobble visually but keeps moving (no freeze), which
  // is why the arcade has no pause on a Silly Race worm squash. (A spurious
  // `sd8===0` here was freezing the marble for the whole ~2.7s wobble.)
  //   0x2548c (skip the intermediate body) → JT[0]=0x256d2 → 0x25730:
  //     jsr helper253BC; jsr objectStep17F66; jsr helper121B8; bra epilog.
  if (s1a === 0 && scb === 0) {
    helper253BC(state, a2);
    objectStep17F66(state, a2, {
      fun1815A: (a2Addr) => { stepWaypointList(state, a2Addr); },
      fun180BE: () => { pickObjLarger(state); },
      fun26196: (a2Addr) => {
        flagScaledMagnitudeDispatch(
          state,
          a2Addr,
          (structPtr, magnitude) => fun261BC(state, structPtr, magnitude, rom.program),
        );
      },
    });
    // Wire FUN_1CABA into spritePosUpdate1BAB2 and let helper121B8 use the
    // real spriteProject1CC62. The old `fun_1cc62 -> obj.z` stub kept obj0.z
    // frozen; with the real projection, the MAME writer at 0x126fc is
    // reproduced and obj0.z_long matches the f12000..12099 oracle.
    helper121B8(state, rom, a2, {
      fun_1bab2: updateSpritePos,
      fun_25bae: enterObjectStateFrom("FUN_121B8"),
      fun_29cce: runTerrainCollision,
      fun_1281c: enterObject1281C,
    });
    return;
  }

  // JT[1] = 0x2574C. This is the lower-platform/death tumble state reached
  // by live play near the worm/bridge section. The binary keeps running the
  // full movement/collision chain here, then advances the small +0x56/+0x57
  // animation gate. Falling back to only helper253BC/objectStep17F66 freezes
  // obj0 in state 1 while velocities keep accumulating, which lets the scroll
  // target run away into unrelated terrain.
  if (s1a === 1) {
    stepAnimation25FC2(state, a2);
    helper253BC(state, a2);
    objectStep17F66(state, a2, {
      fun1815A: (a2Addr) => { stepWaypointList(state, a2Addr); },
      fun180BE: () => { pickObjLarger(state); },
      fun26196: (a2Addr) => {
        flagScaledMagnitudeDispatch(
          state,
          a2Addr,
          (structPtr, magnitude) => fun261BC(state, structPtr, magnitude, rom.program),
        );
      },
    });
    helper121B8(state, rom, a2, {
      fun_1bab2: updateSpritePos,
      fun_25bae: enterObjectStateFrom("FUN_121B8"),
      fun_29cce: runTerrainCollision,
      fun_1281c: enterObject1281C,
    });

    if (rb(state, a2 + 0x1a) !== 1) return;

    if (rb(state, a2 + 0x57) !== 0) {
      wb(state, a2 + 0x57, rb(state, a2 + 0x57) - 1);
    }

    if (s8(rb(state, a2 + 0x57)) >= s8(rb(state, a2 + 0x56))) {
      wb(state, a2 + 0x56, rb(state, a2 + 0x56) + 1);
      return;
    }

    wb(state, a2 + 0x56, rb(state, a2 + 0x56) - 1);
    if (rb(state, a2 + 0x56) !== 0) return;

    soundPair15884(state);
    wb(state, a2 + 0x1a, 0);
    wl(state, a2 + 0x5a, 0);
    spriteRotate1C014(state, rom, objOff);
    return;
  }

  // JT[2] = 0x25824. State 2 is the post-death/respawn animation path:
  //   helper25FC2; helper1B9CC(obj, 1); if obj+0x1C != 0 then 1281C(obj).
  // The fallback only refreshed derived fields, leaving live play frozen in
  // state 2 after some lower-platform death routes.
  if (s1a === 2) {
    stepAnimation25FC2(state, a2);
    helper1B9CC(state, a2, 1);
    if (rb(state, a2 + 0x1c) !== 0) {
      enterObject1281C(state, a2);
    }
    return;
  }

  // JT[3] = 0x25514. Timed collision/launch settle state. Catapult tag 0x0A
  // enters here with obj+0x58=0x0A and obj+0x59=0x0F: the original holds the
  // marble on the animated arm, counts +0x59 down, then clears state back to
  // normal so the previously injected velocities can be integrated by JT[0].
  if (s1a === 3) {
    helper1B9CC(state, a2, 1);
    spriteRotate1C014(state, rom, objOff);
    enterObject1281C(state, a2);

    const tag58 = rb(state, a2 + 0x58);
    if (tag58 === 0) return;

    wb(state, a2 + 0x59, rb(state, a2 + 0x59) - 1);
    if (rb(state, a2 + 0x59) !== 0) return;

    if (tag58 === 0x12) {
      helper285B0(state, a2, 9, rom);
    } else if (tag58 === 0x13 || tag58 === 0x14 || tag58 === 0x20 || tag58 === 0x22 || tag58 === 0x25) {
      helper285B0(state, a2, 5, rom);
    } else if (tag58 === 0x0a) {
      soundCmdSend158AC(state, 0x45);
    }

    wb(state, a2 + 0x58, 0);
    wl(state, a2 + 0x26, 0);
    wl(state, a2 + 0x22, 0);
    wb(state, a2 + 0x1a, 0);
    return;
  }

  // JT[4] = 0x255C6. This is the long demo marble-eaten orbit state:
  //   1B9CC(obj, 1); 13ADE(obj); wait until counter nearly done; then either
  //   re-enter state 4 on a nearby target hit, or clear velocities/state.
  // The previous fallback never called 13ADE, so obj0+0x57 stayed at 0x64 and
  // the demo remained stuck in eaten mode while MAME resumed mode0 scroll.
  if (s1a === 4) {
    helper1B9CC(state, a2, 1);
    const orbitDone = objectOrbitEmit13ADE(state, rom, a2);
    let d2w = orbitDone & 0xffff;

    if (orbitDone !== 0 || rb(state, a2 + 0x57) < 2) {
      const targetY = (rb(state, a2 + 0x10) << 8) | rb(state, a2 + 0x11);
      const targetX = (rb(state, a2 + 0x0c) << 8) | rb(state, a2 + 0x0d);
      const hit = stringHelper17CB8(state, a2, targetX, targetY, 0x70);
      if (hit !== 0) {
        wb(state, a2 + 0x57, 0x65);
        enterObjectStateFrom("refresh/JT4-orbit")(state, a2, 4);
        d2w = 0;
      }
    }

    if (d2w !== 0) {
      wl(state, a2 + 0x04, 0);
      wl(state, a2 + 0x00, 0);
      wb(state, a2 + 0x1a, 0);
    }
    return;
  }

  // JT[5] = 0x257BA. This is the "marble eaten / scripted carry" state hit
  // in long demo mode after FUN_14E92 sets obj0+0x1A=5. The binary still
  // runs the canonical movement/collision chain here:
  //   helper25FC2; helper253BC; objectStep17F66; helper121B8
  // then, if the state is still 5, counts down +0x56 and eventually returns
  // to state 0. The old fallback skipped helper121B8, leaving obj0 frozen.
  if (s1a === 5) {
    helper25FC2(state, rom, a2);
    helper253BC(state, a2);
    objectStep17F66(state, a2, {
      fun1815A: (a2Addr) => { stepWaypointList(state, a2Addr); },
      fun180BE: () => { pickObjLarger(state); },
      fun26196: (a2Addr) => {
        flagScaledMagnitudeDispatch(
          state,
          a2Addr,
          (structPtr, magnitude) => fun261BC(state, structPtr, magnitude, rom.program),
        );
      },
    });
    helper121B8(state, rom, a2, {
      fun_1bab2: updateSpritePos,
      fun_25bae: enterObjectStateFrom("FUN_121B8"),
      fun_29cce: runTerrainCollision,
      fun_1281c: enterObject1281C,
    });

    if (rb(state, a2 + 0x1a) === 5) {
      const count56 = rb(state, a2 + 0x56);
      if (count56 !== 0) {
        wb(state, a2 + 0x56, (count56 - 1) & 0xff);
      }
      if (rb(state, a2 + 0x56) === 0) {
        soundPair15884(state);
        wb(state, a2 + 0x1a, 0);
        wl(state, a2 + 0x5a, 0);
        spriteRotate1C014(state, rom, objOff);
      }
    }
    return;
  }

  // JT[6] = 0x254D2. This short-lived "carried/eaten" state is visible in
  // long demo mode around the mode0 rebuild handoff and again before the
  // mode2 reset. The fallback skipped helper121B8 and the state-6 countdown,
  // so TS could leave the orbit path in a stale normal state while MAME kept
  // the object in state 6 with a live timer.
  if (s1a === 6) {
    if (((wr[0x390] ?? 0) << 8 | (wr[0x391] ?? 0)) === 1) {
      stepWaypointList(state, a2);
    }
    helper121B8(state, rom, a2, {
      fun_1bab2: updateSpritePos,
      fun_25bae: enterObjectStateFrom("FUN_121B8"),
      fun_29cce: runTerrainCollision,
      fun_1281c: enterObject1281C,
    });

    wb(state, a2 + 0x57, (rb(state, a2 + 0x57) - 1) & 0xff);
    if (rb(state, a2 + 0x57) === 0 && rb(state, a2 + 0x18) !== 2) {
      wb(state, a2 + 0x18, 3);
      wl(state, a2 + 0x04, 0);
      wl(state, a2 + 0x00, 0);
    }
    return;
  }

  // JT[7] = 0x25812. MAME only refreshes the derived screen fields with
  // FUN_253BC, then clears obj+0x1C before returning. The generic fallback
  // also ran objectStep17F66, which could move the object in transient
  // carried/death paths instead of leaving this one-vblank settle state still.
  if (s1a === 7) {
    helper253BC(state, a2);
    wb(state, a2 + 0x1c, 0);
    return;
  }

  // JT[8] = 0x258A8. This timed animation path advances +0x6A/+0xCC while
  // counting +0x57 down; when the timer expires, MAME clears state and runs
  // FUN_285B0(obj, 0x10) before the usual sprite refresh tail.
  if (s1a === 8) {
    if (rb(state, a2 + 0x56) !== 0) {
      wb(state, a2 + 0x56, rb(state, a2 + 0x56) - 1);
    }

    if (rb(state, a2 + 0x56) === 0) {
      wb(state, a2 + 0x56, 9);
      ww(state, a2 + 0x6a, rw(state, a2 + 0x6a) + 1);
      wb(state, a2 + 0x57, rb(state, a2 + 0x57) - 1);
    }

    if (rb(state, a2 + 0x57) === 0) {
      wb(state, a2 + 0xd1, 0);
      wb(state, a2 + 0x1a, 0);
      helper285B0(state, a2, 0x10, rom);
    } else {
      wb(state, a2 + 0xd0, rb(state, a2 + 0xd0) + 1);
      if (rb(state, a2 + 0xd0) === 2) {
        wb(state, a2 + 0xd0, 0);
        wl(state, a2 + 0xcc, rl(state, a2 + 0xcc) + 4);
      }
    }

    helper1B9CC(state, a2, 1);
    spriteRotate1C014(state, rom, objOff);
    enterObject1281C(state, a2);
    return;
  }

  // JT[9] = 0x2584E. String hazard death/carry path:
  //   FUN_176D2(obj); FUN_25FC2(obj); FUN_1B9CC(obj, 1); FUN_1281C(obj).
  // Without this branch the string collision state entered by FUN_175C8 is
  // left in the generic fallback and the player freezes in state 9.
  if (s1a === 9) {
    stringTargetStep176D2(state, a2, rom);
    stepAnimation25FC2(state, a2);
    helper1B9CC(state, a2, 1);
    enterObject1281C(state, a2);
    return;
  }

  // JT[10] = 0x2563E. Aerial gate/vacuum hit state reached from FUN_29CCE
  // tag 0x0B inner-hit: run the original fan-pattern countdown, then resume
  // through state 4 instead of falling into the generic movement fallback.
  if (s1a === 10) {
    helper1B9CC(state, a2, 1);
    const done = slotSpawnPattern13D38(state, rom, a2);
    if (done === 0) return;

    const selector = s8(rb(state, a2 + 0x58));
    const slotPtr = readAbsU32(state, rom, 0x0001f016 + ((selector << 2) | 0));
    const slotTag = readAbsU8(state, rom, slotPtr + 0x1f);
    writeAbsU32IfWorkRam(state, slotPtr + 0x36, slotTag === 0x0b ? 0x0001d752 : 0x0001d798);

    const soundIndex = (s8(readAbsU8(state, rom, slotPtr + 0x1b)) - 0x1e) | 0;
    const soundCmd = readAbsU32(state, rom, 0x0001ef5a + ((soundIndex << 2) | 0));
    soundCmdSend158AC(state, soundCmd);

    if (isWorkRamAddr(state, slotPtr) && isWorkRamAddr(state, slotPtr + 0x55)) {
      helper12896(state, rom, slotPtr);
    }

    soundCmdSend158AC(state, 0x3c);
    wl(state, a2 + 0x5a, 0);
    wb(state, a2 + 0x1a, 4);
    ww(state, a2 + 0xd2, rw(state, a2 + 0xd2) + 1);
    wb(state, a2 + 0x57, 0x65);
    return;
  }

  // JT[11] = 0x25876. Silly Race mini-enemy hit state reached from FUN_19D94:
  // keep emitting the orbit sprite records until FUN_13ADE's countdown ends,
  // then re-enter the normal state-4 recovery path through FUN_25BAE.
  if (s1a === 11) {
    helper1B9CC(state, a2, 1);
    const done = objectOrbitEmit13ADE(state, rom, a2);
    if (done !== 0) {
      wb(state, a2 + 0x57, 0x65);
      enterObjectStateFrom("refresh/JT11-mini-enemy")(state, a2, 4);
    }
    return;
  }

  // Fallback (path non-modellati): chain conservativa esistente —
  helper253BC(state, a2);
  objectStep17F66(state, a2, {
    fun1815A: (a2Addr) => { stepWaypointList(state, a2Addr); },
    fun180BE: () => { pickObjLarger(state); },
    fun26196: (a2Addr) => {
      flagScaledMagnitudeDispatch(
        state,
        a2Addr,
        (structPtr, magnitude) => fun261BC(state, structPtr, magnitude, rom.program),
      );
    },
  });
}

export interface RefreshFrame10FCESubs {
  /**
   * FUN_0x00013EE6 — refreshHelper13EE6 (replica available).
   */
  fun13EE6?: (state: GameState) => void;

  /**
   * FUN_0x000251DE — objectScanDispatch251DE.
   */
  objectScanDispatch251DE?: (state: GameState) => void;

  /**
   * FUN_0x000189E2 — processAllSprites.
   */
  processAllSprites189E2?: (state: GameState) => void;

  /**
   * FUN_0x000158CC — objectUpdatePair158CC.
   */
  objectUpdatePair158CC?: (state: GameState) => void;

  /**
   * FUN_0x0001493C — slotArrayTick.
   */
  slotArrayTick1493C?: (state: GameState) => void;

  /**
   * FUN_0x00017230 — dispatchStrings17230.
   */
  dispatchStrings17230?: (state: GameState) => void;

  /**
   * FUN_0x0001912C — refreshHelper1912C (replica available).
   */
  fun1912C?: (state: GameState) => void;

  /**
   * FUN_0x00019BAA — stateSub19BAA.
   */
  stateSub19BAA?: (state: GameState) => void;

  /**
   * FUN_0x0001844A — stateSub1844A.
   */
  stateSub1844A?: (state: GameState) => void;

  /**
   * FUN_0x00012FD0 — stateDispatch12FD0.
   */
  stateDispatch12FD0?: (state: GameState) => void;

  /**
   * FUN_0x00028624 — objDirtyDispatch28624.
   */
  objDirtyDispatch28624?: (state: GameState) => void;
}

/**
 * Cycle-accumulator decorator: adds estimated cycles for `key` to
 * `state.clock.cpuTicks`, then runs `fn`.
 *
 * Missing estimates fall back to 100 cycles for JSR/RTS overhead, enough for
 * cadence decisions around `CYCLES_PER_VBLANK`.
 */
function callSub(state: GameState, key: string, fn: () => void): void {
  addCpuCycles(state, SUB_CYCLE_ESTIMATE[key] ?? as_u32(100));
  fn();
}

function readGameModeWord(state: GameState): number {
  return (((state.workRam[0x394] ?? 0) << 8) | (state.workRam[0x395] ?? 0)) & 0xffff;
}

function readObjCount(state: GameState): number {
  return (((state.workRam[0x396] ?? 0) << 8) | (state.workRam[0x397] ?? 0)) & 0xffff;
}

/**
 *
 * Optional subroutine overrides default to no-op unless wired below.
 *
 * @param state  Shared GameState, mutated in place.
 */
export function refreshFrame10FCE(
  state: GameState,
  rom: RomImage,
  subs: RefreshFrame10FCESubs = {},
): void {
  // ─── Cycle accounting (cadence simulation) ────────────────────────────
  // For each expensive body subroutine, add an M68010 cycle estimate from
  // SUB_CYCLE_ESTIMATE and select fast/heavy variants for 30/60Hz cadence.
  const gameMode = readGameModeWord(state);
  const objCount = readObjCount(state);
  // FUN_10FCE overhead (orchestrator, 304 cycles).
  addCpuCycles(state, SUB_CYCLE_ESTIMATE["FUN_10FCE_OVERHEAD"] ?? as_u32(304));
  const updateSpritePos = (s: GameState, objAddr: number): void => {
    spritePosUpdate1BAB2(s, objAddr, {
      fun_1CABA: (st) => { sub1CABATileRedraw(st, rom); },
    });
  };
  const updateSpriteProject = (s: GameState, argLong: number): number =>
    spriteProject1CC62(s, argLong, {
      fun_1CABA: (st) => { sub1CABATileRedraw(st, rom); },
    });
  const helper1B9CC = (s: GameState, objAddr: number, flagLong: number): void => {
    spriteHelper1B9CC(s, objAddr, flagLong, {
      fun_1bab2: updateSpritePos,
    });
  };
  const enterObjectState = (s: GameState, objAddr: number, code: number): void => {
    objectStateEntry25BAE(s, objAddr, code, {
      soundCommand: (cmd) => { soundCmdSend158AC(s, cmd); },
      fun_2591A: (st, initObj) => {
        objectInit2591A(st, initObj, {
          fun_262B2: (st2, ptr) => {
            if ((st2.workRam[0x390] ?? 0) === 0 && (st2.workRam[0x391] ?? 0) === 0) {
              objectTargetInit262B2(st2, rom, ptr);
            }
          },
          fun_1BAB2: updateSpritePos,
          fun_1CC62: updateSpriteProject,
          fun_25B40: (st2, ptr) => { objectArrayInit25B40(st2, rom, ptr); },
          fun_1B9CC: helper1B9CC,
          fun_13966: (st2, ptr) => { postStateChange13966(st2, rom, ptr); },
        });
      },
    });
  };
  const enterObjectStateFrom = (source: string) =>
    (s: GameState, objAddr: number, code: number): void => {
      const existing = s.debug?.lastObjectStateEntry;
      const alreadyRecorded =
        existing !== undefined &&
        existing.frame === Number(s.clock.frame ?? 0) &&
        existing.entityAddr === (objAddr >>> 0) &&
        existing.code === (code & 0xff);
      if (!alreadyRecorded) {
        recordObjectStateEntryDebug(s, objAddr, code, source);
      }
      enterObjectState(s, objAddr, code);
    };
  const enterObject1281C = (s: GameState, objAddr: number): number =>
    objectEnter1281C(s, objAddr, (ptr, mode) => fun264AA(s, rom, ptr, mode));
  const stepAnimation25FC2 = (s: GameState, objAddr: number): void => {
    helper25FC2(s, rom, objAddr, {
      soundCommand: (cmd) => { soundCmdSend158AC(s, cmd); },
      soundPair15884: (st) => { soundPair15884(st); },
      objectStateEntry25BAE: enterObjectStateFrom("FUN_25FC2"),
      helper18F46: (st, r, typeCode, subIdx) => {
        helper18F46(st, r, typeCode, subIdx);
      },
    });
  };

  // 00010FCE: jsr 0x00013EE6
  // Wire fun1344c = slapsticDispatcher1344C: existing replica that clears
  // PENDING_RECORD @ 0x400970 (cluster Misc Sub-A: byte 0x971..0x973).
  // @ f12056 in MAME ground truth). FUN_144E4 receives oldTarget and newTarget
  const fun13EE6Key = (state.workRam[0x06] ?? 0) === 0 ? "FUN_13EE6_FAST" : "FUN_13EE6_HEAVY";
  callSub(state, fun13EE6Key, () => {
    (subs.fun13EE6 ?? ((s) => {
      refreshHelper13EE6(s, rom, {
        fun1344c: (s2, r) => slapsticDispatcher1344C(s2, r),
        fun144e4: (s2, r, oldTarget, newTarget) => {
          scrollRange144E4(s2, r, oldTarget & 0xffff, newTarget & 0xffff);
        },
      });
    }))(state);
  });

  // 00010FD4: jsr 0x000251DE
  // FUN_253EC chain MAME-canonical (disasm 0x253EC..0x25918, JT @ 0x254BA):
  //
  //   Prologo (0x253ec): D1 = (0x1a,A2).b ext.w (= s1a).
  //   Guard @ 0x25412: tst.b (0xd8,A2); beq → 0x2548c (skip the "intermediate body").
  //   Intermediate body (0x25416..0x25488): for `(0xd8,A2)!=0` AND s1a∉{2,4,7,a,b},
  //     handle `(0x68,A2)` transition with clamp and flag manipulation on `(0xd8,A2)`.
  //   Bound-check @ 0x25490: blt/bgt -> epilog if A1<0 or A1>0xb.
  //   JT dispatch @ 0x254ba (16 word entries):
  //     JT[1] = 0x2574c  → s1a=1
  //     JT[2] = 0x25824  → s1a=2
  //     JT[3] = 0x25514  → s1a=3
  //     JT[4] = 0x255c6  → s1a=4
  //     JT[5] = 0x257ba  → s1a=5
  //     JT[6] = 0x254d2  → s1a=6
  //     JT[7] = 0x25812  → s1a=7
  //     JT[8] = 0x258a8  → s1a=8
  //     JT[9] = 0x2584e  → s1a=9
  //     JT[10] = 0x2563e → s1a=10
  //     JT[11] = 0x25876 → s1a=11
  //
  //   PATH s1a=0 @ 0x256d2 (player normal — obj0 demo gameplay):
  //     tst.b (0xcb,A2); beq.b → 0x25730 (NORMAL chain).
  //     0x25730: jsr helper253BC; jsr objectStep17F66; jsr helper121B8; bra epilog.
  //
  //   helper121B8 runs INTEGRATE_VEL (obj.x += obj.vx, obj.y += obj.vy, etc.)
  //   plus spriteRotate1C014 and internal subs (29CCE/1BC88/1924E/25C74).
  //
  //   MAME f12000+ per obj0 (player1 @ 0x400018): s1a=0, s18=1, 0xcb=0,
  //   0xd8=0 → path NORMAL stabile, no respawn, no out_of_range. FUN_29CCE
  // FUN_251DE: cost dominated by the per-object chain (helper121B8 ~4500/obj).
  // count<=2 = attract (AVG 11180), count>6 = HEAVY (~60000).
  // helper121B8 chain inside fun253ECDispatch).
  const fun251DEKey =
    objCount > 6 ? "FUN_251DE_HEAVY" : "FUN_251DE";
  callSub(state, fun251DEKey, () => {
    (subs.objectScanDispatch251DE ?? ((s) => {
      objectScanDispatch251DE(s, rom, {
        fun_253EC: (st, a2) => {
          fun253ECDispatch(st, rom, a2);
        },
      });
    }))(state);
  });

  // 00010FDA: jsr 0x000189E2
  // FUN_189E2: gate *0x400394.w == 0 (= attract title). Altrove fast.
  const fun189E2Key =
    gameMode === 0
      ? objCount > 6
        ? "FUN_189E2_HEAVY"
        : "FUN_189E2"
      : "FUN_189E2_FAST";
  callSub(state, fun189E2Key, () => {
    (subs.processAllSprites189E2 ?? processAllSprites)(state);
  });

  // 00010FE0: jsr 0x000158CC
  // FUN_158CC itera 2 slot pair @ 0x4009A4 (P1) and 0x400A20 (P2) chiamando
  // dispatch su obj+0x18:
  //   - s18==0 → no-op (skip)
  //   - s18==2 → jsr 25FC2 + 1B9CC + 1281C (state-2 branch)
  //   - else  → jsr 253BC + 182BA + 121B8 (ELSE branch)
  // Plus timer @ +0x6C (state 0x21/0x22 → 0x23 via FUN_160D4) and timer @ +0x56
  // (state 0x24 → 0x23 via FUN_160D4).
  // FUN_158CC: conservative AVG estimate (attract with 2 active slot pairs).
  const slotP1State = state.workRam[0x9bc] ?? 0; // P1 slot @ 0x4009A4 + 0x18
  const slotP2State = state.workRam[0xa38] ?? 0; // P2 slot @ 0x400A20 + 0x18
  const fun158CCKey = slotP1State === 0 && slotP2State === 0 ? "FUN_158CC_FAST" : "FUN_158CC";
  callSub(state, fun158CCKey, () => {
    (subs.objectUpdatePair158CC ?? ((s) => {
      objectUpdatePair158CC(s, {
        objectUpdate: (slotPtr: number) => {
          // Task #183: wire fun_1bab2 → spritePosUpdate1BAB2(fun_1CABA → sub1CABA)
          // Also for P1/P2 slot pairs, both in the state-2 branch (direct 1B9CC)
          // and in the ELSE branch via helper121B8.
          const updateSpritePos = (st: GameState, objAddr: number): void => {
            spritePosUpdate1BAB2(st, objAddr, {
              fun_1CABA: (s2) => { sub1CABATileRedraw(s2, rom); },
            });
          };
          fun158F6(s, slotPtr, rom, {
            helper25FC2: (st, _r, objAddr) => { stepAnimation25FC2(st, objAddr); },
            spriteHelper1B9CCSubs: {
              fun_1bab2: updateSpritePos,
            },
            objectEnter1281C: (st, objAddr) => { enterObject1281C(st, objAddr); },
            helper121B8Subs: {
              fun_1bab2: updateSpritePos,
              fun_29cce: (st, objAddr) => { fun29CCE(st, objAddr, rom); },
              fun_1281c: (st, objAddr) => enterObject1281C(st, objAddr),
            },
          });
        },
      });
    }))(state);
  });

  // 00010FE6: jsr 0x0001493C
  // FUN_14966 ora full port: vedi `sub-14966.ts`. Body Path C reset ticker
  const fun1493CKey = gameMode === 4 ? "FUN_1493C_HEAVY" : "FUN_1493C";
  callSub(state, fun1493CKey, () => {
    const replayHandled = runWarmSlotArrayReplayTick(state, rom);
    if (!replayHandled) {
      (subs.slotArrayTick1493C ?? ((s) => {
        slotArrayTick(s, { fun_14966: (slotPtr, st) => { sub14966(st, rom, slotPtr); } });
      }))(state);
    }
  });

  // 00010FEC: addq.b #1, (0x004003F0).l
  addByte(state, FRAME_CTR_ADDR, 1);

  // 00010FF2: jsr 0x00017230
  const fun17230Key = gameMode === 4 ? "FUN_17230_HEAVY" : "FUN_17230";
  callSub(state, fun17230Key, () => {
    (subs.dispatchStrings17230 ?? ((s) => {
      dispatchStrings17230((slotAddr) => { stringStep1725A(s, slotAddr, rom); });
    }))(state);
  });

  // 00010FF8: jsr 0x0001912C
  const fun1912CKey = gameMode === 4 ? "FUN_1912C" : "FUN_1912C_FAST";
  callSub(state, fun1912CKey, () => {
    (subs.fun1912C ?? ((s) => {
      refreshHelper1912C(s, rom, {
        fun_194ba: (st, entityAddr) => {
          runArray9ObjectDispatch194BA(st, rom, entityAddr);
        },
        fun_199d6: (st, entityAddr) => {
          computeSpriteCoords_v2(st, entityAddr);
        },
      });
    }))(state);
  });

  // 00010FFE: jsr 0x00019BAA
  // si propagano correttamente, causando cluster drift @ 0x674..0x68B
  // (22 byte) + cascade su obj struct screen-Y.
  const fun19BAAKey =
    gameMode === 4
      ? objCount > 6
        ? "FUN_19BAA_HEAVY"
        : "FUN_19BAA"
      : "FUN_19BAA_FAST";
  callSub(state, fun19BAAKey, () => {
    (subs.stateSub19BAA ?? ((s) => { stateSub19BAA(s, rom, { fun_19e42: marbleCellDispatch19E42 }); }))(state);
  });

  // 00011004: jsr 0x0001844A
  // Gate: *0x400394.w == 3 AND *0x400760 != 0 (mode boss/transition).
  const slot760 = state.workRam[0x760] ?? 0;
  const fun1844AKey =
    gameMode === 3 && slot760 !== 0 ? "FUN_1844A_HEAVY" : "FUN_1844A_FAST";
  callSub(state, fun1844AKey, () => {
    (subs.stateSub1844A ?? ((s) => {
      stateSub1844A(s, rom, {
        fun_18e6c: (typeCode, subIdx, st, r) => {
          slotInsertSorted18E6C(st, r, typeCode, subIdx);
        },
        fun_18f46: (typeCode, subIdx, st) => {
          helper18F46(st, rom, typeCode, subIdx);
        },
        fun_18972: (entryAbsAddr, st) => {
          computeSpriteCoords_v4(st, entryAbsAddr);
        },
        soundCommand: (cmd) => {
          soundCmdSend158AC(s, cmd);
        },
      });
    }))(state);
  });

  // 0001100A: jsr 0x00012FD0
  // Wire fun_12d46 = claimScriptSlot: allocates slots at 0x400a9c for script
  // 0x1d854, gated by gameMode==2 + obj+0x1b in {9,a}.
  // Wire fun_13068 = scriptSlotStep13068: advances the 25 script slots through
  // scrollRange144E4 -> scriptRectDispatch12DFA.
  const fun12FD0Key = gameMode === 4 ? "FUN_12FD0_HEAVY" : "FUN_12FD0";
  callSub(state, fun12FD0Key, () => {
    (subs.stateDispatch12FD0 ?? ((s) => {
      const updateWaveTerrain = (paletteByteSigned: number): void => {
        terrainWaveUpdate1D06A(s, rom, paletteByteSigned);
      };
      stateDispatch12FD0(s, {
        fun_12d46: (romScriptPtr) => { claimScriptSlot(s, rom, romScriptPtr); },
        fun_13068: (slotPtr) => {
          scriptSlotStep13068(s, rom, slotPtr, {
            fun12896: (st, sp) => {
              helper12896(st, rom, sp, {
                inner1D06A: updateWaveTerrain,
                // FUN_12896 opcodes 2/8/18 call FUN_158AC (the real sound sender).
                // Opcode 18 is the "marble no longer matches → descend + STOP" path:
                // when a passed vacuum/aspirator sinks, it emits the stop command
                // (0x1ef5a[kind-0x1e] → $4a/$4c). Without this wiring the stop was
                // silently dropped, leaving the suction loop stuck (vacuum bug).
                fun158ac: (st2, cmd) => { soundCmdSend158AC(st2, cmd); },
              });
            },
            inner1D06A: updateWaveTerrain,
          });
        },
      });
    }))(state);
  });

  // 00011010: addq.b #1, (0x004003F0).l
  addByte(state, FRAME_CTR_ADDR, 1);

  // 00011016: jsr 0x00028624
  // ROM table @ 0x23D3A (16 bytes): pass slice from ROM program image.
  const fun28624Key = objCount > 6 ? "FUN_28624_HEAVY" : "FUN_28624";
  callSub(state, fun28624Key, () => {
    (subs.objDirtyDispatch28624 ?? ((s) => {
      objDirtyDispatch28624Default(s, rom);
    }))(state);
  });

  // 0001101C: rts
}

export const REFRESH_FRAME_10FCE_ADDR = 0x00010fce as const;

export const REFRESH_FRAME_10FCE_SUB_ADDRS = [
  0x00013ee6, // FUN_13EE6 (stub)
  0x000251de, // objectScanDispatch251DE
  0x000189e2, // processAllSprites
  0x000158cc, // objectUpdatePair158CC
  0x0001493c, // slotArrayTick
  0x00017230, // dispatchStrings17230
  0x0001912c, // FUN_1912C (stub)
  0x00019baa, // stateSub19BAA
  0x0001844a, // stateSub1844A
  0x00012fd0, // stateDispatch12FD0
  0x00028624, // objDirtyDispatch28624
] as const;
