/**
 * ym2151-channel.ts - one YM2151 channel with four operators and routing state.
 *
 * Hardware: 8 channels total. Each channel has:
 *   - 4 operators (`op[0..3]`)
 *   - Algorithm 0..7 (FM topology)
 *   - Shared key code (KC) and key fraction (KF), plus per-operator DT1/MUL
 *   - Feedback (FB) on op[0], used as self-modulation strength 0..7
 *   - Connection register (CONN) = algorithm 0..7
 *   - L/R output enable (bit 7/6 of $20+ch)
 *   - PMS (LFO phase mod) / AMS (LFO amp mod) sensitivity
 *
 * Algorithm 0 is a serial 1 -> 2 -> 3 -> 4 chain; algorithm 7 is all
 * operators in parallel. The other algorithms are the OPM's intermediate
 * modulation graphs.
 *
 * Reference: Yamaha OPM application manual section 4.3 and MAME
 * `ym2151.cpp::chan_calc`.
 */

import { type Operator, createOperator, operatorSample, operatorKeyOn, operatorKeyOff } from "./ym2151-operator.js";

export interface Channel {
  /** Four operators, slots 0..3. */
  op: Operator[];
  /** FM algorithm 0..7. */
  alg: number;
  /** Feedback on op[0]: 0=none, 1..7=progressively stronger self-modulation. */
  fb: number;
  /** Left/Right output enable. MAME routes OPM output 0 (bit 6) left and output 1 (bit 7) right. */
  lr: number;
  /** Phase modulation sensitivity (LFO PM) 0..7. */
  pms: number;
  /** Amplitude modulation sensitivity (LFO AM) 0..3. */
  ams: number;
  /** Key code register value ($28-$2F), 7-bit block+note. */
  kc: number;
  /** Key fraction register value ($30-$37), top 6 bits used. */
  kf: number;
  /** Latest KEY ON live mask written by reg $08; sampled on the next chip clock. */
  keyLiveMask: number;
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
    kc: 0,
    kf: 0,
    keyLiveMask: 0,
    fbHistory: [0, 0],
  };
}

function feedbackToPhaseMod(value: number): number {
  return (value | 0) * 1024;
}

function outputToPhaseMod(value: number): number {
  return ((value | 0) >> 1) * 1024;
}

/**
 * Computes one channel sample and returns raw 14-bit left/right sums before
 * final mixer normalization.
 *
 * Reference algorithm topology (Yamaha datasheet section 4.3):
 *   alg 0: op1 -> op2 -> op3 -> op4 -> out (serial chain)
 *   alg 1: (op1 + op2) -> op3 -> op4 -> out
 *   alg 2: op1 -> op4; (op2 -> op3 -> op4) -> out
 *   alg 3: (op1 -> op2; op3) -> op4 -> out
 *   alg 4: (op1 -> op2) + (op3 -> op4) -> out
 *   alg 5: op1 -> op2; op1 -> op3; op1 -> op4
 *   alg 6: op1 -> op2; op3; op4
 *   alg 7: op1 + op2 + op3 + op4 -> out
 */
export function channelSample(
  ch: Channel,
  amOffset: number = 0,
  advancePhaseBeforeOutput = true,
): [number, number] {
  const [op1, op2, op3, op4] = ch.op as [Operator, Operator, Operator, Operator];

  // Feedback on op1: average the two previous outputs, then scale by FB.
  const fbInput = ch.fb === 0
    ? 0
    : ((ch.fbHistory[0]! + ch.fbHistory[1]!) >> (10 - ch.fb));

  let s1 = 0, s2 = 0, s3 = 0, s4 = 0;
  switch (ch.alg & 7) {
    case 0: // op1 -> op2 -> op3 -> op4 -> out
      s1 = operatorSample(op1, feedbackToPhaseMod(fbInput), amOffset, advancePhaseBeforeOutput);
      s2 = operatorSample(op2, outputToPhaseMod(s1), amOffset, advancePhaseBeforeOutput);
      s3 = operatorSample(op3, outputToPhaseMod(s2), amOffset, advancePhaseBeforeOutput);
      s4 = operatorSample(op4, outputToPhaseMod(s3), amOffset, advancePhaseBeforeOutput);
      break;
    case 1: // (op1 + op2) -> op3 -> op4 -> out
      s1 = operatorSample(op1, feedbackToPhaseMod(fbInput), amOffset, advancePhaseBeforeOutput);
      s2 = operatorSample(op2, 0, amOffset, advancePhaseBeforeOutput);
      s3 = operatorSample(op3, outputToPhaseMod(s1 + s2), amOffset, advancePhaseBeforeOutput);
      s4 = operatorSample(op4, outputToPhaseMod(s3), amOffset, advancePhaseBeforeOutput);
      break;
    case 2: // op1 -> op4; (op2 -> op3) -> op4 -> out
      s1 = operatorSample(op1, feedbackToPhaseMod(fbInput), amOffset, advancePhaseBeforeOutput);
      s2 = operatorSample(op2, 0, amOffset, advancePhaseBeforeOutput);
      s3 = operatorSample(op3, outputToPhaseMod(s2), amOffset, advancePhaseBeforeOutput);
      s4 = operatorSample(op4, outputToPhaseMod(s1 + s3), amOffset, advancePhaseBeforeOutput);
      break;
    case 3: // (op1 -> op2; op3) -> op4 -> out
      s1 = operatorSample(op1, feedbackToPhaseMod(fbInput), amOffset, advancePhaseBeforeOutput);
      s2 = operatorSample(op2, outputToPhaseMod(s1), amOffset, advancePhaseBeforeOutput);
      s3 = operatorSample(op3, 0, amOffset, advancePhaseBeforeOutput);
      s4 = operatorSample(op4, outputToPhaseMod(s2 + s3), amOffset, advancePhaseBeforeOutput);
      break;
    case 4: // (op1 -> op2) + (op3 -> op4) -> out
      s1 = operatorSample(op1, feedbackToPhaseMod(fbInput), amOffset, advancePhaseBeforeOutput);
      s2 = operatorSample(op2, outputToPhaseMod(s1), amOffset, advancePhaseBeforeOutput);
      s3 = operatorSample(op3, 0, amOffset, advancePhaseBeforeOutput);
      s4 = operatorSample(op4, outputToPhaseMod(s3), amOffset, advancePhaseBeforeOutput);
      break;
    case 5: // op1 -> op2; op1 -> op3; op1 -> op4
      s1 = operatorSample(op1, feedbackToPhaseMod(fbInput), amOffset, advancePhaseBeforeOutput);
      s2 = operatorSample(op2, outputToPhaseMod(s1), amOffset, advancePhaseBeforeOutput);
      s3 = operatorSample(op3, outputToPhaseMod(s1), amOffset, advancePhaseBeforeOutput);
      s4 = operatorSample(op4, outputToPhaseMod(s1), amOffset, advancePhaseBeforeOutput);
      break;
    case 6: // op1 -> op2; op3; op4
      s1 = operatorSample(op1, feedbackToPhaseMod(fbInput), amOffset, advancePhaseBeforeOutput);
      s2 = operatorSample(op2, outputToPhaseMod(s1), amOffset, advancePhaseBeforeOutput);
      s3 = operatorSample(op3, 0, amOffset, advancePhaseBeforeOutput);
      s4 = operatorSample(op4, 0, amOffset, advancePhaseBeforeOutput);
      break;
    case 7: // op1 + op2 + op3 + op4 -> out
      s1 = operatorSample(op1, feedbackToPhaseMod(fbInput), amOffset, advancePhaseBeforeOutput);
      s2 = operatorSample(op2, 0, amOffset, advancePhaseBeforeOutput);
      s3 = operatorSample(op3, 0, amOffset, advancePhaseBeforeOutput);
      s4 = operatorSample(op4, 0, amOffset, advancePhaseBeforeOutput);
      break;
  }

  // FB history update (mid-frame post sample)
  ch.fbHistory[1] = ch.fbHistory[0]!;
  ch.fbHistory[0] = s1;

  // Carrier output depends on the algorithm.
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

  // L/R routing: OPM bit 6 is output 0, routed to MAME's left speaker on Atari System 1.
  const left = (ch.lr & 0x40) !== 0 ? carrierSum : 0;
  const right = (ch.lr & 0x80) !== 0 ? carrierSum : 0;
  return [left, right];
}

/** Key on the operators selected by the slot mask. */
export function channelKeyOn(ch: Channel, slotMask: number): void {
  if ((slotMask & 0x10) !== 0) operatorKeyOn(ch.op[0]!);
  if ((slotMask & 0x20) !== 0) operatorKeyOn(ch.op[1]!);
  if ((slotMask & 0x40) !== 0) operatorKeyOn(ch.op[2]!);
  if ((slotMask & 0x80) !== 0) operatorKeyOn(ch.op[3]!);
}

/** Key off operators not present in the slot mask. */
export function channelKeyOff(ch: Channel, slotMask: number): void {
  if ((slotMask & 0x10) === 0) operatorKeyOff(ch.op[0]!);
  if ((slotMask & 0x20) === 0) operatorKeyOff(ch.op[1]!);
  if ((slotMask & 0x40) === 0) operatorKeyOff(ch.op[2]!);
  if ((slotMask & 0x80) === 0) operatorKeyOff(ch.op[3]!);
}

/** Store the reg $08 key live mask. ymfm samples this state on the chip clock. */
export function channelSetKeyLiveMask(ch: Channel, slotMask: number): void {
  ch.keyLiveMask = slotMask & 0xf0;
}

/** Apply the live key mask to operator edge state for one chip sample. */
export function channelClockKeyState(ch: Channel): void {
  channelKeyOff(ch, ch.keyLiveMask);
  channelKeyOn(ch, ch.keyLiveMask);
}
