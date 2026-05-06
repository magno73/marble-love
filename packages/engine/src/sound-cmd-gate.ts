/**
 * sound-cmd-gate.ts — replica `FUN_00004420` (34 byte).
 *
 * Validator gate posto sopra `FUN_00004442` (sound command dispatcher
 * principale). I caller passano due long sullo stack — `cmdIndex` (arg1) e
 * `data` (arg2) — e questa funzione, prima di delegare, applica un *clamp*
 * sull'argomento dati: se `cmdIndex < 0x0B` (unsigned), forza `data = 0`.
 * Altrimenti (`cmdIndex >= 0x0B`) lascia `data` invariato. Poi chiama
 * `FUN_00004442(cmdIndex, data)` e ne ritorna il valore in `D0`.
 *
 * **Disasm 0x4420..0x4441** (34 byte):
 *
 *   move.l  D2,-(SP)              ; preserve D2
 *   move.l  (0x8,SP),D2           ; D2 = arg1 (cmdIndex, long)
 *   move.l  (0xC,SP),D1           ; D1 = arg2 (data, long)
 *   moveq   #0x0B,D0              ; D0 = 0x0B
 *   cmp.l   D2,D0                 ; D0 - D2  → flags
 *   bls.s   skip_clear            ; if D0 <= D2 unsigned (cmdIndex >= 0x0B) skip
 *   moveq   #0,D1                 ; else: data = 0
 * skip_clear:
 *   move.l  D1,-(SP)              ; push (possibly cleared) data
 *   move.l  D2,-(SP)              ; push cmdIndex
 *   jsr     0x00004442.l          ; tail-call to dispatcher
 *   addq.l  #8,SP                 ; pop 2 long args
 *   move.l  (SP)+,D2              ; restore D2
 *   rts                           ; D0 = return of FUN_4442
 *
 * **Convenzione caller** (osservata sui 5 callsite reali):
 *   - `0x3D40`: `pea 0x0B; jsr 0x4420`           → cmdIndex = 0x0B  (no clear)
 *   - `0x59B8`: `pea 0x0D; jsr 0x4420`           → cmdIndex = 0x0D  (no clear)
 *   - `0x5A8A`: `clr.l -(SP); move.l D2,-(SP)`  → cmdIndex variabile (D2)
 *   - `0x5D1C`, `0x6194`: `pea 0x0C`             → cmdIndex = 0x0C  (no clear)
 *
 * Il path "clear" si attiva quindi solo via `0x5A8A` quando il caller passa
 * `cmdIndex` dinamico < 0x0B (es. effetti sonori indicizzati nel range
 * `0..0x0A` a cui non ha senso allegare un payload).
 *
 * **Side effects** in questo modulo: NESSUNO. Tutti gli effetti (memory writes,
 * MMIO mailbox, ecc.) avvengono dentro `FUN_00004442` e sono gestiti dalla sua
 * replica TS (vedi `sound-dispatch-send.ts` / `audio.ts` per livelli a monte).
 *
 * **Ritorno (D0)**:
 *   pass-through del valore ritornato da `FUN_00004442` (32 bit). Il binario
 *   non altera `D0` dopo il `jsr`.
 *
 * **Convenzione TS**: l'`inner` dispatcher è iniettabile come parametro per
 * test e per futura integrazione con la replica reale di FUN_4442. Default
 * `() => 0` (no-op compatibile con il ritorno tipico di "nessun comando
 * inviato"). Il differential test usa l'inner stub costante per isolare la
 * logica di gating.
 */

/**
 * Signature dell'inner dispatcher (FUN_00004442). Riceve `(cmdIndex, data)`
 * — entrambi long unsigned (0..0xFFFFFFFF) — e ritorna un long che diventa
 * il valore D0 della gate.
 */
export type SoundCmdGateInner = (cmdIndex: number, data: number) => number;

/** Soglia di clamp: `cmdIndex < THRESHOLD` → `data` forzato a 0. */
export const CLAMP_THRESHOLD = 0x0b as const;

/**
 * Replica bit-perfect di `FUN_00004420` — sound command gate.
 *
 * @param cmdIndex  long (0..0xFFFFFFFF). Indice comando passato come arg1.
 * @param data      long (0..0xFFFFFFFF). Payload comando passato come arg2.
 *                  Viene forzato a 0 prima della chiamata interna se
 *                  `cmdIndex < 0x0B` (unsigned).
 * @param inner     callback che modella `FUN_00004442`. Default = `() => 0`
 *                  (utile per test della sola logica di gating). Riceve i due
 *                  long DOPO l'eventuale clamp.
 * @returns         D0 = pass-through del valore ritornato da `inner`.
 *
 * Note di low-level fidelity:
 *   - Il `cmp.l D2,D0` con `bls.s` corrisponde a un confronto unsigned 32-bit:
 *     `cmdIndex >= 0x0B` (unsigned) ⇒ `data` preservato. Per indici dal range
 *     `0..0x0A` (inclusivi) il clear scatta. Per long molto grandi (≥ 0x0B
 *     fino a 0xFFFFFFFF) il clear NON scatta.
 *   - L'inner dispatcher è chiamato SEMPRE (anche quando `data` è stato
 *     azzerato): non c'è un "early return" nel binario.
 *   - La funzione non tocca workRam direttamente; tutti i side-effects sono
 *     delegati all'inner.
 */
export function soundCmdGate(
  cmdIndex: number,
  data: number,
  inner: SoundCmdGateInner = () => 0,
): number {
  // Normalizza a unsigned 32-bit (corrisponde alla semantica long M68k).
  const idx = cmdIndex >>> 0;
  const dataNorm = data >>> 0;

  // bls.s skip_clear con cmp.l D2,D0 ⇒ branch taken se 0x0B <= idx (unsigned).
  // Path "clear": solo quando idx < 0x0B.
  const dataOut = idx < CLAMP_THRESHOLD ? 0 : dataNorm;

  // Tail-call al dispatcher con (cmdIndex, data_clamped).
  return inner(idx, dataOut) >>> 0;
}
