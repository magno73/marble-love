/**
 * slapstic-103.ts — Atari Slapstic 137412-103 (Marble Madness) state machine.
 *
 * Replica bit-perfect di `mame/src/mame/atari/slapstic.cpp`, configurazione
 * `slapstic103`, branca `active_103_110` (3rd revision of the slapstic family).
 *
 * Il chip Atari Slapstic e' un IC custom (20-pin DIP) che si frappone tra
 * address bus del 68010 e una ROM di programma, fornendo bank switching +
 * protezione anti-copia. Per Marble Madness occupa la finestra
 * `0x080000-0x087FFF` (8KB visibili), e seleziona uno di 4 bank da 8KB
 * presenti nella ROM image a offset `0x080000 + bank*0x2000`.
 *
 * **Parametri chip 103** (`slapstic.cpp:271-297`):
 *   bankstart  = 3 (bank di reset)
 *   bank[]     = { 0x0040, 0x0050, 0x0060, 0x0070 }
 *   alt1       = mask=0x007f, value=0x002d        (test_any → fuori range OK)
 *   alt2       = mask=0x3fff, value=0x3d14        (test_in → dentro range)
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
 *   NO additive banking (chip 103 e' rev1, gli additivi sono per chip 111+)
 *
 * **Bus geometry**:
 *   start         = 0x080000
 *   end           = 0x087FFF
 *   mirror        = 0
 *   data_width    = 16 → shift = 1 (M68K word-addressed bus)
 *   address_lines = 14 (A0-A13 sul chip = A1-A14 sul bus 68000)
 *   range_mask    = ~((end - start) | mirror) = ~0x7FFF = 0xFFFF8000
 *   range_value   = 0x080000
 *   input_mask    = ((1 << 14) - 1) << 1 = 0x7FFE
 *
 * **Test helpers** (riprodotti da `slapstic.cpp:838-871`):
 *   test_in(mv)     = test(range_mask | (mv.mask << 1), range_value | (mv.value << 1))
 *   test_any(mv)    = test(mv.mask << 1, mv.value << 1)              // ignora range
 *   test_inside()   = test(range_mask, range_value)
 *   test_reset()    = test(range_mask | input_mask, range_value)     // any addr 0x80000
 *                                                                    // (low 15 bit == 0)
 *   test_bank(b)    = test(range_mask | input_mask, range_value | (b << 1))
 *
 * **Stati FSM** (per la branca 103-110):
 *   IDLE        - in attesa di un "reset access" (addr a 0x80000, low 15 bit clear)
 *   ACTIVE      - bank scelto + accetta direct/alt/bit transitions
 *   ALT_VALID   - dopo alt1 trigger, attende alt2
 *   ALT_SELECT  - dopo alt2 ok, attende alt3 (carica loaded_bank)
 *   ALT_COMMIT  - dopo alt3, attende alt4 (commit loaded_bank → current_bank)
 *   BIT_LOAD    - dopo bit1 trigger, attende bit2 (carica loaded_bank dal current)
 *   BIT_SET_ODD - bit-set state alternato; accetta bit3* per modificare loaded_bank
 *   BIT_SET_EVEN- come ODD ma alternato (toggle ogni hit di bit3*)
 *
 * Bank di reset dopo `slapsticReset()` = 3 (parametro `bankstart`).
 * MAME: `device_reset()` → `change_bank(slapstic_table[chip-101]->bankstart)`.
 *
 * **Reset access** (idle → active):
 *   Un qualsiasi accesso ad addr che soddisfa test_reset(): un read/write al
 *   primo word della slapstic window (`0x080000` per data_width=16) — solo
 *   l'A0-A14 sono 0. Questo e' la classica "trigger read" che il binario
 *   ROM esegue prima di ogni sequenza di bank switching (`slapstic-lookup.ts`).
 *
 * Bit-perfect verificato vs MAME slapstic device tap (`oracle/mame_slapstic_tap.lua`).
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

/** Inizio window slapstic (incluso). */
const START = 0x080000;
/** Fine window slapstic (esclusa). 8KB visibili. */
const END_EXCL = 0x088000;
/** Address shift per data_width=16 (un bus word = 2 byte). */
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

/** Stati FSM esposti per i 9 stati MAME (S_BIT_SET_ODD/EVEN sono distinti). */
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
  /** Bank correntemente esposto sul bus (0..3). */
  bank: number;
  /** Stato FSM. */
  state: SlapsticState;
  /** Bank in costruzione durante ALT_SELECT / BIT_SET (committed solo da alt4/bit4). */
  loadedBank: number;
}

/**
 * Crea una FSM in stato di reset (idle, bank = BANKSTART = 3).
 *
 * Equivalente a `atari_slapstic_device::device_reset()` di MAME:
 *   m_state = m_s_idle.get();
 *   change_bank(slapstic_table[m_chipnum - 101]->bankstart);  // = 3 for chip 103
 */
export function createSlapsticFsm(): SlapsticFsm {
  return { bank: BANKSTART, state: "IDLE", loadedBank: 0 };
}

/**
 * Intercetta un accesso (read O write) al bus alla `addr` indicata.
 *
 * **IMPORTANTE**: questa funzione va chiamata SU OGNI accesso al bus che cade
 * dentro `0x080000-0x087FFF` (write o read). MAME installa un "tap" su tutto
 * il range della address-space → ogni operazione triggera `m_state->test()`.
 *
 * Ritorna il bank correntemente esposto dopo questo accesso. Il caller usa
 * `bank * 0x2000` come offset all'interno del blob ROM `0x080000`.
 *
 * Replica esattamente la state machine MAME per chip 103 (branca 103-110).
 */
export function slapsticTick(fsm: SlapsticFsm, addr: number): number {
  const a = addr >>> 0;

  switch (fsm.state) {
    case "IDLE":
      // Solo un reset access torna in ACTIVE.
      if (testReset(a)) {
        fsm.state = "ACTIVE";
      }
      break;

    case "ACTIVE":
      // 1. Direct bank switch → bank N, torna IDLE
      // 2. ALT trigger (alt1, test_any) → ALT_VALID
      // 3. BIT trigger (bit1, test_in) → BIT_LOAD
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
      // (questo "swap" e' un quirk di MAME: i pattern bit3c*/bit3s* hanno
      // un significato che dipende dalla fase odd/even della sequenza)
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

/** Magic constants esposti per testing/debugging — non per consumo runtime. */
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
