# Tom Harte SingleStepTests — stack ABI subset

Pre/post-state test vectors for M68000 instructions used by the M68010 stack
ABI (LINK/UNLK, MOVEM.L, MOVE with `(d16,An)`, JSR/RTS, ADDQ.L #n,SP). Used as
an oracle to validate the TS register-file implementation that emulates
Marble Madness's stack frame handling.

## Origin

- Upstream repo: <https://github.com/SingleStepTests/m68000>
- Upstream commit: `64b253116a3de04aaac4346c43680960dc9b67e5`
- License: MIT — see [`UPSTREAM_LICENSE`](./UPSTREAM_LICENSE). Tests were
  generated using MAME's microcoded M68000 emulator (per upstream README).

## Schema

Documented in [`SCHEMA.md`](./SCHEMA.md). TL;DR: each file is a JSON array of
test objects with keys `name`, `initial`, `final`, `transactions`, `length`.
The opcode word is `initial.prefetch[0]`. `initial.pc` is MAME's `m_au`
("next prefetch address"), so the actual start PC is `initial.pc - 4`.

## File list

| File                | Instruction class                          | Test count |
|---------------------|--------------------------------------------|-----------:|
| `LINK.json`         | `LINK An,#-N`                              | 1000       |
| `UNLK.json`         | `UNLK An`                                  | 1000       |
| `MOVEM_L_PD.json`   | `MOVEM.L <list>,-(An)`                     |  267       |
| `MOVEM_L_POI.json`  | `MOVEM.L (An)+,<list>`                     |  288       |
| `MOVE_L_DISP.json`  | `MOVE.L` with `(d16,An)` src or dst        |  666       |
| `MOVE_W_DISP.json`  | `MOVE.W` with `(d16,An)` src or dst        |  690       |
| `JSR_PC.json`       | `JSR <ea>`                                 | 1000       |
| `RTS.json`          | `RTS`                                      | 1000       |
| `ADDQ_L_SP.json`    | `ADDQ.L #n,SP` (A7 adjust)                 |   12       |

Counts marked 1000 were sampled deterministically from the upstream 2500-test
files using `random.Random(seed=0xCAFEBABE)`; the rest are kept in full.
Total size: ~22 MB uncompressed.

## Reproducing the subset

1. Clone the upstream repo with sparse checkout (blobless to save bandwidth):
   ```bash
   git clone --filter=blob:none --no-checkout --depth=1 \
     https://github.com/SingleStepTests/m68000.git /tmp/tom_harte_m68000_full
   cd /tmp/tom_harte_m68000_full
   git checkout HEAD -- README.md decode.py LICENSE \
     v1/LINK.json.bin v1/UNLINK.json.bin v1/MOVEM.l.json.bin \
     v1/MOVE.l.json.bin v1/MOVE.w.json.bin \
     v1/JSR.json.bin v1/RTS.json.bin v1/ADD.l.json.bin
   ```
2. Decode the binary blobs to JSON (writes `v1/*.json` next to the `.bin`):
   ```bash
   python3 decode.py
   ```
3. Run the subset builder (deterministic):
   ```bash
   cd /Users/magnus-bot/Code/marble-love/oracle/tom_harte_m68000
   python3 build_subset.py
   ```

The script reads `/tmp/tom_harte_m68000_full/v1/*.json` and writes the subset
files in this directory. Given the same upstream commit it is bit-for-bit
reproducible (sort order = `(opcode, name)`; sampling seed = `0xCAFEBABE`).

## Filter rules

The exact filter for each output file is documented in
[`build_subset.py`](./build_subset.py). Summary:

- `LINK`:        opcode ∈ `0x4E50..0x4E57`
- `UNLK`:        opcode ∈ `0x4E58..0x4E5F`
- `MOVEM_L_PD`:  `(opcode & 0xFFF8) == 0x48E0`  (reg-to-mem long predecrement)
- `MOVEM_L_POI`: `(opcode & 0xFFF8) == 0x4CD8`  (mem-to-reg long postincrement)
- `MOVE_L_DISP`: MOVE.L with src OR dst effective-address mode bits == 5
- `MOVE_W_DISP`: MOVE.W with src OR dst effective-address mode bits == 5
- `JSR_PC`:      `(opcode & 0xFFC0) == 0x4E80`
- `RTS`:         opcode == `0x4E75`
- `ADDQ_L_SP`:   `(opcode & 0xF1FF) == 0x508F` (ADDQ tests live inside ADD.l)

## Notes / caveats

- The upstream README warns about TAS and TRAPV; neither is in this subset.
- The MOVE_L/MOVE_W subsets keep tests where mode 5 = `(d16,An)` appears on
  either side. Compiler-emitted small-displacement frame access uses mode 5.
  Mode 6 = `(d8,An,Xn)` (brief-extension with index register) is NOT included
  because the Marble Madness toolchain rarely emits it for frame access.
- Address-error variants (`"re"`/`"we"` transaction types) appear naturally
  in JSR if the EA misaligns. The TS register-file should treat them as
  faults; cycle accuracy of address-error handling is out of scope for the
  current stack-ABI validation.

## License

The JSON test data in this directory is derived from the upstream MIT-licensed
dataset and remains under MIT (see `UPSTREAM_LICENSE`). The `build_subset.py`
script is part of this repository and follows the repository's license.
