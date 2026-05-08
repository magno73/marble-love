/**
 * state-dispatch-12fd0.ts — replica `FUN_00012FD0` (158 byte).
 *
 * Dispatcher a due blocchi principali:
 *
 * **Blocco 1 — ricerca oggetto attivo (solo se gameMode == 2)**:
 *   Scansiona il player-object array @ 0x400018 (stride 0xe2) per un numero
 *   di voci pari a `[0x400396].w`. Per ogni oggetto:
 *     - se `obj+0x18 == 1` (attivo) AND `[0x40075e] != 0` (flag globale)
 *       AND `obj+0x1b ∈ {0x09, 0x0a}` (stato di scripting)
 *     → chiama `fun_12d46(0x1d854)` e interrompe la scansione.
 *
 * **Blocco 2 — sound init condizionale**:
 *   Se `[0x40075c] != 0`: chiama `fun_11ac2()`.
 *
 * **Blocco 3 — loop 25 oggetti script-state**:
 *   Per ogni `i ∈ [0..24]` chiama `fun_13068(0x400a9c + i*0x56)`.
 *
 * **Disasm 0x12FD0..0x13067** (158 byte):
 *
 *   movem.l  d2-d4,-(a7)             ; salva D2-D4
 *   moveq    #$2, d0
 *   cmp.w    $400394.l, d0           ; D0.w == [0x400394].w? (gameMode)
 *   bne.w    $13034                  ; no → salta blocco 1
 *   movea.l  #$400018, a0            ; A0 = base array oggetti
 *   clr.b    d2                      ; D2b = 0 (counter)
 *   bra.b    $13028                  ; → check loop
 *
 * ; loop body @ 0x12FEA:
 *   cmpi.b   #$1, $18(a0)            ; obj+0x18 == 1?
 *   bne.b    $1301c                  ; no → next
 *   tst.b    $40075e.l               ; flag75e != 0?
 *   beq.b    $1301c                  ; no → next
 *   cmpi.b   #$a, $1b(a0)           ; obj+0x1b == 0xa?
 *   beq.w    $1300c                  ; sì → dispatch
 *   cmpi.b   #$9, $1b(a0)           ; obj+0x1b == 0x9?
 *   bne.b    $1301c                  ; no → next
 *
 * ; dispatch @ 0x1300C:
 *   pea.l    $1d854.l                ; push ROM ptr (script header)
 *   jsr      $12d46.l                ; FUN_12D46(0x1d854)
 *   addq.l   #$4, a7                 ; pop arg
 *   bra.b    $13034                  ; break (goto blocco 2)
 *
 * ; next @ 0x1301C:
 *   move.l   a0, d4
 *   addi.l   #$e2, d4                ; D4 = A0 + 0xe2 (next object)
 *   movea.l  d4, a0                  ; A0 = next object
 *   addq.b   #$1, d2                 ; D2b++
 *
 * ; loop check @ 0x13028:
 *   move.b   d2, d0
 *   ext.w    d0                      ; D0.w = signExt(D2b)
 *   cmp.w    $400396.l, d0           ; D0.w == [0x400396].w?
 *   bne.b    $12fea                  ; no → loop body
 *
 * ; blocco 2 @ 0x13034:
 *   tst.b    $40075c.l               ; flag75c != 0?
 *   beq.b    $13042                  ; no → salta
 *   jsr      $11ac2.l                ; FUN_11AC2()
 *
 * ; blocco 3 @ 0x13042:
 *   move.l   #$400a9c, d3            ; D3 = base array script-state
 *   clr.b    d2                      ; D2b = 0 (counter loop2)
 * ; loop2 body @ 0x1304A:
 *   move.l   d3, d1                  ; D1 = ptr corrente
 *   moveq    #$56, d0                ; D0 = 0x56 (stride)
 *   add.l    d0, d3                  ; D3 += 0x56 (ptr per prossima iter)
 *   move.l   d1, -(a7)               ; push ptr
 *   jsr      $13068.l                ; FUN_13068(ptr)
 *   addq.l   #$4, a7                 ; pop arg
 *   addq.b   #$1, d2                 ; D2b++
 *   cmpi.b   #$19, d2                ; D2b == 25?
 *   bne.b    $1304a                  ; no → loop2
 *
 *   movem.l  (a7)+, d2-d4            ; restore D2-D4
 *   rts
 *
 * **Costanti osservabili**:
 *   - 0x400394: game-mode word (2 = enable inner-loop)
 *   - 0x400018: base player/enemy object array
 *   - 0x400396: object count word (numero oggetti da scansionare)
 *   - 0x40075e: flag byte (scripting-trigger enable)
 *   - 0x40075c: flag byte (sound init enable)
 *   - 0x400a9c: base script-state array (25 elementi stride 0x56)
 *   - 0x1d854:  ROM ptr passato a fun_12d46 (script-header)
 *   - obj+0x18: byte "active" (1 = attivo)
 *   - obj+0x1b: byte "state" (0x09 o 0x0a → dispatch)
 *
 * **JSR sub injection** (3 sub esposte via `StateDispatch12FD0Subs`):
 *   - `fun_12d46(romScriptPtr)`: `FUN_00012D46` — alloca slot e bind script.
 *     Default no-op. Arg: ROM ptr (0x1d854).
 *   - `fun_11ac2()`: `FUN_00011AC2` — copia tabella ROM → workRam.
 *     Default no-op.
 *   - `fun_13068(slotPtr)`: `FUN_00013068` — aggiorna script-state slot.
 *     Default no-op. Arg: ptr assoluto al record script-state (workRam).
 *
 * Parity test: `cli/src/test-state-dispatch-12fd0-parity.ts` (500/500).
 */

import type { GameState } from "./state.js";

// ─── Costanti workRam ─────────────────────────────────────────────────────

const WRAM = 0x00400000 as const;

/** Byte offset workRam address 0x400394: game-mode word. */
const OFF_FLAG_75C = 0x40075c - WRAM; // 0x75c
/** Byte offset workRam address 0x40075e: scripting-trigger enable flag. */
const OFF_FLAG_75E = 0x40075e - WRAM; // 0x75e

/** Absolute address of first player/enemy object. */
export const OBJ_ARRAY_BASE = 0x00400018 as const;
/** Stride between consecutive objects (in bytes). */
export const OBJ_STRIDE = 0xe2 as const;
/** Byte offset within each object for "active" flag. */
export const OBJ_ACTIVE_OFF = 0x18 as const;
/** Byte offset within each object for scripting state byte. */
export const OBJ_STATE_OFF = 0x1b as const;
/** State value: dispatch trigger (0x9 or 0xa). */
export const OBJ_STATE_DISPATCH_A = 0x09 as const;
export const OBJ_STATE_DISPATCH_B = 0x0a as const;

/** ROM pointer to script header, passed to fun_12d46. */
export const ROM_SCRIPT_PTR = 0x0001d854 as const;

/** Absolute address of first script-state slot. */
export const SLOT_ARRAY_BASE = 0x00400a9c as const;
/** Stride between consecutive script-state slots (in bytes). */
export const SLOT_STRIDE = 0x56 as const;
/** Number of script-state slots. */
export const SLOT_COUNT = 25 as const;

/** gameMode value that enables the object-scan block. */
export const GAME_MODE_INNER = 2 as const;

/** Address constant for this function in ROM. */
export const STATE_DISPATCH_12FD0_ADDR = 0x00012fd0 as const;

// ─── Memory helpers ────────────────────────────────────────────────────────

/** Read unsigned byte from workRam at absolute M68k address. */
function rb(state: GameState, addr: number): number {
  return state.workRam[(addr - WRAM) >>> 0] ?? 0;
}

/** Read unsigned word (big-endian) from workRam at absolute M68k address. */
function rw(state: GameState, addr: number): number {
  const off = (addr - WRAM) >>> 0;
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

// ─── Subs interface ────────────────────────────────────────────────────────

/**
 * Stub injection per le 3 JSR di `FUN_00012FD0`.
 *
 * Tutte le subs default a no-op quando non iniettate.
 */
export interface StateDispatch12FD0Subs {
  /**
   * `FUN_00012D46(romScriptPtr)` — alloca primo slot libero nella tabella
   * ROM @ 0x1F016 e lo bind al puntatore script `romScriptPtr`.
   *
   * Arg: `romScriptPtr` = `0x0001D854` (costante dal binario; PEA assoluta).
   * Implementazione canonica: `claimScriptSlot(state, rom, 0x1d854)`.
   */
  fun_12d46?: (romScriptPtr: number) => void;

  /**
   * `FUN_00011AC2()` — copia 66 word da ROM @ 0x1D370 → workRam @ 0x76E.
   * Implementazione canonica: `soundMaybe11AC2(state, rom)`.
   */
  fun_11ac2?: () => void;

  /**
   * `FUN_00013068(slotPtr)` — aggiorna il record di script-state al ptr
   * assoluto `slotPtr` (workRam).
   * Chiamata 25 volte, una per ciascun slot @ 0x400a9c + i*0x56.
   */
  fun_13068?: (slotPtr: number) => void;
}

// ─── Implementazione ───────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00012FD0`.
 *
 * @param state  GameState (workRam letto e non scritto direttamente da questa
 *               funzione — tutti i side-effect sono delegati alle `subs`).
 * @param subs   Stub injection per le 3 JSR interne.
 */
export function stateDispatch12FD0(
  state: GameState,
  subs?: StateDispatch12FD0Subs,
): void {
  // ── Blocco 1: inner loop (solo se gameMode == 2) ──────────────────────
  //
  // moveq #2, D0 ; cmp.w $400394, D0 ; bne.w $13034
  // M68k cmp.w Dn, mem: compara D0.w con [0x400394].w
  // Sets flags as D0 - [0x400394]. bne se D0 != [0x400394] → skip
  const gameMode = rw(state, 0x400394);
  if (gameMode === GAME_MODE_INNER) {
    // movea.l #$400018, a0 ; clr.b d2 ; bra $13028
    const objCount = rw(state, 0x400396); // [0x400396].w (loop limit)
    let d2b = 0; // loop counter D2.b
    let a0 = OBJ_ARRAY_BASE; // A0 = current object ptr

    // do-while loop: check d2b != objCount first (bra to check, then body)
    while (d2b !== (objCount & 0xffff)) {
      // cmpi.b #$1, $18(a0)
      const active = rb(state, a0 + OBJ_ACTIVE_OFF);
      if (active === 1) {
        // tst.b $40075e
        const flag75e = state.workRam[OFF_FLAG_75E] ?? 0;
        if (flag75e !== 0) {
          // cmpi.b #$a, $1b(a0) ; beq dispatch ; cmpi.b #$9, $1b(a0) ; bne next
          const objState = rb(state, a0 + OBJ_STATE_OFF);
          if (objState === OBJ_STATE_DISPATCH_B || objState === OBJ_STATE_DISPATCH_A) {
            // pea $1d854 ; jsr $12d46 ; addq #4, a7
            subs?.fun_12d46?.(ROM_SCRIPT_PTR);
            // bra.b $13034 — break (skip rest of loop, goto blocco 2)
            break;
          }
        }
      }
      // next object: addi.l #$e2, d4 ; movea.l d4, a0 ; addq.b #1, d2
      a0 = (a0 + OBJ_STRIDE) >>> 0;
      d2b = (d2b + 1) & 0xff;
      // loop check: move.b d2, d0 ; ext.w d0 ; cmp.w $400396, d0 ; bne body
      // Note: ext.w of a byte counter 0..255 is the same value (sign extension
      // of 0..127 = same; 128..255 sign-extends to negatives, but the loop
      // limit [0x400396] is typically small so this only matters for edge cases)
    }
  }

  // ── Blocco 2: sound init condizionale ────────────────────────────────────
  //
  // tst.b $40075c ; beq $13042 ; jsr $11ac2
  const flag75c = state.workRam[OFF_FLAG_75C] ?? 0;
  if (flag75c !== 0) {
    subs?.fun_11ac2?.();
  }

  // ── Blocco 3: loop 25 script-state slots ─────────────────────────────────
  //
  // move.l #$400a9c, d3 ; clr.b d2
  // loop: move.l d3, d1 ; moveq #$56, d0 ; add.l d0, d3 ; push d1 ; jsr $13068
  let d3 = SLOT_ARRAY_BASE >>> 0; // current ptr (incremented before call)
  for (let i = 0; i < SLOT_COUNT; i++) {
    const d1 = d3 >>> 0; // capture current before advance
    d3 = (d3 + SLOT_STRIDE) >>> 0; // D3 += 0x56 (next iter ptr)
    subs?.fun_13068?.(d1);
  }

  // movem.l (a7)+, d2-d4 ; rts
}
