/**
 * object-state-entry-25bae.ts — replica `FUN_00025BAE` (198 byte,
 * 0x25BAE..0x25C73).
 *
 * "Object state-transition entry" wrapper chiamato da uno scheduler superiore
 * (probabile vicino di parentela `FUN_00025BAE` ↔ `FUN_00025C74` adiacente).
 *
 * Riceve due argomenti pushati come long sullo stack:
 *   - arg1 (long @ SP+8 dopo `move.l A2,-(SP)`): puntatore oggetto (`A2`).
 *   - arg2 (byte @ SP+15 → LSB del secondo long): sub-state code in {2, 9, 4}.
 *
 * Effetti comuni (sempre eseguiti, prima del dispatch):
 *   - `A2[+0x00..03]` long  ← 0
 *   - `A2[+0x04..07]` long  ← 0
 *   - se `A2[+0x1A].b == 6`  →  `A2[+0x18].b = 3`
 *
 * Poi dispatch in base a `subStateCode`:
 *
 * ── Case 2 (`subStateCode == 2`) ────────────────────────────────────────
 *   - move.w  (0x20,A2),D0w        ; D0.w = A2[+0x20].w (DEAD-LOAD: il valore
 *                                    NON viene osservato — non passato a 0x158ac
 *                                    né testato; il successivo `andi.w #-1` è
 *                                    no-op sul valore e i flag CCR non vengono
 *                                    consumati prima del prossimo write.)
 *   - andi.w  #-0x1,D0w            ; AND con 0xFFFF (no-op su valore, set CCR)
 *   - pea     (0x38).l ; jsr 0x158ac ; soundCommand(0x38)
 *   - clr.b   (0x5F,A2)             ; A2[+0x5F].b = 0
 *   - move.b  #0x2,(0x60,A2)        ; A2[+0x60].b = 2
 *   - move.l  #0x20FDE,(0x5A,A2)    ; A2[+0x5A] = 0x20FDE (long)
 *   - move.b  #0x2,(0x56,A2)        ; A2[+0x56].b = 2
 *   - move.b  #0x2,(0x1A,A2)        ; A2[+0x1A].b = 2
 *
 * ── Case 9 (`subStateCode == 9`) ────────────────────────────────────────
 *   - clr.b   (0x5F,A2)             ; A2[+0x5F].b = 0
 *   - move.b  #0x4,(0x60,A2)        ; A2[+0x60].b = 4
 *   - move.l  #0x21062,(0x5A,A2)    ; A2[+0x5A] = 0x21062 (long)
 *   - move.b  #0x9,(0x1A,A2)        ; A2[+0x1A].b = 9
 *
 * ── Case 4 (`subStateCode == 4`) ────────────────────────────────────────
 *   - jsr     0x2591A (objectInit2591A(A2))   ; full object initializer
 *   - cmpi.b  #0x65,(0x57,A2)
 *   - if A2[+0x57].b == 0x65: pea (0x3C).l ; jsr 0x158ac  → soundCommand(0x3C)
 *   - else                  : pea (0x3D).l ; jsr 0x158ac  → soundCommand(0x3D)
 *   - clr.l   (0x5A,A2)             ; A2[+0x5A] = 0 (long)
 *   - move.b  #0x4,(0x1A,A2)        ; A2[+0x1A].b = 4
 *   - addq.w  #0x1,(0xD2,A2)        ; A2[+0xD2].w += 1 (16-bit wrap)
 *
 * ── Default (qualsiasi altro byte: 0,1,3,5,6,7,8,A..FF) ────────────────
 *   Nessun side effect oltre alle scritture comuni iniziali (clear longs +
 *   conditional +0x18). Cade direttamente al `bra 0x25C70` epilog.
 *
 * **Stack accounting**:
 *   - `move.l A2,-(SP)` prologue (cleanup via `movea.l (SP)+,A2`).
 *   - Case 2: `pea 0x38` + `jsr` → `addq.l #4,SP` cleanup (1 long).
 *   - Case 9: nessun push (compilatore inline).
 *   - Case 4: `move.l A2,-(SP)` + `jsr` → `addq.l #4,SP` cleanup PRIMA del
 *     `cmpi.b`; poi `pea 0x3C/3D` + `jsr` → `addq.l #4,SP` cleanup.
 *
 * **Modellazione bit-perfect** delle sottigliezze M68k:
 *
 *   1. **Dead-load `move.w (0x20,A2),D0w; andi.w #-1,D0w`** (case 2):
 *      D0.w viene caricato con `A2[+0x20].w` ma NON consumato:
 *        - non passato come arg al `pea (0x38)`/jsr 0x158ac (che usa solo
 *          il long pushato da pea);
 *        - i flag CCR settati da andi.w non hanno un branch successivo;
 *        - D0 è caller-saved → la jsr lo distrugge.
 *      Quindi la replica TS NON simula questo load (nessun side effect).
 *
 *   2. **`addq.w #1,(0xD2,A2)`** (case 4): incrementa la word a +0xD2.
 *      `addq.w` è 16-bit: wrap a 0xFFFF→0x0000 (aggiungiamo `& 0xffff`).
 *
 *   3. **`move.l #0x20FDE,(0x5A,A2)`** / **`move.l #0x21062,(0x5A,A2)`**:
 *      i due valori sono pointer ROM (probabili sprite/tile descriptor in
 *      ROM zone 0x20000+). Replicati verbatim come long big-endian.
 *
 *   4. **JSR esterne (2 sub)**:
 *      - `FUN_158AC` (sound command sender) → callback `soundCommand(cmd)`,
 *        invocato 1 volta per case 2 (cmd=0x38), 1 volta per case 4
 *        (cmd=0x3C o 0x3D).
 *      - `FUN_2591A` (objectInit2591A) → callback `fun_2591A(state, objPtr)`,
 *        invocato 1 volta per case 4. NON chiamiamo internamente
 *        `objectInit2591A` perché il caller (parity test) lo patcha a stub
 *        in ROM e vuole controllare i side effect della sub via callback.
 *
 *   5. **Big-endian writes**: tutti i `move.l`, `move.w`, `move.b` scrivono
 *      in BE; replicato byte-by-byte.
 *
 *   6. **Conditional `if A2[+0x1A]==6 → A2[+0x18]=3`**: applicato PRIMA del
 *      dispatch su subStateCode. Su case 2/9/4 il +0x1A viene poi
 *      sovrascritto col nuovo state, ma la write su +0x18 persiste.
 *
 * **Caller noto**: scheduler state-machine adiacente in zona 0x25BE0..0x25C70
 * (vedi xref a 0x25BAE per identificarlo). Pattern cdecl standard: il caller
 * pusha 2 long (objPtr + subStateLong), chiama, poi pulisce con `addq.l #8,SP`.
 *
 * **Pattern**: simile a `object-init-2591a.ts` (zona vicina, stesso scheduler
 * di parentela). Differenze chiave: questa funzione ha 2 arg invece di 1,
 * dispatch su byte invece che inline init, e usa callback per `FUN_2591A`
 * + `FUN_158AC` invece di 6 callback inline.
 *
 * Verifica bit-perfect via `cli/src/test-object-state-entry-25bae-parity.ts`.
 */

import type { GameState } from "./state.js";

/** Base assoluta della work RAM (0x400000 nel bus M68k). */
const WORK_RAM_BASE = 0x400000;
/** Limite superiore esclusivo workRam (0x400000 + 0x2000). */
const WORK_RAM_END = 0x402000;

/** Indirizzo entry-point del binario (per parity tests / cross-ref). */
export const OBJECT_STATE_ENTRY_25BAE_ADDR = 0x00025bae as const;

/** Indirizzi delle 2 sub-jsr esterne usate da FUN_25BAE. */
export const OBJECT_STATE_ENTRY_25BAE_SUB_ADDRS = {
  /** `FUN_158AC` — sound command sender (byte LSB del long pushato). */
  fun_158AC: 0x000158ac,
  /** `FUN_2591A` — object full initializer (`objectInit2591A`). */
  fun_2591A: 0x0002591a,
} as const;

/** Sub-state codes gestiti dal dispatcher (tutti gli altri byte → no-op). */
export const OBJECT_STATE_ENTRY_25BAE_CODES = {
  /** Case 2: setup sprite per state 2 + sound 0x38. */
  state2: 0x02,
  /** Case 9: setup sprite per state 9 (no sound). */
  state9: 0x09,
  /** Case 4: full init via FUN_2591A + sound 0x3C/0x3D + counter inc. */
  state4: 0x04,
} as const;

/** Sound command IDs cabled in FUN_25BAE via `pea (imm).l; jsr FUN_158AC`. */
export const OBJECT_STATE_ENTRY_25BAE_SOUND_IDS = {
  /** Case 2 sound. */
  case2: 0x38,
  /** Case 4 sound se A2[+0x57] == 0x65. */
  case4_match65: 0x3c,
  /** Case 4 sound se A2[+0x57] != 0x65. */
  case4_otherwise: 0x3d,
} as const;

/** Sprite-descriptor pointer ROM (case 2). */
export const SPRITE_PTR_CASE2 = 0x00020fde as const;
/** Sprite-descriptor pointer ROM (case 9). */
export const SPRITE_PTR_CASE9 = 0x00021062 as const;

/** Soglia di confronto per A2[+0x57] (case 4). */
export const FIELD_57_MATCH_VALUE = 0x65 as const;

/**
 * Bag delle 2 sub-jsr esterne orchestrate da `FUN_00025BAE`. Ogni callback è
 * opzionale (default no-op) per consentire test isolati o iniezione di stub.
 */
export interface ObjectStateEntry25BAESubs {
  /**
   * `FUN_158AC(cmd)` — sound command sender. Invocata 1 volta in case 2
   * (cmd=0x38) e 1 volta in case 4 (cmd=0x3C o 0x3D). Il binario passa il
   * long via `pea (imm).l` ma `FUN_158AC` legge solo il byte LSB; qui
   * passiamo direttamente il byte.
   */
  soundCommand?: (cmd: number) => void;
  /**
   * `FUN_2591A(objPtr)` — `objectInit2591A`, full object initializer.
   * Invocata SOLO in case 4. Default no-op (il parity test patcha
   * `FUN_2591A` con `rts` per isolare le scritture dirette di FUN_25BAE).
   *
   * NB: la replica TS di `FUN_2591A` è in `object-init-2591a.ts`. Qui non
   * la chiamiamo internamente per consentire stub injection in test.
   */
  fun_2591A?: (state: GameState, objPtr: number) => void;
  /**
   * **MAME-NET integration flag** (NON parte del disasm grezzo):
   * Se `true`, il prologue comune NON azzera A2[+0x00] (vx) e A2[+0x04] (vy).
   *
   * **Motivazione bit-perfect (osservata in /tmp/mame_100f.json)**:
   * In MAME demo gameplay f12000+, obj0 ha invariantemente s1a=0, s58=0,
   * s36=0 — la chain `helper121B8 → OUT_OF_RANGE | BOUNCE_BELOW_TARGET`
   * che invoca questa funzione con code=4 NON triggera mai. Il NETTO MAME
   * osservato sul flusso live è: vx/vy preservate (perché 25BAE non è
   * chiamato). In repliche TS dove `spriteProject1CC62` può ritornare un
   * valore che fa triggerare spuriosamente OUT_OF_RANGE, attivare questo
   * flag dal chiamante (refresh-frame / helper121B8) permette di preservare
   * la velocità integrata da helper182BA senza distruggere il "movimento
   * smooth" osservabile in MAME.
   *
   * **Default `false`** (= bit-perfect del disasm grezzo, parità isolata
   * con MAME garantita dal test).
   */
  preserveVelocity?: boolean;
}

// ─── Helper interni: read/write byte/word/long su workRam (BE M68k) ──────

function readU8(workRam: Uint8Array, addrAbs: number): number {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_END) return 0;
  return (workRam[a - WORK_RAM_BASE] ?? 0) & 0xff;
}

function writeU8(workRam: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_END) return;
  workRam[a - WORK_RAM_BASE] = value & 0xff;
}

function readU16BE(workRam: Uint8Array, addrAbs: number): number {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 1 >= WORK_RAM_END) return 0;
  const off = a - WORK_RAM_BASE;
  return (((workRam[off] ?? 0) << 8) | (workRam[off + 1] ?? 0)) & 0xffff;
}

function writeU16BE(workRam: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 1 >= WORK_RAM_END) return;
  const off = a - WORK_RAM_BASE;
  const v = value & 0xffff;
  workRam[off] = (v >>> 8) & 0xff;
  workRam[off + 1] = v & 0xff;
}

function writeU32BE(workRam: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 3 >= WORK_RAM_END) return;
  const off = a - WORK_RAM_BASE;
  const v = value >>> 0;
  workRam[off] = (v >>> 24) & 0xff;
  workRam[off + 1] = (v >>> 16) & 0xff;
  workRam[off + 2] = (v >>> 8) & 0xff;
  workRam[off + 3] = v & 0xff;
}

/**
 * Replica `FUN_00025BAE` — object state-transition entry.
 *
 * Vedi disasm e semantica nell'header del file. Le 2 sub-jsr sono esposte
 * via `subs` (default no-op); le scritture dirette su A2 sono replicate
 * bit-perfect.
 *
 * @param state          GameState corrente (`workRam` mutato in-place).
 * @param objPtr         Puntatore assoluto M68k all'oggetto (es. `0x004012XX`).
 *                       Deve cadere all'interno della work RAM e lasciare
 *                       almeno 0xD4 byte disponibili (campo più alto: A2+0xD2..D3
 *                       word, scritto in case 4).
 * @param subStateCode   Byte (LSB del secondo long sullo stack) selettore di
 *                       branch: 2, 9, 4 → effetti specifici; altri → no-op.
 * @param subs           Bag di callback per le 2 sub-jsr esterne. Default
 *                       tutte no-op.
 */
export function objectStateEntry25BAE(
  state: GameState,
  objPtr: number,
  subStateCode: number,
  subs: ObjectStateEntry25BAESubs = {},
): void {
  const wr = state.workRam;
  const objAbs = objPtr >>> 0;
  const code = subStateCode & 0xff;

  // ── Effetti comuni (eseguiti SEMPRE, prima del dispatch) ─────────────

  // 0x25BB8..0x25BBE: A2[+0x4] = 0 (long); A2[+0x0] = 0 (long).
  // Ordine binario: prima +0x4 poi +0x0 — replicato identico per
  // determinismo cross-platform (anche se equivalente per workRam pure).
  // `preserveVelocity` flag (MAME-net integration override, vedi interfaccia
  // `ObjectStateEntry25BAESubs.preserveVelocity` per motivazione):
  if (subs.preserveVelocity !== true) {
    writeU32BE(wr, objAbs + 0x04, 0);
    writeU32BE(wr, objAbs + 0x00, 0);
  }

  // 0x25BC0..0x25BCC: cmpi.b #6,(0x1A,A2); bne skip; move.b #3,(0x18,A2)
  if (readU8(wr, objAbs + 0x1a) === 0x06) {
    writeU8(wr, objAbs + 0x18, 0x03);
  }

  // ── Dispatch su subStateCode (byte) ──────────────────────────────────

  if (code === 0x02) {
    // 0x25BD4..0x25BDA: dead-load `move.w (0x20,A2),D0w; andi.w #-1,D0w`.
    // NON modellato: D0 caller-saved + flag CCR non consumati. Skip.

    // 0x25BDC..0x25BE6: pea 0x38; jsr FUN_158AC; addq.l #4,SP
    subs.soundCommand?.(OBJECT_STATE_ENTRY_25BAE_SOUND_IDS.case2);

    // 0x25BE8..0x25C04: scritture dirette
    writeU8(wr, objAbs + 0x5f, 0); // clr.b (0x5F,A2)
    writeU8(wr, objAbs + 0x60, 0x02); // move.b #2,(0x60,A2)
    writeU32BE(wr, objAbs + 0x5a, SPRITE_PTR_CASE2); // move.l #0x20FDE,(0x5A,A2)
    writeU8(wr, objAbs + 0x56, 0x02); // move.b #2,(0x56,A2)
    writeU8(wr, objAbs + 0x1a, 0x02); // move.b #2,(0x1A,A2)
    return;
  }

  if (code === 0x09) {
    // 0x25C12..0x25C28: case 9 — nessuna sound, solo writes.
    writeU8(wr, objAbs + 0x5f, 0); // clr.b (0x5F,A2)
    writeU8(wr, objAbs + 0x60, 0x04); // move.b #4,(0x60,A2)
    writeU32BE(wr, objAbs + 0x5a, SPRITE_PTR_CASE9); // move.l #0x21062,(0x5A,A2)
    writeU8(wr, objAbs + 0x1a, 0x09); // move.b #9,(0x1A,A2)
    return;
  }

  if (code === 0x04) {
    // 0x25C32..0x25C40: jsr FUN_2591A(A2)
    subs.fun_2591A?.(state, objAbs);

    // 0x25C3A..0x25C42: cmpi.b #0x65,(0x57,A2); bne 0x25C54
    const v57 = readU8(wr, objAbs + 0x57);
    if (v57 === FIELD_57_MATCH_VALUE) {
      // 0x25C44..0x25C50: pea 0x3C; jsr FUN_158AC; addq.l #4,SP
      subs.soundCommand?.(OBJECT_STATE_ENTRY_25BAE_SOUND_IDS.case4_match65);
    } else {
      // 0x25C54..0x25C60: pea 0x3D; jsr FUN_158AC; addq.l #4,SP
      subs.soundCommand?.(OBJECT_STATE_ENTRY_25BAE_SOUND_IDS.case4_otherwise);
    }

    // 0x25C62..0x25C66: clr.l (0x5A,A2); move.b #4,(0x1A,A2)
    writeU32BE(wr, objAbs + 0x5a, 0);
    writeU8(wr, objAbs + 0x1a, 0x04);

    // 0x25C6C: addq.w #1,(0xD2,A2) — incremento word con wrap a 16 bit.
    const cur = readU16BE(wr, objAbs + 0xd2);
    writeU16BE(wr, objAbs + 0xd2, (cur + 1) & 0xffff);
    return;
  }

  // Default: nessun altro side effect oltre alle scritture comuni iniziali.
}
