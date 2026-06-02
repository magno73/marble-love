/**
 * slapstic-103.ts — Atari Slapstic 137412-103 (Marble Madness) state machine.
 *
 * Bit-perfect replica of `mame/src/mame/atari/slapstic.cpp`, `slapstic103`
 * configuration, `active_103_110` branch (3rd revision of the slapstic family).
 *
 * Atari's Slapstic is a custom 20-pin IC placed between the 68010 address bus
 * and program ROM, providing bank switching plus copy protection. Marble
 * Madness maps it at `0x080000-0x087FFF` (8KB visible) and selects one of four
 * 8KB banks in the ROM image at `0x080000 + bank*0x2000`.
 *
 * **Chip 103 parameters** (`slapstic.cpp:271-297`):
 *   bankstart  = 3 (reset bank)
 *   bank[]     = { 0x0040, 0x0050, 0x0060, 0x0070 }
 *   alt1       = mask=0x007f, value=0x002d        (test_any -> out-of-range OK)
 *   alt2       = mask=0x3fff, value=0x3d14        (test_in -> inside range)
 *   alt3       = mask=0x3ffc, value=0x3d24        (test_in)
 *   alt4       = mask=0x3fcf, value=0x0040        (test_in, commit)
 *   altshift   = 0
 *   bit1       = mask=0x3ff0, value=0x34c0        (test_in, bitwise start)
 *   bit2       = mask=0x3fcf, value=0x0040        (test_in, bitwise load)
 *   bit3c0     = mask=0x3ff3, value=0x34c0        (clear bit 0)
 *   bit3s0     = mask=0x3ff3, value=0x34c1        (set bit 0)
 *   bit3c1     = mask=0x3ff3, value=0x34c2        (clear bit 1)
 *   bit3s1     = mask=0x3ff3, value=0x34c3        (set bit 1)
 *   bit4       = mask=0x3ff8, value=0x34d0        (bitwise commit)
 *   NO additive banking (chip 103 is rev1; additive banking starts at chip 111)
 *
 * **Bus geometry**:
 *   start         = 0x080000
 *   end           = 0x087FFF
 *   mirror        = 0
 *   data_width    = 16 -> shift = 1 (M68K word-addressed bus)
 *   address_lines = 14 (chip A0-A13 = 68000 bus A1-A14)
 *   range_mask    = ~((end - start) | mirror) = ~0x7FFF = 0xFFFF8000
 *   range_value   = 0x080000
 *   input_mask    = ((1 << 14) - 1) << 1 = 0x7FFE
 *
 * **Test helpers** (mirrored from `slapstic.cpp:838-871`):
 *   test_in(mv)     = test(range_mask | (mv.mask << 1), range_value | (mv.value << 1))
 *   test_any(mv)    = test(mv.mask << 1, mv.value << 1)              // ignore range
 *   test_inside()   = test(range_mask, range_value)
 *   test_reset()    = test(range_mask | input_mask, range_value)     // any addr 0x80000
 *                                                                    // (low 15 bit == 0)
 *   test_bank(b)    = test(range_mask | input_mask, range_value | (b << 1))
 *
 * Hardware note: MAME installs the slapstic tap over the full CPU address
 * space. `test_any` can therefore be armed by prefetch/code reads outside the
 * protected window (for example `0x02ff5a` in `FUN_2FF40`), not only by accesses
 * to `0x080000..0x087FFF`.
 *
 * **FSM states** (103-110 branch):
 *   IDLE        - waiting for a reset access (addr 0x80000, low 15 bits clear)
 *   ACTIVE      - bank selected; accepts direct/alt/bit transitions
 *   ALT_VALID   - after alt1 trigger, waiting for alt2
 *   ALT_SELECT  - after alt2, waiting for alt3 (loads loaded_bank)
 *   ALT_COMMIT  - after alt3, waiting for alt4 (commits loaded_bank -> current bank)
 *   BIT_LOAD    - after bit1 trigger, waiting for bit2 (loads loaded_bank from current)
 *   BIT_SET_ODD - alternating bit-set state; accepts bit3* loaded_bank edits
 *   BIT_SET_EVEN- same as ODD, with phase toggled on each bit3* hit
 *
 * Reset bank after `slapsticReset()` = 3 (`bankstart` parameter).
 * MAME: `device_reset()` -> `change_bank(slapstic_table[chip-101]->bankstart)`.
 *
 * **Reset access** (idle -> active):
 *   Any access satisfying test_reset(): a read/write to the first word of the
 *   slapstic window (`0x080000` for data_width=16), where only A0-A14 are 0.
 *   This is the classic trigger read the ROM performs before each bank-switch
 *   sequence (`slapstic-lookup.ts`).
 *
 * Bit-perfect against the MAME slapstic device tap (`oracle/mame_slapstic_tap.lua`).
 */

// ─── Constants from chip 103 config ──────────────────────────────────────────

const BANKSTART = 3;

/** Bank select values from `slapstic_data.bank[4]`. */
const BANK_VALUES = [0x0040, 0x0050, 0x0060, 0x0070] as const;

/** ALT path: 1st, 2nd, 3rd, 4th step (mask, value). */
const ALT1_MASK = 0x007f, ALT1_VAL = 0x002d;
const ALT2_MASK = 0x3fff, ALT2_VAL = 0x3d14;
const ALT3_MASK = 0x3ffc, ALT3_VAL = 0x3d24;
const ALT4_MASK = 0x3fcf, ALT4_VAL = 0x0040;
const ALT_SHIFT = 0;

/** BIT path: 1st, 2nd, then bit3 (clear/set 0/1), then bit4 commit. */
const BIT1_MASK   = 0x3ff0, BIT1_VAL   = 0x34c0;
const BIT2_MASK   = 0x3fcf, BIT2_VAL   = 0x0040;
const BIT3C0_MASK = 0x3ff3, BIT3C0_VAL = 0x34c0; // clear bit 0 on odd / set bit 1 on even
const BIT3S0_MASK = 0x3ff3, BIT3S0_VAL = 0x34c1; // set bit 0   on odd / clear bit 1 on even
const BIT3C1_MASK = 0x3ff3, BIT3C1_VAL = 0x34c2; // clear bit 1 on odd / set bit 0 on even
const BIT3S1_MASK = 0x3ff3, BIT3S1_VAL = 0x34c3; // set bit 1   on odd / clear bit 0 on even
const BIT4_MASK   = 0x3ff8, BIT4_VAL   = 0x34d0;

// ─── Bus geometry constants ──────────────────────────────────────────────────

/** Slapstic window start, inclusive. */
const START = 0x080000;
/** Slapstic window end, exclusive. 8KB visible. */
const END_EXCL = 0x088000;
/** Address shift per data_width=16 (one bus word = 2 bytes). */
const SHIFT = 1;

/** `range_mask = ~((end-1 - start) | mirror)` = ~0x7FFF = 0xFFFF8000. */
const RANGE_MASK = (~(END_EXCL - 1 - START) >>> 0) & 0xFFFFFFFF; // = 0xFFFF8000
/** `range_value = start`. */
const RANGE_VALUE = START;
/** `input_mask = ((1 << 14) - 1) << 1` = 0x7FFE. */
const INPUT_MASK = ((1 << 14) - 1) << SHIFT;

// ─── Test helpers (mirror MAME `checker::test_*` semantics) ──────────────────

/** `test_in`: range + input matter; (addr & (range_mask | (mv.mask<<shift))) == (range_value | (mv.value<<shift)). */
function testIn(addr: number, mvMask: number, mvVal: number): boolean {
  const m = (RANGE_MASK | (mvMask << SHIFT)) >>> 0;
  const v = (RANGE_VALUE | (mvVal << SHIFT)) >>> 0;
  return ((addr >>> 0) & m) === v;
}

/** `test_any`: NO range mask — match anywhere on the bus. */
function testAny(addr: number, mvMask: number, mvVal: number): boolean {
  const m = (mvMask << SHIFT) >>> 0;
  const v = (mvVal << SHIFT) >>> 0;
  return ((addr >>> 0) & m) === v;
}

/** `test_reset`: range_mask | input_mask vs range_value — A0..A14 == 0 inside window. */
function testReset(addr: number): boolean {
  return ((addr >>> 0) & ((RANGE_MASK | INPUT_MASK) >>> 0)) === RANGE_VALUE;
}

/** `test_bank(b)`: range_mask | input_mask vs range_value | (b<<shift). */
function testBank(addr: number, b: number): boolean {
  const m = ((RANGE_MASK | INPUT_MASK) >>> 0);
  const v = (RANGE_VALUE | (b << SHIFT)) >>> 0;
  return ((addr >>> 0) & m) === v;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** FSM states exposed for the 9 MAME states; S_BIT_SET_ODD/EVEN stay distinct. */
export type SlapsticState =
  | "IDLE"
  | "ACTIVE"
  | "ALT_VALID"
  | "ALT_SELECT"
  | "ALT_COMMIT"
  | "BIT_LOAD"
  | "BIT_SET_ODD"
  | "BIT_SET_EVEN";

export interface SlapsticFsm {
  /** Bank currently exposed on the bus (0..3). */
  bank: number;
  /** Current FSM state. */
  state: SlapsticState;
  /** Bank being built during ALT_SELECT / BIT_SET; committed only by alt4/bit4. */
  loadedBank: number;
}

/**
 * Creates an FSM in reset state (idle, bank = BANKSTART = 3).
 *
 * Equivalent to MAME's `atari_slapstic_device::device_reset()`:
 *   m_state = m_s_idle.get();
 *   change_bank(slapstic_table[m_chipnum - 101]->bankstart);  // = 3 for chip 103
 */
export function createSlapsticFsm(): SlapsticFsm {
  return { bank: BANKSTART, state: "IDLE", loadedBank: 0 };
}

/**
 * Feeds one bus access (read or write) at the supplied `addr` into the FSM.
 *
 * This must be called for every slapstic-relevant bus access. Window accesses
 * at `0x080000-0x087FFF` always trigger the FSM, and `test_any` also requires
 * known out-of-range prefetch/code reads that match the `alt1` pattern.
 *
 * Returns the bank exposed after this access. The caller uses `bank * 0x2000`
 * as the offset inside the `0x080000` ROM blob.
 *
 * Exact replica of the MAME state machine for chip 103 (103-110 branch).
 */
export function slapsticTick(fsm: SlapsticFsm, addr: number): number {
  const a = addr >>> 0;

  switch (fsm.state) {
    case "IDLE":
      // Only a reset access returns to ACTIVE.
      if (testReset(a)) {
        fsm.state = "ACTIVE";
      }
      break;

    case "ACTIVE":
      // 1. Direct bank switch -> bank N, then IDLE
      // 2. ALT trigger (alt1, test_any) -> ALT_VALID
      // 3. BIT trigger (bit1, test_in) -> BIT_LOAD
      if (testBank(a, BANK_VALUES[0])) {
        fsm.bank = 0;
        fsm.state = "IDLE";
      } else if (testBank(a, BANK_VALUES[1])) {
        fsm.bank = 1;
        fsm.state = "IDLE";
      } else if (testBank(a, BANK_VALUES[2])) {
        fsm.bank = 2;
        fsm.state = "IDLE";
      } else if (testBank(a, BANK_VALUES[3])) {
        fsm.bank = 3;
        fsm.state = "IDLE";
      } else if (testAny(a, ALT1_MASK, ALT1_VAL)) {
        fsm.state = "ALT_VALID";
      } else if (testIn(a, BIT1_MASK, BIT1_VAL)) {
        fsm.state = "BIT_LOAD";
      }
      break;

    case "ALT_VALID":
      // Either reset (back to ACTIVE) or alt2 valid → ALT_SELECT; else
      // sequence breaks → ACTIVE.
      if (testReset(a)) {
        fsm.state = "ACTIVE";
      } else if (testIn(a, ALT2_MASK, ALT2_VAL)) {
        fsm.state = "ALT_SELECT";
      } else {
        fsm.state = "ACTIVE";
      }
      break;

    case "ALT_SELECT":
      if (testReset(a)) {
        fsm.state = "ACTIVE";
      } else if (testIn(a, ALT3_MASK, ALT3_VAL)) {
        // Loaded bank = (addr >> (shift + altshift)) & 3
        fsm.loadedBank = (a >>> (SHIFT + ALT_SHIFT)) & 3;
        fsm.state = "ALT_COMMIT";
      } else {
        fsm.state = "ACTIVE";
      }
      break;

    case "ALT_COMMIT":
      if (testReset(a)) {
        fsm.state = "ACTIVE";
      } else if (testIn(a, ALT4_MASK, ALT4_VAL)) {
        fsm.bank = fsm.loadedBank;
        fsm.state = "IDLE";
      }
      break;

    case "BIT_LOAD":
      if (testReset(a)) {
        fsm.state = "ACTIVE";
      } else if (testIn(a, BIT2_MASK, BIT2_VAL)) {
        fsm.loadedBank = fsm.bank;
        fsm.state = "BIT_SET_ODD";
      }
      break;

    case "BIT_SET_ODD":
      // is_odd = true: clear0=bit3c0, set0=bit3s0, clear1=bit3c1, set1=bit3s1
      if (testReset(a)) {
        fsm.state = "ACTIVE";
      } else if (testIn(a, BIT3C0_MASK, BIT3C0_VAL)) {
        fsm.loadedBank &= ~1;
        fsm.state = "BIT_SET_EVEN";
      } else if (testIn(a, BIT3S0_MASK, BIT3S0_VAL)) {
        fsm.loadedBank |= 1;
        fsm.state = "BIT_SET_EVEN";
      } else if (testIn(a, BIT3C1_MASK, BIT3C1_VAL)) {
        fsm.loadedBank &= ~2;
        fsm.state = "BIT_SET_EVEN";
      } else if (testIn(a, BIT3S1_MASK, BIT3S1_VAL)) {
        fsm.loadedBank |= 2;
        fsm.state = "BIT_SET_EVEN";
      } else if (testIn(a, BIT4_MASK, BIT4_VAL)) {
        fsm.bank = fsm.loadedBank;
        fsm.state = "IDLE";
      }
      break;

    case "BIT_SET_EVEN":
      // is_odd = false: clear0=bit3s1, set0=bit3c1, clear1=bit3s0, set1=bit3c0
      // This swap is a MAME quirk: bit3c*/bit3s* patterns change meaning
      // depending on the odd/even phase of the sequence.
      if (testReset(a)) {
        fsm.state = "ACTIVE";
      } else if (testIn(a, BIT3S1_MASK, BIT3S1_VAL)) {
        fsm.loadedBank &= ~1;
        fsm.state = "BIT_SET_ODD";
      } else if (testIn(a, BIT3C1_MASK, BIT3C1_VAL)) {
        fsm.loadedBank |= 1;
        fsm.state = "BIT_SET_ODD";
      } else if (testIn(a, BIT3S0_MASK, BIT3S0_VAL)) {
        fsm.loadedBank &= ~2;
        fsm.state = "BIT_SET_ODD";
      } else if (testIn(a, BIT3C0_MASK, BIT3C0_VAL)) {
        fsm.loadedBank |= 2;
        fsm.state = "BIT_SET_ODD";
      } else if (testIn(a, BIT4_MASK, BIT4_VAL)) {
        fsm.bank = fsm.loadedBank;
        fsm.state = "IDLE";
      }
      break;
  }

  return fsm.bank;
}

// ─── Expose internals for testing ────────────────────────────────────────────

/** Magic constants exposed for tests/debugging, not runtime consumption. */
export const _SLAPSTIC_103_CONFIG = {
  BANKSTART,
  BANK_VALUES,
  ALT1: { mask: ALT1_MASK, value: ALT1_VAL },
  ALT2: { mask: ALT2_MASK, value: ALT2_VAL },
  ALT3: { mask: ALT3_MASK, value: ALT3_VAL },
  ALT4: { mask: ALT4_MASK, value: ALT4_VAL },
  BIT1: { mask: BIT1_MASK, value: BIT1_VAL },
  BIT2: { mask: BIT2_MASK, value: BIT2_VAL },
  BIT3C0: { mask: BIT3C0_MASK, value: BIT3C0_VAL },
  BIT3S0: { mask: BIT3S0_MASK, value: BIT3S0_VAL },
  BIT3C1: { mask: BIT3C1_MASK, value: BIT3C1_VAL },
  BIT3S1: { mask: BIT3S1_MASK, value: BIT3S1_VAL },
  BIT4: { mask: BIT4_MASK, value: BIT4_VAL },
  SHIFT,
  RANGE_MASK,
  RANGE_VALUE,
  INPUT_MASK,
} as const;
