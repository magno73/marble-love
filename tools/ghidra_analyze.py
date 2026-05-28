#!/usr/bin/env python3
"""
ghidra_analyze.py — opens an existing Ghidra project, adds memory blocks +
entry points, re-analyzes, and dumps function list/strings/disassembly/xrefs.

Prerequisite: the binary has already been imported via analyzeHeadless:

    ./tools/ghidra_headless.sh "$(pwd)/ghidra_project" marble \\
        -import "$(pwd)/ghidra_project/marble_program.bin" \\
        -loader BinaryLoader \\
        -loader-baseAddr 0x000000 \\
        -processor 68000:BE:32:default \\
        -overwrite

Poi:

    uv run --with pyghidra python3 tools/ghidra_analyze.py
"""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJ_DIR = ROOT / "ghidra_project"
PROJ_NAME = "marble"
OUT_DIR = ROOT / "ghidra_project"

os.environ.setdefault(
    "GHIDRA_INSTALL_DIR", "/opt/homebrew/Cellar/ghidra/12.0.4/libexec"
)
os.environ.setdefault(
    "JAVA_HOME", "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
)

import pyghidra  # noqa: E402

pyghidra.start()


def setup_memory_and_entries(program, monitor):
    """Aggiunge memory blocks per RAM/MMIO e seedingha entry points."""
    from ghidra.program.flatapi import FlatProgramAPI
    from ghidra.program.model.symbol import SourceType

    flat = FlatProgramAPI(program, monitor)
    af = program.getAddressFactory()
    space = af.getDefaultAddressSpace()
    mem = program.getMemory()
    st = program.getSymbolTable()

    def add_block(name, start_int, length, write=False):
        start = space.getAddress(start_int)
        if mem.getBlock(start) is not None:
            return
        try:
            blk = mem.createUninitializedBlock(name, start, length, False)
            blk.setRead(True)
            blk.setWrite(write)
            blk.setVolatile(True)
            print(f"  + block {name} @ 0x{start_int:X} size=0x{length:X}")
        except Exception as e:
            print(f"  ! block {name} failed: {e}")

    def add_label(name, addr_int):
        addr = space.getAddress(addr_int)
        try:
            st.createLabel(addr, name, SourceType.USER_DEFINED)
        except Exception as e:
            print(f"  ! label {name} failed: {e}")

    print("[setup] memory blocks")
    add_block("WORK_RAM",   0x400000, 0x002000, write=True)
    add_block("CART_RAM",   0x900000, 0x100000, write=True)
    add_block("PF_RAM",     0xA00000, 0x002000, write=True)
    add_block("MOB_RAM",    0xA02000, 0x001000, write=True)
    add_block("ALPHA_RAM",  0xA03000, 0x001000, write=True)
    add_block("PAL_RAM",    0xB00000, 0x000800, write=True)
    add_block("EEPROM",     0xF00000, 0x000400, write=True)
    add_block("MMIO_VID",   0x800000, 0x0C0002, write=True)
    add_block("MMIO_INPUT", 0xF20000, 0x040004, write=True)
    add_block("MMIO_SOUND", 0xF80000, 0x080002, write=True)
    add_block("INT3STATE",  0x2E0000, 0x000002, write=False)

    print("[setup] labels")
    labels = [
        ("VEC_SSP", 0x000000), ("VEC_RESET_PC", 0x000004),
        ("VEC_BUS_ERROR", 0x000008), ("VEC_ADDR_ERROR", 0x00000C),
        ("VEC_ILLEGAL_INSTR", 0x000010),
        ("VEC_IRQ_LV2_JOY", 0x000068),
        ("VEC_IRQ_LV3_SPRITE", 0x00006C),
        ("VEC_IRQ_LV4_VBLANK", 0x000070),
        ("VEC_IRQ_LV6_SOUND", 0x000078),
        ("ResetEntry", 0x000466),
        ("MMIO_PF_XSCROLL", 0x800000),
        ("MMIO_PF_YSCROLL", 0x820000),
        ("MMIO_PF_PRIORITY", 0x840000),
        ("MMIO_AV_CONTROL", 0x860001),
        ("MMIO_WATCHDOG", 0x880001),
        ("MMIO_VBLANK_ACK", 0x8A0001),
        ("MMIO_EEPROM_UNLOCK", 0x8C0001),
        ("MMIO_TRAKBALL_P1X", 0xF20000),
        ("MMIO_TRAKBALL_P1Y", 0xF20002),
        ("MMIO_TRAKBALL_P2X", 0xF20004),
        ("MMIO_TRAKBALL_P2Y", 0xF20006),
        ("MMIO_SWITCHES", 0xF60000),
        ("MMIO_SOUND_RESP", 0xFC0001),
        ("MMIO_SOUND_CMD", 0xFE0001),
        ("MMIO_INT3_STATE", 0x2E0000),
    ]
    for name, addr_int in labels:
        add_label(name, addr_int)

    print("[setup] entry points + disasm")
    reset_addr = space.getAddress(0x466)
    flat.addEntryPoint(reset_addr)
    flat.disassemble(reset_addr)

    for vec_offset in [0x68, 0x6C, 0x70, 0x78, 0x08, 0x0C, 0x10]:
        try:
            vec_addr = space.getAddress(vec_offset)
            buf = bytearray(4)
            mem.getBytes(vec_addr, buf)
            target_int = (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]
            if 0x400 <= target_int < 0x88000:
                target_addr = space.getAddress(target_int)
                flat.addEntryPoint(target_addr)
                flat.disassemble(target_addr)
                print(f"  + vec 0x{vec_offset:03X} → 0x{target_int:06X}")
        except Exception as e:
            print(f"  ! vec 0x{vec_offset:03X} failed: {e}")


def run_analysis(program, monitor):
    from ghidra.app.plugin.core.analysis import AutoAnalysisManager
    print("[analyze] auto-analysis…")
    mgr = AutoAnalysisManager.getAnalysisManager(program)
    mgr.initializeOptions()
    mgr.startAnalysis(monitor)
    mgr.waitForAnalysis(None, monitor)


def write_out(name, text):
    p = OUT_DIR / name
    p.write_text(text, encoding="utf-8")
    print(f"  → {p} ({len(text)} byte)")


def dump_functions(program):
    out = ["# Functions in marble program ROM",
           "# columns: address xref_count name", ""]
    fm = program.getFunctionManager()
    fns = list(fm.getFunctions(True))
    rm = program.getReferenceManager()
    rows = []
    for fn in fns:
        addr = fn.getEntryPoint()
        refs = list(rm.getReferencesTo(addr))
        rows.append((len(refs), addr.toString(), fn.getName()))
    rows.sort(key=lambda r: -r[0])
    for xref, addr_str, name in rows:
        out.append(f"{addr_str:<10}  {xref:5d}  {name}")
    out.append("")
    out.append(f"# Total functions: {len(rows)}")
    write_out("dump_functions.txt", "\n".join(out))


def dump_strings(program):
    out = ["# Strings in marble program ROM", ""]
    listing = program.getListing()
    for data in listing.getDefinedData(True):
        s = data.getValue()
        if s is None:
            continue
        s_str = str(s)
        if len(s_str) < 3:
            continue
        if not all(32 <= ord(c) < 127 for c in s_str):
            continue
        out.append(f"{data.getAddress().toString():<10}  {s_str}")
    write_out("dump_strings.txt", "\n".join(out))


def dump_disasm_from(program, addr_int, max_bytes, fname):
    out = [f"# Disasm from 0x{addr_int:X} ({max_bytes} bytes)", ""]
    listing = program.getListing()
    af = program.getAddressFactory()
    addr = af.getDefaultAddressSpace().getAddress(addr_int)
    instr = listing.getInstructionAt(addr)
    cnt = 0
    while instr is not None and cnt < max_bytes:
        a = instr.getAddress()
        operands = ",".join(
            str(instr.getDefaultOperandRepresentation(i))
            for i in range(instr.getNumOperands())
        )
        out.append(f"{a.toString():<10}  {instr.getMnemonicString():<6} {operands}")
        cnt += instr.getLength()
        instr = listing.getInstructionAfter(instr.getAddress())
    write_out(fname, "\n".join(out))


def dump_xrefs_mmio(program):
    out = ["# XRefs ai MMIO/RAM chiave del 68010", ""]
    targets = [
        (0x400000, "Program RAM start"),
        (0x401FFE, "Program RAM end"),
        (0x800000, "Playfield X scroll"),
        (0x820000, "Playfield Y scroll"),
        (0x860000, "Audio/video control (word)"),
        (0x860001, "Audio/video control (byte)"),
        (0x880000, "Watchdog reset"),
        (0x8A0000, "VBLANK IRQ ack"),
        (0xA00000, "Playfield RAM start"),
        (0xA02000, "Sprite RAM start"),
        (0xA03000, "Alpha RAM start"),
        (0xB00000, "Palette RAM start"),
        (0xB00400, "Playfield palette base"),
        (0xF00000, "EEPROM base"),
        (0xF20000, "Trackball P1 X (rotated)"),
        (0xF20002, "Trackball P1 Y (rotated)"),
        (0xF60000, "Switch inputs"),
        (0xFC0000, "Sound response read"),
        (0xFE0000, "Sound command write"),
    ]
    af = program.getAddressFactory()
    space = af.getDefaultAddressSpace()
    rm = program.getReferenceManager()
    for addr_int, label in targets:
        addr = space.getAddress(addr_int)
        refs = list(rm.getReferencesTo(addr))
        out.append(f"\n## 0x{addr_int:06X} — {label} ({len(refs)} refs)")
        for ref in refs[:50]:
            from_addr = ref.getFromAddress()
            instr = program.getListing().getInstructionAt(from_addr)
            if instr:
                out.append(
                    f"  {from_addr.toString():<10}  {instr.toString()}  ({ref.getReferenceType().getName()})"
                )
    write_out("dump_xrefs_mmio.txt", "\n".join(out))


def dump_memory_blocks(program):
    out = ["# Memory blocks defined in this Ghidra project", ""]
    for b in program.getMemory().getBlocks():
        out.append(
            f"{b.getName():<20}  {b.getStart()}..{b.getEnd()}  "
            f"size=0x{b.getSize():X}  R={b.isRead()} W={b.isWrite()} X={b.isExecute()}"
        )
    write_out("dump_memory.txt", "\n".join(out))


def main() -> int:
    from ghidra.base.project import GhidraProject
    from ghidra.util.task import ConsoleTaskMonitor

    monitor = ConsoleTaskMonitor()
    print(f"[ghidra] opening {PROJ_DIR}/{PROJ_NAME}")
    project = GhidraProject.openProject(str(PROJ_DIR), PROJ_NAME, False)
    program = project.openProgram("/", "marble_program.bin", False)
    print(f"[ghidra] opened: {program.getName()}")

    tx = program.startTransaction("setup")
    try:
        setup_memory_and_entries(program, monitor)
    finally:
        program.endTransaction(tx, True)

    tx = program.startTransaction("analysis")
    try:
        run_analysis(program, monitor)
    finally:
        program.endTransaction(tx, True)

    print("[ghidra] dumping")
    dump_memory_blocks(program)
    dump_functions(program)
    dump_strings(program)
    dump_disasm_from(program, 0x466, 8192, "dump_disasm_reset.txt")
    dump_xrefs_mmio(program)

    print("[ghidra] saving")
    project.save(program)
    project.close()
    print("[ghidra] ✅ done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
