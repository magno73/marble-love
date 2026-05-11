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


# Coppie (even, odd) per ROM_START(marble), in ordine di offset crescente.
# Riferimento: mame/src/mame/atari/atarisy1.cpp:1003-1046
#
# NOTA: include solo le ROM cartridge `136033.*`, NON la motherboard BIOS
# `136032.*` (i 16 KB iniziali della program region). Per Ghidra il blob
# completo deve includere ENTRAMBE; questa lista è pensata per produrre il
# segmento cartridge a partire da 0x10000. La BIOS va prependa separatamente
# se serve (di solito la cartridge basta perché i jump al BIOS passano dal
# vector table a 0x000000 — ed è codice common a tutti i giochi System 1).
DEFAULT_PAIRS_MARBLE_BIOS: list[tuple[str, str, int]] = [
    # (even, odd, offset_in_blob) — Motherboard TTL Rev 2 BIOS
    ("136032.205.l13", "136032.206.l12", 0x00000),
]

DEFAULT_PAIRS_MARBLE_CART: list[tuple[str, str, int]] = [
    # (even, odd, offset_in_blob) — Marble cartridge program ROMs
    ("136033.623", "136033.624", 0x10000),
    ("136033.625", "136033.626", 0x18000),
    ("136033.627", "136033.628", 0x20000),
    ("136033.229", "136033.630", 0x28000),
    # Slapstic-protected (decoded come banco unico a 0x80000)
    ("136033.107", "136033.108", 0x80000),
]

# Compat con la versione precedente.
DEFAULT_PAIRS: list[tuple[str, str]] = [
    (e, o) for (e, o, _off) in (DEFAULT_PAIRS_MARBLE_BIOS + DEFAULT_PAIRS_MARBLE_CART)
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
    ap.add_argument("--bios-zip", type=Path, default=None,
                    help="Path a atarisy1.zip (BIOS motherboard 136032.*). "
                         "Se non specificato, si assume nella stessa dir di --rom-zip.")
    ap.add_argument("--out", type=Path, default=None,
                    help="Output binario interleaved per Ghidra (richiesto se non --list)")
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

    if args.out is None:
        ap.error("--out è richiesto (oppure usa --list)")

    args.out.parent.mkdir(parents=True, exist_ok=True)

    # Output: blob piatto, dimensione 0x88000 (= 0x80000 program + 0x8000 slapstic).
    # Le ROM sono piazzate al loro offset esatto da ROM_START(marble),
    # interleaved big-endian.
    OUT_SIZE = 0x88000
    # MAME default ROM_REGION flag = ROMREGION_ERASE00 (zero-fill) — verifica
    # atarisy1.cpp:976 `ROM_REGION( 0x88000, "maincpu", 0 )` (terzo arg = 0).
    # Le zone non popolate da ROM_LOAD (es. 0x30000..0x7FFFF) restano a 0x00.
    # Bus M68K legge bit-perfect da quella region. decodeBitstream1A668
    # consuma `ctrlStream=0x7F0FB` durante body f12002: TS pre-fillato a
    # 0xFF leggeva 0xFFFFFFFF → token 0x3FFF → Path A → output uniforme
    # 0x0FFF (= 74B drift cluster 0x0700). Allineato a 0x00 → token 0x0000
    # → Path B → output bit-perfect MAME.
    out = bytearray(b"\x00" * OUT_SIZE)

    # BIOS sta in atarisy1.zip (parent set MAME); cartridge in marble.zip.
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
                    f"❌ {even}/{odd} @ {offset:#x} + {len(blob):#x} > out size {OUT_SIZE:#x}",
                    file=sys.stderr,
                )
                return 1
            out[offset : offset + len(blob)] = blob
            print(f"   {even} + {odd}  →  {offset:#08x} ({len(blob)} byte)")

    args.out.write_bytes(bytes(out))
    print(f"✅ wrote {OUT_SIZE} bytes → {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
