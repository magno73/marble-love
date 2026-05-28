#!/usr/bin/env python3
"""
ghidra_disasm_at.py - force disassembly at a list of addresses and dump the result.

Usage:
  uv run --with pyghidra python3 tools/ghidra_disasm_at.py 0x34A 0x36C [more...]
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
    if len(sys.argv) < 2:
        print("usage: ghidra_disasm_at.py 0xADDR [0xADDR ...]", file=sys.stderr)
        return 2

    from ghidra.base.project import GhidraProject
    from ghidra.program.flatapi import FlatProgramAPI
    from ghidra.util.task import ConsoleTaskMonitor

    proj = GhidraProject.openProject(str(ROOT / "ghidra_project"), "marble", False)
    program = proj.openProgram("/", "marble_program.bin", False)
    monitor = ConsoleTaskMonitor()
    flat = FlatProgramAPI(program, monitor)
    af = program.getAddressFactory()
    space = af.getDefaultAddressSpace()
    listing = program.getListing()

    addrs = [int(a, 0) for a in sys.argv[1:]]

    tx = program.startTransaction("force-disasm")
    try:
        for addr_int in addrs:
            addr = space.getAddress(addr_int)
            # Clear data first (in case it was misclassified)
            try:
                listing.clearCodeUnits(addr, addr.add(64), False)
            except Exception:
                pass
            flat.addEntryPoint(addr)
            flat.disassemble(addr)
            print(f"  forced disasm @ 0x{addr_int:X}")

        # Re-run analysis to follow control flow
        from ghidra.app.plugin.core.analysis import AutoAnalysisManager
        mgr = AutoAnalysisManager.getAnalysisManager(program)
        mgr.startAnalysis(monitor)
        mgr.waitForAnalysis(None, monitor)
    finally:
        program.endTransaction(tx, True)

    # Dump each requested address
    for addr_int in addrs:
        addr = space.getAddress(addr_int)
        end = addr_int + 0x80
        out = [f"# Disasm 0x{addr_int:X}..", ""]
        cur = addr
        while cur.getOffset() < end:
            instr = listing.getInstructionAt(cur)
            if instr is None:
                out.append(f"{cur.toString():<10}  (no instr)")
                cur = cur.add(1)
                continue
            operands = ",".join(
                str(instr.getDefaultOperandRepresentation(i))
                for i in range(instr.getNumOperands())
            )
            out.append(f"{cur.toString():<10}  {instr.getMnemonicString():<6} {operands}")
            cur = cur.add(instr.getLength())
            if instr.getMnemonicString() == "rte" or instr.getMnemonicString() == "rts":
                out.append(f"  --- end at {cur.toString()} ---")
                break
        print("\n".join(out))
        print()

    proj.save(program)
    proj.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
