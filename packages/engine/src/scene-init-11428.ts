/**
 * scene-init-11428.ts — replica `FUN_00011428` (42 byte, 6 jsr + clr.l/addq.l/rts).
 *
 * Helper "scene-init" chiamato da `FUN_0001101e` (state==0, @0x11094) e da
 * `FUN_00011452` (@0x114D4 e @0x1156E) come reset/refresh dell'ambiente
 * grafico prima di transitare ad un nuovo state della title-screen / menu.
 *
 * **Disasm 0x11428..0x11450** (42 byte, 0 args, 0 ret):
 *
 *   jsr     0x28DEA.l            ; vblankAck (clear MMIO ack + advance frameLo)
 *   jsr     0x121A6.l            ; clearPaletteRam (0xB00000..0xB007FF, 0x800B)
 *   jsr     0x12174.l            ; clearMoAlphaRam (0xA00000..0xA01FFF, 0x2000B)
 *   jsr     0x28580.l            ; initFnPointers (4 long ptr in workRam +0x412)
 *   clr.l   -(SP)                ; push arg long = 0
 *   jsr     0x28C7E.l            ; fillLoop( arg.w )  — leggerà (0xA,SP)
 *   jsr     0x28CA6.l            ; sceneObjInit (no stack arg, ignora 4 byte)
 *   addq.l  #4,SP                ; cleanup arg
 *   rts
 *
 * **Convenzione stack**: il `clr.l -(SP)` prima del 5° JSR pusha un long zero
 * come argomento C-style. `FUN_00028C7E` legge quella word a `(0xA,SP)` (low
 * word di un BE long, = 0) e la usa come offset iniziale di un loop. Il 6°
 * JSR (`FUN_00028CA6`) NON consuma lo stack (non lo legge): la `addq.l #4,SP`
 * cleanup serve solo a bilanciare il push iniziale.
 *
 * **Side effect diretti del modulo**: ZERO. Tutto il lavoro è delegato alle
 * 6 sub-jsr — `FUN_00011428` è puro orchestratore. Conseguenze:
 *   - bit-perfect = preservare l'ordine ESATTO delle 6 chiamate;
 *   - non c'è palette / workRam / MMIO scritta direttamente da questo body;
 *   - il caller di TS deve fornire le 6 callback (default no-op) con la
 *     semantica del binario; verifica via differential testing patcha le
 *     6 entry-point in ROM con `addq.b #1, sentinel.l ; rts` e conta hit.
 *
 * **Pattern parità (vedi `scene-init-11428.test.ts` + parity CLI)**: chiamiamo
 * il binario reale con SP fresca e contiamo le 6 sub via 6 sentinel byte in
 * work RAM 0x4003E0..0x4003E5; in TS le 6 callback fanno `++sentinel`.
 * 500/500 verificato.
 */

import type { RomImage } from "./bus.js";
import type { GameState } from "./state.js";
import { sceneObjInit28CA6 } from "./scene-obj-init-28ca6.js";

/**
 * Bag delle 6 sub-jsr orchestrate da `FUN_00011428`. Ogni callback è opzionale
 * (default no-op) per consentire test isolati o iniezione di stub. Ordine di
 * chiamata identico al binario.
 */
export interface SceneInit11428Subs {
  /** FUN_28DEA: ack vblank — clear (0x400016).b, busy-wait, ++(0x4003F0).b. */
  vblankAck?: (state: GameState) => void;
  /** FUN_121A6: clr.l loop su 0xB00000..0xB007FF (palette RAM, 2 KiB → 0). */
  clearPaletteRam?: (state: GameState) => void;
  /** FUN_12174: clr.l loop su 0xA00000..0xA01FFF (MO+alpha RAM, 8 KiB → 0). */
  clearMoAlphaRam?: (state: GameState) => void;
  /** FUN_28580: init 4 function-pointer field a workRam +0x412/+0x41E/+0x42A/+0x436. */
  initFnPointers?: (state: GameState) => void;
  /** FUN_28C7E: fill-loop di 0x780 iterazioni (arg.w = 0 dal caller). */
  fillLoop?: (state: GameState) => void;
  /** FUN_28CA6: scene object init (32 slot @ 0x4001DC) + 2× FUN_26F3E + FUN_28DEA. */
  sceneObjInit?: (state: GameState) => void;
}

/**
 * Replica `FUN_00011428` — scene-init orchestrator.
 *
 * Zero argomenti, zero return value, zero side effects diretti. La
 * bit-parity dipende interamente dall'ordine di chiamata delle 6 sub.
 *
 * @param state GameState passato alle callback (mutato dalle sub).
 * @param subs  Callback bag per le 6 sub-jsr. Default: tutte no-op.
 */
export function sceneInit11428(
  state: GameState,
  subs: SceneInit11428Subs = {},
  rom?: RomImage,
): void {
  // 0x11428: jsr 0x28DEA — vblank ack.
  subs.vblankAck?.(state);
  // 0x1142E: jsr 0x121A6 — clear palette RAM.
  subs.clearPaletteRam?.(state);
  // 0x11434: jsr 0x12174 — clear MO + alpha RAM.
  subs.clearMoAlphaRam?.(state);
  // 0x1143A: jsr 0x28580 — init function pointers in workRam.
  subs.initFnPointers?.(state);
  // 0x11440: clr.l -(SP) — push arg = 0 long.
  // 0x11442: jsr 0x28C7E — fill-loop, legge arg.w da (0xA,SP) → 0.
  subs.fillLoop?.(state);
  // 0x11448: jsr 0x28CA6 — scene object init (no stack arg).
  (subs.sceneObjInit ?? ((s) => { if (rom !== undefined) sceneObjInit28CA6(s, rom); }))(state);
  // 0x1144E: addq.l #4,SP — cleanup push.
  // 0x11450: rts.
}

// ─── Costanti esposte per i test di parità ────────────────────────────────

/** Indirizzo entry-point del binario (per parity tests / cross-ref). */
export const SCENE_INIT_11428_ADDR = 0x00011428 as const;

/** Indirizzi delle 6 sub-jsr nell'ordine di chiamata. */
export const SCENE_INIT_11428_SUB_ADDRS = [
  0x00028dea, // vblankAck
  0x000121a6, // clearPaletteRam
  0x00012174, // clearMoAlphaRam
  0x00028580, // initFnPointers
  0x00028c7e, // fillLoop (arg = 0)
  0x00028ca6, // sceneObjInit
] as const;
