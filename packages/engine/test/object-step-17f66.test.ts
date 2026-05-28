/**
 * Test objectStep17F66 (FUN_17F66) — smoke tests sui rami principali.
 *
 */

import { describe, it, expect } from "vitest";
import {
  objectStep17F66,
  type ObjectStepCallees,
  COMMAND_WHITELIST,
  STUCK_DELTA,
  STUCK_CLAMP,
  VEL_SCALE,
  DEPTH_BASE,
  MODE_5_FLOOR,
} from "../src/object-step-17f66.js";
import { emptyGameState } from "../src/state.js";

const A2_ADDR = 0x401200;
const A2_OFF = A2_ADDR - 0x400000;

function makeCallees(): {
  callees: ObjectStepCallees;
  log: { kind: string; arg?: number }[];
} {
  const log: { kind: string; arg?: number }[] = [];
  const callees: ObjectStepCallees = {
    fun1815A: (a) => log.push({ kind: "1815A", arg: a >>> 0 }),
    fun180BE: () => log.push({ kind: "180BE" }),
    fun26196: (a) => log.push({ kind: "26196", arg: a >>> 0 }),
  };
  return { callees, log };
}

function writeU32BE(buf: Uint8Array, off: number, v: number): void {
  buf[off] = (v >>> 24) & 0xff;
  buf[off + 1] = (v >>> 16) & 0xff;
  buf[off + 2] = (v >>> 8) & 0xff;
  buf[off + 3] = v & 0xff;
}

function readU32BE(buf: Uint8Array, off: number): number {
  return (
    (((buf[off] ?? 0) << 24) |
      ((buf[off + 1] ?? 0) << 16) |
      ((buf[off + 2] ?? 0) << 8) |
      (buf[off + 3] ?? 0)) >>>
    0
  );
}

describe("objectStep17F66 (FUN_17F66)", () => {
  it("costanti coerenti col disasm", () => {
    expect(VEL_SCALE).toBe(0x160);
    expect(DEPTH_BASE).toBe(0x1f);
    expect(MODE_5_FLOOR).toBe(4);
    expect(STUCK_DELTA).toBe(-0x6000);
    expect(STUCK_CLAMP).toBe(0xfffb0000);
    // Whitelist ha esattamente 10 byte ammessi.
    expect(COMMAND_WHITELIST.size).toBe(10);
    for (const v of [0x00, 0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x38, 0x39, 0x3a, 0x3b]) {
      expect(COMMAND_WHITELIST.has(v)).toBe(true);
    }
    // Spot-check: byte non in whitelist.
    for (const v of [0x01, 0x2c, 0x32, 0x37, 0x3c, 0x80, 0xff]) {
      expect(COMMAND_WHITELIST.has(v)).toBe(false);
    }
  });

  it("skip path: state18 == 2 → nessuna jsr, nessuna mutazione", () => {
    const s = emptyGameState();
    s.workRam[A2_OFF + 0x18] = 2;
    s.workRam[A2_OFF + 0x00] = 0xaa;
    s.workRam[A2_OFF + 0x04] = 0xbb;
    s.workRam[A2_OFF + 0x08] = 0xcc;
    const { callees, log } = makeCallees();

    const r = objectStep17F66(s, A2_ADDR, callees);

    expect(r.path).toBe("skip");
    expect(log).toHaveLength(0);
    expect(s.workRam[A2_OFF + 0x00]).toBe(0xaa);
    expect(s.workRam[A2_OFF + 0x04]).toBe(0xbb);
    expect(s.workRam[A2_OFF + 0x08]).toBe(0xcc);
  });

  it("skip path: state18 == 3 → identico al ramo 2", () => {
    const s = emptyGameState();
    s.workRam[A2_OFF + 0x18] = 3;
    const { callees, log } = makeCallees();
    const r = objectStep17F66(s, A2_ADDR, callees);
    expect(r.path).toBe("skip");
    expect(log).toHaveLength(0);
  });

  it("special-dispatch: *0x400390 word == 1 → fun1815A(a2) e poi return", () => {
    const s = emptyGameState();
    s.workRam[0x0390] = 0x00;
    s.workRam[0x0391] = 0x01;
    s.workRam[A2_OFF + 0x18] = 0; // not skip
    const { callees, log } = makeCallees();
    const r = objectStep17F66(s, A2_ADDR, callees);
    expect(r.path).toBe("special");
    expect(log).toEqual([{ kind: "1815A", arg: A2_ADDR }]);
  });

  it("movement path: cmd whitelist + mode!=1,5 → store+add e fun26196", () => {
    const s = emptyGameState();
    s.workRam[A2_OFF + 0x18] = 0;
    // global390 != 1 (resta 0)
    s.workRam[A2_OFF + 0x58] = 0x2d; // whitelist
    s.workRam[A2_OFF + 0x36] = 0; // not 2
    s.workRam[A2_OFF + 0x1a] = 0; // mode 0, no scaling
    s.workRam[A2_OFF + 0xc6] = 0x10; // → 0x4006AA
    s.workRam[A2_OFF + 0xc7] = 0x20; // → 0x4006A8
    writeU32BE(s.workRam, A2_OFF + 0x00, 0); // pos.x
    writeU32BE(s.workRam, A2_OFF + 0x04, 0); // pos.y

    const { callees, log } = makeCallees();
    const r = objectStep17F66(s, A2_ADDR, callees);

    expect(r.path).toBe("movement");
    expect(s.workRam[0x06aa]).toBe(0x10);
    expect(s.workRam[0x06a8]).toBe(0x20);
    // dx = sext(0x20) * 0x160 = 32 * 352 = 11264
    // dy = -sext(0x10) * 0x160 = -16 * 352 = -5632 (i32)
    expect(readU32BE(s.workRam, A2_OFF + 0x00)).toBe(11264 >>> 0);
    expect(readU32BE(s.workRam, A2_OFF + 0x04)).toBe(-5632 >>> 0);
    expect(log).toEqual([{ kind: "26196", arg: A2_ADDR }]);
  });

  it("movement path: global396 == 1 → fun180BE() invece di store byte", () => {
    const s = emptyGameState();
    s.workRam[A2_OFF + 0x18] = 0;
    // global396 word == 1
    s.workRam[0x0396] = 0x00;
    s.workRam[0x0397] = 0x01;
    s.workRam[A2_OFF + 0x58] = 0x00; // whitelist (== 0)
    s.workRam[A2_OFF + 0x36] = 0;
    s.workRam[A2_OFF + 0x1a] = 0;
    s.workRam[0x06a8] = 0x05; // dy_b
    s.workRam[0x06aa] = 0x03; // dx_b
    s.workRam[A2_OFF + 0xc6] = 0x77;
    s.workRam[A2_OFF + 0xc7] = 0x88;

    const { callees, log } = makeCallees();
    const r = objectStep17F66(s, A2_ADDR, callees);

    expect(r.path).toBe("movement");
    expect(s.workRam[0x06a8]).toBe(0x05);
    expect(s.workRam[0x06aa]).toBe(0x03);
    // dx = sext(5)*0x160 = 1760, dy = -sext(3)*0x160 = -1056
    expect(readU32BE(s.workRam, A2_OFF + 0x00)).toBe(1760 >>> 0);
    expect(readU32BE(s.workRam, A2_OFF + 0x04)).toBe(-1056 >>> 0);
    expect(log).toEqual([
      { kind: "180BE" },
      { kind: "26196", arg: A2_ADDR },
    ]);
  });

  it("movement path: mode==5 con D1 < 4 → clamp D1=4 nel scaling", () => {
    const s = emptyGameState();
    s.workRam[A2_OFF + 0x18] = 0;
    s.workRam[A2_OFF + 0x58] = 0x2e; // whitelist
    s.workRam[A2_OFF + 0x36] = 0;
    s.workRam[A2_OFF + 0x1a] = 5; // mode 5 → scaling + clamp
    // depth = 0x40 → sext = 64, D1 = 0x1F - 64 = -33 < 4 → clamp 4
    s.workRam[A2_OFF + 0x56] = 0x40;
    // cmd_x = 0x10 → 0x4006AA, cmd_y = 0x10 → 0x4006A8
    s.workRam[A2_OFF + 0xc6] = 0x10;
    s.workRam[A2_OFF + 0xc7] = 0x10;
    writeU32BE(s.workRam, A2_OFF + 0x00, 0);
    writeU32BE(s.workRam, A2_OFF + 0x04, 0);

    const { callees } = makeCallees();
    const r = objectStep17F66(s, A2_ADDR, callees);

    expect(r.path).toBe("movement");
    // d3 = 16 * 0x160 = 5632. asr.l #8 = 22 (5632 >> 8). muls.w #4 = 88. asl.l #3 = 704.
    expect(readU32BE(s.workRam, A2_OFF + 0x00)).toBe(704 >>> 0);
    expect(readU32BE(s.workRam, A2_OFF + 0x04)).toBe(-704 >>> 0);
  });

  it("movement path: mode==1 senza clamp (D1 può essere < 4 senza clamp)", () => {
    const s = emptyGameState();
    s.workRam[A2_OFF + 0x18] = 0;
    s.workRam[A2_OFF + 0x58] = 0x31; // whitelist
    s.workRam[A2_OFF + 0x36] = 0;
    s.workRam[A2_OFF + 0x1a] = 1; // mode 1 → scaling NO clamp
    // depth = 0x40 → D1 = 0x1F - 64 = -33 (NO clamp in mode 1)
    s.workRam[A2_OFF + 0x56] = 0x40;
    s.workRam[A2_OFF + 0xc6] = 0x10;
    s.workRam[A2_OFF + 0xc7] = 0x10;
    writeU32BE(s.workRam, A2_OFF + 0x00, 0);
    writeU32BE(s.workRam, A2_OFF + 0x04, 0);

    const { callees } = makeCallees();
    objectStep17F66(s, A2_ADDR, callees);

    // d3 iniz = 5632; asr.l #8 = 22; muls.w D1w (D1=-33) = -726; asl.l #3 = -5808.
    expect(readU32BE(s.workRam, A2_OFF + 0x00)).toBe(-5808 >>> 0);
    // d2 iniz = -5632; asr.l #8 = -22 (signed); muls.w (-33) = 726; asl.l #3 = 5808.
    expect(readU32BE(s.workRam, A2_OFF + 0x04)).toBe(5808 >>> 0);
  });

  it("stuck path: state36==2 bypass whitelist; (8,A2) post-addi >= -0x50000 → no clamp", () => {
    const s = emptyGameState();
    s.workRam[A2_OFF + 0x18] = 0;
    s.workRam[A2_OFF + 0x58] = 0x2d; // whitelist match (irrilevante: state36==2 bypass)
    s.workRam[A2_OFF + 0x36] = 2;
    writeU32BE(s.workRam, A2_OFF + 0x08, 0x00010000);

    const { callees, log } = makeCallees();
    const r = objectStep17F66(s, A2_ADDR, callees);

    expect(r.path).toBe("stuck");
    // (8,A2) -= 0x6000 → 0x10000 - 0x6000 = 0xA000. >= -0x50000 → no clamp.
    expect(readU32BE(s.workRam, A2_OFF + 0x08)).toBe(0xa000);
    expect(log).toEqual([{ kind: "26196", arg: A2_ADDR }]);
  });

  it("stuck path: post-addi value < -0x50000 signed → clamp 0xFFFB0000", () => {
    const s = emptyGameState();
    s.workRam[A2_OFF + 0x18] = 0;
    s.workRam[A2_OFF + 0x58] = 0x80; // NON in whitelist (irrilevante per clamp ora)
    s.workRam[A2_OFF + 0x36] = 1;
    // Inizia molto negativo: -0x4FFFF + ulteriore -0x6000 = -0x55FFF < -0x50000 → clamp.
    writeU32BE(s.workRam, A2_OFF + 0x08, (-0x4ffff) >>> 0);

    const { callees, log } = makeCallees();
    const r = objectStep17F66(s, A2_ADDR, callees);

    expect(r.path).toBe("stuck");
    expect(readU32BE(s.workRam, A2_OFF + 0x08)).toBe(STUCK_CLAMP);
    expect(log).toEqual([{ kind: "26196", arg: A2_ADDR }]);
  });

  it("stuck path: post-addi >= -0x50000 → NESSUN clamp (anche con cmd bit7 set)", () => {
    const s = emptyGameState();
    s.workRam[A2_OFF + 0x18] = 0;
    s.workRam[A2_OFF + 0x58] = 0xff; // bit7 set ma irrilevante (la logica e' cmpi.l)
    s.workRam[A2_OFF + 0x36] = 1;
    // Inizia 0 → post-addi = -0x6000. -0x6000 >= -0x50000 → no clamp.
    writeU32BE(s.workRam, A2_OFF + 0x08, 0);

    const { callees } = makeCallees();
    const r = objectStep17F66(s, A2_ADDR, callees);

    expect(r.path).toBe("stuck");
    expect(readU32BE(s.workRam, A2_OFF + 0x08)).toBe((-0x6000) >>> 0);
  });

  it("stuck path: state36==0 → no addi, no clamp, ma chiama fun26196", () => {
    const s = emptyGameState();
    s.workRam[A2_OFF + 0x18] = 0;
    s.workRam[A2_OFF + 0x58] = 0xff; // NON in whitelist
    s.workRam[A2_OFF + 0x36] = 0; // gate stuck mods
    writeU32BE(s.workRam, A2_OFF + 0x08, 0xcafef00d);

    const { callees, log } = makeCallees();
    const r = objectStep17F66(s, A2_ADDR, callees);

    expect(r.path).toBe("stuck");
    // (8,A2) inalterato.
    expect(readU32BE(s.workRam, A2_OFF + 0x08)).toBe(0xcafef00d);
    expect(log).toEqual([{ kind: "26196", arg: A2_ADDR }]);
  });

  it("priorita': skip > special > movement/stuck (skip vince anche con global390==1)", () => {
    const s = emptyGameState();
    s.workRam[0x0390] = 0x00;
    s.workRam[0x0391] = 0x01; // would trigger special
    s.workRam[A2_OFF + 0x18] = 2; // skip wins
    const { callees, log } = makeCallees();
    const r = objectStep17F66(s, A2_ADDR, callees);
    expect(r.path).toBe("skip");
    expect(log).toHaveLength(0);
  });

  it("addi long signed: (8,A2)=0x3000 → 0xFFFFD000 (-0x3000); ge -0x50000 → no clamp", () => {
    const s = emptyGameState();
    s.workRam[A2_OFF + 0x18] = 0;
    s.workRam[A2_OFF + 0x58] = 0xfe; // NOT whitelist → stuck path
    s.workRam[A2_OFF + 0x36] = 1;
    writeU32BE(s.workRam, A2_OFF + 0x08, 0x00003000);

    const { callees } = makeCallees();
    objectStep17F66(s, A2_ADDR, callees);

    // 0x3000 + (-0x6000) = -0x3000 (i32) = 0xFFFFD000.
    // -0x3000 >= -0x50000 signed → no clamp.
    expect(readU32BE(s.workRam, A2_OFF + 0x08)).toBe(0xffffd000);
  });

  it("global390 cmp e' WORD a 0x400390 (BE), non long: byte 0x390=0x00 0x391=0x02 NON triggera", () => {
    const s = emptyGameState();
    s.workRam[A2_OFF + 0x18] = 0;
    s.workRam[0x0390] = 0x00;
    s.workRam[0x0391] = 0x02; // word == 2 → NOT 1
    s.workRam[A2_OFF + 0x58] = 0x00; // whitelist
    s.workRam[A2_OFF + 0x36] = 0;
    s.workRam[A2_OFF + 0x1a] = 0;

    const { callees, log } = makeCallees();
    const r = objectStep17F66(s, A2_ADDR, callees);
    expect(r.path).toBe("movement");
    // No fun1815A.
    expect(log.find((l) => l.kind === "1815A")).toBeUndefined();
  });
});
