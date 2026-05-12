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
import { addCpuCycles } from "./m68k/clock.js";
import { SUB_CYCLE_ESTIMATE } from "./m68k/sub-cycle-costs.js";
import { as_u32 } from "./wrap.js";
import { objectScanDispatch251DE } from "./object-scan-dispatch-251de.js";
import { objectStep17F66 } from "./object-step-17f66.js";
import { waypointListStep1815A } from "./waypoint-list-step-1815a.js";
import { helper253BC } from "./helper-253bc.js";
import { helper121B8 } from "./helper-121b8.js";
import { fun158F6 } from "./sub-158f6.js";
import { processAllSprites } from "./process-all-sprites-189e2.js";
import { objectUpdatePair158CC } from "./object-update-pair-158cc.js";
import { slotArrayTick } from "./slot-array-tick.js";
import { fun14966Stub } from "./sub-14966-stub.js";
import { dispatchStrings17230 } from "./dispatch-strings-17230.js";
import { stringStep1725A } from "./string-step-1725a.js";
import { stateSub19BAA } from "./state-sub-19baa.js";
import { marbleCellDispatch19E42 } from "./marble-cell-dispatch-19e42.js";
import { stateSub1844A } from "./state-sub-1844a.js";
import { stateDispatch12FD0 } from "./state-dispatch-12fd0.js";
import { objDirtyDispatch28624 } from "./obj-dirty-dispatch-28624.js";
import { refreshHelper1912C } from "./refresh-helper-1912c.js";
import { refreshHelper13EE6 } from "./refresh-helper-13ee6.js";
import { slapsticDispatcher1344C } from "./slapstic-dispatcher-1344c.js";
import { scrollRange144E4 } from "./scroll-range-144e4.js";
import { scriptSlotStep13068 } from "./script-slot-step-13068.js";
import { helper12896 } from "./helper-12896.js";
import { claimScriptSlot } from "./script-slot-claim.js";

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

/**
 * Replica del dispatcher `FUN_253EC` (0x253EC..0x25918) — versione minima
 * focalizzata sui path osservati per obj0 e altri object slot in demo gameplay.
 *
 * Si appoggia al disasm:
 *   - Prologo: tst.b (0xd8,A2). Se !=0 esegue body intermedio (0x25416..),
 *     altrimenti salta a bound-check + JT (0x2548c).
 *   - JT @ 0x254BA dispatcha per s1a (= (0x1a,A2).b ext.w). Bound 0..0xb.
 *   - Per s1a=0 (path NORMAL per obj0): se (0xcb,A2)==0 → chain
 *     helper253BC + objectStep17F66 + helper121B8.
 *
 * Per s1a∉{0} oppure 0xcb!=0 oppure 0xd8!=0 oppure s1a fuori range, cade
 * sul vecchio behavior conservativo (no chain extra) — coerente con il
 * fatto che obj0 demo gameplay è invariante su s1a=0/cb=0/d8=0 (verificato
 * vs /tmp/mame_100f.json frame 12000..12099).
 */
function fun253ECDispatch(state: GameState, rom: RomImage, a2: number): void {
  const wr = state.workRam;
  const objOff = (a2 - 0x00400000) >>> 0;
  if (objOff + 0xe2 > wr.length) return;

  const s1a = wr[objOff + 0x1a] ?? 0;
  const sd8 = wr[objOff + 0xd8] ?? 0;
  const scb = wr[objOff + 0xcb] ?? 0;

  // Path NORMAL per s1a=0 con guard 0xd8==0 e cb==0:
  //   0x2548c (skip body intermedio) → JT[0]=0x256d2 → 0x25730:
  //     jsr helper253BC; jsr objectStep17F66; jsr helper121B8; bra epilog.
  if (s1a === 0 && sd8 === 0 && scb === 0) {
    helper253BC(state, a2);
    objectStep17F66(state, a2, {
      fun1815A: (a2Addr) => { waypointListStep1815A(state, a2Addr, undefined, rom); },
      fun180BE: () => {},
      fun26196: () => {},
    });
    // Wire FUN_1CABA (heavy tile-redraw) into both spritePosUpdate1BAB2 and
    // spriteProject1CC62. spritePosUpdate1BAB2 invokes it conditionally on
    // tile-change (sentinel @ 0x400696/8 = 0xFFFF set right above in
    // helper121B8 → first invocation triggers it). spriteProject1CC62 only
    // calls it if argByte != 0, but here helper121B8 always passes argLong=0,
    // so that path is no-op anyway. We inject the real replica into both
    // injection points so STRUCT @ 0x401C28 (= cz) reflects the terrain z
    // under obj0's current tile, allowing INTEGRATE_VEL to be taken.
    // STUB `fun_1cc62 → obj.z`: bit-perfect proven (99/99 MAME match per
    // obj0.x). Tentativi di wirare spriteProject1CC62 (real) o
    // sub1CABATileRedraw (heavy redraw) producono regressione obj0.x.
    // Cause: 1) sub1CABATileRedraw NON bit-perfect (B2 parity 0/100);
    // 2) spriteProject senza sub1CABA → ritorna valore basato su STRUCT
    // warm che non e' quello che MAME calcola (= MAME ha STRUCT aggiornata
    // da sub1CABA). Per fix vero serve PRIMA fixare sub1CABATileRedraw
    // bit-perfect, POI wirare spriteProject + sub1CABA insieme.
    helper121B8(state, rom, a2, {
      fun_1cc62: (_s, _argZero) => {
        const objZOff = objOff + 0x14;
        return (
          (((wr[objZOff] ?? 0) << 24) |
            ((wr[objZOff + 1] ?? 0) << 16) |
            ((wr[objZOff + 2] ?? 0) << 8) |
            (wr[objZOff + 3] ?? 0)) >>> 0
        );
      },
    });
    return;
  }

  // Fallback (path non-modellati): chain conservativa esistente —
  // helper253BC + objectStep17F66 SENZA helper121B8. Equivalente al
  // wiring precedente; mantiene parity per obj non-obj0 finché i path
  // restanti del JT non vengono modellati.
  helper253BC(state, a2);
  objectStep17F66(state, a2, {
    fun1815A: (a2Addr) => { waypointListStep1815A(state, a2Addr, undefined, rom); },
    fun180BE: () => {},
    fun26196: () => {},
  });
}

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
 * Cycle-accumulator decorator: aggiunge i cicli stimati per `key` al
 * counter CPU di `state.clock.cpuTicks`, poi esegue `fn`.
 *
 * Il lookup in `SUB_CYCLE_ESTIMATE` cade su 100 cicli (overhead jsr+rts
 * approssimativo) per chiavi non presenti. Usato dal main-tick per
 * decidere se il body ha sforato `CYCLES_PER_VBLANK` (cadenza 60Hz).
 */
function callSub(state: GameState, key: string, fn: () => void): void {
  addCpuCycles(state, SUB_CYCLE_ESTIMATE[key] ?? as_u32(100));
  fn();
}

/** Legge `*0x400394.w` (game mode). Word big-endian. */
function readGameModeWord(state: GameState): number {
  return (((state.workRam[0x394] ?? 0) << 8) | (state.workRam[0x395] ?? 0)) & 0xffff;
}

/** Legge `*0x400396.w` (obj count attivi). */
function readObjCount(state: GameState): number {
  return (((state.workRam[0x396] ?? 0) << 8) | (state.workRam[0x397] ?? 0)) & 0xffff;
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
  // ─── Cycle accounting (cadence simulation) ────────────────────────────
  // Per ogni sub "fat" del body sommiamo una stima cicli M68010 (vedi
  // SUB_CYCLE_ESTIMATE in m68k/sub-cycle-costs.ts), scegliendo fast/heavy
  // in base ai gate condizionali letti dal workRam (game-mode word
  // *0x400394 e obj count *0x400396). Il main-tick legge il totale a fine
  // body per decidere se sforare la mailbox vblank (cadenza 60Hz).
  const gameMode = readGameModeWord(state);
  const objCount = readObjCount(state);
  // FUN_10FCE overhead (orchestratore, 304 cicli)
  addCpuCycles(state, SUB_CYCLE_ESTIMATE["FUN_10FCE_OVERHEAD"] ?? as_u32(304));

  // 00010FCE: jsr 0x00013EE6
  // Wire fun1344c = slapsticDispatcher1344C: replica esistente che pulisce
  // PENDING_RECORD @ 0x400970 (cluster Misc Sub-A: byte 0x971..0x973).
  // Wire fun144e4 = scrollRange144E4: dispatcher di scroll-row che chiama
  // scriptRectDispatch12DFA (FUN_12DFA) → popola gli slot @ 0x400a9c quando
  // la riga scroll attraversa una rect-list boundary (cluster slot 0 spawn
  // @ f12056 in MAME ground truth). FUN_144E4 riceve oldTarget e newTarget
  // come long sullo stack, ma legge solo i low word — passiamo i due long
  // così come spinti dal binario e scrollRange144E4 fa il sext16 internamente.
  // FUN_13EE6: gate *0x400006 → fast quando 0 (attract steady-state).
  // Heavy quando scroll attivo (gameplay).
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
  //   Guard @ 0x25412: tst.b (0xd8,A2); beq → 0x2548c (skip "body intermedio").
  //   Body intermedio (0x25416..0x25488): per `(0xd8,A2)!=0` AND s1a∉{2,4,7,a,b},
  //     gestione transizione `(0x68,A2)` con clamp e flag manip su `(0xd8,A2)`.
  //   Bound-check @ 0x25490: blt/bgt → epilog se A1<0 o A1>0xb.
  //   JT dispatch @ 0x254ba (16 word entries):
  //     JT[0] = 0x256d2  → s1a=0  ← path normale per obj0 demo gameplay
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
  //     [se cb!=0: branch a respawn-block, fuori scope obj0 demo].
  //     0x25730: jsr helper253BC; jsr objectStep17F66; jsr helper121B8; bra epilog.
  //
  //   helper121B8 fa: INTEGRATE_VEL (obj.x += obj.vx, obj.y += obj.vy, ecc.)
  //   + scrive globals 0x684/688/68c/690/692/694 + chiama spritePosUpdate1BAB2
  //   + spriteRotate1C014 + sub interne (29CCE/1BC88/1924E/25C74).
  //
  //   MAME f12000+ per obj0 (player1 @ 0x400018): s1a=0, s18=1, 0xcb=0,
  //   0x36=0, 0xd8=0, s58=0 → path NORMAL stabile, no respawn, no out_of_range.
  //   `fun_29cce` con no-op è bit-perfect per obj0 (vedi sub-29cce.ts riga 36-58:
  //   nessun BLOCK complesso triggera, no neg.l vx/vy nell'epilog perché
  //   *0x400666/0x400668 restano 0). Helper121B8 chiamato qui per obj0 è
  //   SAFE (non duplicato con sub158F6: sub158F6 itera P1/P2 slot pair
  //   @ 0x4009A4/0x400A20, MAI 0x400018 = obj0).
  // FUN_251DE: cost dominato dalla chain per-obj (helper121B8 ~4500/obj).
  // count<=2 = attract (AVG 11180), count>6 = HEAVY (~60000).
  // Path "skip respawn" (FAST) raro nel codice attuale (TS wira sempre la
  // chain helper121B8 nel fun253ECDispatch).
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
  // FUN_158CC itera 2 slot pair @ 0x4009A4 (P1) e 0x400A20 (P2) chiamando
  // FUN_158F6(slotPtr). FUN_158F6 ora replicato bit-perfect in `sub-158f6.ts`:
  // dispatch su obj+0x18:
  //   - s18==0 → no-op (skip)
  //   - s18==2 → jsr 25FC2 + 1B9CC + 1281C (state-2 branch)
  //   - else  → jsr 253BC + 182BA + 121B8 (ELSE branch)
  // Plus timer @ +0x6C (state 0x21/0x22 → 0x23 via FUN_160D4) e timer @ +0x56
  // (state 0x24 → 0x23 via FUN_160D4).
  // FUN_158CC: stima conservativa AVG (attract con 2 slot pair attivi).
  // Variante FAST quando entrambi slot s18=0 (raro in gameplay attract).
  const slotP1State = state.workRam[0x9bc] ?? 0; // P1 slot @ 0x4009A4 + 0x18
  const slotP2State = state.workRam[0xa38] ?? 0; // P2 slot @ 0x400A20 + 0x18
  const fun158CCKey = slotP1State === 0 && slotP2State === 0 ? "FUN_158CC_FAST" : "FUN_158CC";
  callSub(state, fun158CCKey, () => {
    (subs.objectUpdatePair158CC ?? ((s) => {
      objectUpdatePair158CC(s, {
        objectUpdate: (slotPtr: number) => {
          fun158F6(s, slotPtr, rom);
        },
      });
    }))(state);
  });

  // 00010FE6: jsr 0x0001493C
  // Default callback per FUN_14966: stub minimal (head-only) — vedi
  // `sub-14966-stub.ts` per coverage e workaround slot 3.
  const fun1493CKey = gameMode === 4 ? "FUN_1493C_HEAVY" : "FUN_1493C";
  callSub(state, fun1493CKey, () => {
    (subs.slotArrayTick1493C ?? ((s) => {
      slotArrayTick(s, { fun_14966: fun14966Stub });
    }))(state);
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
  // Gate: *0x400394.w == 4. Altrimenti fast (rts immediato).
  const fun1912CKey = gameMode === 4 ? "FUN_1912C" : "FUN_1912C_FAST";
  callSub(state, fun1912CKey, () => {
    (subs.fun1912C ?? ((s) => { refreshHelper1912C(s, rom); }))(state);
  });

  // 00010FFE: jsr 0x00019BAA
  // Wire fun_19e42 = marbleCellDispatch19E42 (replica bit-perfect già
  // esistente in marble-cell-dispatch-19e42.ts). Senza wire, il callback
  // è no-op stub e i globals velocity-per-direction @ 0x674..0x683 non
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
    (subs.stateSub1844A ?? ((s) => { stateSub1844A(s, rom); }))(state);
  });

  // 0001100A: jsr 0x00012FD0
  // (subs.fun_11ac2 = soundMaybe11AC2 wiring valutato: gating *0x40075c == 0
  // in MAME @ 2400, fix non applicabile per il drift cluster B residuo.)
  // Wire fun_12d46 = claimScriptSlot (alloca slot @ 0x400a9c per script
  // 0x1d854; gated da gameMode==2 + obj+0x1b∈{9,a} — in demo gameplay
  // gameMode=1, quindi il gate è falso ma il wire è canonical per parity).
  // Wire fun_13068 = scriptSlotStep13068 (avanza state dei 25 slot @
  // 0x400a9c — necessario per progredire s1a=3→2→...→0 dopo l'allocazione
  // via scrollRange144E4 → scriptRectDispatch12DFA chain).
  const fun12FD0Key = gameMode === 4 ? "FUN_12FD0_HEAVY" : "FUN_12FD0";
  callSub(state, fun12FD0Key, () => {
    (subs.stateDispatch12FD0 ?? ((s) => {
      stateDispatch12FD0(s, {
        fun_12d46: (romScriptPtr) => { claimScriptSlot(s, rom, romScriptPtr); },
        fun_13068: (slotPtr) => {
          scriptSlotStep13068(s, rom, slotPtr, {
            fun12896: (st, sp) => { helper12896(st, rom, sp); },
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
      const romTab = rom.program.subarray(0x23d3a, 0x23d3a + 16);
      objDirtyDispatch28624(s, romTab);
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
