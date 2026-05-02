#!/usr/bin/env python3
"""
find_rng_static.py — scan Ghidra project per funzioni piccole con pattern RNG:
  read RAM[X] → math → write RAM[X] → return

Output: ranked list di (function_addr, address_touched, num_insts).

Uso:
    uv run --with pyghidra python3 tools/find_rng_static.py
"""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

os.environ.setdefault(
    "GHIDRA_INSTALL_DIR", "/opt/homebrew/Cellar/ghidra/12.0.4/libexec"
)
os.environ.setdefault(
    "JAVA_HOME", "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
)

import pyghidra  # noqa: E402

pyghidra.start()


def main() -> int:
    from ghidra.base.project import GhidraProject

    proj = GhidraProject.openProject(str(ROOT / "ghidra_project"), "marble", False)
    program = proj.openProgram("/", "marble_program.bin", True)

    fm = program.getFunctionManager()
    listing = program.getListing()
    rm = program.getReferenceManager()

    candidates = []

    for fn in fm.getFunctions(True):
        body = fn.getBody()
        # count instructions in this function
        n_inst = 0
        ram_reads = set()
        ram_writes = set()

        for addr_set_iter in body.getAddressRanges():
            addr = addr_set_iter.getMinAddress()
            end = addr_set_iter.getMaxAddress()
            instr = listing.getInstructionAt(addr)
            while instr is not None and instr.getAddress().compareTo(end) <= 0:
                n_inst += 1
                # references FROM this instruction
                for ref in instr.getReferencesFrom():
                    target = ref.getToAddress().getOffset()
                    rt = ref.getReferenceType().getName()
                    # Solo accessi a Work RAM 0x400000-0x401FFF
                    if 0x400000 <= target < 0x402000:
                        if "READ" in rt and "WRITE" not in rt:
                            ram_reads.add(target)
                        elif "WRITE" in rt and "READ" not in rt:
                            ram_writes.add(target)
                        elif "READ_WRITE" in rt:
                            ram_reads.add(target)
                            ram_writes.add(target)
                instr = listing.getInstructionAfter(instr.getAddress())
                if instr is None or instr.getAddress().compareTo(end) > 0:
                    break

        # Find addresses that are BOTH read and written by this function
        rw_intersect = ram_reads & ram_writes

        # Heuristic: small function, 1-3 RW addresses, called many times
        if rw_intersect and 5 <= n_inst <= 25:
            xref_count = len(list(rm.getReferencesTo(fn.getEntryPoint())))
            if xref_count >= 3:
                candidates.append({
                    "fn": fn.getEntryPoint().getOffset(),
                    "n_inst": n_inst,
                    "xrefs": xref_count,
                    "rw": sorted(rw_intersect),
                    "reads": sorted(ram_reads),
                    "writes": sorted(ram_writes),
                })

    # sort: high xref, low n_inst, few rw addresses
    candidates.sort(key=lambda c: (-c["xrefs"], c["n_inst"], len(c["rw"])))

    print("# Candidate RNG-like functions")
    print("# (small read+write to Work RAM, 5+ xref)")
    print(f"# {'fn':<10} {'inst':<5} {'xref':<5} {'rw_addrs'}")
    print()
    for c in candidates[:30]:
        rw_str = ", ".join(f"0x{a:06X}" for a in c["rw"][:5])
        print(f"0x{c['fn']:06X}   {c['n_inst']:3d}    {c['xrefs']:3d}    [{rw_str}]")

    proj.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
