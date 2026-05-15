/**
 * probe-sound-diff.ts — Differential testing TS SoundChip vs MAME oracle.
 *
 * Carica un dump MAME generato da `oracle/mame_sound_dump.lua` (JSON con
 * audiocpu regs + audioRam + ym2151 regs + pokey regs + mailbox state),
 * esegue il TS SoundChip per N frame da reset, e diffa il register shadow
 * byte per byte.
 *
 * Phase 5/6 V2 register-state parity criterion: 0 byte diff su tutte le
 * regioni quando 6502 gira freerunning (no cmd input dal main).
 *
 * Usage:
 *   npx tsx packages/cli/src/probe-sound-diff.ts /tmp/mame_sound_state_600.json
 *
 * Output:
 *   audioRam (4KB) diff: N byte
 *   YM2151 regs diff:    N byte
 *   POKEY writeRegs diff: N byte
 *   Status: PASS | FAIL (criterion ≤ 0 byte per V2 strict)
 *
 * Phase 7 (V3 sample-level audio): aggiunge diff su sample stream (richiede
 * envelope + operator FM sync con MAME ym2151_device::sound_stream_update).
 */

import { readFileSync } from "node:fs";
import { createSoundChip, tickCycles, getRegisterShadow } from "../../engine/src/m6502/sound-chip.js";
import { SOUND_CYCLES_PER_FRAME } from "../../engine/src/m6502/sound-clock.js";

interface MameDump {
  frame: number;
  audiocpu: { a: number; x: number; y: number; sp: number; p: number; pc: number };
  audioRam: string;          // 4KB hex (8192 chars)
  mailbox: { soundlatch: number; mainlatch: number; pendingSound: string; pendingMain: string };
  ym2151: string;            // 256 byte hex (512 chars)
  pokey: string;             // 16 byte hex (32 chars)
}

function hex2bytes(hex: string, expectedLen: number): Uint8Array {
  if (hex.length !== expectedLen * 2) {
    throw new Error(`hex2bytes: atteso ${expectedLen * 2} char, ricevuti ${hex.length}`);
  }
  const out = new Uint8Array(expectedLen);
  for (let i = 0; i < expectedLen; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function diffBytes(a: Uint8Array, b: Uint8Array, label: string): {
  count: number;
  firstOffset: number;
  total: number;
  summary: string;
} {
  if (a.length !== b.length) {
    throw new Error(`${label} length mismatch: ${a.length} vs ${b.length}`);
  }
  let count = 0;
  let firstOffset = -1;
  const offsets: number[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      count++;
      if (firstOffset < 0) firstOffset = i;
      if (offsets.length < 10) offsets.push(i);
    }
  }
  const summary = count === 0
    ? "PASS"
    : `FAIL first@0x${firstOffset.toString(16)} (offsets: ${offsets.map((o) => "0x" + o.toString(16)).join(",")}${count > offsets.length ? "..." : ""})`;
  return { count, firstOffset, total: a.length, summary };
}

function main(): void {
  const dumpPath = process.argv[2];
  if (dumpPath === undefined) {
    console.error("Usage: probe-sound-diff.ts <mame-dump.json>");
    process.exit(1);
  }
  const dump: MameDump = JSON.parse(readFileSync(dumpPath, "utf8"));
  console.log(`Loaded MAME dump @ frame ${dump.frame}`);
  console.log(`  audiocpu PC=$${dump.audiocpu.pc.toString(16)}, A=$${dump.audiocpu.a.toString(16)}, SP=$${dump.audiocpu.sp.toString(16)}`);

  // Carica ROM
  const rom421 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.421"));
  const rom422 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.422"));

  // TS SoundChip da reset, tick fino a dump.frame
  const chip = createSoundChip({ roms: { rom421, rom422 } });
  const targetCycles = dump.frame * SOUND_CYCLES_PER_FRAME;
  console.log(`Ticking TS to ${targetCycles} cycles (${dump.frame} frame @ ${SOUND_CYCLES_PER_FRAME} cyc/frame)...`);
  tickCycles(chip, targetCycles);
  console.log(`TS @ ${chip.cpu.cycles} cycles, PC=$${(chip.cpu.rf.pc as number).toString(16)}`);

  // Estrai shadow MAME
  const mameAudioRam = hex2bytes(dump.audioRam, 0x1000);
  const mameYm = hex2bytes(dump.ym2151, 256);
  const mamePokey = hex2bytes(dump.pokey, 16);

  // Estrai shadow TS
  const tsShadow = getRegisterShadow(chip);

  // Diff
  const dAudio = diffBytes(tsShadow.audioRam, mameAudioRam, "audioRam");
  const dYm = diffBytes(tsShadow.ym2151Regs, mameYm, "YM2151");
  const dPokey = diffBytes(tsShadow.pokeyWriteRegs, mamePokey, "POKEY");

  console.log("");
  console.log(`Region differential vs MAME oracle @ frame ${dump.frame}:`);
  console.log(`  audioRam   (4KB):  ${dAudio.count.toString().padStart(4)} / ${dAudio.total} byte  ${dAudio.summary}`);
  console.log(`  YM2151 regs (256): ${dYm.count.toString().padStart(4)} / ${dYm.total} byte  ${dYm.summary}`);
  console.log(`  POKEY regs  (16):  ${dPokey.count.toString().padStart(4)} / ${dPokey.total} byte  ${dPokey.summary}`);

  const total = dAudio.count + dYm.count + dPokey.count;
  console.log("");
  if (total === 0) {
    console.log("Status: PASS — register-state bit-perfect MAME oracle.");
    process.exit(0);
  } else {
    console.log(`Status: FAIL — total ${total} byte divergent. Phase 5/6 V2 criterion: 0.`);
    console.log("Hint: undocumented opcode? mailbox timing skew? chip stub partial?");
    process.exit(2);
  }
}

main();
