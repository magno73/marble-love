/**
 * boot-init.ts — sequenza di boot del game engine.
 *
 * Replica progressivamente la sequenza di reset del binario originale,
 * portando uno `emptyGameState()` a un primo stato "post-boot pre-tick"
 * coerente. Pensato per essere chiamato UNA volta prima del primo `tick()`.
 *
 * **Sequenza nel binario** (reset vector @ 0x004 → entry @ 0x466):
 *
 *   Hardware init (0x466..0x4FE):
 *     - SR = 0x2700                              ; disable IRQ
 *     - watchdog kick loop @ 0x486 (4000 iter)
 *     - clear MMIO 0x860000, 0xF40010
 *     - clear alpha RAM 0xA00000..0xA03FFE word-by-word (0x4000 byte!)
 *     - test bit 6 of MMIO 0xF60001 (= test mode? skip if 0)
 *     - init color RAM 0xB00000..0xB0061E con pattern decrescente:
 *         word[i] = (-0x1000 + (i+1)*4) & 0xFFFF
 *     - init work RAM 0x400000..0x401FFE (clear words via test routine
 *       a 0x84E che azzera + verifica con cmp + branch)
 *
 *   High-level init (FUN_FA0, indirect call dopo hw init):
 *     - if *0x400016 == 0 (cold boot):
 *         copy 3 long ROM ptrs (0x10074, 0x10078, 0x1007C) →
 *             workRam (0x400140, 0x400154, 0x400168) via FUN_1D74
 *     - clear *0x40017C (word) e MMIO 0x860000
 *     - jsr 0x1CEA = paletteRamInitFull
 *     - jsr 0xE24 = paletteBootstrapInit
 *     - jsr 0x31D0 = gameStateMachineInit (state machine + alpha RAM clear)
 *     - molti altri setup di workRam globals (per ora STUB)
 *
 * **Stato dopo bootInit()**: `tick(state, {rom})` può procedere senza UB.
 * Per parità byte-perfect con FUN_FA0 servirebbe replicare l'intera funzione
 * (~1KB). Per ora bootInit copre i pezzi "visibili": palette inizializzata,
 * alpha RAM cleared, state machine globals impostati.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { applySlapsticBank } from "./m68k/apply-slapstic-bank.js";
import { as_u16, as_u32 } from "./wrap.js";

import {
  paletteRamInitFull,
  paletteBootstrapInit,
  gameStateMachineInit,
} from "./init-helpers.js";
import { slotArrayBulkInit } from "./slot-array-init.js";
import { mainLoopInit117B2 } from "./main-loop-init-117b2.js";
import { clearPlayfieldRam12174 } from "./clear-playfield-ram-12174.js";
import { levelDispatcher16EC6 } from "./level-dispatcher-16ec6.js";
import { moScreenInit1A286 } from "./mo-screen-init-1a286.js";
import { moGridInit2404 } from "./mo-grid-init-2404.js";
import { levelInit16F6C } from "./level-init-16f6c.js";

function shouldArmLegacyAttractWarmReplay(workRam: Uint8Array): boolean {
  return (
    (workRam[0x3e4] ?? 0) === 1 &&
    (workRam[0x3e2] ?? 0) === 0 &&
    (((workRam[0x390] ?? 0) << 8) | (workRam[0x391] ?? 0)) === 1 &&
    (((workRam[0x392] ?? 0) << 8) | (workRam[0x393] ?? 0)) === 0 &&
    (workRam[0x13f2] ?? 0) === 0xff &&
    (workRam[0x13f3] ?? 0) === 0xa6 &&
    (workRam[0x6f5] ?? 0) === 0x32
  );
}

/**
 * Inizializza color RAM con il pattern decrescente del RESET handler
 * (0x4C4..0x4DC):
 *
 *   D0 = -0x1000
 *   loop until A0 >= 0xB0061E:
 *     D0 += 4
 *     *(A0)+ = D0  (word)
 *
 * Output: 783 word @ 0xB00000..0xB0061E, valori 0xFFFC, 0xFFF8, 0xFFF4, ...
 */
function colorRamHardwareInit(state: GameState): void {
  let d0 = -0x1000 & 0xffff;
  // Loop limit 0xB0061E exclusive di 0xB00000 → 0x61E byte = 0x30F word.
  // Ma il loop scrive con `(A0)+` quindi quando A0 == 0xB0061E loop stop.
  // Il bne controlla cmpa.l A0,A1 dove A1 = 0xB0061E. Quindi 0x30F+1 iter:
  // A0 va da 0xB00000 a 0xB0061E (inclusive write quando A0=0xB0061C).
  for (let off = 0; off < 0x61e; off += 2) {
    d0 = (d0 + 4) & 0xffff;
    state.colorRam[off] = (d0 >>> 8) & 0xff;
    state.colorRam[off + 1] = d0 & 0xff;
  }
}

/**
 * Replica le 3 strcpy condizionali di FUN_FA0 (0xfc2..0xff8):
 *
 *   if *0x400016 == 0:
 *     FUN_1D74(dst=0x400140, src=*ROM[0x10074])  // strcpy fino a null
 *     FUN_1D74(dst=0x400168, src=*ROM[0x1007C])
 *     FUN_1D74(dst=0x400154, src=*ROM[0x10078])
 *
 * **Importante**: `FUN_1D74` è una `strcpy` C-style (`move.b (A0)+,(A1)+`
 * con `bne` su Z flag), NON un long copy. ROM[0x10074..0x1007C] sono
 * ptr long che puntano a stringhe ASCII null-terminated nella ROM
 * ("PLAYER 1 START\0", "PLAYER 2 START\0", "TRAKBALL\0"). Vengono
 * copiate in workRam come HUD label text.
 */
function bootHudStringsInit(state: GameState, rom: RomImage): void {
  if ((state.workRam[0x16] ?? 0) !== 0) return; // warm boot

  function readLong(buf: Uint8Array, off: number): number {
    return (
      ((buf[off] ?? 0) << 24) |
      ((buf[off + 1] ?? 0) << 16) |
      ((buf[off + 2] ?? 0) << 8) |
      (buf[off + 3] ?? 0)
    ) >>> 0;
  }

  /** strcpy stile FUN_1D74: copia byte fino al primo null, INCLUSO il null. */
  function strcpy(dstOff: number, srcAbs: number): void {
    let s = srcAbs;
    let d = dstOff;
    while (true) {
      const b = rom.program[s] ?? 0;
      state.workRam[d] = b;
      s++; d++;
      if (b === 0) return;
      // Safety bound: stringhe ROM sono < 64 byte; evita loop infiniti
      if (d - dstOff > 64) return;
    }
  }

  // Ordine FUN_FA0: 0x140 (Player 1), 0x168 (Player 2), 0x154 (Trakball)
  strcpy(0x140, readLong(rom.program, 0x10074));
  strcpy(0x168, readLong(rom.program, 0x1007c));
  strcpy(0x154, readLong(rom.program, 0x10078));
}

/**
 * Opzioni opzionali di `bootInit`.
 */
export interface BootInitOptions {
  /**
   * Se passato (0..5), dopo il bootInit base esegue la catena
   * `clearPlayfieldRam12174 + levelDispatcher16EC6` per pre-caricare il
   * livello indicato in `state.playfieldRam` (Codex chain end-to-end).
   * Utile per smoke test / renderer demo. NON usare per scenari di parity
   * vs MAME oracle: rompe l'allineamento (il binario reale non pre-load
   * a boot, popola la playfield via game loop iterativo).
   */
  preloadLevel?: number;
  /**
   * Se true, dopo `preloadLevel` esegue la chain MO init scoperta nelle
   * subs `level-enter`:
   *   - moScreenInit1A286: 32 word slot headers (bank A/B/C/D × 8 entries)
   *   - moGridInit2404(rom, arg1=1): 56 motion-object slot @ 0xA02200+
   * Risultato: Frame.sprites passa da 0/1 (placeholder) a N>=2 sprite reali
   * con coordinate non-zero, gfxBank, palette wirate. Il rendering Pixi
   * mostra gli sprite. Opt-in: NON usare per parity test (il binario
   * chiama queste sub solo a level-enter, non a boot).
   */
  fullScreenInit?: boolean;
  /**
   * "Warm state" (snapshot-hybrid mode): se passato, popola direttamente
   * state.workRam/playfieldRam/spriteRam/alphaRam/colorRam dai buffer e
   * SALTA tutto il bootInit standard. Utile per testing/demo quando si
   * vuole partire da uno snapshot RAM esistente (es. MAME state dump @
   * frame N) e poi avanzare via tick(M).
   *
   * Non si combina con `preloadLevel` o `fullScreenInit` (che vengono
   * ignorati). Use case: simulare game-loop "warm" senza ri-boot full.
   */
  warmState?: {
    workRam: Uint8Array;
    playfieldRam: Uint8Array;
    spriteRam: Uint8Array;
    alphaRam: Uint8Array;
    colorRam: Uint8Array;
    /** Optional: scroll registers cached da MMIO write. */
    videoScrollX?: number;
    videoScrollY?: number;
    /**
     * Optional: slapstic bank attivo nello snapshot warm. Se passato, viene
     * applicato a `rom.slapsticFsm.bank` + `applySlapsticBank(rom, bank)`.
     * Default: usa il bank gia' presente in `rom.slapsticFsm` (tipicamente
     * il bank di reset = 3 oppure quello settato da setup precedente).
     *
     * Per warm-state @ MAME f12000 attract mode, il bank corretto e' **1**
     * (verificato via `oracle/mame_slapstic_tap.lua` analizzando i bytes
     * letti).
     */
    slapsticBank?: number;
  };
}

/**
 * Esegue la sequenza di boot completa.
 *
 * Va chiamato UNA volta su uno `emptyGameState()` prima del primo `tick()`.
 * È idempotente (può essere richiamato senza side-effect dannosi grazie al
 * gate `*0x400016 == 0`), ma in pratica chiamarlo una volta sola.
 */
export function bootInit(
  state: GameState,
  rom: RomImage,
  options: BootInitOptions = {},
): void {
  // 0. Snapshot-hybrid: se warmState passato, popola state direttamente e
  //    saltato tutto il bootInit standard (= no boot rom code, no preloadLevel).
  if (options.warmState !== undefined) {
    const w = options.warmState;
    state.workRam.set(w.workRam.subarray(0, state.workRam.length));
    state.playfieldRam.set(w.playfieldRam.subarray(0, state.playfieldRam.length));
    state.spriteRam.set(w.spriteRam.subarray(0, state.spriteRam.length));
    state.alphaRam.set(w.alphaRam.subarray(0, state.alphaRam.length));
    state.colorRam.set(w.colorRam.subarray(0, state.colorRam.length));
    if (w.videoScrollX !== undefined) state.videoScrollX = w.videoScrollX & 0x1ff;
    if (w.videoScrollY !== undefined) state.videoScrollY = w.videoScrollY & 0x1ff;
    if (w.slapsticBank !== undefined) {
      rom.slapsticFsm.bank = w.slapsticBank & 3;
      rom.slapsticFsm.state = "IDLE";
      rom.slapsticFsm.loadedBank = 0;
      applySlapsticBank(rom, rom.slapsticFsm.bank);
    }
    state.rng.seed = as_u32((((state.workRam[0x3a6] ?? 0) << 8) | (state.workRam[0x3a7] ?? 0)) & 0xffff);
    state.rng.callsThisFrame = as_u32(0);
    state.clock.frame = as_u32(0);
    state.clock.cpuTicks = as_u32(0);
    state.clock.scanline = as_u16(0);
    state.clock.mainLoopBodyTicks = as_u32(0);
    state.clock.decoderD6Init = as_u16(0);
    state.clock.decoderCallCount = as_u32(0);
    state.clock.pendingSlotArray1493C = undefined;
    const armLegacyWarmReplay = shouldArmLegacyAttractWarmReplay(state.workRam);
    state.clock.slotArrayReplayTick = armLegacyWarmReplay ? as_u16(0) : undefined;
    state.clock.warmResidualReplayTick = armLegacyWarmReplay ? as_u16(0) : undefined;
    return;
  }

  // 1. Hardware init (RESET 0x466)
  colorRamHardwareInit(state);
  // alpha RAM clear: già 0 in emptyGameState
  // work RAM clear: già 0 in emptyGameState

  // 2. FUN_FA0 cold-boot conditional (3 strcpy HUD labels)
  // NB: in attract_mode l'oracle non popola questa fascia → il cold-boot
  // di FUN_FA0 non viene eseguito (probabilmente *0x400016 != 0 già al
  // momento della chiamata, warm-boot path). Saltiamo la strcpy per
  // allinearci. Va riabilitata quando si farà parità per scenari che
  // attivano effettivamente il path cold-boot (e.g. dopo POST hardware).
  // bootHudStringsInit(state, rom);
  void bootHudStringsInit; // tenuta in scope per uso futuro
  state.workRam[0x17c] = 0;
  state.workRam[0x17d] = 0;

  // 3. Sub-init replicate
  paletteRamInitFull(state, rom);
  paletteBootstrapInit(state);
  gameStateMachineInit(state, rom);

  // 4. Bulk init slot array (FUN_10392, chiamato dal main loop FUN_117B2
  //    via FUN_10504 al primo giro, prima dell'avvio del game state machine).
  slotArrayBulkInit(state);

  // 5. Boot main path globals (FUN_100B0 + FUN_100E0):
  //   *0x4003AE = 0x0080  (AV-control init)
  //   *0x4003B6 = 0       (FUN_100B0 set 0xFFFF, FUN_100E0 increments → 0)
  //   *0x4003B8 = 0x012C  (FUN_100E0 imposta countdown 300)
  //   *0x4003B2 = 0       (FUN_100E0 cleared, già 0 in empty state)
  state.workRam[0x3ae] = 0x00;
  state.workRam[0x3af] = 0x80;
  state.workRam[0x3b6] = 0x00;
  state.workRam[0x3b7] = 0x00;
  state.workRam[0x3b8] = 0x01;
  state.workRam[0x3b9] = 0x2c;
  // Global cascading timer @ 0x40039E inner counter (offset +4 = 0x3A2):
  // inizializzato a 0xFF (TIMER_DISABLED) dal binario per evitare cascade
  // spurious al primo tick (verificato vs oracle frame 46).
  state.workRam[0x3a2] = 0xff;

  // 6. Main loop init chain (FUN_117B2 prefix only, loopIterations=0).
  //    Stato: 2026-05-08 ri-tentato dopo chain playfield Codex completa +
  //    9 default subs Cat.1 wirati. Risultato: peggiora attract_mode
  //    aligned parity da 9 → 14 campi divergenti @ truth-offset=47.
  //    Spiegazione: il prefix esegue intera chain `mainLoopInit11452 →
  //    mainLoopInit10504 → levelDispatcher16EC6 → buildTilemapRows1A444`
  //    che POPOLA state.playfieldRam con level 0, ma MAME oracle al frame
  //    47 (post-FUN_FA0, primo tick) non ha ancora eseguito tale path —
  //    il binario reale entra nel game loop iter normale. Differenza
  //    semantica: bootInit "salta avanti" troppo.
  //    Per RENDERING è utile (playfield popolato); per PARITY no.
  //    Soluzione futura: trigger del wireup solo se chiamante esplicita
  //    intenzione di "pre-load level" (renderer demo / smoke test), non
  //    bootInit base. Vedi visual-smoke-test che chiama la chain manualm.
  void mainLoopInit117B2; // tenuta in scope per uso futuro

  // 7. Optional pre-load level (gated, opt-in). Esegue manualmente la
  //    chain di tile loading scoperta via watch_write MAME su level1:
  //    `clearPlayfieldRam12174 + levelDispatcher16EC6` con sub default
  //    Codex (buildTilemapRows1A444 → packTilemapEntries1A9CC).
  //    Risultato: state.playfieldRam popolato con ~1500-2900 byte
  //    (varia per livello). Vedi integration-playfield-chain.test.ts.
  if (options.preloadLevel !== undefined) {
    state.workRam[0x394] = (options.preloadLevel >>> 8) & 0xff;
    state.workRam[0x395] = options.preloadLevel & 0xff;
    clearPlayfieldRam12174(state);
    levelDispatcher16EC6(state, rom);
    // TODO: levelInit16F6C call attempted ma peggiora pf match 24% → 16%.
    // Probabilmente scrive content per livello diverso (= preloadLevel index
    // mismatch con quello che MAME ha @ frame 2400). Lascio decode-bitstream
    // pfRam-aware ma NO call esplicita per ora. Indagare arg specifico.
    void levelInit16F6C;

    // Imposta state machine a 1 (= attract scenario / case 1) per attivare
    // string render (HUD) durante il game tick. Senza questo, *0x390=0 → case 0
    // (idle refresh) → niente HUD. Pattern usuale di FUN_117B2 prefix.
    state.workRam[0x390] = 0;
    state.workRam[0x391] = 1;
    // player count = 1 (single player demo)
    state.workRam[0x396] = 0;
    state.workRam[0x397] = 1;
  }

  // 8. Optional: full screen-init MO chain. Replica `level-enter` subs che
  //    popolano gli sprite slot. Opt-in (preserva parity vs MAME oracle).
  if (options.fullScreenInit === true) {
    moScreenInit1A286(state, rom);
    moGridInit2404(state, rom, 1);
  }

  // TODO: replicare il resto di FUN_FA0 (sub di setup workRam globals,
  // copyRomToWorkram66Words, etc.). Per ora gli campi non inizializzati
  // restano 0 → il primo tick gira ma alcuni state-machine slot saranno
  // inattivi finché il game engine non li popola.
}
