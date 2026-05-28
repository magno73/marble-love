#!/usr/bin/env python3
"""
ghidra_dump_range.py - dump disassembly for an arbitrary Ghidra project range.

Usage: uv run --with pyghidra python3 tools/ghidra_dump_range.py START_HEX END_HEX OUT_FILE

Examples:
    uv run --with pyghidra python3 tools/ghidra_dump_range.py 0x340 0x400 ghidra_project/dump_isr.txt
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


def main():
    if len(sys.argv) != 4:
        print("usage: ghidra_dump_range.py START_HEX END_HEX OUT_FILE", file=sys.stderr)
        return 2
    start = int(sys.argv[1], 0)
    end = int(sys.argv[2], 0)
    out_file = Path(sys.argv[3])

    from ghidra.base.project import GhidraProject
    proj = GhidraProject.openProject(str(ROOT / "ghidra_project"), "marble", False)
    program = proj.openProgram("/", "marble_program.bin", True)  # readonly
    listing = program.getListing()
    af = program.getAddressFactory()
    space = af.getDefaultAddressSpace()

    out = [f"# Disasm 0x{start:X}..0x{end:X}", ""]
    addr = space.getAddress(start)
    while addr.getOffset() < end:
        instr = listing.getInstructionAt(addr)
        if instr is None:
            # try data
            data = listing.getDataAt(addr)
            if data is not None:
                out.append(f"{addr.toString():<10}  DATA   {data.getValue()}")
                addr = addr.add(data.getLength())
                continue
            # raw byte
            try:
                b = program.getMemory().getByte(addr)
                out.append(f"{addr.toString():<10}  .byte  0x{b & 0xff:02X}")
            except Exception:
                out.append(f"{addr.toString():<10}  .???")
            addr = addr.add(1)
            continue
        operands = ",".join(
            str(instr.getDefaultOperandRepresentation(i))
            for i in range(instr.getNumOperands())
        )
        # also show flow info
        flows = instr.getFlows()
        flow_str = ""
        if flows:
            flow_str = "  → " + ", ".join(f.toString() for f in flows[:3])
        # show called function name if call
        out.append(f"{addr.toString():<10}  {instr.getMnemonicString():<6} {operands}{flow_str}")
        addr = addr.add(instr.getLength())

    out_file.write_text("\n".join(out), encoding="utf-8")
    print(f"wrote {len(out)} lines → {out_file}")
    proj.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
