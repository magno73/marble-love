/**
 * state-sub-5584.ts — replica `FUN_00005584` (132 byte).
 *
 * Wrapper di "scan & match" che incolla 3 helper:
 *   1. `FUN_0000540A`  — table-of-string-records walker (vedi state-sub-540a)
 *   2. `FUN_000053EA`  — read-byte-pair OR (`byte[ptr]|byte[ptr+1]`)
 *   3. `FUN_00005468`  — record-step (forward-walk con flag-update)
 *
 * Il wrapper:
 *   - Walka la tabella partendo da `arg0_ptr` per `arg2_word` record (FUN_540A).
 *   - Verifica che il pair byte all'indirizzo risultante sia non-zero (FUN_53EA);
 *     se è zero ritorna 0 immediato (= "tabella terminata").
 *   - Per `D4 ∈ {3, 6, 9, 12, 15}` (5 step di 3) chiama
 *     `FUN_5468(curPtr, arg1_word, D4, arg4_word, arg4_word)` ottenendo un
 *     nuovo pointer. Se il pair `byte[ptr]|byte[ptr+1]` del nuovo pointer è 0,
 *     il pointer "step" viene rimpiazzato col pointer ORIGINALE arg0 (D6 = arg0).
 *     Confronta poi il pointer-corrente con il risultato di FUN_540A: se sono
 *     uguali, esce. Altrimenti continua con D4 += 3.
 *   - Ritorna in D0 il valore dell'ultima invocazione di FUN_53EA (può essere
 *     0 se quella è stata l'uscita early, oppure il valore non-zero se l'uscita
 *     è avvenuta per cmp.l-equal, oppure il valore dell'iterazione D4=15 se
 *     il loop completa senza match).
 *
 * **Disasm 0x5584..0x5604** (132 byte):
 *
 *   0x5584:  movem.l {D6 D5 D4 D3 D2},-(SP)   ; preserve D2..D6 (20 byte)
 *   0x5588:  move.l  (0x18,SP),D2             ; D2 = arg0 (long ptr)
 *   0x558c:  move.w  (0x1e,SP),D3w            ; D3w = arg1 (word)
 *   0x5590:  move.w  (0x22,SP),D1w            ; D1w = arg2 (word)
 *   0x5594:  move.l  D2,D6                    ; D6 = arg0 (save initial ptr)
 *   0x5596:  moveq   #0,D0
 *   0x5598:  move.w  D1w,D0w                  ; D0 = arg2 (zero-ext)
 *   0x559a:  move.l  D0,-(SP)                 ; push arg2 (long)
 *   0x559c:  move.l  D2,-(SP)                 ; push arg0 (long)
 *   0x559e:  jsr     0x540A.l                 ; D0 = FUN_540A(arg0, arg2)
 *   0x55a4:  move.l  D0,D5                    ; D5 = walked_ptr (or 0 sentinel)
 *   0x55a6:  move.l  D5,D2                    ; D2 = D5 (cur ptr)
 *   0x55a8:  move.l  D2,-(SP)                 ; push D2
 *   0x55aa:  jsr     0x53EA.l                 ; D0 = FUN_53EA(D2)
 *   0x55b0:  tst.l   D0
 *   0x55b2:  lea     (0xc,SP),SP              ; pop 12 byte (cleanup 540A 8 + 53EA 4)
 *   0x55b6:  beq.w   0x5602                   ; if pair == 0 → exit (D0 = 0)
 *   0x55ba:  moveq   #3,D4                    ; D4 = 3 (loop start)
 *   0x55bc: loop_top:
 *   0x55bc:  moveq   #0,D0
 *   0x55be:  move.w  (0x2a,SP),D0w            ; D0 = arg4 word (caller_SP+0x12)
 *   0x55c2:  move.l  D0,-(SP)                 ; push arg4
 *   0x55c4:  moveq   #0,D0
 *   0x55c6:  move.w  (0x2a,SP),D0w            ; D0 = arg4 word (re-read; SP shifted)
 *                                              ;   ATTENZIONE: SP è già sceso di 4
 *                                              ;   ma offset 0x2a punta ancora ad
 *                                              ;   arg4 (0x2e dopo +4 push? NO:
 *                                              ;   il push appena fatto ha portato
 *                                              ;   arg4 a 0x2e, non 0x2a! Verifica
 *                                              ;   nelle note di fedeltà sotto).
 *   0x55ca:  move.l  D0,-(SP)                 ; push arg4 (di nuovo)
 *   0x55cc:  moveq   #0,D0
 *   0x55ce:  move.w  D4w,D0w                  ; D0 = D4 (zero-ext)
 *   0x55d0:  move.l  D0,-(SP)                 ; push D4
 *   0x55d2:  moveq   #0,D0
 *   0x55d4:  move.w  D3w,D0w                  ; D0 = D3 (zero-ext)
 *   0x55d6:  move.l  D0,-(SP)                 ; push D3 (= arg1 word)
 *   0x55d8:  move.l  D2,-(SP)                 ; push D2 (= cur ptr)
 *   0x55da:  jsr     0x5468.l                 ; D0 = FUN_5468(D2, D3, D4, arg4, arg4)
 *   0x55e0:  move.l  D0,D2                    ; D2 = step_ptr (overwrite cur)
 *   0x55e2:  move.l  D2,-(SP)                 ; push D2
 *   0x55e4:  jsr     0x53EA.l                 ; D0 = FUN_53EA(D2)
 *   0x55ea:  tst.l   D0
 *   0x55ec:  lea     (0x18,SP),SP             ; pop 24 byte (5468 args 20 + 53EA 4)
 *   0x55f0:  bne.b   0x55f4                   ; if D0 != 0 skip restore
 *   0x55f2:  move.l  D6,D2                    ; D2 = D6 (restore arg0 original)
 *   0x55f4:  cmp.l   D5,D2
 *   0x55f6:  beq.w   0x5602                   ; if D2 == D5 → exit
 *   0x55fa:  addq.w  #3,D4w                   ; D4 += 3
 *   0x55fc:  moveq   #0x12,D0
 *   0x55fe:  cmp.w   D4w,D0w                  ; cmp.w D4,D0 (= 0x12 - D4)
 *   0x5600:  bhi.b   0x55bc                   ; if 0x12 > D4 (unsigned) → loop
 *   0x5602:  movem.l (SP)+,{D2 D3 D4 D5 D6}   ; restore + rts (return D0 unchanged)
 *
 *   D0 al rts:
 *     - early-exit @ 0x55b6:  D0 = 0 (dal 53EA fallito)
 *     - exit @ 0x55f6 (cmp eq): D0 = ultimo 53EA result
 *     - exit @ loop completion: D0 = 53EA result dell'iter D4=15
 *
 * **Convenzione caller** (verificata @ 0x5e9a, 0x6002, 0x6058):
 *   - Tutti i caller in FUN_5e00 (single caller funzione).
 *   - Args: 5 long (4 word ext-l + 1 long ptr).
 *     `arg0` long  = pointer absoluto (M68k 24-bit) alla testa di una tabella
 *                    di record (workRam-resident, range 0x40xxxx).
 *     `arg1` word  = parametro forward-walk (passato a FUN_5468 come arg2 word).
 *     `arg2` word  = numero di record da scansionare in FUN_540A.
 *     `arg3` word  = NON usato dentro FUN_5584 (passato dal caller ma ignorato
 *                    da questa funzione; potrebbe essere un legacy/placeholder).
 *     `arg4` word  = parametro byte/word passato 2 volte a FUN_5468 (arg3 byte
 *                    e arg4 word del callee).
 *   - Return: long (D0). Vedi tabella sopra.
 *   - Callee-saved: D2-D6 (preservato dal movem.l di prologue/epilogue).
 *
 * **Side effects**: nessuno DIRETTO da questo wrapper. Tutti gli effetti reali
 *   (modifica workRam, caller stack frame letture, ecc.) vivono dentro i 3
 *   callee. La replica TS modella i 3 callee come callback iniettabili — il
 *   differential test li intercetta a livello binario via patch RTS.
 *
 * **Note di low-level fidelity**:
 *
 *   1. **Stack offset di `(0x2a, SP)`**: post-movem (5×4 = 20 byte = 0x14) +
 *      ret addr (4) = 24 = 0x18. Caller_SP_args = SP + 0x18. Args structure:
 *      arg0 @ +0, arg1 @ +4 (word @ +6), arg2 @ +8 (word @ +0xa), arg3 @ +0xc
 *      (word @ +0xe), arg4 @ +0x10 (word @ +0x12). Quindi (0x2a, SP) =
 *      (caller_SP_args + 0x12) = arg4 low word. **Confermato** dalla disasm
 *      del caller @ 0x5fe2..0x6002 dove l'ultimo push è arg4 da ROM[0x10070]
 *      (vedi `0x5fe2: move.w (0x10070).l, D0w; ext.l D0; move.l D0,-(SP)`).
 *
 *   2. **Re-read `(0x2a, SP)` dopo push**: il primo push @ 0x55c2 abbassa SP
 *      di 4. Il successivo `move.w (0x2a, SP), D0w` @ 0x55c6 legge da SP+0x2a
 *      (con SP-4 rispetto a prima); l'offset risultante è caller_SP+0x16
 *      (= arg4 high word + 2 = STILL arg4 low word su BE). NO: + 4 sul SP
 *      significa che (0x2a, SP) ora punta a arg4_low_word - 4 = ... aspetta.
 *      Verifichiamo: SP è sceso di 4 → ogni offset `(N, SP)` ora vede dato
 *      a `OLD_SP - 4 + N`. Quindi (0x2a, SP) ora punta a `caller_SP_args +
 *      0x12 - 4 = caller_SP_args + 0xe = arg3 low word`!
 *      **MA**: il valore appena pushato @ 0x55c2 era proprio `D0w (arg4)`.
 *      Lo stack ora ha:
 *         (0, SP)        = D0 = arg4 long (just pushed)
 *         (4..0x17, SP)  = ret + saved D2..D6
 *         (0x18..., SP)  = caller args
 *      ma con SP sceso di 4 dal post-prologue. Quindi:
 *         (0x18 + 4 = 0x1c, SP) = arg0
 *         (0x1c + 6 = 0x22, SP) = arg1 word
 *         (0x1c + 0xa = 0x26, SP) = arg2 word
 *         (0x1c + 0xe = 0x2a, SP) = arg3 word ✗
 *      **OPPURE**: se i caller passano arg3=0x0001 e arg4=ROM_word, e (0x2a, SP)
 *      legge arg3 dopo il primo push → leggerebbe `0x0001` invece di arg4.
 *      Verifichiamo l'aritmetica: post-movem SP delta = 20. Push (0x55c2): SP
 *      delta = 24. (0x2a, SP) @ delta 24 = caller_SP + 0x2a - 0x18 (delta 24 -
 *      caller offset 24) = caller_SP + 0x12 → ANCORA arg4! Errore mio sopra.
 *
 *      Riepilogo CORRETTO: `delta` indica quanto SP è sceso rispetto al
 *      caller_SP_pre_call. Caller_SP_pre_call - delta = current SP. Args sono
 *      a caller_SP_pre_call + offsets (0..0x14 per 5 long args). Quindi
 *      `(N, SP)` legge dato a `current_SP + N = caller_SP_pre_call - delta + N`.
 *      Per leggere arg4 low word (caller_SP + 0x12), serve N = delta + 0x12.
 *      - Pre-loop body, post-cleanup `lea (0xc,SP),SP`: delta = 20 (post-movem).
 *        N = 20 + 0x12 = 0x26... ma il codice usa 0x2a! Quindi delta deve
 *        essere 24 (4 byte extra). Da dove? RET ADDR. Il movem decrementa SP
 *        di 20, e prima del movem c'era già il ret addr pushato dal caller's
 *        jsr. Quindi `caller_SP` qui significa "SP prima del jsr" + 4 (per
 *        contare il ret addr). Riconto: post-prologue, delta dal caller_SP
 *        pre-jsr = 20 (movem) + 4 (ret) = 24. Args @ caller_SP + 0..0x13.
 *        N = 24 + 0x12 = 0x36? No anche qui sbagliato.
 *
 *      Approccio brutale: dalla disasm noi LEGGIAMO che (0x18, SP) → arg0,
 *      (0x1e, SP) → arg1w, (0x22, SP) → arg2w, (0x2a, SP) → arg4w. Differenza
 *      0x18 → 0x1e = 6 byte (= 2 word: arg0 long termina a +3, poi 2 byte
 *      di pad/high-word, poi word a +6). Differenza 0x1e → 0x22 = 4. 0x22 →
 *      0x2a = 8 byte (= 2 long: skip arg3 long). Quindi:
 *         (0x18, SP) = arg0 long start (length 4)  → @+0
 *         (0x1c, SP) = arg1 long start (length 4)  → word @+6
 *         (0x1e, SP) = arg1 word (low)
 *         (0x20, SP) = arg2 long start             → word @+0xa
 *         (0x22, SP) = arg2 word (low)
 *         (0x24, SP) = arg3 long start             → word @+0xe
 *         (0x28, SP) = arg4 long start             → word @+0x12
 *         (0x2a, SP) = arg4 word (low)
 *      ✓ Confermato. Delta tra caller_SP_args e SP post-movem = 0x18.
 *
 *      Dopo il primo push @ 0x55c2, SP -= 4. Ora delta = 0x1c. (0x2a, SP)
 *      ora punta a `current_SP + 0x2a = caller_SP_args + 0x2a - 0x1c =
 *      caller_SP_args + 0xe = arg3 word low`. Quindi la SECONDA lettura
 *      legge arg3, NON arg4!
 *
 *      Ma aspetta, il caller @ 0x6002 push args RTL: arg4(@5fea), arg3(@5fec=
 *      `pea (0x1).w`), arg2(@5ff0..5ff6), arg1(@5ff8..5ffe), arg0(@6000).
 *      Quindi nello stack post-call: arg0 più in basso (=SP+4), poi arg1, ...
 *      arg4 più in alto. Quindi:
 *         caller_SP_args + 0x10 = arg4 → low word @ +0x12
 *         caller_SP_args + 0x0c = arg3 → low word @ +0x0e
 *         caller_SP_args + 0x08 = arg2 → low word @ +0x0a
 *         caller_SP_args + 0x04 = arg1 → low word @ +0x06
 *         caller_SP_args + 0x00 = arg0
 *      ✓ Concorda con (0x2a, SP) = arg4 word, (0x26, SP) = arg3, etc.
 *
 *      Quindi la SECONDA lettura @ 0x55c6 (con SP -= 4) effettivamente legge
 *      arg3 word, NON arg4. **Ma** nel caller 0x5e00 a tutti e tre i callsite
 *      `arg3 = 1` (immediate `pea (0x1).w`). E in TUTTI i casi `arg4 = ROM
 *      word`. Quindi in produzione le DUE letture passano (arg4, arg3) =
 *      (ROM, 1) come gli ultimi due args di FUN_5468.
 *
 *      Nel modello bit-perfect TS dobbiamo replicare questo: la seconda
 *      lettura passa `arg3` (NON `arg4` di nuovo). Esponiamo entrambi nel
 *      callback inner5468 perché il differential test cattura gli args dallo
 *      stack del binario al momento del jsr.
 *
 *   2.5 **Doppia conferma via re-disasm corretta**: a 0x55c2 push abbassa SP
 *      di 4 (da 0x14 di delta movem a 0x18). Poi 0x55c6 legge (0x2a, SP) con
 *      delta 0x18 → caller_SP + (0x2a - 0x18) = caller_SP + 0x12... aspetta,
 *      delta era 0x18 prima del push, quindi 0x18 + 4 = 0x1c dopo il push.
 *      Riprovo: pre-push delta = 0x18. Post-push delta = 0x1c. (0x2a, SP) @
 *      delta 0x1c → caller_offset = 0x2a - 0x1c = 0x0e → arg3 word. ✓
 *      Quindi:
 *         primo push (0x55c2):  arg4 word (delta 0x18 → caller offset 0x12)
 *         secondo push (0x55ca): arg3 word (delta 0x1c → caller offset 0x0e)
 *         terzo push (0x55d0):   D4 (loop counter)
 *         quarto push (0x55d6):  D3 (arg1 word)
 *         quinto push (0x55d8):  D2 (cur ptr long)
 *      → FUN_5468 args (in ordine): (D2, D3, D4, arg3, arg4) — NB: arg3, NON
 *      arg4 ripetuto.
 *
 *      Verifichiamo con FUN_5468's signature (link.w A6,-0xc):
 *         (0x8, A6)  = arg0 = ptr long       → D2 ✓
 *         (0xe, A6)  = arg1 word low         → D3 ✓
 *         (0x12, A6) = arg2 word low         → D4 ✓
 *         (0x17, A6) = arg3 byte (low byte of word low) → arg3 ✓ (= 1 in prod)
 *         (0x1a, A6) = arg4 word low         → arg4 ✓ (= ROM[0x10070])
 *      Perfetto: gli args sono (D2, D3w, D4w, arg3w, arg4w).
 *
 *   3. **`movem.l {D6 D5 D4 D3 D2}, -(SP)` push order**: M68k `movem` preserva
 *      registri in ordine D0..A7 sullo stack (D2 più in basso, A7/D7 più in
 *      alto). Per `-(SP)`, la maschera dichiara i registri da preservare e
 *      vengono pushati TUTTI dal più alto (D7-side) al più basso (D2-side),
 *      così che D2 finisce a (0,SP) e D6 a (0x10,SP). Layout post-movem:
 *         (0, SP) = D2  ; (4, SP) = D3  ; (8, SP) = D4  ; (0xc, SP) = D5  ; (0x10, SP) = D6
 *         (0x14, SP) = ret addr (pushato da jsr precedente)
 *         (0x18, SP) = arg0 long
 *      Confermato.
 *
 *   4. **`moveq #0,D0; move.w (off,SP),D0w`**: prima clear D0 long a 0, poi
 *      copia low word di stack in low word di D0. Risultato: D0 = `0x0000WWWW`
 *      con WWWW = word value. Non c'è sign-extend (il valore è zero-extended
 *      a long perché la metà alta resta 0).
 *
 *   5. **`move.l D2, D6`**: D6 = D2 long (= arg0 originale). D6 NON viene
 *      mai più scritto fino al `move.l D6, D2` @ 0x55f2.
 *
 *   6. **`cmp.l D5, D2`**: M68k `cmp.l Sn, Dn` calcola `Dn - Sn` settando i
 *      flag. `beq` testa Z. Quindi beq se `D2 == D5` (equiv long equality).
 *
 *   7. **`cmp.w D4w, D0w` con D0 = 0x12**: calcola `D0w - D4w`. `bhi` testa
 *      C=0 AND Z=0 → unsigned higher → `D0w > D4w`. Loop while 0x12 > D4w.
 *      D4 prende valori 3, 6, 9, 0xC, 0xF (5 iter), poi 0x12 esce.
 *
 *   8. **`addq.w #3, D4w`**: word increment, wrap mod 65536. Non rilevante
 *      qui (D4 stays in word range).
 *
 *   9. **D0 al return**: il movem epilogue NON tocca D0. Quindi D0 conserva
 *      il suo valore al momento di entry in 0x5602. I due path noti:
 *      - Da 0x55b6 (early): D0 = 0 (53EA aveva ritornato 0 → tst.l D0 fece
 *        beq).
 *      - Da 0x55f6 (cmp eq): D0 = ultimo 53EA result.
 *      - Da loop full (D4=0x12): cade da 0x5600 a 0x5602, D0 = ultimo 53EA.
 *
 *  10. **Caller usage di D0**: in FUN_5e00 dopo il jsr 5584 a 0x6002 c'è
 *      `move.w D6w,(-0x4,A6)` — non si testa D0. Idem agli altri due
 *      callsite. Probabilmente i caller si affidano agli effetti di workRam
 *      di FUN_5468 piuttosto che al return.
 *
 * **Xrefs** (3 ref, 1 caller funzione):
 *   - `0x5F0E` in FUN_5E00 — jsr 0x5584 (UNCONDITIONAL_CALL)
 *   - `0x6002` in FUN_5E00 — jsr 0x5584 (UNCONDITIONAL_CALL)
 *   - `0x6058` in FUN_5E00 — jsr 0x5584 (UNCONDITIONAL_CALL)
 *
 * Verifica bit-perfect via `packages/cli/src/test-state-sub-5584-parity.ts`.
 */

import type { GameState } from "./state.js";

// ─── Tipi callback ─────────────────────────────────────────────────────────

/**
 * Signature di `FUN_0000540A` — table-of-records walker.
 *
 * @param state    GameState (workRam letto, non scritto da 540A).
 * @param a2       arg0 long: pointer assoluto M68k alla testa della tabella.
 * @param d3Word   arg1 word: numero massimo di record da scansionare (0..0xFFFF).
 * @returns        long unsigned: 0 se la tabella terminò con pair `00 00`,
 *                 altrimenti il pointer post-walk (assoluto M68k).
 */
export type Sub5584Inner540A = (
  state: GameState,
  a2: number,
  d3Word: number,
) => number;

/**
 * Signature di `FUN_000053EA` — read-byte-pair OR.
 *
 * @param state  GameState (workRam letto).
 * @param ptr    Pointer assoluto M68k.
 * @returns      `(byte[ptr] | byte[ptr+1]) >>> 0`, range `0..0xFF`.
 */
export type Sub5584Inner53EA = (state: GameState, ptr: number) => number;

/**
 * Signature di `FUN_00005468` — record forward-step con flag-update.
 *
 * @param state    GameState (workRam letto E scritto).
 * @param a2       arg0 long: pointer corrente (record header).
 * @param d3Word   arg1 word: parametro forward-walk (= arg1 di FUN_5584).
 * @param d2Word   arg2 word: contatore loop (3, 6, 9, 12, 15).
 * @param arg3Word arg3 word: low byte usato come byte arg3 di 5468 (= arg3 di
 *                 FUN_5584; in produzione = 1 per tutti i callsite).
 * @param arg4Word arg4 word: parametro modificato in-place dal callee (in
 *                 FUN_5468 c'è `move.w D1w,(0x1a,A6)` che riscrive lo stack-
 *                 arg). Nel TS questo aspetto NON è osservabile (passiamo a
 *                 valore); il binario lo scrive ma il caller non lo legge dopo.
 * @returns        long unsigned: pointer post-step (o 0 se early-exit interno).
 */
export type Sub5584Inner5468 = (
  state: GameState,
  a2: number,
  d3Word: number,
  d2Word: number,
  arg3Word: number,
  arg4Word: number,
) => number;

// ─── Replica ───────────────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00005584` — scan-and-match wrapper.
 *
 * Invoca FUN_540A una volta, poi (condizionalmente) FUN_53EA + (FUN_5468 +
 * FUN_53EA) ×N con N ∈ [0..5]. Ritorna il long D0 al momento di rts.
 *
 * @param state     GameState. Letto da 540A/53EA, letto+scritto da 5468.
 * @param arg0Long  Pointer assoluto M68k (long). Tipicamente in workRam.
 * @param arg1Word  Word param (passato a 5468 come arg1).
 * @param arg2Word  Word param (passato a 540A come d3 count).
 * @param arg3Word  Word param (passato a 5468 come arg3 byte; in produzione=1).
 *                  NB: NON è arg3 in senso disasm (che è arg unused), bensì
 *                  l'arg3 del callee 5468 che equivale a `arg3` del CALLER di
 *                  5584 (caller_SP_args + 0x0c). Vedi note di fedeltà §2.5.
 *                  Nel binario originale FUN_5584 NON LEGGE direttamente arg3
 *                  dal proprio stack frame, ma lo legge via `(0x2a, SP)` DOPO
 *                  un push (offset shift). Modelliamo passandolo esplicitamente.
 * @param arg4Word  Word param (passato a 5468 come arg4 word).
 * @param inner540A Callback per FUN_540A. Default: ritorna 0 (= "tabella vuota").
 * @param inner53EA Callback per FUN_53EA. Default: ritorna 0 (= "pair zero").
 * @param inner5468 Callback per FUN_5468. Default: ritorna 0.
 *
 * @returns  long unsigned (D0 al rts):
 *            - 0 se early-exit dopo la prima FUN_53EA (pair = 0 → tabella term.)
 *            - 0 se loop completes con D2 == D5 ma 53EA ha ritornato 0 nella
 *              iterazione finale prima dell'exit
 *            - non-zero se loop exit per cmp-eq con 53EA != 0
 *            - non-zero/zero alternato secondo l'ultima iter D4=15 se loop
 *              completa senza match
 *
 * **Modellazione bit-perfect**:
 *
 * 1. `D0 = arg2_word` zero-ext (moveq #0; move.w → D0 = 0x0000WWWW).
 * 2. FUN_540A riceve `(arg0Long, D0)` come (long, long pushato).
 * 3. `D2 = D5 = D0` (return value di 540A). Tutti long.
 * 4. FUN_53EA(D2): `D0 = pair`. Se 0 → exit con D0 = 0.
 * 5. Loop body con D4 = 3, 6, 9, 12, 15:
 *    - FUN_5468(D2_pre, D3=arg1, D4, arg3, arg4) → D0
 *    - D2 = D0 (overwrite cur ptr)
 *    - FUN_53EA(D2) → D0 (new pair)
 *    - if D0 == 0: D2 = D6 (= arg0Long original)
 *    - if D2 == D5 (long eq): exit con D0 = current 53EA result
 * 6. D0 al rts conserva il valore dal cammino (vedi §9 note di fedeltà).
 *
 * **Safety**: il loop ha al massimo 5 iterazioni (D4 ∈ {3,6,9,12,15}). Nessuna
 * possibilità di runaway. Le callback inner devono essere total functions.
 */
export function stateSub5584(
  state: GameState,
  arg0Long: number,
  arg1Word: number,
  arg2Word: number,
  arg3Word: number,
  arg4Word: number,
  inner540A: Sub5584Inner540A = () => 0,
  inner53EA: Sub5584Inner53EA = () => 0,
  inner5468: Sub5584Inner5468 = () => 0,
): number {
  // Normalizzazione args (force unsigned long / word).
  const a0 = arg0Long >>> 0;
  const a1w = arg1Word & 0xffff;
  const a2w = arg2Word & 0xffff;
  const a3w = arg3Word & 0xffff;
  const a4w = arg4Word & 0xffff;

  // ─── Prologue: D2/D3/D1/D6 = a0/a1w/a2w/a0 ─────────────────────────────
  // Nota: D3 = arg1, D1 = arg2 (vedi disasm). D2 = arg0 = D6 (save).
  // D6 NON viene mai più scritto fino al restore in caso di pair-zero.
  const d6 = a0;

  // ─── jsr 540A(arg0, arg2_word_zext) → D5 ────────────────────────────────
  // D0 = a2w zero-ext to long. Pushed as long.
  const d5 = (inner540A(state, a0, a2w) >>> 0) >>> 0;

  // D2 = D5 (cur ptr).
  let d2 = d5;

  // ─── jsr 53EA(D2) → D0; if D0 == 0 → exit (D0 stays 0) ─────────────────
  let d0 = (inner53EA(state, d2) >>> 0) >>> 0;
  if (d0 === 0) {
    // Early-exit @ 0x55b6. D0 = 0, ritorno.
    return 0 >>> 0;
  }

  // ─── Loop body @ 0x55bc..0x5600 ────────────────────────────────────────
  // D4 ∈ {3, 6, 9, 12, 15} (5 iter max). Loop while 0x12 > D4w (unsigned).
  for (let d4 = 3; d4 < 0x12; d4 += 3) {
    // jsr 5468(D2, D3=a1w, D4, arg3=a3w, arg4=a4w) → D0
    const stepPtr = (inner5468(state, d2, a1w, d4 & 0xffff, a3w, a4w) >>> 0) >>> 0;
    // D2 = D0 (overwrite con step result, anche se sarà rimpiazzato sotto).
    d2 = stepPtr;

    // jsr 53EA(D2) → D0
    d0 = (inner53EA(state, d2) >>> 0) >>> 0;

    // tst.l D0; bne skip_restore; restore D2 = D6
    if (d0 === 0) {
      d2 = d6;
    }

    // cmp.l D5, D2; beq exit
    if (d2 === d5) {
      // Exit @ 0x55f6. D0 conserva l'ultimo 53EA result (può essere 0 o no).
      return d0 >>> 0;
    }
    // else: addq.w #3, D4w; cmp 0x12 > D4 → loop or fall-through.
  }

  // Loop completato senza match (D4 raggiunge 0x12). Il path di fallthrough
  // a 0x5602 passa attraverso `moveq #0x12, D0; cmp.w D4w, D0w; bhi`. Il
  // `moveq` SOVRASCRIVE D0 con 0x12 PRIMA del cmp. Quindi se il cmp fallisce
  // (= D4 >= 0x12, cioè exit dal loop), D0 = 0x12 quando arriva all'epilogue.
  // Il movem epilogue non tocca D0 → return D0 = 0x12 (long).
  void state; // referenced for API consistency
  return 0x12 >>> 0;
}
