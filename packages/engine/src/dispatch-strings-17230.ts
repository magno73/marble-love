/**
 * dispatch-strings-17230.ts — replica `FUN_00017230` (42 byte).
 *
 * Sub di servizio chiamata da `FUN_00010fce` (1 xref @ 0x10FF2, JSR.L) come
 * sesto step del frame-tick di alto livello (subito dopo `addq.b #1, (0x4003F0)`,
 * il "frame counter" globale). È un **dispatcher**: itera 7 volte un puntatore
 * sull'array di slot stringa @ `0x401482` (stride `0x42`) e per ognuno chiama
 * `FUN_0001725a(slotPtr)` (string animation step) passando il pointer come
 * unico arg long sullo stack (cdecl-like).
 *
 * **Disasm 0x17230..0x17258** (42 byte, 0 args, 0 ret):
 *
 *   movem.l { D3 D2 }, -(SP)        ; salva D2/D3 (callee-saved)
 *   move.l  #0x401482, D3            ; D3 = pointer al primo slot
 *   clr.b   D2b                      ; D2 = counter byte = 0
 *   loop:
 *     move.l  D3, D1                 ; D1 = current slot ptr
 *     moveq   #0x42, D0              ; D0 = stride 0x42
 *     add.l   D0, D3                 ; D3 += 0x42 (next slot ptr)
 *     move.l  D1, -(SP)              ; push slotPtr arg
 *     jsr     0x0001725a.l           ; FUN_1725A(slotPtr)
 *     addq.l  #4, SP                 ; pop arg
 *     addq.b  #1, D2b                ; D2++
 *     cmpi.b  #0x7, D2b              ; D2 == 7?
 *     bne.b   loop                   ; ripeti finché D2 != 7
 *   movem.l (SP)+, { D2 D3 }         ; restore D2/D3
 *   rts
 *
 * **Geometria**:
 *   - Array: 7 slot da 0x42 byte ciascuno @ `0x401482..0x401482+7*0x42-1`
 *     = `0x401482..0x4015D3` (294 byte di workRam).
 *   - Pointer chiamati al callee, in ordine:
 *     `0x401482, 0x4014C4, 0x401506, 0x401548, 0x40158A, 0x4015CC, 0x40160E`.
 *     **Notabene**: il loop pre-incrementa D3 *prima* del jsr per la prossima
 *     iterazione, ma D1 (= D3 originale di quella iterazione) è ciò che viene
 *     pushato. Quindi i 7 pointer pushati sono `0x401482 + i*0x42` per
 *     `i ∈ 0..6`. Il valore finale "unused" di D3 dopo l'ultimo `add.l` è
 *     `0x401650` (= base + 7*0x42), ma il `cmpi.b` chiude il loop prima
 *     di un eventuale ottavo `jsr`.
 *
 * **Dispatcher puro**: questa funzione **non** scrive in workRam, non legge
 * MMIO, non tocca palette/sprite/alpha RAM. Tutti gli effetti collaterali
 * sono delegati al callee `FUN_0001725a` (vedi `string-step.ts` per la
 * famiglia di sub correlate, sebbene `0x1725a` sia distinto da
 * `FUN_00002CD4`/`FUN_00002DA0`).
 *
 * **Modello TS**: poiché `FUN_0001725a` non è ancora replicato in TS, il
 * dispatcher è esposto come **higher-order** che riceve il callee come
 * callback `(slotAddr) => void`. Questo permette:
 *   1. parità isolata vs il binario (callee patchato con uno stub di
 *      bookkeeping in `cli/src/test-dispatch-strings-17230-parity.ts`),
 *   2. integrazione futura senza breaking change (basta passare la TS-port
 *      di `FUN_0001725a` come callback quando sarà disponibile).
 *
 * Nessuna modifica a `state.workRam` qui: il dispatcher è "trasparente"
 * dal punto di vista dello state, e si limita a calcolare i 7 indirizzi e
 * invocare la callback nell'ordine 68k esatto.
 *
 * Bit-perfect verificato vs binary tramite
 * `cli/src/test-dispatch-strings-17230-parity.ts` (500/500 cases).
 */

/** Indirizzo workRam del primo slot stringa (immediato `move.l #0x401482, D3`). */
export const SLOT_BASE_ADDR = 0x401482 as const;
/** Stride in byte tra slot consecutivi (immediato `moveq #0x42, D0`). */
export const SLOT_STRIDE = 0x42 as const;
/** Numero di slot iterati dal loop (`cmpi.b #0x7, D2b`). */
export const SLOT_COUNT = 7 as const;
/** Indirizzo (assoluto 68010) della funzione callee: `jsr 0x0001725a.l`. */
export const CALLEE_ADDR = 0x0001725a as const;

/**
 * Replica `FUN_00017230` — `dispatchStrings17230(callee)`.
 *
 * Itera 7 slot stringa (`SLOT_BASE_ADDR + i * SLOT_STRIDE` per `i ∈ 0..6`)
 * invocando `callee(slotAddr)` per ciascuno, **nell'ordine esatto** del loop
 * 68k (i = 0, 1, …, 6). I `slotAddr` sono valori long unsigned (32-bit
 * 68010 address), nello spazio workRam.
 *
 * @param callee Funzione invocata 7 volte. Riceve il pointer assoluto
 *               (`number` u32) al slot corrente. Il valore di ritorno è
 *               ignorato (D0 del callee viene poi clobbered dal `move.l`
 *               della prossima iterazione comunque).
 *
 * NOTE bit-perfect:
 *   - Nessun side-effect TS oltre alle 7 invocazioni del callee.
 *   - Il dispatcher non legge/scrive `state.workRam` direttamente: è
 *     interamente pure rispetto a state.
 *   - L'ordine di invocazione (ascending `i`) coincide col binario (D2 va
 *     da 0 a 6).
 *   - Il `SP` push/pop di D2/D3 è internal al binario e non osservabile
 *     dall'esterno: TS non ha un equivalente.
 */
export function dispatchStrings17230(
  callee: (slotAddr: number) => void,
): void {
  // Replica fedelmente il loop: D3 inizia a SLOT_BASE_ADDR, D2 a 0.
  // Ad ogni iter: salva D1=D3, incrementa D3 += 0x42, chiama callee(D1),
  // incrementa D2, esci se D2 == 7.
  let d3 = SLOT_BASE_ADDR >>> 0;
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slotPtr = d3 >>> 0;
    d3 = (d3 + SLOT_STRIDE) >>> 0;
    callee(slotPtr);
  }
}
