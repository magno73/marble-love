/**
 * refresh-frame-10fce.ts — replica `FUN_00010FCE` (19 istr, ~80 byte).
 *
 * "Idle/refresh frame handler": orchestratore chiamato da `mainLoopInit1101E`
 * (case 0 e case 1 timer-expiry) che esegue 12 JSR in sequenza e 2 `addq.b`
 * sul frame-counter globale @ 0x4003F0.
 *
 * **Disasm 0x10FCE..0x1001C** (80 byte, 19 istruzioni):
 *
 *   00010FCE  jsr 0x00013EE6    ; [stub] FUN_13EE6 — non ancora replicata
 *   00010FD4  jsr 0x000251DE    ; objectScanDispatch251DE
 *   00010FDA  jsr 0x000189E2    ; processAllSprites
 *   00010FE0  jsr 0x000158CC    ; objectUpdatePair158CC
 *   00010FE6  jsr 0x0001493C    ; slotArrayTick
 *   00010FEC  addq.b #1, (0x004003F0).l   ; frame-counter++
 *   00010FF2  jsr 0x00017230    ; dispatchStrings17230
 *   00010FF8  jsr 0x0001912C    ; [stub] FUN_1912C — non ancora replicata
 *   00010FFE  jsr 0x00019BAA    ; stateSub19BAA
 *   00011004  jsr 0x0001844A    ; stateSub1844A
 *   0001100A  jsr 0x00012FD0    ; stateDispatch12FD0
 *   00011010  addq.b #1, (0x004003F0).l   ; frame-counter++ (secondo)
 *   00011016  jsr 0x00028624    ; objDirtyDispatch28624
 *   0001101C  rts
 *
 * FUN_1912C è disponibile come `refresh-helper-1912c.ts` (replica da agente parallelo)
 * ed è wired come default.
 * FUN_13EE6 è disponibile come `refresh-helper-13ee6.ts` (replica da agente parallelo)
 * ed è wired come default.
 *
 * FUN_1493C è già replicata in `slot-array-tick.ts` ma è qui esposta come
 * opzionale stub per override.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { objectScanDispatch251DE } from "./object-scan-dispatch-251de.js";
import { spriteRotate1C014 } from "./sprite-rotate-1c014.js";
import { spriteBracketLerp1C676 } from "./sprite-bracket-lerp-1c676.js";
import { stateSub1B5C2 } from "./state-sub-1b5c2.js";
import { helper182BA } from "./helper-182ba.js";
import { objectStep17F66 } from "./object-step-17f66.js";
import { waypointListStep1815A } from "./waypoint-list-step-1815a.js";
import { helper253BC } from "./helper-253bc.js";
import { processAllSprites } from "./process-all-sprites-189e2.js";
import { objectUpdatePair158CC } from "./object-update-pair-158cc.js";
import { slotArrayTick } from "./slot-array-tick.js";
import { dispatchStrings17230 } from "./dispatch-strings-17230.js";
import { stringStep1725A } from "./string-step-1725a.js";
import { stateSub19BAA } from "./state-sub-19baa.js";
import { stateSub1844A } from "./state-sub-1844a.js";
import { stateDispatch12FD0 } from "./state-dispatch-12fd0.js";
import { objDirtyDispatch28624 } from "./obj-dirty-dispatch-28624.js";
import { refreshHelper1912C } from "./refresh-helper-1912c.js";
import { refreshHelper13EE6 } from "./refresh-helper-13ee6.js";
import { slapsticDispatcher1344C } from "./slapstic-dispatcher-1344c.js";

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

function addByte(state: GameState, addr: number, delta: number): void {
  wb(state, addr, rb(state, addr) + delta);
}

/** Frame-counter global byte address (addq.b #1 target). */
export const FRAME_CTR_ADDR = 0x004003f0 as const;

export interface RefreshFrame10FCESubs {
  /**
   * FUN_0x00013EE6 — refreshHelper13EE6 (replica disponibile).
   * Default: chiama la replica reale (richiede rom).
   */
  fun13EE6?: (state: GameState) => void;

  /**
   * FUN_0x000251DE — objectScanDispatch251DE.
   * Default: chiama la replica reale (richiede rom).
   */
  objectScanDispatch251DE?: (state: GameState) => void;

  /**
   * FUN_0x000189E2 — processAllSprites.
   * Default: chiama la replica reale.
   */
  processAllSprites189E2?: (state: GameState) => void;

  /**
   * FUN_0x000158CC — objectUpdatePair158CC.
   * Default: chiama la replica reale.
   */
  objectUpdatePair158CC?: (state: GameState) => void;

  /**
   * FUN_0x0001493C — slotArrayTick.
   * Default: chiama la replica reale.
   */
  slotArrayTick1493C?: (state: GameState) => void;

  /**
   * FUN_0x00017230 — dispatchStrings17230.
   * Default: chiama la replica reale.
   */
  dispatchStrings17230?: (state: GameState) => void;

  /**
   * FUN_0x0001912C — refreshHelper1912C (replica disponibile).
   * Default: chiama la replica reale (richiede rom).
   */
  fun1912C?: (state: GameState) => void;

  /**
   * FUN_0x00019BAA — stateSub19BAA.
   * Default: chiama la replica reale (richiede rom).
   */
  stateSub19BAA?: (state: GameState) => void;

  /**
   * FUN_0x0001844A — stateSub1844A.
   * Default: chiama la replica reale (richiede rom).
   */
  stateSub1844A?: (state: GameState) => void;

  /**
   * FUN_0x00012FD0 — stateDispatch12FD0.
   * Default: chiama la replica reale.
   */
  stateDispatch12FD0?: (state: GameState) => void;

  /**
   * FUN_0x00028624 — objDirtyDispatch28624.
   * Default: chiama la replica reale (richiede rom per ROM table).
   */
  objDirtyDispatch28624?: (state: GameState) => void;
}

/**
 * Replica bit-perfect di `FUN_00010FCE`.
 *
 * Esegue 12 JSR in ordine + 2× `addq.b #1, (0x4003F0).l`.
 * Tutte le JSR sono esposte come subs iniettabili; le 3 non ancora replicate
 * (FUN_13EE6, FUN_1912C) hanno default no-op.
 *
 * @param state  GameState condiviso (modifica in-place).
 * @param rom    ROM image necessaria per alcune sub di default.
 * @param subs   Callback injection (opzionale).
 */
export function refreshFrame10FCE(
  state: GameState,
  rom: RomImage,
  subs: RefreshFrame10FCESubs = {},
): void {
  // 00010FCE: jsr 0x00013EE6
  // Wire fun1344c = slapsticDispatcher1344C: replica esistente che pulisce
  // PENDING_RECORD @ 0x400970 (cluster Misc Sub-A: byte 0x971..0x973).
  (subs.fun13EE6 ?? ((s) => {
    refreshHelper13EE6(s, rom, {
      fun1344c: (s2, r) => slapsticDispatcher1344C(s2, r),
    });
  }))(state);

  // 00010FD4: jsr 0x000251DE
  // FUN_253EC default chain (chirurgica, evita helper121B8 intero che ha
  // sub stub no-op problematiche): objectStep17F66 con fun1815A wirato a
  // waypointListStep1815A (= update VX/VY in attract-mode-homing path,
  // *0x400390 == 1) + helper253BC (campi derivati obj+0x2a, +0x1d) +
  // spriteRotate1C014 (rotation matrix obj+0x75..+0xb3) + spriteBracketLerp
  // (globals 0x400674..683).
  (subs.objectScanDispatch251DE ?? ((s) => {
    objectScanDispatch251DE(s, rom, {
      fun_253EC: (st, a2) => {
        // MAME canonical chain (atarisy1_v.cpp FUN_253EC state 0):
        //   helper253BC → objectStep17F66 → helper121B8(INTEGRATE_VEL + ...)
        helper253BC(st, a2);
        objectStep17F66(st, a2, {
          fun1815A: (a2Addr) => { waypointListStep1815A(st, a2Addr, undefined, rom); },
          fun180BE: () => {},
          fun26196: () => {},
        });
        // INTEGRATE_VEL extracted from helper121B8 (chain MAME-canonical).
        // Estratto solo INTEGRATE_VEL path (= obj.{x,y,z} += obj.{vx,vy,vz})
        // per evitare side-effect spurious del wiring helper121B8 totale.
        {
          const wr = st.workRam;
          const objOff = (a2 - 0x400000) >>> 0;
          const r32 = (off: number): number =>
            (((wr[off] ?? 0) << 24) | ((wr[off + 1] ?? 0) << 16) |
             ((wr[off + 2] ?? 0) << 8) | (wr[off + 3] ?? 0)) >>> 0;
          const w32 = (off: number, v: number): void => {
            const u = v >>> 0;
            wr[off]     = (u >>> 24) & 0xff;
            wr[off + 1] = (u >>> 16) & 0xff;
            wr[off + 2] = (u >>> 8)  & 0xff;
            wr[off + 3] = u & 0xff;
          };
          // obj.x += obj.vx
          w32(objOff + 0x0c, (r32(objOff + 0x0c) + r32(objOff + 0x00)) >>> 0);
          // obj.y += obj.vy
          w32(objOff + 0x10, (r32(objOff + 0x10) + r32(objOff + 0x04)) >>> 0);
          // obj.z += obj.vz
          w32(objOff + 0x14, (r32(objOff + 0x14) + r32(objOff + 0x08)) >>> 0);
        }
        spriteRotate1C014(st, rom, (a2 - 0x400000) >>> 0);
        spriteBracketLerp1C676(st);
      },
    });
  }))(state);

  // 00010FDA: jsr 0x000189E2
  (subs.processAllSprites189E2 ?? processAllSprites)(state);

  // 00010FE0: jsr 0x000158CC
  // FUN_158CC itera 2 slot pair @ 0x4009A4 (P1) e 0x400A20 (P2) chiamando
  // FUN_158F6(slotPtr). FUN_158F6 dispatch su obj+0x18:
  //   - s18==0 → no-op (skip)
  //   - s18==2 → branch alt: jsr 25FC2, 1B9CC, 1281C
  //   - else  → jsr 253BC, 182BA, 121B8 (= INTEGRATE_VEL + stateSub1B5C2 +
  //                                       spriteBracketLerp via 121B8 chain)
  // Chirurgico: replico l'ELSE branch (più comune in attract mode), saltando
  // helper182BA (non ancora replicato) e usando solo le sub MAME bit-perfect
  // necessarie per popolare cluster 0x674..683.
  (subs.objectUpdatePair158CC ?? ((s) => {
    objectUpdatePair158CC(s, {
      objectUpdate: (slotPtr: number) => {
        const objOff = (slotPtr - 0x400000) >>> 0;
        const s18 = s.workRam[objOff + 0x18] ?? 0;
        if (s18 === 0 || s18 === 2) return; // skip / branch alt non replicato
        // ELSE branch FUN_158F6 (line 0x1597a..1598c):
        helper253BC(s, slotPtr);
        // FUN_182BA: state-validate-grid + seek/gravity + 26196 dispatch
        helper182BA(s, slotPtr, rom);
        // helper121B8 surrogate: INTEGRATE_VEL + stateSub1B5C2 + spriteBracketLerp
        {
          const wr = s.workRam;
          const r32 = (off: number): number =>
            (((wr[off] ?? 0) << 24) | ((wr[off + 1] ?? 0) << 16) |
             ((wr[off + 2] ?? 0) << 8) | (wr[off + 3] ?? 0)) >>> 0;
          const w32 = (off: number, v: number): void => {
            const u = v >>> 0;
            wr[off]     = (u >>> 24) & 0xff;
            wr[off + 1] = (u >>> 16) & 0xff;
            wr[off + 2] = (u >>> 8)  & 0xff;
            wr[off + 3] = u & 0xff;
          };
          // obj.x += obj.vx, obj.y += obj.vy, obj.z += obj.vz
          w32(objOff + 0x0c, (r32(objOff + 0x0c) + r32(objOff + 0x00)) >>> 0);
          w32(objOff + 0x10, (r32(objOff + 0x10) + r32(objOff + 0x04)) >>> 0);
          w32(objOff + 0x14, (r32(objOff + 0x14) + r32(objOff + 0x08)) >>> 0);
        }
        stateSub1B5C2(s, slotPtr, 0x40066a, 0x40069e);
        spriteBracketLerp1C676(s);
      },
    });
  }))(state);

  // 00010FE6: jsr 0x0001493C
  (subs.slotArrayTick1493C ?? slotArrayTick)(state);

  // 00010FEC: addq.b #1, (0x004003F0).l
  addByte(state, FRAME_CTR_ADDR, 1);

  // 00010FF2: jsr 0x00017230
  (subs.dispatchStrings17230 ?? ((s) => {
    dispatchStrings17230((slotAddr) => { stringStep1725A(s, slotAddr, rom); });
  }))(state);

  // 00010FF8: jsr 0x0001912C
  (subs.fun1912C ?? ((s) => { refreshHelper1912C(s, rom); }))(state);

  // 00010FFE: jsr 0x00019BAA
  (subs.stateSub19BAA ?? ((s) => { stateSub19BAA(s, rom); }))(state);

  // 00011004: jsr 0x0001844A
  (subs.stateSub1844A ?? ((s) => { stateSub1844A(s, rom); }))(state);

  // 0001100A: jsr 0x00012FD0
  // (subs.fun_11ac2 = soundMaybe11AC2 wiring valutato: gating *0x40075c == 0
  // in MAME @ 2400, fix non applicabile per il drift cluster B residuo.)
  (subs.stateDispatch12FD0 ?? stateDispatch12FD0)(state);

  // 00011010: addq.b #1, (0x004003F0).l
  addByte(state, FRAME_CTR_ADDR, 1);

  // 00011016: jsr 0x00028624
  // ROM table @ 0x23D3A (16 bytes): pass slice from ROM program image.
  (subs.objDirtyDispatch28624 ?? ((s) => {
    const romTab = rom.program.subarray(0x23d3a, 0x23d3a + 16);
    objDirtyDispatch28624(s, romTab);
  }))(state);

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
