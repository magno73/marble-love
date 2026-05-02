#!/usr/bin/env python3
"""
rom_prep.py — preparazione ROM per import in Ghidra.

Atari System 1 / Marble Madness usa CPU 68010 con bus 16-bit. Le ROM di
programma sono dumpate in coppie even/odd (8-bit ciascuna). Per Ghidra (e per
qualunque static analysis) servono interleaved come unico blob big-endian.

Uso:
    python3 tools/rom_prep.py \\
        --rom-dir roms \\
        --out ghidra_project/marble_program.bin

Trova automaticamente i file della ROM standard di marble (vedi `mame -listxml marble`
per la lista esatta) e fonde le coppie even/odd in un unico blob.

PHASE 2: questo script è il primo input di Ghidra. Va fatto girare prima di
aprire il progetto Ghidra.

Riferimenti:
    - mame/src/mame/atari/atarisy1.cpp — ROM_START(marble) macro
    - https://wiki.mamedev.org/index.php/ROM_loading_techniques
"""

from __future__ import annotations

import argparse
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path


# Coppie (even, odd) → output offset/length, presi da ROM_START(marble) di
# atarisys1.cpp. PHASE 1: verificare e completare leggendo il driver MAME
# corrente (potrebbero esserci varianti marble2, marble3, ecc.).
#
# NOTA: i nomi qui sotto sono PLACEHOLDER. Vanno corretti dopo la lettura del
# driver MAME e l'estrazione di marble.zip. Lasciati come scaffold.
DEFAULT_PAIRS: list[tuple[str, str]] = [
    # (even_byte_rom, odd_byte_rom)
    # ("136033.623", "136033.624"),
    # ("136033.625", "136033.626"),
]


@dataclass
class RomPair:
    even: bytes
    odd: bytes

    def interleave(self) -> bytes:
        """Restituisce i byte interleaved big-endian (even=hi, odd=lo)."""
        if len(self.even) != len(self.odd):
            raise ValueError(
                f"size mismatch: even={len(self.even)} odd={len(self.odd)}"
            )
        out = bytearray(len(self.even) * 2)
        out[0::2] = self.even
        out[1::2] = self.odd
        return bytes(out)


def read_rom(path: Path) -> bytes:
    """Legge un file ROM. Supporta:
    - file plain (.bin, no extension)
    - .zip (estrae il primo file con nome che combacia)
    """
    if path.is_file() and path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path, "r") as z:
            # Restituisce un blob virtuale: chiamante deve estrarre membri
            raise NotImplementedError(
                "Per ZIP usa --rom-zip e specifica i membri esatti"
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
                    help="Directory con i file ROM separati o lo zip MAME")
    ap.add_argument("--rom-zip", type=Path, default=None,
                    help="Path a marble.zip (alternativa a --rom-dir)")
    ap.add_argument("--out", type=Path, required=True,
                    help="Output binario interleaved per Ghidra")
    ap.add_argument("--list", action="store_true",
                    help="Solo elenca i file della ROM zip e esci")
    args = ap.parse_args()

    if args.list:
        if not args.rom_zip:
            print("--list richiede --rom-zip", file=sys.stderr)
            return 2
        for name in list_zip(args.rom_zip):
            print(name)
        return 0

    if not DEFAULT_PAIRS:
        print(
            "❌ DEFAULT_PAIRS è vuoto.\n"
            "   Fase 1 deliverable: riempi DEFAULT_PAIRS leggendo\n"
            "   mame/src/mame/atari/atarisy1.cpp ROM_START(marble).\n"
            "   Per ispezionare la zip: python3 tools/rom_prep.py --list --rom-zip roms/marble.zip",
            file=sys.stderr,
        )
        return 1

    args.out.parent.mkdir(parents=True, exist_ok=True)
    full = bytearray()
    for even, odd in DEFAULT_PAIRS:
        if args.rom_zip:
            ev = extract_from_zip(args.rom_zip, even)
            od = extract_from_zip(args.rom_zip, odd)
        else:
            ev = read_rom(args.rom_dir / even)
            od = read_rom(args.rom_dir / odd)
        pair = RomPair(even=ev, odd=od)
        full.extend(pair.interleave())

    args.out.write_bytes(bytes(full))
    print(f"✅ wrote {len(full)} bytes → {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
