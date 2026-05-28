#!/usr/bin/env python3
"""find_xrefs.py - list xrefs to specific RAM addresses, classified read/write.

Usage: uv run --with pyghidra python3 tools/find_xrefs.py 0x4003A6 0x4003A7 0x4003F0
"""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
os.environ.setdefault("GHIDRA_INSTALL_DIR", "/opt/homebrew/Cellar/ghidra/12.0.4/libexec")
os.environ.setdefault("JAVA_HOME", "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home")

import pyghidra  # noqa: E402

pyghidra.start()

from ghidra.base.project import GhidraProject  # noqa: E402

if len(sys.argv) < 2:
    print("usage: find_xrefs.py 0xADDR [0xADDR ...]", file=sys.stderr)
    sys.exit(2)

proj = GhidraProject.openProject(str(ROOT / "ghidra_project"), "marble", False)
program = proj.openProgram("/", "marble_program.bin", True)

af = program.getAddressFactory().getDefaultAddressSpace()
listing = program.getListing()
rm = program.getReferenceManager()

for arg in sys.argv[1:]:
    addr_int = int(arg, 0)
    addr = af.getAddress(addr_int)
    refs = list(rm.getReferencesTo(addr))
    print(f"\n## 0x{addr_int:06X}  ({len(refs)} refs)")
    for ref in refs:
        from_addr = ref.getFromAddress()
        instr = listing.getInstructionAt(from_addr)
        rt = ref.getReferenceType().getName()
        text = instr.toString() if instr else "(no instr)"
        # Find containing function
        fn = program.getFunctionManager().getFunctionContaining(from_addr)
        fn_str = fn.getName() if fn else "??"
        print(f"  {from_addr.toString():<10} in {fn_str:<22}  {text:<50}  ({rt})")

proj.close()
