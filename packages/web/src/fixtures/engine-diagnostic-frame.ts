import { render as renderNs, state as stateNs } from "@marble-love/engine";
import type { GraphicsLookupEntry } from "../rom-graphics.js";

type Frame = renderNs.Frame;
type MotionObjectLookupInfo = renderNs.MotionObjectLookupInfo;
type PlayfieldLookupInfo = renderNs.PlayfieldLookupInfo;

const COLOR_WORDS = [0x0000, 0xf222, 0xf363, 0xf5a4, 0xfbb5, 0xfff7, 0xf45c, 0xf9bb];

function writeWord(ram: Uint8Array, offset: number, word: number): void {
  ram[offset] = (word >>> 8) & 0xff;
  ram[offset + 1] = word & 0xff;
}

function graphicsLookupsToMotionLookups(
  lookups: GraphicsLookupEntry[] | undefined,
): MotionObjectLookupInfo[] {
  return (
    lookups?.map((lookup) => ({
      offset: lookup.offset,
      bank: lookup.bank,
      color: lookup.color,
      bpp: lookup.bpp,
    })) ?? []
  );
}

function graphicsLookupsToPlayfieldLookups(
  lookups: GraphicsLookupEntry[] | undefined,
): PlayfieldLookupInfo[] {
  return (
    lookups?.map((lookup) => ({
      offset: lookup.offset,
      bank: lookup.bank,
      color: lookup.color,
      bpp: lookup.bpp,
    })) ?? [
      { offset: 0, bank: 0, color: 0, bpp: 4 },
      { offset: 0, bank: 0, color: 1, bpp: 4 },
      { offset: 0, bank: 0, color: 2, bpp: 4 },
      { offset: 0, bank: 0, color: 3, bpp: 4 },
    ]
  );
}

export function buildEngineDiagnosticFrame(
  frameNumber: number,
  motionObjectLookups?: GraphicsLookupEntry[],
  playfieldLookups?: GraphicsLookupEntry[],
): Frame {
  const state = stateNs.emptyGameState();
  const playfieldRam = new Uint8Array(64 * 30 * 2);

  for (let i = 0; i < COLOR_WORDS.length; i += 1) {
    writeWord(state.colorRam, i * 2, COLOR_WORDS[i] ?? 0);
  }
  writeWord(state.colorRam, 0x101 * 2, 0xfff7);
  writeWord(state.colorRam, 0x102 * 2, 0xf45c);
  writeWord(state.colorRam, 0x103 * 2, 0xf6af);
  writeWord(state.colorRam, 0x28, 0xf363);
  writeWord(state.colorRam, 0x30, 0xf5a4);
  writeWord(state.colorRam, 0x38, 0xfbb5);

  for (let row = 10; row < 22; row += 1) {
    for (let column = 11; column < 38; column += 1) {
      const offset = (row * 64 + column) * 2;
      const lookupIndex = 1 + ((row + column + Math.floor(frameNumber / 24)) % 3);
      const tileIndex = (row * 5 + column) & 0xff;
      writeWord(playfieldRam, offset, (lookupIndex << 8) | tileIndex);
    }
  }

  // One looping motion-object list: entry 0 -> 1 -> 2 -> 0.
  const bob = Math.round(Math.sin(frameNumber / 20) * 3);
  state.spriteRam.set([0x0f, 0x02 + bob, 0x01, 0x10, 0x11, 0x82, 0x00, 0x01], 0);
  state.spriteRam.set([0x0b, 0x42, 0x02, 0x20, 0x96, 0x83, 0x00, 0x02], 8);
  state.spriteRam.set([0x86, 0x42, 0x03, 0x30, 0x1b, 0x83, 0x00, 0x00], 16);

  writeWord(state.alphaRam, 0, 0x0445);
  writeWord(state.alphaRam, 2, 0x044e);
  writeWord(state.alphaRam, 4, 0x0447);

  return renderNs.buildFrame(state, {
    playfieldRam,
    playfieldLookups: graphicsLookupsToPlayfieldLookups(playfieldLookups),
    scrollX: frameNumber % 16,
    scrollY: 0,
    motionObjects: "linked-list",
    motionObjectStartEntry: 0,
    maxMotionObjectEntries: 8,
    motionObjectLookups: graphicsLookupsToMotionLookups(motionObjectLookups),
    videoControlByte: 0x0c,
  });
}
