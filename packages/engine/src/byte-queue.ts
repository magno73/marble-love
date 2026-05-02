/**
 * byte-queue.ts — circular byte queue + piccole utility byte-level.
 *
 * Il binario tiene una "byte queue" a `0x401F44` con 16 elementi e
 * head/tail byte indices. Usata (probabilmente) per i comandi sound: i
 * produttori (game logic) accodano comandi, il consumer (sound IRQ)
 * dequeue e li manda al chip audio MMIO.
 *
 * Layout struct @ 0x401F44:
 *   +0x00  status flags (1 byte) — set/cleared dai produttori
 *   +0x01  ?
 *   +0x02..0x11  16-byte circular buffer
 *   +0x12  head index (byte; 0..15, wraps)
 *   +0x13  tail index (byte; 0..15, wraps)
 *   +0x14..0x19  altre fields modificate da FUN_4D98
 *
 * **Verificate bit-perfect** vs binary tramite `cli/src/test-byte-queue-parity.ts`.
 */

import type { GameState } from "./state.js";

/** Offset workRam del head/tail/buffer struct (assoluto 0x401F44). */
export const QUEUE_BASE_OFF = 0x1f44 as const;
export const QUEUE_DATA_OFF = QUEUE_BASE_OFF + 0x02;
export const QUEUE_HEAD_OFF = QUEUE_BASE_OFF + 0x12;
export const QUEUE_TAIL_OFF = QUEUE_BASE_OFF + 0x13;

/** Numero di slot del circular buffer. */
export const QUEUE_CAPACITY = 16 as const;

// ─── dequeueByte (FUN_4D68) ───────────────────────────────────────────────

/**
 * Replica `FUN_00004D68` — `dequeueByte()`.
 *
 * Disassembly (12 istruzioni):
 *   lea     (0x401F44).l, A0
 *   move.b  (0x12, A0), D0b           ; D0.b = head
 *   cmp.b   (0x13, A0), D0b           ; head == tail?
 *   beq.w   empty                     ; queue vuota → return -1
 *   addq.b  #1, (0x12, A0)            ; head++
 *   cmpi.b  #0xF, D0b
 *   bcs.w   skip_wrap                 ; if old_head < 15: skip
 *   clr.b   (0x12, A0)                ; else (old_head == 15): wrap to 0
 *   skip_wrap:
 *   ext.w   D0w
 *   ext.l   D0
 *   move.b  (0x2, A0, D0w*0x1), D0b   ; D0.b = buffer[old_head]
 *   rts
 *   empty:
 *   moveq   #-1, D0                   ; return -1 (0xFFFFFFFF as long)
 *   rts
 *
 * Ritorna il byte all'indice `head` corrente (0..255 unsigned), oppure
 * -1 (0xFFFFFFFF) se la queue è vuota (head == tail).
 *
 * Side effect (solo se non vuota): head avanza di 1 con wrap a 16
 * (quando old_head era 15, head torna a 0; altrimenti head += 1).
 */
export function dequeueByte(state: GameState): number {
  const head = state.workRam[QUEUE_HEAD_OFF] ?? 0;
  const tail = state.workRam[QUEUE_TAIL_OFF] ?? 0;

  if (head === tail) {
    return 0xffffffff; // moveq #-1, D0 → tutti i bit a 1 (long)
  }

  // Read byte at buffer[head] BEFORE updating head
  const byte = state.workRam[QUEUE_DATA_OFF + head] ?? 0;

  // Advance head: addq.b 0x1 (wraps modulo 256), then if old head >= 15 → clear
  let newHead = (head + 1) & 0xff;
  if (head >= 0xf) newHead = 0;
  state.workRam[QUEUE_HEAD_OFF] = newHead;

  // Return value: D0 high bits = sign-extended head (always 0 for head 0..15),
  // D0 low byte = byte. Net: byte (0..255) as positive long.
  return byte;
}

// ─── orPairBytes (FUN_53EA) ───────────────────────────────────────────────

/**
 * Replica `FUN_000053EA` — `orPairBytes(ptr) = ptr[0] | ptr[1]`.
 *
 * Disassembly (~13 istruzioni):
 *   movea.l (0x8,SP), A0
 *   moveq   #0, D1
 *   move.b  (A0), D1b           ; D1 = ptr[0]
 *   moveq   #0, D0
 *   move.b  (A0)+, D0b          ; D0 = ptr[0] (same byte), A0++
 *   movea.l A0, A1              ; A1 = ptr+1
 *   addq.l  #1, A0              ; A0 = ptr+2 (dead — non usato dopo)
 *   moveq   #0, D2
 *   move.b  (A1), D2b           ; D2 = ptr[1]
 *   or.l    D2, D0              ; D0 = ptr[0] | ptr[1]
 *   or.l    D0, D1              ; D1 = ptr[0] | (ptr[0] | ptr[1]) = ptr[0] | ptr[1]
 *   move.l  D1, D0
 *   rts
 *
 * Ritorna `ptr[0] | ptr[1]` come long (high bits = 0).
 *
 * **Use case**: probabilmente test "almeno uno dei 2 byte è non-zero" su
 * struct flag (ad es. due byte di status accoppiati).
 */
export function orPairBytes(state: GameState, ptr: number): number {
  const off = (ptr - 0x400000) >>> 0;
  if (off + 1 >= state.workRam.length) return 0;
  const b0 = state.workRam[off] ?? 0;
  const b1 = state.workRam[off + 1] ?? 0;
  return (b0 | b1) >>> 0;
}
