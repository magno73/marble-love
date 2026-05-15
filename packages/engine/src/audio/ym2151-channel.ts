/**
 * ym2151-channel.ts — Un YM2151 channel (4 operatori + algorithm + connection).
 *
 * Hardware: 8 channels totali. Ogni channel:
 *   - 4 operatori (op[0..3])
 *   - Algorithm 0..7 (FM topology)
 *   - Key code (KC) + key fraction (KF) condivisi tra op (con DT1/MUL per op)
 *   - Feedback (FB) sull'op[0] = self-modulation 0..7 (shift)
 *   - Connection register (CONN) = algorithm 0..7
 *   - L/R output enable (bit 7/6 of $20+ch)
 *   - PMS (LFO phase mod) / AMS (LFO amp mod) sensitivity
 *
 * Algorithm 0: 1 → 2 → 3 → 4 → output (4 op series chain).
 * Algorithm 7: 1+2+3+4 → output (all parallel, no FM).
 * Altri intermedi.
 *
 * Reference: Yamaha OPM application manual § 4.3 + MAME ym2151.cpp:chan_calc.
 */

import { type Operator, createOperator, operatorSample, operatorKeyOn, operatorKeyOff } from "./ym2151-operator.js";

export interface Channel {
  /** 4 operatori (slot 0..3). */
  op: Operator[];
  /** FM algorithm 0..7. */
  alg: number;
  /** Feedback su op[0]: 0=none, 1..7=progressively stronger self-modulation. */
  fb: number;
  /** Left/Right output enable (bit 7=L, bit 6=R). Default both. */
  lr: number;
  /** Phase modulation sensitivity (LFO PM) 0..7. */
  pms: number;
  /** Amplitude modulation sensitivity (LFO AM) 0..3. */
  ams: number;
  /** Last op[0] output (used for FB self-modulation). */
  fbHistory: number[];
}

export function createChannel(): Channel {
  return {
    op: [createOperator(), createOperator(), createOperator(), createOperator()],
    alg: 0,
    fb: 0,
    lr: 0xc0,  // both L+R enabled
    pms: 0,
    ams: 0,
    fbHistory: [0, 0],
  };
}

/** Compute 1 sample output del channel. Ritorna [left, right] entrambi -1..+1.
 * Implementa tutti gli 8 algoritmi FM dell'OPM.
 *
 * Reference algorithm topology (Yamaha datasheet § 4.3):
 *   alg 0: op1 → op2 → op3 → op4 → out (serial chain)
 *   alg 1: (op1 + op2) → op3 → op4 → out
 *   alg 2: op1 → op4; (op2 → op3 → op4) → out
 *   alg 3: (op1 → op2; op3) → op4 → out
 *   alg 4: (op1 → op2) + (op3 → op4) → out
 *   alg 5: op1 → op2; op1 → op3; op1 → op4 (op1 mod all)
 *   alg 6: op1 → op2; op3; op4 (parallel)
 *   alg 7: op1 + op2 + op3 + op4 → out (all parallel)
 */
export function channelSample(ch: Channel): [number, number] {
  const [op1, op2, op3, op4] = ch.op as [Operator, Operator, Operator, Operator];

  // Feedback su op1: media degli ultimi 2 output (hardware OPM uses 2-sample
  // delay average to reduce DC). Shift by (10 - fb) per scalare.
  const fbInput = ch.fb === 0
    ? 0
    : Math.round((ch.fbHistory[0]! + ch.fbHistory[1]!) / (1 << (10 - ch.fb)));

  let s1 = 0, s2 = 0, s3 = 0, s4 = 0;
  switch (ch.alg & 7) {
    case 0: // op1 → op2 → op3 → op4 → out
      s1 = operatorSample(op1, fbInput);
      s2 = operatorSample(op2, s1);
      s3 = operatorSample(op3, s2);
      s4 = operatorSample(op4, s3);
      break;
    case 1: // (op1 + op2) → op3 → op4 → out
      s1 = operatorSample(op1, fbInput);
      s2 = operatorSample(op2, 0);
      s3 = operatorSample(op3, s1 + s2);
      s4 = operatorSample(op4, s3);
      break;
    case 2: // op1 → op4; (op2 → op3) → op4 → out
      s1 = operatorSample(op1, fbInput);
      s2 = operatorSample(op2, 0);
      s3 = operatorSample(op3, s2);
      s4 = operatorSample(op4, s1 + s3);
      break;
    case 3: // (op1 → op2; op3) → op4 → out
      s1 = operatorSample(op1, fbInput);
      s2 = operatorSample(op2, s1);
      s3 = operatorSample(op3, 0);
      s4 = operatorSample(op4, s2 + s3);
      break;
    case 4: // (op1 → op2) + (op3 → op4) → out
      s1 = operatorSample(op1, fbInput);
      s2 = operatorSample(op2, s1);
      s3 = operatorSample(op3, 0);
      s4 = operatorSample(op4, s3);
      break;
    case 5: // op1 → op2; op1 → op3; op1 → op4 (op1 mods all 3)
      s1 = operatorSample(op1, fbInput);
      s2 = operatorSample(op2, s1);
      s3 = operatorSample(op3, s1);
      s4 = operatorSample(op4, s1);
      break;
    case 6: // op1 → op2; op3; op4 (parallel)
      s1 = operatorSample(op1, fbInput);
      s2 = operatorSample(op2, s1);
      s3 = operatorSample(op3, 0);
      s4 = operatorSample(op4, 0);
      break;
    case 7: // op1 + op2 + op3 + op4 → out (all parallel)
      s1 = operatorSample(op1, fbInput);
      s2 = operatorSample(op2, 0);
      s3 = operatorSample(op3, 0);
      s4 = operatorSample(op4, 0);
      break;
  }

  // FB history update (mid-frame post sample)
  ch.fbHistory[1] = ch.fbHistory[0]!;
  ch.fbHistory[0] = s1;

  // Carrier output: depends on algorithm. Per alg 0-3 carrier = op4.
  // Alg 4: op2 + op4. Alg 5: op2+op3+op4. Alg 6: op2+op3+op4. Alg 7: tutti 4.
  let carrierSum: number;
  switch (ch.alg & 7) {
    case 0: case 1: case 2: case 3:
      carrierSum = s4;
      break;
    case 4:
      carrierSum = s2 + s4;
      break;
    case 5: case 6:
      carrierSum = s2 + s3 + s4;
      break;
    case 7:
      carrierSum = s1 + s2 + s3 + s4;
      break;
    default:
      carrierSum = s4;
  }

  // Normalize: max amplitude = ~8191 (sine peak) × N carrier op (1..4).
  // Scale a -1..+1 float per Web Audio.
  const scaled = carrierSum / (8191 * 4);

  // L/R routing
  const left = (ch.lr & 0x80) !== 0 ? scaled : 0;
  const right = (ch.lr & 0x40) !== 0 ? scaled : 0;
  return [left, right];
}

/** Key ON: arma operatori in base al slot mask. */
export function channelKeyOn(ch: Channel, slotMask: number): void {
  if ((slotMask & 0x10) !== 0) operatorKeyOn(ch.op[0]!);
  if ((slotMask & 0x20) !== 0) operatorKeyOn(ch.op[1]!);
  if ((slotMask & 0x40) !== 0) operatorKeyOn(ch.op[2]!);
  if ((slotMask & 0x80) !== 0) operatorKeyOn(ch.op[3]!);
}

/** Key OFF: release operatori non in maschera. */
export function channelKeyOff(ch: Channel, slotMask: number): void {
  if ((slotMask & 0x10) === 0) operatorKeyOff(ch.op[0]!);
  if ((slotMask & 0x20) === 0) operatorKeyOff(ch.op[1]!);
  if ((slotMask & 0x40) === 0) operatorKeyOff(ch.op[2]!);
  if ((slotMask & 0x80) === 0) operatorKeyOff(ch.op[3]!);
}
