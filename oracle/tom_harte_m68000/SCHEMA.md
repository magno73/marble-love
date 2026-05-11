# Tom Harte SingleStepTests — JSON schema

This directory contains a subset of the
[SingleStepTests/m68000](https://github.com/SingleStepTests/m68000) dataset
(MIT-licensed). The original `.json.bin` binary blobs were decoded with the
upstream `decode.py`; the resulting JSON files were then filtered down to a
stack-ABI subset by [`build_subset.py`](./build_subset.py).

## File list

| File                | Instruction class                          | Opcode mask / range          | First test (sample)                       |
|---------------------|--------------------------------------------|------------------------------|-------------------------------------------|
| `LINK.json`         | `LINK An,#-N`                              | `0x4E50..0x4E57`             | `LINK A0, # 4e50` (op `0x4E50`)           |
| `UNLK.json`         | `UNLK An`                                  | `0x4E58..0x4E5F`             | `UNLINK A0 4e58` (op `0x4E58`)            |
| `MOVEM_L_PD.json`   | `MOVEM.L <list>,-(An)` (reg-to-mem PD)     | `0x48E0..0x48E7` (& 0xFFF8)  | `MOVEM.l #, -(A0) 48e0` (op `0x48E0`)     |
| `MOVEM_L_POI.json`  | `MOVEM.L (An)+,<list>` (mem-to-reg POI)    | `0x4CD8..0x4CDF` (& 0xFFF8)  | `MOVEM.l (A0)+, # 4cd8` (op `0x4CD8`)     |
| `MOVE_L_DISP.json`  | `MOVE.L` with `(d16,An)` on either side    | mode=5 in src or dst         | `MOVE.l (d16, A2), D0 202a` (op `0x202A`) |
| `MOVE_W_DISP.json`  | `MOVE.W` with `(d16,An)` on either side    | mode=5 in src or dst         | `MOVE.w (d16, A0), D0 3028` (op `0x3028`) |
| `JSR_PC.json`       | `JSR <ea>` (PC pushed to SP)               | `0x4E80..0x4EBF` (& 0xFFC0)  | `JSR (A0) 4e90` (op `0x4E90`)             |
| `RTS.json`          | `RTS`                                       | `0x4E75` (exact)             | `RTS 4e75` (op `0x4E75`)                  |
| `ADDQ_L_SP.json`    | `ADDQ.L #n,SP` (A7 stack adjust)           | `0x508F,0x518F,..,0x5E8F` (& 0xF1FF == 0x508F) | `ADD.l 8, A7 508f` (op `0x508F`) |

> Note: the upstream `MOVE_L`/`MOVE_W` files cover the full M68000 addressing
> matrix; we filtered to mode 5 (`(d16,An)`). The user request mentioned `d8`
> displacement; on the M68K only mode 5 = `(d16,An)` (16-bit signed) maps to
> the typical `move.l d0,(N,A6)` small-displacement frame-pointer accesses
> emitted by C compilers. Mode 6 = `(d8,An,Xn)` (with index register) is NOT
> included; the toolchain in Marble Madness almost never emits it for stack
> frame access.
>
> Note: ADDQ is not stored in its own upstream file; ADDQ.L tests live inside
> `ADD.l.json.bin`. We filter by exact opcode mask `(op & 0xF1FF) == 0x508F`.

## Test object schema

Each file is a JSON array of test cases. One test:

```jsonc
{
  // Free-form label: "<index> <disasm> <hex-opcode>"
  "name": "070 LINK A0, # 4e50",

  // CPU + memory state BEFORE executing the instruction
  "initial": {
    // 32-bit data registers
    "d0": <uint32>, "d1": <uint32>, ..., "d7": <uint32>,
    // 32-bit address registers A0..A6
    "a0": <uint32>, ..., "a6": <uint32>,
    // User and supervisor stack pointers (the "active" one matches SR.S)
    "usp": <uint32>,
    "ssp": <uint32>,
    // Status register (16-bit)
    "sr":  <uint16>,
    // Program counter — NOTE: this is MAME's `m_au` ("next prefetch
    // address"), so PC is +4 from where execution actually starts.
    "pc":  <uint32>,
    // Two-word prefetch queue at the start. prefetch[0] is the OPCODE that
    // will execute next; prefetch[1] is the following word.
    "prefetch": [<uint16>, <uint16>],
    // Sparse RAM image. Each entry is [address, byte_value]. Note that the
    // upstream binary encoding stores 16-bit words and decode.py splits them
    // into two byte entries (one for even, one for odd).
    "ram": [[<uint32>, <uint8>], ...]
  },

  // CPU + memory state AFTER executing the instruction (same shape)
  "final": { ... },

  // Bus transactions, one element per cycle group. Format depends on type:
  //   ["n", cycles]                              — idle
  //   ["r"|"w", cycles, fc, addr, ".w"|".b", data, UDS, LDS]   — bus cycle
  //   ["re"|"we", ...]                           — address-error variant
  //   ["t", ...]                                 — TAS read-modify-write
  "transactions": [ ... ],

  // Total cycle count for the instruction (matches sum of `cycles` in
  // transactions; sometimes 0 when the upstream had no cycle info).
  "length": <int>
}
```

### Field semantics (from upstream README)

- **`pc` in `initial`**: set to MAME's `m_au`. Because `m_au` is "next
  prefetch address", `initial.pc == pc_at_start_of_instruction + 4`. To
  recover the "start PC" use `initial.pc - 4`; the opcode word at that
  address equals `initial.prefetch[0]`.
- **`prefetch`**: the IRC/IR prefetch latches. `prefetch[0]` is the IR (the
  word currently being executed); `prefetch[1]` is the IRC (the next word
  already fetched). After execution `final.prefetch` reflects the new state.
- **`sr` low byte** is CCR (X N Z V C in bits 4..0); high byte is the
  supervisor flags (T1, S, IPM).
- **`ram`**: only addresses that matter for the test (program bytes,
  stack region, EA targets) are listed. Decoder splits each 16-bit RAM word
  into `[even_addr, hi_byte]` and `[even_addr|1, lo_byte]`.
- **`transactions[i]` cycle fields**: `cycles` is the cycle count for that
  bus phase. `fc` is the M68K function code (1=user data, 2=user prog,
  5=sup data, 6=sup prog, 7=int ack). `data` is the data-bus value (16-bit;
  byte transfers replicate the byte into the active half — see upstream
  README's data-bus note). `UDS`/`LDS` are the upper/lower data strobes.

### Differences vs the classic TomHarte format

Quoting upstream README:

> They are in ALMOST the same format as the TomHarte tests, just generated
> with a better emulator, and:
> - RAM pieces are now in 16 bits, as it is on the real processor.
> - There are the new "re" and "we" cycle types …
> - PC is now set using `m_au` from MAME … it's "next prefetch address"
>   so it's +4 from where the test starts executing.
> - Data bus now always is as real processor (UDS-only `0xAB` → 0xAB00).
> - Transaction logs now include UDS and LDS.

## Full sample (LINK)

First test of `LINK.json` (opcode `0x4E50`, `LINK A0,#$3a30`):

```json
{
  "name": "070 LINK A0, # 4e50",
  "initial": {
    "d0": 1234567890,
    "...": "(other Dn/An shown for brevity)",
    "a0": 0x12345678,
    "usp": 0x00400000,
    "ssp": 0x00500000,
    "sr": 0x2000,           // supervisor, no flags
    "pc": 0x00010004,        // m_au — actual instruction starts at 0x00010000
    "prefetch": [0x4E50, 0x3A30],   // opcode + displacement word
    "ram": [
      [0x00010000, 0x4E], [0x00010001, 0x50],
      [0x00010002, 0x3A], [0x00010003, 0x30],
      "..."
    ]
  },
  "final": {
    "a0":  0x004FFFFC,       // An = new top of stack (after push)
    "ssp": 0x00500000 + 0x3A30, // SSP after adjustment by displacement
    "pc":  0x00010008,
    "prefetch": [..., ...]
  },
  "transactions": [
    ["r", 4, 6, 0x10004, ".w", 0x????, 1, 1],   // prefetch
    ["w", 4, 5, 0x4FFFFC, ".w", 0x1234, 1, 1],  // push hi(An)
    ["w", 4, 5, 0x4FFFFE, ".w", 0x5678, 1, 1],  // push lo(An)
    ["r", 4, 6, 0x10006, ".w", 0x????, 1, 1]    // prefetch next
  ],
  "length": 16
}
```

(The actual test JSON has every field populated; this is an illustrative
shape — re-formatted with placeholders for brevity. For a real example,
open any file with `head -c 2000 LINK.json`.)
