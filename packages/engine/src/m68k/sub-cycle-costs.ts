/**
 * sub-cycle-costs.ts — stima cicli M68010 per le sub chiamate dal body del
 * main loop ROM (path `FUN_10FCE` → orchestrato da `FUN_1101E` case 0/1,
 * piu' `FUN_26F3E` post-body).
 *
 * **Scopo**: alimentare il cycle counter di `main-tick` per simulare la
 * cadenza dinamica 30Hz/60Hz osservata in MAME. Il main thread esce dal
 * body solo dopo aver speso ≥ `CYCLES_PER_VBLANK` (≈ 119316 cicli @60Hz
 * con clock M68010 = 7.16 MHz), poi entra nella `jsr 0x28DEA` (vblank
 * spin-wait). In path "veloci" (body < vblank) il body gira ogni 2 vsync
 * (= 30Hz). Nei path "lenti" (gate condizionali tutti attivi, p.es.
 * scroll attivo + decode bitstream + heavy obj scan) puo' sforare e
 * portare a 60Hz reali per pochi frame.
 *
 * **Metodologia**:
 *   - Per ciascuna sub leggiamo l'header `Disasm 0xXXXX..0xYYYY` nei file
 *     TS corrispondenti (commento). Le istruzioni sono raggruppate per
 *     categoria (JSR, MOVE, MULS, Bcc, etc.) e moltiplicate per i cicli
 *     base M68010 dalla tabella ufficiale Motorola (M68000PRM, sezione
 *     Cycle/Op).
 *   - Sub con loop iteriamo `count` volte (count = numero osservato in
 *     attract gameplay) e includiamo i cicli del corpo loop + branch
 *     taken/not-taken.
 *   - Sub gated (gate `tst.b / cmp.w` early-exit) hanno una **stima fast
 *     path** (gate falso → ~30 cicli, rts immediato) e una **stima full
 *     path** (gate vero → full body). Riportiamo solo full body nella
 *     mappa principale ed annotiamo gate probability nel commento.
 *
 * **Numeri approssimativi (±15%)**. La granularita' e' sufficiente per
 * discriminare path 30Hz da path 60Hz; non e' bit-perfect M68010 cycle
 * counting (servirebbe full instruction tracer + EA mode decoding).
 *
 * **Convention**:
 *   - Tutte le costanti sono `u32` brandizzate (cicli >= 0, max 16M).
 *   - `_FAST` suffix = gate falso / loop count minimo.
 *   - `_AVG`  suffix = media osservata in attract gameplay.
 *   - Default (no suffix) = `_AVG`.
 *
 * **Reference**:
 *   - M68010 Cycle Table: M68000PRM Appendix B (Motorola, 1992).
 *   - Disasm header per ogni sub: vedi i file TS sotto
 *     `packages/engine/src/<sub-name>.ts`.
 *   - Drift baseline (sanity probe): `npx tsx packages/cli/src/
 *     probe-cluster-histogram.ts | head -1` → `f+99 workRam total diff
 *     = 387` (invariato post-add di questa table).
 */
import { as_u32, type u32 } from "../wrap.js";

// ─── Costanti di riferimento ──────────────────────────────────────────────

/**
 * Cicli per vblank @ 60Hz, M68010 a 7.16 MHz.
 *   7159000 cicli/sec / 60 fps ≈ 119316.66
 * Soglia di confronto: body < CYCLES_PER_VBLANK ⇒ gira a 30Hz (2 vsync
 * spin); body > CYCLES_PER_VBLANK ⇒ slip a 60Hz (frame singolo).
 */
export const CYCLES_PER_VBLANK: u32 = as_u32(119316);

/** Cicli per vblank @ 30Hz (= 2 × 60Hz). Soglia "molto slow". */
export const CYCLES_PER_VBLANK_30HZ: u32 = as_u32(238632);

// ─── Stime cycle-cost per sub del body ────────────────────────────────────
//
// Range: la maggior parte delle sub ha gate condizionali (`*0x400394 == N`,
// `*0x400760 != 0`, etc.). Riportiamo la stima per il caso `*0x400394 == 4`
// (game gameplay attivo) che e' il path "loaded". Path attract (`*0x400394
// != 4` per le sub gated, p.es. `19BAA`/`1912C`) sono significativamente
// piu' veloci e annotati con `_FAST`.

export const SUB_CYCLE_ESTIMATE: Readonly<Record<string, u32>> = {
  // ─── FUN_10FCE: refreshFrame10FCE (orchestratore body, 80 byte) ─────────
  //
  // Disasm 0x10FCE..0x1001C (19 istr):
  //   - 12 × `jsr 0x........l`         (12 × 20) = 240
  //   -  2 × `addq.b #1,(0x4003F0).l`  (2  × 24) =  48
  //   -  1 × `rts`                      = 16
  //   Total prologo + epilogo overhead orchestratore: ~304 cicli + somma
  //   delle 12 sub chiamate. La stima di seguito include solo l'overhead
  //   della funzione (jsr + addq + rts), non i body delle 12 sub: queste
  //   sono sommate separatamente.
  //
  // L'overhead di FUN_10FCE *senza* le 12 sub:
  "FUN_10FCE_OVERHEAD": as_u32(304),

  // ─── FUN_251DE: objectScanDispatch251DE (478 byte, ~120 istr) ───────────
  //
  // Outer loop: per ogni obj in [0..*0x400396) (count tipico = 2 in attract,
  // 8-22 in gameplay), per ciascuno:
  //   - prologo loop: 6 movem/lea/cmpi/branch ≈ 30 cicli
  //   - cmpi.b #0 / beq → continue se slot vuoto: 12 + 10 = 22
  //   - cmpi.w #0x190 (0x6A,A2): 16 cicli
  //   - jsr FUN_253EC(obj): 20 + 80 (cycle stima FUN_253EC fast path
  //     dispatch JT) = 100
  //   - re-test cmpi.b: ~22 cicli
  //   - state-3/2 increment branch: ~20 cicli (most paths skip respawn)
  //
  // Respawn block (gate molto stretto: count==2 + X range + level==4):
  //   praticamente mai eseguito in attract. Stima 0 cicli media.
  //
  // Per count=2 (attract): outer ~ 2 × (30+22+16+100+22+20) = ~420
  // Per count=22 (heavy gameplay): outer ~ 22 × 210 = ~4620
  //
  // FUN_253EC inner (non separato qui, ma inglobato): la JT @ 0x254BA
  // dispatcha 12 entries; il path s1a=0 per obj0 chiama helper253BC +
  // objectStep17F66 + helper121B8 (vedi sotto). Quando helper121B8 e'
  // incluso, FUN_253EC costa ~6500 (player) o ~150 (slot non-player).
  // Qui modelliamo FUN_253EC come parte del costo di 251DE, con stima
  // media obj=2 (entrambi player).
  //
  // ATTRACT (count=2, gameplay path s1a=0, ELSE-branch in 158F6):
  //   2 × FUN_253EC = 2 × (overhead + helper253BC + objectStep17F66
  //                       + helper121B8)
  //   = 2 × (80 + 200 + 600 + 4500)
  //   = 2 × 5380 = 10760
  // Outer overhead: ~420
  // Total: ~11180 cicli (path gameplay attract)
  //
  // FAST (gate skip respawn, no helper121B8 chain, count=2): ~700 cicli
  "FUN_251DE_FAST": as_u32(700),
  "FUN_251DE": as_u32(11180), // = AVG attract gameplay (count=2)
  "FUN_251DE_HEAVY": as_u32(60000), // count=8-12 con full helper121B8 chain

  // ─── FUN_189E2: processAllSprites (60 byte, ~14 istr loop) ──────────────
  //
  // Gate: *0x400394 == 0 → skip se != 0 (gate `bne.w exit`). In gameplay
  // (*0x394 == 4) gate-false: skip completo. In attract (*0x394 == 0 o
  // valore di transizione), loop attivo.
  //
  // Loop body per entry (count = *0x400396):
  //   move.l D3,D1; moveq #0xC,D0; add.l D0,D3; move.l D1,-(SP);
  //   jsr 0x18A1E; addq.l #4,SP; addq.b #1,D2;
  //   move.b D2,D0; ext.w D0; cmp.w (0x400396).l,D0w; bne.b loop
  //   = 4+4+4+12+20+8+4+4+4+16+10 = 90 cicli + cost(FUN_18A1E)
  //
  // FUN_18A1E (computeSpriteCoords_v1) stima ~120 cicli (4 long load, 2
  // word store, 1 mul effective addr).
  //
  // Per count=2 (attract): 2 × 210 + prologo 30 + epilogo 16 = ~470
  // Per count=22: 22 × 210 + 50 = ~4670
  //
  // GATE OFF (game mode 4 = gameplay attivo): tst.w + bne.w + movem rts
  //   = 12 + 10 + 16 = 38 cicli — questo e' il path "veloce".
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
  // FUN_158F6 stima:
  //   - prologo: movem + movea = ~24
  //   - tst.b (0x18) / beq epilog: 16
  //   - se ELSE branch (default per attract, s18=1 → ELSE): chiama
  //     helper253BC (200) + helper182BA (900) + helper121B8 (4500)
  //     + 3 × push/jsr/cleanup: ~80
  //   - epilog: ~20
  // FUN_158F6 ELSE: ~24+16+5680+20 = ~5740 cicli
  // FUN_158F6 STATE-2 (s18=2): ~24+16+helper25FC2(~400)+1B9CC(~150)
  //   +1281C(~300)+80 = ~970
  // FUN_158F6 EMPTY (s18=0): ~24+16+epilog20 = 60
  //
  // 158CC totale (attract, slot pair entrambi attivi ELSE):
  //   ~208 + 2 × 5740 = ~11688
  // 158CC fast (slot pair entrambi s18=0): ~208 + 2 × 60 = ~328
  "FUN_158CC_FAST": as_u32(330),
  "FUN_158CC": as_u32(11700), // attract gameplay (P1+P2 attivi ELSE)
  "FUN_158F6_ELSE": as_u32(5740),
  "FUN_158F6_STATE2": as_u32(970),
  "FUN_158F6_EMPTY": as_u32(60),

  // ─── FUN_1493C: slotArrayTick (42 byte, loop 4 iter) ────────────────────
  //
  // Stessa struttura di 158CC ma 4 iter, FUN_14966 e' uno stub minimo
  // (head-only ~100 cicli media; piu' overhead loop ~80/iter).
  //   ~32 prologo + 4 × (80 + cost(FUN_14966)) + 16 epilog
  //
  // FUN_14966 stub: ~100 cicli (head-only path)
  // FUN_14966 full (slot 3 con queue drain): ~800
  // 1493C totale attract: 32 + 4×180 + 16 = ~768
  // 1493C heavy: 32 + 4×880 + 16 = ~3568
  "FUN_1493C": as_u32(770),
  "FUN_1493C_HEAVY": as_u32(3570),

  // ─── FUN_17230: dispatchStrings17230 (42 byte, loop 7 iter) ─────────────
  //
  // Loop 7 iter, FUN_1725A stima per slot non attivo ~30 cicli (tst+beq+
  // epilog), per slot attivo ~300-500 (typo/anim step).
  //   ~32 prologo + 7 × (80 + cost(FUN_1725A)) + 16 epilog
  //
  // Attract (HUD strings: 1-2 slot attivi su 7): media ~120/slot
  //   = 32 + 7 × 200 + 16 = ~1448
  // Gameplay (5-6 slot attivi): 32 + 7 × 500 + 16 = ~3548
  "FUN_17230": as_u32(1450),
  "FUN_17230_HEAVY": as_u32(3550),

  // ─── FUN_13EE6: refreshHelper13EE6 (1190 byte, scroll+decode) ───────────
  //
  // Gate principale: *0x400006 == 0 → salta a ramo finale (path 0x1411c).
  // In attract steady-state *0x400006 = 0 quasi sempre → fast path.
  //
  // Fast path (gate skip):
  //   - jsr FUN_1344C (slapsticDispatcher): ~120 cicli (simple clear)
  //   - tst.b / beq: 16+10
  //   - ramo finale loop (~36 obj scan): ~36 × 50 + sums = ~2000
  //   - aggiorna scroll velocity/pos/flag: ~150
  //   Total: ~2300 cicli
  //
  // Full path (gate true, scroll attivo + decode bitstream):
  //   - + levelHelper2FFB8 (slapstic lookup): ~200
  //   - + calcolo scrollIdx: ~80
  //   - + decodeBitstream1A668: ~4500 (vedi sotto)
  //   - + blit buffer in PF RAM: ~400
  //   - + ramo finale loop come sopra: ~2000
  //   Total: ~7200 cicli
  //
  // GATE PROBABILITY:
  //   *0x400006 e' settato quando scroll attivo (= run/blit pending).
  //   In attract: ~5-10% dei frame. In gameplay: ~30-50% dei frame.
  "FUN_13EE6_FAST": as_u32(2300),
  "FUN_13EE6": as_u32(2800), // attract media (90% fast + 10% full)
  "FUN_13EE6_HEAVY": as_u32(7200), // gameplay con scroll attivo

  // ─── FUN_1A668: decodeBitstream1A668 (304 byte, 36 word output) ─────────
  //
  // Loop 36 word output. Per token (path A/B/C/D mix):
  //   - lettura ctrl long, asr.l, mask: ~40 cicli
  //   - dispatch path (3-4 cmpi/bne): ~30
  //   - path body (op ROM lookup + write): ~50
  //   Per token ~120 cicli media.
  // Total: 36 × 120 + prologo movem + epilog = ~4400 cicli
  //
  // CHIAMATA SOLO IF gate FUN_13EE6 attivo (sopra). Conteggio incluso
  // nella stima FUN_13EE6_HEAVY (4500 cicli decode + altro).
  "FUN_1A668": as_u32(4400),

  // ─── FUN_1912C: refreshHelper1912C (130 byte) ───────────────────────────
  //
  // Gate: *0x400394 == 4. Se != 4 → rts immediato (~40 cicli).
  // Se == 4: slot scan (count = *0x400396, ~22 obj) + entity loop (9
  // entity × 0x28 stride).
  //   - Slot scan: 22 × (cmpi/beq/lea/cmpi/beq/cmpi/beq/moveq + tail
  //              ~50 cicli) = ~1100
  //   - Entity loop: 9 × (tst+addq+cmpi+beq+cmpi+threshold+cmp+
  //                     jsr FUN_199D6 stima 200 + path JSR FUN_194BA
  //                     stima 150) = 9 × 400 = 3600
  //   Total full: ~4700 cicli
  //
  // GATE: in attract *0x394 != 4 (= 0 attract title o 1 attract play
  //   menu), quindi quasi sempre fast.
  "FUN_1912C_FAST": as_u32(40),
  "FUN_1912C": as_u32(4700), // gameplay (game mode = 4)

  // ─── FUN_19BAA: stateSub19BAA (490 byte) ────────────────────────────────
  //
  // Gate: *0x400394 == 4. Se != 4 → rts (~40).
  // Se == 4:
  //   - tst.b *0x400762; spawn dispatcher gate 1/8: stima ~50 + (occasion.
  //     1/8) FUN_19A40 ~600 = ~125 media
  //   - outer loop entity (10 × 0x38 stride):
  //     * tst entity[0x18] / beq next: ~22 cicli (skip se entity inattiva)
  //     * se attiva: addq + cmp + bgt path movimento + AI block
  //       - script terminator scan-others: 10 × 60 = 600 (raro)
  //       - movement block: ~300
  //       - jsr FUN_19E42 (marbleCellDispatch): ~400
  //     * media per entity attiva: ~700
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
  // Fast: ~40 cicli (link+movem+gate+epilog)
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
  //   Total: ~7700 cicli
  "FUN_1844A_FAST": as_u32(40),
  "FUN_1844A": as_u32(40), // attract: gate off
  "FUN_1844A_HEAVY": as_u32(7700), // mode 3 attivo

  // ─── FUN_12FD0: stateDispatch12FD0 (158 byte) ──────────────────────────
  //
  // Blocco 1: gate *0x400394 == 2 → scan player array per script. In attract
  // *0x394 == 0 → skip. Costo skip: ~30 (cmp + bne).
  // Blocco 2: tst *0x40075c + jsr FUN_11AC2 (raro): ~30 + (1/100) × 200 = 32
  // Blocco 3: loop 25 slot script-state × stride 0x56 (= 0x400A9C..):
  //   - 25 × (movem prologo loop ~10 + jsr fun_13068 ~150 + tail ~20) = 25
  //     × 180 = 4500
  //   - FUN_13068 (scriptSlotStep): ~150 cicli media (slot inattivo ~30,
  //     slot attivo ~400; in attract 1-2 slot attivi).
  //
  // Total attract: 30 + 30 + 25 × 50 (mostly inactive) = ~1300
  // Total gameplay: 30 + 30 + 25 × 200 = ~5060
  "FUN_12FD0_FAST": as_u32(1300),
  "FUN_12FD0": as_u32(1300), // attract default
  "FUN_12FD0_HEAVY": as_u32(5060),

  // ─── FUN_28624: objDirtyDispatch28624 (140 byte) ───────────────────────
  //
  // Loop count = *0x400396 (= 2 in attract, 8-22 gameplay):
  //   - prologo per iter: moveq+move+asl+move+ext+ext+and+beq = ~30
  //   - bit-set path (raro, ~5% iter): tst+jsr FUN_28E3C (~400) = ~430
  //   - tail iter: move+add+movea+addq = ~14
  //   - loop test: move+ext+cmp+bne = ~30
  //   Total per iter: 30 + 0.05*430 + 14 + 30 = ~95 cicli
  //
  // count=2 attract: 2 × 95 + 16 prologo + 24 epilog + 6 clr = ~230
  // count=22 gameplay: 22 × 95 + 46 = ~2136
  "FUN_28624": as_u32(230), // attract count=2
  "FUN_28624_HEAVY": as_u32(2140), // gameplay count=22

  // ─── FUN_121B8: helper121B8 (1634 byte, 466 istr) ──────────────────────
  //
  // **MONSTER FUNCTION** — domina il body cost quando chiamata. Stima
  // basata sul disasm (movem 28 + dead-stores 4×16 + global writes
  // 6×20 + asr.l #19 ×2 + cmpa branch + jsr A3 (spritePosUpdate ~600)
  // + jsr 0x1CC62 (spriteProject ~400) + path INTEGRATE_VEL...
  //
  // INTEGRATE_VEL path (gameplay default per obj0):
  //   - 3 × long add (obj.x/y/z += vx/vy/vz): 3 × 32 = 96
  //   - jsr A3 (spritePosUpdate1BAB2 ~600), jsr 1C676 (spriteBracketLerp
  //     ~400)
  //   - velocity scaling + bounds: ~400
  //   - state dispatch chain: stateSub1B5C2 (~300) + 29CCE (~stub 30)
  //     + 1BC88 (~stub 30) + 1924E (~stub 30) + 25C74 (~stub 30)
  //   - bbox tests + slot insert sorted: ~600
  //   - render update (1365C): ~400
  //   - dispatch state 160F6: ~250
  //   Total: ~3700 cicli (con stubs FUN_29CCE etc.)
  //
  // OUT_OF_RANGE path (rare, score event):
  //   - player branch: soundCommand + state25BAE: ~500
  //   - non-player: stateSub15BD0: ~300
  //
  // Stima media: ~4500 cicli (INTEGRATE_VEL default in gameplay).
  // Quando chiamato da player obj (obj0) e ELSE branch in 158F6 (sub158F6
  // chiama helper121B8 dall'ELSE), il path INTEGRATE_VEL e' attivo.
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
  // Default movement (gameplay obj0): ~600 cicli
  //   - 9 × cmpi.b whitelist: 9 × 22 = 198
  //   - jsr FUN_180BE (no-op stub): ~30
  //   - byte stores + jsr FUN_26196 (flagScaledMagnitude): ~400
  // Stuck (obj0 falling): ~250
  // Skip (s18 in {2,3}): ~30
  "FUN_17F66": as_u32(600),

  // ─── FUN_182BA: helper182BA (~100 istr) ────────────────────────────────
  //
  // Per obj non-player ELSE branch chiamato da 158F6:
  //   - jsr FUN_15DB6 (stateValidateGrid): ~500 (grid bitmap check)
  //   - gate 0x36 == 2: skip-seek (gravity path): ~80
  //   - target lookup ROM + Manhattan compute: ~300
  //   - divs.w D1,D2 / D1,D3: 2 × 140 = 280 (worst case)
  //   - scaled velocity + clamp: ~200
  //   - jsr FUN_26196: ~400
  // Total: ~1760 cicli
  //
  // Path gravity only (no seek): ~80 + 400 = 480
  "FUN_182BA": as_u32(1760),
  "FUN_182BA_GRAVITY": as_u32(480),

  // ─── FUN_26F3E: lateGameLogic26F3E (4848 byte) ──────────────────────────
  //
  // Chiamato DOPO il body 10FCE/1101E (main thread post-body).
  // 3 fasi:
  //   1. bufferFill1B12A per ogni entity in [0x3BC..0x3DB]: 32 × 60 = ~2000
  //   2. sortAdjacentObjects 3× (stride 1/2/3): 3 × 800 = 2400
  //   3. setup cursors + entity sprite dispatch: ~3000
  // Total: ~7400 cicli (gameplay, *0x3E2 != 0 → fase 2 attiva)
  // Fast (no end-screen, *0x3E2 == 0): solo fase 1 + setup minimo = ~2200
  "FUN_26F3E_FAST": as_u32(2200),
  "FUN_26F3E": as_u32(7400),

  // ─── FUN_1101E: mainLoopInit1101E (orchestratore dispatcher) ────────────
  //
  // Gate: stateWord = *0x400390. Path attract = stateWord == 0 → chiama
  // refreshFrame10FCE direttamente.
  //
  // Costo dispatch + jsr 10FCE (escluso il body di 10FCE): ~40 cicli.
  // Case 1/2/3/4/5/6 hanno costi diversi, ma case 0 e' il path "veloce"
  // dominante in steady-state.
  "FUN_1101E_OVERHEAD": as_u32(40),
};

// ─── Totale body iter (sanity check) ──────────────────────────────────────

/**
 * Somma delle stime per un body iter "normale" (path fast/attract,
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
 *                              31634 cicli
 *
 * <<< CYCLES_PER_VBLANK (119316): body completa in ~26% di un vblank →
 * spin-wait 28DEA × 2 → cadenza 30Hz. Coerente con MAME oracle.
 */
export const BODY_ITER_ESTIMATE_FAST: u32 = as_u32(31634);

/**
 * Somma stima body "lento" (gameplay attivo, tutti i gate ON):
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
 *                             117254 cicli
 *
 * MARGINALMENTE <CYCLES_PER_VBLANK (119316): in gameplay heavy il body
 * sta dentro un vblank, ma con piccolo margine. Aggiungere 1-2 obj scan
 * con full helper121B8 sforerebbe → slip a 60Hz per pochi frame.
 *
 * Path SOPRA vblank (= 60Hz triggered):
 *   - *0x394 == 4 AND *0x396 > 2 (multi-player o multi-enemy attivi):
 *     FUN_251DE_HEAVY scala lineare con count. Per count=8: ~60000;
 *     per count=12: ~110000; per count=15: ~140000 cicli da solo →
 *     somma con resto = >180000 cicli → body slip a 60Hz per >1
 *     vblank.
 *   - + FUN_1844A_HEAVY (mode 3 attivo, transition boss): aggiunge
 *     7700 cicli.
 *   - + FUN_13EE6_HEAVY (scroll attivo + decodeBitstream): aggiunge
 *     ~5000 cicli incrementali.
 *
 *   Conclusione: il body forza 60Hz quando `count > ~10` (8-22 obj
 *   con full helper121B8 chain), che corrisponde a momenti di intensa
 *   azione gameplay (multi-marble + multi-enemy contemporanei).
 */
export const BODY_ITER_ESTIMATE_HEAVY: u32 = as_u32(117254);

/**
 * Soglia "spill 60Hz": body_cycles >= CYCLES_PER_VBLANK ⇒ il main thread
 * non riesce a completare un'iter dentro un vblank, quindi la `jsr 28DEA`
 * trova `*0x400016 != 0` (vblank gia' passato) → non spin-wait → entra
 * direttamente nella prossima iter → cadenza 60Hz (transitoria).
 */
export const BODY_ITER_SPILL_THRESHOLD: u32 = CYCLES_PER_VBLANK;

// ─── Sub list helpers ─────────────────────────────────────────────────────

/**
 * Sub chiamate direttamente dal body di FUN_10FCE (12 JSR + addq×2 + rts):
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
 *  Plus addq.b × 2 (frame counter +1) e rts.
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
 * Sub chiamate dal body main-thread DOPO FUN_10FCE (= FUN_1101E + post):
 *   - FUN_1101E    dispatcher (overhead)
 *   - FUN_26F3E    lateGameLogic (chiamata dopo 10FCE in main thread)
 */
export const BODY_POST_SUB_LIST: readonly string[] = [
  "FUN_1101E_OVERHEAD",
  "FUN_26F3E",
];
