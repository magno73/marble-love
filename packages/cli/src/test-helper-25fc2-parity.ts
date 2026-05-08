#!/usr/bin/env node
/**
 * test-helper-25fc2-parity.ts — differential FUN_00025FC2 vs helper25FC2.
 *
 * `FUN_00025FC2` (129 istr, 0x25FC2..0x26194) è un animation-sequence
 * stepper: avanza il puntatore animazione di una object struct in work RAM
 * e dispatcha una transizione di stato quando la sequenza ROM termina
 * (sentinel `0xFFFFFFFF`).
 *
 * **Argomento**: 1 long sullo stack = `objPtr` (A2).
 * **Costanti interne**: A1 = 0x20FDE, A3 = 0x400018.
 *
 * **Sub-JSR** patchate per isolamento:
 *   - `FUN_158AC` (@ 0x158AC): append byte arg a buffer (cattura sound calls).
 *   - `FUN_15884` (@ 0x15884): `rts` — no-op (sound pair catturato via 158AC).
 *   - `FUN_25BAE` (@ 0x25BAE): append (objPtr, subStateCode) a un buffer.
 *   - `FUN_18F46` (@ 0x18F46): append (typeCode, subIdx) a un buffer.
 *
 * **Strategia parity**:
 *   1. ROM patch: intercetta i 4 sub-jsr con stub che scrivono i loro arg
 *      in zone fisse di work RAM (0x401F00+).
 *   2. Per ogni caso random: randomizza objPtr, tutti i campi rilevanti
 *      di A2, e un set di sentinelle vicini.
 *   3. Esegui binario reale @ FUN_00025FC2 + TS helper25FC2 su mirror.
 *   4. Confronta tutti i campi scritti + le sequenze di chiamate sub-jsr.
 *
 * **Buffer cattura** (tutti in work RAM range 0x401F00-0x401FF0):
 *   - 0x401F00: FUN_158AC sound buffer (max 4 byte)
 *   - 0x401F0C: FUN_158AC sound cur ptr (long → next write slot)
 *   - 0x401F10: FUN_25BAE call buffer (max 3 × 8 byte = 24 byte)
 *     ogni entry: [objPtr long BE][code long BE]
 *   - 0x401F2C: FUN_25BAE call count byte
 *   - 0x401F30: FUN_15884 call count byte
 *   - 0x401F34: FUN_18F46 call buffer (max 2 × 8 byte = 16 byte)
 *     ogni entry: [typeCode long BE][subIdx long BE]
 *   - 0x401F44: FUN_18F46 call count byte
 *
 * Uso: npx tsx packages/cli/src/test-helper-25fc2-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  helper25FC2 as h25fc2Ns,
  bus as busNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_25FC2 = 0x00025fc2;
const FUN_158AC = 0x000158ac;
const FUN_15884 = 0x00015884;
const FUN_25BAE = 0x00025bae;
const FUN_18F46 = 0x00018f46;

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;

// ─── Buffer cattura in work RAM ───────────────────────────────────────────────
// FUN_158AC sound buffer: cur ptr @ 0x401F0C, buffer 4 byte @ 0x401F00-0x401F03
const SOUND_BUF_BASE  = 0x00401f00 as const;
const SOUND_BUF_END   = 0x00401f04 as const;
const SOUND_CUR_PTR   = 0x00401f0c as const;
// FUN_25BAE call buffer: 3 entries × 8 byte @ 0x401F10-0x401F27, count @ 0x401F2C
const OSE25_BUF_BASE  = 0x00401f10 as const;
const OSE25_COUNT_PTR = 0x00401f2c as const;
// FUN_15884 call count: @ 0x401F30
const SP15884_COUNT   = 0x00401f30 as const;
// FUN_18F46 call buffer: 2 entries × 8 byte @ 0x401F34-0x401F43, count @ 0x401F44
const H18F46_BUF_BASE = 0x00401f34 as const;
const H18F46_COUNT    = 0x00401f44 as const;

// ─── Object pointer candidates ───────────────────────────────────────────────
// Tutti >= 0x401000, con almeno 0xC0 byte fino a 0x401EFF
// (stack @ 0x401F00; buffer @ 0x401F00+)
const PTR_CANDIDATES: readonly number[] = [
  0x00401000, 0x00401100, 0x00401200, 0x00401300,
  0x00401400, 0x00401500, 0x00401600, 0x00401700,
  0x00401800, 0x00401900, 0x00401a00, 0x00401b00,
  0x00401c00,
];

// ─── Fail record ─────────────────────────────────────────────────────────────
interface FailRecord {
  i: number;
  ptr: number;
  field: string;
  bin: unknown;
  ts: unknown;
}

// ─── LCG RNG ─────────────────────────────────────────────────────────────────
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ─── ROM patches ─────────────────────────────────────────────────────────────

/**
 * Patch FUN_158AC: append byte arg (offset 0x7 da SP) a buffer.
 *   move.b  (0x7,SP), D0       : 10 2F 00 07
 *   movea.l ($401F0C).l, A1    : 22 79 00 40 1F 0C
 *   move.b  D0, (A1)+          : 12 C0
 *   move.l  A1, ($401F0C).l    : 23 C9 00 40 1F 0C
 *   rts                         : 4E 75
 * 20 byte (FUN_158AC è >= 20 byte → sicuro).
 */
function patchSoundSink(rom: Buffer): void {
  const a = FUN_158AC;
  rom[a + 0x0] = 0x10; rom[a + 0x1] = 0x2f; rom[a + 0x2] = 0x00; rom[a + 0x3] = 0x07;
  rom[a + 0x4] = 0x22; rom[a + 0x5] = 0x79;
  rom[a + 0x6] = 0x00; rom[a + 0x7] = 0x40; rom[a + 0x8] = 0x1f; rom[a + 0x9] = 0x0c;
  rom[a + 0xa] = 0x12; rom[a + 0xb] = 0xc0;
  rom[a + 0xc] = 0x23; rom[a + 0xd] = 0xc9;
  rom[a + 0xe] = 0x00; rom[a + 0xf] = 0x40; rom[a + 0x10] = 0x1f; rom[a + 0x11] = 0x0c;
  rom[a + 0x12] = 0x4e; rom[a + 0x13] = 0x75;
}

/**
 * Patch FUN_15884: incrementa count @ 0x401F30 + rts.
 *   addq.b  #1, ($401F30).l    : 52 39 00 40 1F 30  (52 39 = addq.b, NOT 52 B9 = addq.l)
 *   rts                         : 4E 75
 */
function patchSoundPair(rom: Buffer): void {
  const a = FUN_15884;
  rom[a + 0x0] = 0x52; rom[a + 0x1] = 0x39;
  rom[a + 0x2] = 0x00; rom[a + 0x3] = 0x40; rom[a + 0x4] = 0x1f; rom[a + 0x5] = 0x30;
  rom[a + 0x6] = 0x4e; rom[a + 0x7] = 0x75;
}

/**
 * Patch FUN_25BAE: append (objPtr, code) al buffer + rts.
 *
 * FUN_25BAE è chiamata da FUN_25FC2 con 2 long sullo stack:
 *   - Prima push (farther from SP): `pea 0x2.w` o `pea 0x4.w` → subStateCode
 *   - Seconda push (closer to SP): `move.l A2, -(A7)` → objPtr
 *   - Return addr al ritorno da jsr
 *
 * Al momento di ingresso in FUN_25BAE:
 *   SP+0 = return addr
 *   SP+4 = objPtr (ultima push = più vicina allo SP)
 *   SP+8 = subStateCode long (prima push = più lontana dallo SP)
 *
 * Stub (36 byte):
 *   move.b  ($401F2C).l, D0     ; D0 = count
 *   cmp.b   #3, D0              ; limit 3 entries
 *   bge.b   done
 *   addq.b  #1, ($401F2C).l    ; count++
 *   mulu    #8, D0              ; offset = count_old * 8
 *   lea     ($401F10).l, A0    ; A0 = buf base
 *   adda.l  D0, A0             ; A0 += offset
 *   move.l  (0x4,SP), (A0)    ; write objPtr   [SP+4]
 *   move.l  (0x8,SP), (0x4,A0) ; write subStateCode [SP+8]
 * done:
 *   rts
 *
 * M68k encoding:
 *   10 39 00 40 1F 2C         move.b ($401F2C).l, D0
 *   0C 00 00 03               cmpi.b #3, D0
 *   70 00                     moveq #0, D0          ; zero D0 to avoid dirty upper bits
 *   10 39 00 40 1F 2C         move.b ($401F2C).l, D0 ; read count byte
 *   0C 00 00 03               cmpi.b #3, D0
 *   6C 20                     bge.b → rts (skip 0x20=32 bytes)
 *   52 39 00 40 1F 2C         addq.b #1, ($401F2C).l
 *   C0 FC 00 08               mulu.w #8, D0
 *   41 F9 00 40 1F 10         lea ($401F10).l, A0
 *   D1 C0                     adda.l D0, A0
 *   22 2F 00 04               move.l (0x4,SP), D1    ; objPtr
 *   20 81                     move.l D1, (A0)
 *   22 2F 00 08               move.l (0x8,SP), D1    ; subStateCode
 *   21 41 00 04               move.l D1, (0x4,A0)
 *   4E 75                     rts
 */
function patchOSE25BAE(rom: Buffer): void {
  const a = FUN_25BAE;
  // moveq #0, D0  — zero D0 (move.b alone leaves upper bits dirty)
  rom[a+0x0]=0x70; rom[a+0x1]=0x00;
  // move.b ($401F2C).l, D0
  rom[a+0x2]=0x10; rom[a+0x3]=0x39; rom[a+0x4]=0x00; rom[a+0x5]=0x40;
  rom[a+0x6]=0x1f; rom[a+0x7]=0x2c;
  // cmpi.b #3, D0
  rom[a+0x8]=0x0c; rom[a+0x9]=0x00; rom[a+0xa]=0x00; rom[a+0xb]=0x03;
  // bge.b → rts at a+0x2E (offset 0x20 from a+0xE)
  rom[a+0xc]=0x6c; rom[a+0xd]=0x20;
  // addq.b #1, ($401F2C).l  (52 39 = addq.b)
  rom[a+0xe]=0x52; rom[a+0xf]=0x39; rom[a+0x10]=0x00; rom[a+0x11]=0x40;
  rom[a+0x12]=0x1f; rom[a+0x13]=0x2c;
  // mulu.w #8, D0  (C0 FC 00 08)
  rom[a+0x14]=0xc0; rom[a+0x15]=0xfc; rom[a+0x16]=0x00; rom[a+0x17]=0x08;
  // lea ($401F10).l, A0
  rom[a+0x18]=0x41; rom[a+0x19]=0xf9; rom[a+0x1a]=0x00; rom[a+0x1b]=0x40;
  rom[a+0x1c]=0x1f; rom[a+0x1d]=0x10;
  // adda.l D0, A0
  rom[a+0x1e]=0xd1; rom[a+0x1f]=0xc0;
  // move.l (0x4,SP), D1    objPtr [SP+4 = objPtr]
  rom[a+0x20]=0x22; rom[a+0x21]=0x2f; rom[a+0x22]=0x00; rom[a+0x23]=0x04;
  // move.l D1, (A0)
  rom[a+0x24]=0x20; rom[a+0x25]=0x81;
  // move.l (0x8,SP), D1    subStateCode [SP+8]
  rom[a+0x26]=0x22; rom[a+0x27]=0x2f; rom[a+0x28]=0x00; rom[a+0x29]=0x08;
  // move.l D1, (0x4,A0)
  rom[a+0x2a]=0x21; rom[a+0x2b]=0x41; rom[a+0x2c]=0x00; rom[a+0x2d]=0x04;
  // rts
  rom[a+0x2e]=0x4e; rom[a+0x2f]=0x75;
}

/**
 * Patch FUN_18F46: append (typeCode, subIdx) al buffer + rts.
 *
 * FUN_18F46 è chiamata con 2 long sullo stack RTL (arg1 = typeCode @ SP+12,
 * arg2 = subIdx @ SP+8 dopo movem push di 3 regs):
 * Dopo movem.l {A3 A2 D2},-(SP) (12 byte) → arg1 @ SP+0x13 (byte), arg2 @ SP+0x17.
 * Ma noi stiamo patchando FUN_18F46 stesso: prima della movem, gli arg sono:
 *   arg1 (typeCode long) @ SP+4 (pushed first = closer to SP after return addr @ SP)
 *   arg2 (subIdx long)   @ SP+8
 *
 * Stub (38 byte):
 *   move.b ($401F44).l, D0      ; D0 = count
 *   cmpi.b #2, D0               ; limit 2
 *   bge.b done
 *   addq.b #1, ($401F44).l
 *   mulu #8, D0
 *   lea ($401F34).l, A0
 *   adda.l D0, A0
 *   move.l (0x4,SP), (A0)       ; typeCode
 *   move.l (0x8,SP), (0x4,A0)  ; subIdx
 * done:
 *   rts
 */
function patchHelper18F46(rom: Buffer): void {
  const a = FUN_18F46;
  // moveq #0, D0  — zero D0 (move.b alone leaves upper bits dirty)
  rom[a+0x0]=0x70; rom[a+0x1]=0x00;
  // move.b ($401F44).l, D0
  rom[a+0x2]=0x10; rom[a+0x3]=0x39; rom[a+0x4]=0x00; rom[a+0x5]=0x40;
  rom[a+0x6]=0x1f; rom[a+0x7]=0x44;
  // cmpi.b #2, D0
  rom[a+0x8]=0x0c; rom[a+0x9]=0x00; rom[a+0xa]=0x00; rom[a+0xb]=0x02;
  // bge.b → rts at a+0x2E (offset 0x20 from a+0xE)
  rom[a+0xc]=0x6c; rom[a+0xd]=0x20;
  // addq.b #1, ($401F44).l  (52 39 = addq.b)
  rom[a+0xe]=0x52; rom[a+0xf]=0x39; rom[a+0x10]=0x00; rom[a+0x11]=0x40;
  rom[a+0x12]=0x1f; rom[a+0x13]=0x44;
  // mulu.w #8, D0  (C0 FC 00 08)
  rom[a+0x14]=0xc0; rom[a+0x15]=0xfc; rom[a+0x16]=0x00; rom[a+0x17]=0x08;
  // lea ($401F34).l, A0
  rom[a+0x18]=0x41; rom[a+0x19]=0xf9; rom[a+0x1a]=0x00; rom[a+0x1b]=0x40;
  rom[a+0x1c]=0x1f; rom[a+0x1d]=0x34;
  // adda.l D0, A0
  rom[a+0x1e]=0xd1; rom[a+0x1f]=0xc0;
  // move.l (0x4,SP), D1    typeCode [SP+4]
  rom[a+0x20]=0x22; rom[a+0x21]=0x2f; rom[a+0x22]=0x00; rom[a+0x23]=0x04;
  // move.l D1, (A0)
  rom[a+0x24]=0x20; rom[a+0x25]=0x81;
  // move.l (0x8,SP), D1    subIdx [SP+8]
  rom[a+0x26]=0x22; rom[a+0x27]=0x2f; rom[a+0x28]=0x00; rom[a+0x29]=0x08;
  // move.l D1, (0x4,A0)
  rom[a+0x2a]=0x21; rom[a+0x2b]=0x41; rom[a+0x2c]=0x00; rom[a+0x2d]=0x04;
  // rts
  rom[a+0x2e]=0x4e; rom[a+0x2f]=0x75;
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBuf = Buffer.from(readFileSync(romPath));

  // Patch ROM
  patchSoundSink(romBuf);
  patchSoundPair(romBuf);
  patchOSE25BAE(romBuf);
  patchHelper18F46(romBuf);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  // Prepara la RomImage TS (copia dal buffer patchato)
  const romImage = busNs.emptyRomImage();
  romBuf.copy(Buffer.from(romImage.program.buffer), 0, 0, Math.min(romBuf.length, romImage.program.length));

  console.log(`\n=== helper25FC2 (FUN_00025FC2) — ${n} casi ===`);
  console.log(
    `  (FUN_158AC → sound-sink, FUN_15884 → count, FUN_25BAE → call-log, FUN_18F46 → call-log)`,
  );

  const rng = makeRng(0x25fc2);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rw = (): number => Math.floor(rng() * 0x10000) & 0xffff;
  const pickPtr = (): number =>
    PTR_CANDIDATES[Math.floor(rng() * PTR_CANDIDATES.length)]!;

  let ok = 0;
  let firstFail: FailRecord | null = null;

  // Tutti i field offset scritti dalla funzione (da disasm).
  const SCRATCH_FIELDS = [
    0x18, 0x1a, 0x56, 0x57,
    0x5a, 0x5b, 0x5c, 0x5d,
    0x5f, 0x60, 0x62, 0x63, 0x64, 0x65,
    0x66, 0x67,
    0xa4, 0xa5,
  ] as const;

  // Offset NON toccati (sentinelle per no-spill)
  const NEIGHBORS = [
    0x00, 0x01, 0x17, 0x19, 0x1b,
    0x55, 0x58, 0x59, 0x5e, 0x61,
    0x68, 0x69, 0xa3, 0xa6, 0xa7,
  ] as const;

  const ANIM_BASE = h25fc2Ns.ANIM_BASE_ROM;     // 0x20FDE
  const OBJ_PAIR  = h25fc2Ns.OBJECT_PAIR_BASE;  // 0x400018

  // Costruisce uno scenario di test randomizzato.
  // Variazione chiave: state (0x1A), step56 (0x56), secondary_state (0x18),
  // anim_ptr (0x5A), frame_ctr (0x5F), fps (0x60), sub_frame_ctr (0x66), ecc.
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    const ptr = pickPtr();
    // Permetti anche ptr uguale ai due oggetti della coppia
    // per coprire la logica di word_a4
    const ptrChoice = rng();
    const actualPtr =
      ptrChoice < 0.05 ? OBJ_PAIR :
      ptrChoice < 0.1  ? OBJ_PAIR + 0xe2 :
      ptr;
    const off = actualPtr - WORK_RAM_BASE;

    // ── Pre-state randomizzato ────────────────────────────────────────────
    // state (0x1A): distribuzione {1,2,5, random}
    const r1a = rng();
    const pre1A: number =
      r1a < 0.25 ? 0x01 :
      r1a < 0.50 ? 0x02 :
      r1a < 0.70 ? 0x05 :
      rb();

    // Scegli anim_ptr coerente con lo scenario:
    // 20% → dentro range [A1+4, A1+0x7C] index 1..30
    // 20% → index 9 esatto (per wrap detection)
    // 20% → fuori range (< A1 o >= A1+0x80)
    // 40% → punta a sentinel in ROM
    let preAnimPtr: number;
    let preAnimPtrIssentinel = false;
    const r5a = rng();
    if (r5a < 0.20) {
      // Dentro range A1..A1+0x7C (index 0..31), random
      const idx = Math.floor(rng() * 32);
      preAnimPtr = (ANIM_BASE + idx * 4) >>> 0;
    } else if (r5a < 0.40) {
      // Index 8 (così dopo advance diventa index 9 = wrap)
      preAnimPtr = (ANIM_BASE + 8 * 4) >>> 0;
    } else if (r5a < 0.60) {
      // Fuori range: prima di A1
      preAnimPtr = ANIM_BASE > 4 ? (ANIM_BASE - 4) >>> 0 : 0x00020fda;
    } else {
      // Punta a un indirizzo ROM con sentinel (per trigger dispatch)
      // Usiamo 0x20FDA (= A1-4) che nella ROM non è sentinel → useremo
      // la strategia: pre-load a uno degli indirizzi reali con sentinel.
      // Sappiamo che 0x20FDA nella ROM originale = 0xFFFFFFFF (da sopra).
      // Usiamo 0x20FDA come primo indirizzo sentinel noto.
      // In realtà usiamo (A1 + fps*4) dopo advance:
      // Per semplicità usiamo 0x21006 (index 9 avanzato) che sappiamo non sentinel,
      // oppure 0x20FDA che è sentinel.
      // Generiamo un anim_ptr che, dopo l'advance di fps step, punterà a sentinel.
      // Più semplice: impostiamo fps=1, frame_ctr=1, e anim_ptr tale che
      // anim_ptr+4 sia un indirizzo sentinel in ROM.
      // Gli indirizzi sentinel noti da analisi ROM: 0x20FDA, 0x20FCE, ...
      // Per semplicità usiamo approccio diretto: settiamo fps=0 frame_ctr=0
      // → advance immediato, e usiamo anim_ptr-4 = 0x20FD6 (→ 0x20FDA sentinel)
      // Oppure: usiamo il campo 0x5A direttamente per puntare già al sentinel
      // (con fps=1, frame_ctr=1 → avanza di 4, quindi ptr-4 deve puntare al sentinel−4).
      // Per semplificare: frame_ctr=fps → advance → nuovo ptr = preAnimPtr+4
      // preAnimPtr+4 = 0x20FDA → preAnimPtr = 0x20FD6.
      preAnimPtr = 0x00020fd6; // +4 = 0x20FDA = sentinel
      preAnimPtrIssentinel = true;
    }

    // fps e frame_ctr
    let preFrameCtr = rb() & 0x1f;
    let preFps = rb() & 0x1f;
    // 40% force advance (frame_ctr == fps, advance avviene)
    if (rng() < 0.40) {
      // Assicuriamo che il frame venga avanzato: frame_ctr = fps
      preFrameCtr = preFps > 0 ? preFps - 1 : 0;
      preFps = preFrameCtr + 0; // fps = frame_ctr → dopo incr frame_ctr+1 > fps? No
      // Meglio: dopo incr frame_ctr+1 NOT > fps → non advance;
      // per forzare advance: fps <= frame_ctr+1
      // settiamo frame_ctr = fps-1 → dopo incr = fps → fps > fps? No (not strictly greater) → advance
      preFps = (rb() & 0x0f) + 1;
      preFrameCtr = preFps - 1; // dopo incr = preFps → non > fps → advance
    }

    // step56
    const preStep56 = rb();
    // secondary_state
    const preSecState = rng() < 0.33 ? 0x02 : rb();
    // sub_frame_ctr
    const preSubFc = rb() & 0x07; // piccolo per evitare troppo noise
    // secondary_ptr (0x62..65)
    const preSecPtr = ((0x00020000 + Math.floor(rng() * 0x1000) * 4)) >>> 0;
    // obj_type 0x57
    const preObjType = rb();
    // flag67
    const preFlag67 = rb();

    // ── Build scratch object ─────────────────────────────────────────────
    const scratchObj = new Uint8Array(0xc0);
    for (let k = 0; k < 0xc0; k++) scratchObj[k] = rb();

    // Override campi controllati
    scratchObj[0x1a] = pre1A;
    // anim_ptr (0x5A..5D)
    scratchObj[0x5a] = (preAnimPtr >>> 24) & 0xff;
    scratchObj[0x5b] = (preAnimPtr >>> 16) & 0xff;
    scratchObj[0x5c] = (preAnimPtr >>> 8)  & 0xff;
    scratchObj[0x5d] = preAnimPtr & 0xff;
    scratchObj[0x5f] = preFrameCtr;
    scratchObj[0x60] = preFps;
    scratchObj[0x56] = preStep56;
    scratchObj[0x18] = preSecState;
    scratchObj[0x66] = preSubFc;
    // secondary_ptr (0x62..65)
    scratchObj[0x62] = (preSecPtr >>> 24) & 0xff;
    scratchObj[0x63] = (preSecPtr >>> 16) & 0xff;
    scratchObj[0x64] = (preSecPtr >>> 8)  & 0xff;
    scratchObj[0x65] = preSecPtr & 0xff;
    scratchObj[0x57] = preObjType;
    scratchObj[0x67] = preFlag67;

    // Sentinelle vicini (offset non toccati)
    const neighborSentinels: Record<number, number> = {};
    for (let idx = 0; idx < NEIGHBORS.length; idx++) {
      const nOff = NEIGHBORS[idx]!;
      const v = (0xb0 + idx) & 0xff;
      neighborSentinels[nOff] = v;
      scratchObj[nOff] = v;
    }

    // ── Setup binary ─────────────────────────────────────────────────────
    // Init buffer zone
    pokeMem(cpu, SOUND_CUR_PTR, 4, SOUND_BUF_BASE);
    for (let k = 0; k < 4; k++) pokeMem(cpu, SOUND_BUF_BASE + k, 1, 0xff);
    pokeMem(cpu, OSE25_COUNT_PTR, 1, 0);
    pokeMem(cpu, SP15884_COUNT, 1, 0);
    pokeMem(cpu, H18F46_COUNT, 1, 0);
    // Object scratch
    for (let k = 0; k < 0xc0; k++) pokeMem(cpu, actualPtr + k, 1, scratchObj[k]!);

    // ── Mirror su state.workRam ──────────────────────────────────────────
    for (let k = 0; k < WORK_RAM_SIZE; k++) stateInst.workRam[k] = 0;
    for (let k = 0; k < 0xc0; k++) stateInst.workRam[off + k] = scratchObj[k]!;

    // ── Run binary ───────────────────────────────────────────────────────
    callFunction(cpu, FUN_25FC2, [actualPtr]);

    // Leggi catture binarie
    const binSoundCurEnd = peekMem(cpu, SOUND_CUR_PTR, 4) >>> 0;
    const binSoundCount = (binSoundCurEnd - SOUND_BUF_BASE) >>> 0;
    const binSounds: number[] = [];
    for (let k = 0; k < binSoundCount && k < 4; k++) {
      binSounds.push(peekMem(cpu, SOUND_BUF_BASE + k, 1) & 0xff);
    }
    const binSP15884 = peekMem(cpu, SP15884_COUNT, 1) & 0xff;
    const binOSE25Count = peekMem(cpu, OSE25_COUNT_PTR, 1) & 0xff;
    const binOSE25Calls: { objPtr: number; code: number }[] = [];
    for (let k = 0; k < binOSE25Count && k < 3; k++) {
      const base = OSE25_BUF_BASE + k * 8;
      const op = ((peekMem(cpu, base, 4)) >>> 0);
      const codeLong = ((peekMem(cpu, base + 4, 4)) >>> 0);
      binOSE25Calls.push({ objPtr: op, code: codeLong & 0xff });
    }
    const binH18F46Count = peekMem(cpu, H18F46_COUNT, 1) & 0xff;
    const binH18F46Calls: { typeCode: number; subIdx: number }[] = [];
    for (let k = 0; k < binH18F46Count && k < 2; k++) {
      const base = H18F46_BUF_BASE + k * 8;
      const tc = (peekMem(cpu, base, 4)) >>> 0;
      const si = (peekMem(cpu, base + 4, 4)) >>> 0;
      binH18F46Calls.push({ typeCode: tc & 0xff, subIdx: si & 0xff });
    }

    // ── Run TS ───────────────────────────────────────────────────────────
    const tsSounds: number[] = [];
    let tsSP15884 = 0;
    const tsOSE25Calls: { objPtr: number; code: number }[] = [];
    const tsH18F46Calls: { typeCode: number; subIdx: number }[] = [];

    h25fc2Ns.helper25FC2(stateInst, romImage, actualPtr, {
      soundCommand: (cmd) => tsSounds.push(cmd & 0xff),
      soundPair15884: () => { tsSP15884++; },
      objectStateEntry25BAE: (_s, p, c) => tsOSE25Calls.push({ objPtr: p, code: c & 0xff }),
      helper18F46: (_s, _r, tc, si) => tsH18F46Calls.push({ typeCode: tc & 0xff, subIdx: si & 0xff }),
    });

    // ── Confronto ────────────────────────────────────────────────────────
    let fail: FailRecord | null = null;

    // 1) Sound calls
    if (!fail && binSounds.length !== tsSounds.length) {
      fail = { i, ptr: actualPtr, field: "soundCount", bin: binSounds.length, ts: tsSounds.length };
    }
    if (!fail) {
      for (let k = 0; k < binSounds.length; k++) {
        if (binSounds[k] !== tsSounds[k]) {
          fail = { i, ptr: actualPtr, field: `sound[${k}]`, bin: `0x${(binSounds[k]!).toString(16)}`, ts: `0x${(tsSounds[k]!).toString(16)}` };
          break;
        }
      }
    }

    // 2) soundPair15884 call count
    if (!fail && binSP15884 !== tsSP15884) {
      fail = { i, ptr: actualPtr, field: "soundPair15884Count", bin: binSP15884, ts: tsSP15884 };
    }

    // 3) objectStateEntry25BAE calls
    if (!fail && binOSE25Count !== tsOSE25Calls.length) {
      fail = { i, ptr: actualPtr, field: "ose25Count", bin: binOSE25Count, ts: tsOSE25Calls.length };
    }
    if (!fail) {
      for (let k = 0; k < binOSE25Calls.length; k++) {
        const b = binOSE25Calls[k]!;
        const t = tsOSE25Calls[k];
        if (!t || b.objPtr !== t.objPtr || b.code !== t.code) {
          fail = { i, ptr: actualPtr, field: `ose25[${k}]`, bin: JSON.stringify(b), ts: JSON.stringify(t) };
          break;
        }
      }
    }

    // 4) helper18F46 calls
    if (!fail && binH18F46Count !== tsH18F46Calls.length) {
      fail = { i, ptr: actualPtr, field: "h18f46Count", bin: binH18F46Count, ts: tsH18F46Calls.length };
    }
    if (!fail) {
      for (let k = 0; k < binH18F46Calls.length; k++) {
        const b = binH18F46Calls[k]!;
        const t = tsH18F46Calls[k];
        if (!t || b.typeCode !== t.typeCode || b.subIdx !== t.subIdx) {
          fail = { i, ptr: actualPtr, field: `h18f46[${k}]`, bin: JSON.stringify(b), ts: JSON.stringify(t) };
          break;
        }
      }
    }

    // 5) SCRATCH_FIELDS
    if (!fail) {
      for (const fOff of SCRATCH_FIELDS) {
        const binVal = peekMem(cpu, actualPtr + fOff, 1) & 0xff;
        const tsVal  = stateInst.workRam[off + fOff] ?? 0;
        if (binVal !== tsVal) {
          fail = { i, ptr: actualPtr, field: `field@+0x${fOff.toString(16)}`, bin: `0x${binVal.toString(16)}`, ts: `0x${tsVal.toString(16)}` };
          break;
        }
      }
    }

    // 6) NEIGHBORS (no-spill)
    if (!fail) {
      for (const nOff of NEIGHBORS) {
        const expected = neighborSentinels[nOff]!;
        const binVal = peekMem(cpu, actualPtr + nOff, 1) & 0xff;
        const tsVal  = stateInst.workRam[off + nOff] ?? 0;
        if (binVal !== tsVal || binVal !== expected) {
          fail = { i, ptr: actualPtr, field: `neighbor@+0x${nOff.toString(16)}`, bin: `bin=${binVal.toString(16)} ts=${tsVal.toString(16)} exp=${expected.toString(16)}`, ts: "mismatch" };
          break;
        }
      }
    }

    if (fail) {
      if (firstFail === null) firstFail = fail;
    } else {
      ok++;
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const f = firstFail;
    console.log(`  First fail @ case ${f.i} ptr=0x${f.ptr.toString(16)}:`);
    console.log(`    ${f.field}: bin=${String(f.bin)} ts=${String(f.ts)}`);
  }

  void rw;
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
