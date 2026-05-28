#!/usr/bin/env python3
"""
rom_prep.py - prepare ROMs for Ghidra import.

Atari System 1 / Marble Madness uses a 68010 CPU with a 16-bit bus. Program
ROMs are dumped as even/odd 8-bit pairs. Ghidra and other static-analysis tools
need those pairs interleaved into one big-endian blob.

Usage:
    python3 tools/rom_prep.py \\
        --rom-dir roms \\
        --out ghidra_project/marble_program.bin

The script auto-detects the standard Marble Madness ROM files. See
`mame -listxml marble` for canonical file names, then merges even/odd pairs
into one blob.

Phase 2 note: this script produces the first Ghidra input. Run it before
opening the Ghidra project.

References:
    - mame/src/mame/atari/atarisy1.cpp - ROM_START(marble) macro
    - https://wiki.mamedev.org/index.php/ROM_loading_techniques
"""

from __future__ import annotations

import argparse
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path


# Even/odd pairs for ROM_START(marble), ordered by increasing offset.
# Reference: mame/src/mame/atari/atarisy1.cpp:1003-1046.
#
# This list includes cartridge ROMs `136033.*` and the motherboard BIOS
# `136032.*`. For Ghidra, the complete blob must include both. The cartridge
# segment starts at 0x10000; BIOS calls still enter through the vector table at
# 0x000000 and shared System 1 code.
DEFAULT_PAIRS_MARBLE_BIOS: list[tuple[str, str, int]] = [
    # (even, odd, offset_in_blob) - Motherboard TTL Rev 2 BIOS.
    ("136032.205.l13", "136032.206.l12", 0x00000),
]

DEFAULT_PAIRS_MARBLE_CART: list[tuple[str, str, int]] = [
    # (even, odd, offset_in_blob) - Marble cartridge program ROMs.
    ("136033.623", "136033.624", 0x10000),
    ("136033.625", "136033.626", 0x18000),
    ("136033.627", "136033.628", 0x20000),
    ("136033.229", "136033.630", 0x28000),
    # Slapstic-protected region decoded as a single banked blob at 0x80000.
    ("136033.107", "136033.108", 0x80000),
]

# Compatibility with the earlier version of this script.
DEFAULT_PAIRS: list[tuple[str, str]] = [
    (e, o) for (e, o, _off) in (DEFAULT_PAIRS_MARBLE_BIOS + DEFAULT_PAIRS_MARBLE_CART)
]


@dataclass
class RomPair:
    even: bytes
    odd: bytes

    def interleave(self) -> bytes:
        """Return big-endian interleaved bytes, where even=hi and odd=lo."""
        if len(self.even) != len(self.odd):
            raise ValueError(
                f"size mismatch: even={len(self.even)} odd={len(self.odd)}"
            )
        out = bytearray(len(self.even) * 2)
        out[0::2] = self.even
        out[1::2] = self.odd
        return bytes(out)


def read_rom(path: Path) -> bytes:
    """Read a ROM file.

    Supports plain files. ZIP users should call `extract_from_zip` with exact
    member names.
    """
    if path.is_file() and path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path, "r"):
            raise NotImplementedError(
                "For ZIP input use --rom-zip and the exact expected members"
            )
    return path.read_bytes()


def extract_from_zip(zip_path: Path, member: str) -> bytes:
    with zipfile.ZipFile(zip_path, "r") as z:
        return z.read(member)


def list_zip(zip_path: Path) -> list[str]:
    with zipfile.ZipFile(zip_path, "r") as z:
        return sorted(z.namelist())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--rom-dir", type=Path, default=Path("roms"),
                    help="Directory with separate ROM files or the MAME ZIP")
    ap.add_argument("--rom-zip", type=Path, default=None,
                    help="Path to marble.zip, alternative to --rom-dir")
    ap.add_argument("--bios-zip", type=Path, default=None,
                    help="Path to atarisy1.zip, the 136032.* motherboard BIOS. "
                         "If omitted, the script checks the --rom-zip directory.")
    ap.add_argument("--out", type=Path, default=None,
                    help="Interleaved Ghidra output binary, required unless --list is used")
    ap.add_argument("--list", action="store_true",
                    help="Only list files in the ROM ZIP, then exit")
    args = ap.parse_args()

    if args.list:
        if not args.rom_zip:
            print("--list requires --rom-zip", file=sys.stderr)
            return 2
        for name in list_zip(args.rom_zip):
            print(name)
        return 0

    if args.out is None:
        ap.error("--out is required unless --list is used")

    args.out.parent.mkdir(parents=True, exist_ok=True)

    # Flat output blob, size 0x88000 (= 0x80000 program + 0x8000 slapstic).
    # ROMs are placed at their exact ROM_START(marble) offsets and interleaved
    # big-endian.
    OUT_SIZE = 0x88000
    # MAME's ROM_REGION flag effectively zero-fills: see atarisy1.cpp:976
    # `ROM_REGION( 0x88000, "maincpu", 0 )`. Unpopulated ranges such as
    # 0x30000..0x7FFFF stay 0x00. The M68K bus reads from that region
    # bit-faithfully; pre-filling with 0xFF caused decodeBitstream1A668 to take
    # the wrong token path during the f12002 body.
    out = bytearray(b"\x00" * OUT_SIZE)

    # BIOS lives in atarisy1.zip, the parent MAME set; cartridge ROMs live in
    # marble.zip.
    bios_zip = args.bios_zip
    if bios_zip is None and args.rom_zip is not None:
        guess = args.rom_zip.parent / "atarisy1.zip"
        if guess.is_file():
            bios_zip = guess

    sections = [(DEFAULT_PAIRS_MARBLE_BIOS, bios_zip), (DEFAULT_PAIRS_MARBLE_CART, args.rom_zip)]
    for pairs, src_zip in sections:
        for even, odd, offset in pairs:
            if src_zip is not None and src_zip.is_file():
                ev = extract_from_zip(src_zip, even)
                od = extract_from_zip(src_zip, odd)
            else:
                ev = read_rom(args.rom_dir / even)
                od = read_rom(args.rom_dir / odd)
            pair = RomPair(even=ev, odd=od)
            blob = pair.interleave()
            if offset + len(blob) > OUT_SIZE:
                print(
                    f"ERROR: {even}/{odd} @ {offset:#x} + {len(blob):#x} > out size {OUT_SIZE:#x}",
                    file=sys.stderr,
                )
                return 1
            out[offset : offset + len(blob)] = blob
            print(f"   {even} + {odd}  ->  {offset:#08x} ({len(blob)} bytes)")

    args.out.write_bytes(bytes(out))
    print(f"wrote {OUT_SIZE} bytes -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
