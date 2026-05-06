/**
 * boot-spurious-handler.ts — replica `FUN_000100D8` (48 byte).
 *
 * **Ruolo**: handler della "spurious IRQ" del 68010. Il vector @ 0x60 della
 * vector table (offset 0x18 nella ROM, perché 68k usa vector # 24 per
 * spurious IRQ) puntando di norma a un thunk `jmp 0x000100d8.l` (visto al
 * sito 0x10024). Quando un'interrupt line viene asserita ma nessun device
 * risponde con un vector valido, la CPU dispatch'a su questo entry point.
 *
 * Il binario tratta la spurious IRQ come **soft-reboot** del boot path
 * principale: scrive un sentinel byte (D0.b passato dal contesto IRQ) a
 * `0x0040000E`, poi `bra` a 0x100B0 — la stessa entry del cold boot
 * (`jmp 0x000100A8` → fall-through). Il path termina con `jmp 0x117B2`
 * (main loop), quindi NON c'è `rts`.
 *
 * **Disasm 0x100D8..0x100E0** (entry, 8 byte):
 *
 *   000100d8    move.b D0b,(0x0040000e).l   ; *0x40000E = D0.b (sentinel)
 *   000100de    bra.b  0x000100b0           ; → boot main path
 *
 * **Disasm 0x100B0..0x100D8** (boot main, 40 byte):
 *
 *   000100b0    move.l SP,(0x00400440).l     ; *0x400440 = SP (save)
 *   000100b6    clr.w  (0x00840000).l        ; MMIO clear (no workRam)
 *   000100bc    move.w #-0x1,(0x004003b6).l  ; *0x4003B6 = 0xFFFF
 *   000100c4    move.w #0x80,(0x004003ae).l  ; *0x4003AE = 0x0080
 *   000100cc    jsr    0x000100e0.l          ; FUN_100E0: audio init + counters
 *   000100d2    jmp    0x000117b2.l          ; → main loop (NO RTS)
 *
 * Totale 8 + 40 = 48 byte (il `jmp 0x100D2 → 0x117B2` è l'ultima istruzione
 * raggiungibile dentro la funzione).
 *
 * **FUN_100E0** (`jsr` interno; 30 byte, NON è parte dei 48 ma effetti
 * mirrorati qui per default): chiama `FUN_4D98` (audio init via thunk
 * `FUN_254`) con args 0x0080/0x0000, poi:
 *
 *   - *0x4003B6 += 1   (passa da 0xFFFF a 0x0000 — wrap)
 *   - *0x4003B2 = 0    (byte)
 *   - *0x4003B8 = 0x012C
 *
 * **FUN_4D98** (chiamato da FUN_100E0 con due long args sullo stack;
 * solo low word usata):
 *
 *   - *0x401F44 = 0x80   (byte: bset.l #7 di D0 = 0x0080)
 *   - *0x401F45 = 0      (byte clear)
 *   - *0x401F5A = 0      (long clear)
 *   - MMIO: *0x860000 = 0 poi 0x0080; *0xFE0000 = 0 (no workRam)
 *
 * **Argomenti**:
 *   - `d0In` = byte sentinel scritto a `*0x40000E` (in IRQ è il valore di
 *     D0 al momento del dispatch, indeterminato — va passato dal caller).
 *   - `spLong` = valore SP da salvare in `*0x400440` (long). Se non passato,
 *     non viene scritto (NB: il binario scrive sempre, quindi per parità
 *     bit-perfect il caller del test deve fornirlo).
 *
 * **Ritorno**: void. La funzione non torna mai con `rts` — termina con
 * `jmp 0x117B2`. La parity test usa `runUntil(0x117B2)` o patcha l'ultima
 * istruzione con `rts`.
 *
 * **Side effects** in `state.workRam`:
 *
 *   workRam[0x000E]      = d0In & 0xFF        (byte)
 *   workRam[0x0440..3]   = spLong (BE long)   (se fornito)
 *   workRam[0x03AE..F]   = 0x0080 (BE word)
 *   workRam[0x03B2]      = 0x00               (byte; FUN_100E0)
 *   workRam[0x03B6..7]   = 0x0000 (BE word)   (FFFF + 1, wrap)
 *   workRam[0x03B8..9]   = 0x012C (BE word)   (FUN_100E0)
 *   workRam[0x1F44]      = 0x80               (byte; FUN_4D98)
 *   workRam[0x1F45]      = 0x00               (byte; FUN_4D98)
 *   workRam[0x1F5A..D]   = 0x00000000 (long)  (FUN_4D98)
 *
 * MMIO writes (no workRam): 0x840000 (word=0), 0x860000 (word=0 then 0x80),
 * 0xFE0000 (word=0). Se serve loggarle, passare un `subs.onMmioWrite`.
 *
 * **JSR esterne**: due (`jsr 0x100E0` e — annidato — `jsr 0x254 → 0x4D98`).
 * Per ergonomia espongo entrambi via `subs?` con default che mirrora gli
 * effetti workRam, così i test parity possono lasciare il binario eseguire
 * il codice reale e confrontare il workRam delta senza injection.
 *
 * Verifica bit-perfect via `cli/src/test-boot-spurious-handler-parity.ts`.
 */

import type { GameState } from "./state.js";

/** Offset workRam (relativo a 0x400000). */
export const BSH_SENTINEL_OFF = 0x000e; // *0x40000E
export const BSH_SP_SAVE_OFF = 0x0440; // *0x400440 (long)
export const BSH_AV_CONTROL_OFF = 0x03ae; // *0x4003AE (word)
export const BSH_FRAME_FLAG_OFF = 0x03b2; // *0x4003B2 (byte)
export const BSH_FRAME_CTR_OFF = 0x03b6; // *0x4003B6 (word)
export const BSH_COUNTDOWN_OFF = 0x03b8; // *0x4003B8 (word) = 300
export const BSH_AUDIO_BASE_OFF = 0x1f44; // *0x401F44 (byte)
export const BSH_AUDIO_FLAG_OFF = 0x1f45; // *0x401F45 (byte)
export const BSH_AUDIO_ACK_OFF = 0x1f5a; // *0x401F5A (long)

/**
 * Stub injection per le due JSR raggiunte dal handler.
 *
 * Default implementations replicano gli effetti workRam delle funzioni reali
 * (sound init + counter setup), permettendo ai parity test di non dover
 * fornire injection — il binario esegue il codice reale, la TS replica il
 * delta.
 *
 * I caller che vogliono diagnostica o stub possono override:
 *
 *   bootSpuriousHandler(s, d0, sp, {
 *     audioInit80: () => { audioInitCalls++; },
 *   });
 */
export interface BootSpuriousHandlerSubs {
  /**
   * Replica `FUN_00100E0`: imposta counter timers e chiama l'audio init.
   * Default: applica gli effetti workRam (counter @ 0x3B2/0x3B6/0x3B8 +
   * delegate a `audioReset80`).
   */
  audioInit80?: (state: GameState, subs: BootSpuriousHandlerSubs) => void;

  /**
   * Replica `FUN_00004D98` (chiamato via thunk `FUN_254`): reset stato
   * mailbox audio. Default: applica gli effetti workRam @ 0x1F44/0x1F45/
   * 0x1F5A senza toccare MMIO (le scritture a 0x860000 / 0xFE0000 sono
   * irrilevanti per il workRam diff).
   */
  audioReset80?: (state: GameState) => void;
}

/**
 * Default `audioReset80` — mirror di FUN_4D98 (solo workRam, no MMIO).
 *
 *   D0 = 0x0080 (low word del primo arg)
 *   bclr #7, D0 → 0x0000
 *   write 0x0000 a MMIO 0x860000           (skip workRam)
 *   write arg2 (0x0000) a MMIO 0xFE0000    (skip workRam)
 *   bset #7, D0 → 0x0080
 *   *(A1=0x401F44) = D0.b = 0x80
 *   *(A1+1=0x401F45) = 0
 *   *(A1+0x16=0x401F5A) = 0 (long)
 *   write 0x0080 a MMIO 0x860000           (skip workRam)
 */
function defaultAudioReset80(state: GameState): void {
  const r = state.workRam;
  r[BSH_AUDIO_BASE_OFF] = 0x80;
  r[BSH_AUDIO_FLAG_OFF] = 0x00;
  r[BSH_AUDIO_ACK_OFF] = 0x00;
  r[BSH_AUDIO_ACK_OFF + 1] = 0x00;
  r[BSH_AUDIO_ACK_OFF + 2] = 0x00;
  r[BSH_AUDIO_ACK_OFF + 3] = 0x00;
}

/**
 * Default `audioInit80` — mirror di FUN_100E0 (senza la jsr esterna che
 * deleghiamo a `audioReset80`):
 *
 *   moveq #0, D0
 *   move.l D0, -(SP)                    ; arg2 = 0
 *   move.w *0x4003AE, D0w               ; D0 = 0x0080 (gia' settato)
 *   move.l D0, -(SP)                    ; arg1 = 0x0080
 *   jsr 0x254 → FUN_4D98(arg1=0x80, arg2=0x00)
 *   addq.l #8, SP                       ; pop
 *   addq.w #1, *0x4003B6                ; FFFF + 1 = 0x0000 (wrap)
 *   clr.b *0x4003B2                     ; = 0 (gia' 0 in empty state)
 *   move.w #0x12C, *0x4003B8            ; = 300
 *   rts
 */
function defaultAudioInit80(
  state: GameState,
  subs: BootSpuriousHandlerSubs,
): void {
  const r = state.workRam;

  // jsr FUN_4D98 (via thunk FUN_254): reset audio mailbox base.
  const audioReset = subs.audioReset80 ?? defaultAudioReset80;
  audioReset(state);

  // addq.w #1, *0x4003B6 — increment word in BE, può fare wrap.
  const ctr =
    (((r[BSH_FRAME_CTR_OFF] ?? 0) << 8) | (r[BSH_FRAME_CTR_OFF + 1] ?? 0)) &
    0xffff;
  const ctrNext = (ctr + 1) & 0xffff;
  r[BSH_FRAME_CTR_OFF] = (ctrNext >>> 8) & 0xff;
  r[BSH_FRAME_CTR_OFF + 1] = ctrNext & 0xff;

  // clr.b *0x4003B2
  r[BSH_FRAME_FLAG_OFF] = 0;

  // move.w #0x12C, *0x4003B8
  r[BSH_COUNTDOWN_OFF] = 0x01;
  r[BSH_COUNTDOWN_OFF + 1] = 0x2c;
}

/**
 * Replica bit-perfect di `FUN_000100D8` (48 byte, spurious IRQ handler).
 *
 * Esegue gli effetti workRam dell'intera traccia raggiungibile da 0x100D8
 * fino a `jmp 0x117B2`:
 *
 *   1. *0x40000E = d0In & 0xFF                (sentinel)
 *   2. (bra a 0x100B0)
 *   3. *0x400440 = spLong (long, BE)          (se fornito)
 *   4. clr.w MMIO 0x840000                    (no workRam)
 *   5. *0x4003B6 = 0xFFFF
 *   6. *0x4003AE = 0x0080
 *   7. jsr FUN_100E0 → audioInit80(state)     (vedi default sopra)
 *   8. (jmp a 0x117B2 — la funzione termina senza RTS)
 *
 * @param state    GameState (workRam viene mutato).
 * @param d0In     byte sentinel scritto a `*0x40000E`. In IRQ è il valore
 *                 corrente di `D0` al dispatch, indeterminato; il caller
 *                 deve fornirlo (es. dal contesto del test).
 * @param spLong   valore SP da salvare in `*0x400440` (long). Se `null`,
 *                 la scrittura viene skippata (utile in test che non
 *                 inizializzano lo stack).
 * @param subs     stub injection opzionali (default mirroring gli effetti
 *                 workRam delle JSR reali).
 *
 * @returns void. La funzione termina con `jmp 0x117B2` — non c'è valore di
 *          ritorno.
 */
export function bootSpuriousHandler(
  state: GameState,
  d0In: number,
  spLong: number | null = null,
  subs: BootSpuriousHandlerSubs = {},
): void {
  const r = state.workRam;

  // 1. move.b D0b, (0x0040000E).l
  r[BSH_SENTINEL_OFF] = d0In & 0xff;

  // 2. bra.b 0x100B0 (control flow only)

  // 3. move.l SP, (0x00400440).l
  if (spLong !== null) {
    const sp = spLong >>> 0;
    r[BSH_SP_SAVE_OFF] = (sp >>> 24) & 0xff;
    r[BSH_SP_SAVE_OFF + 1] = (sp >>> 16) & 0xff;
    r[BSH_SP_SAVE_OFF + 2] = (sp >>> 8) & 0xff;
    r[BSH_SP_SAVE_OFF + 3] = sp & 0xff;
  }

  // 4. clr.w (0x00840000).l — MMIO, no workRam.

  // 5. move.w #-1, (0x004003B6).l
  r[BSH_FRAME_CTR_OFF] = 0xff;
  r[BSH_FRAME_CTR_OFF + 1] = 0xff;

  // 6. move.w #0x80, (0x004003AE).l
  r[BSH_AV_CONTROL_OFF] = 0x00;
  r[BSH_AV_CONTROL_OFF + 1] = 0x80;

  // 7. jsr 0x100E0 — FUN_100E0 (audio init + counter setup, wraps 0x3B6).
  const audioInit = subs.audioInit80 ?? defaultAudioInit80;
  audioInit(state, subs);

  // 8. jmp 0x117B2 — control flow only (no rts).
}

// Re-export defaults per chi vuole testarli isolatamente.
export const _defaults = {
  audioInit80: defaultAudioInit80,
  audioReset80: defaultAudioReset80,
};
