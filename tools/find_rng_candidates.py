#!/usr/bin/env python3
"""
find_rng_candidates.py — analizza il dump Work RAM multi-snapshot per trovare
candidate RNG state cells.

Heuristica:
  - Per ogni cella della Work RAM, calcola:
    * cambio_count: quanti snapshot consecutivi differiscono
    * unique_values: quanti valori distinti la cella assume
    * runs: lunghezza media delle "stesso valore" run (più corte = più caotiche)
    * delta_bits_set: average # di bit che cambiano tra snapshot consecutivi
  - Filtra: cambio_count >= 50% degli snap pairs, unique_values >= 5
  - Ordina per (unique_values descending, runs ascending)
  - Top candidate = RNG state probabilmente

Le posizioni di oggetti game state (marble.x/y, score, timer) sono FILTRATE
fuori dal candidate set perché:
  - score: monotono, troppo poco unique
  - timer: monotono
  - marble pos: cambia in modo CONTIGUO (cluster di celle adiacenti — è
    un Vec3) — il filtro "cella isolata" lo esclude

Uso:
    python3 tools/find_rng_candidates.py /tmp/ram_dump.bin
"""

import struct
import sys
from collections import Counter
from pathlib import Path

SNAPSHOT_SIZE = 0x2000  # 8 KB
HEADER_SIZE = 2          # 2 byte frame counter (BE u16)


def parse_dump(path: Path):
    data = path.read_bytes()
    snap_total = HEADER_SIZE + SNAPSHOT_SIZE
    n = len(data) // snap_total
    snaps = []
    for i in range(n):
        base = i * snap_total
        frame = struct.unpack(">H", data[base : base + 2])[0]
        ram = data[base + HEADER_SIZE : base + snap_total]
        snaps.append((frame, ram))
    return snaps


def analyze(snaps):
    n = len(snaps)
    if n < 3:
        print("not enough snapshots")
        return

    print(f"# {n} snapshots, frames {snaps[0][0]}..{snaps[-1][0]}")
    print(f"# RAM range: 0x400000-0x401FFF (8 KB)")
    print()

    n_pairs = n - 1
    rng_candidates = []

    for offset in range(SNAPSHOT_SIZE):
        values = [snap[1][offset] for snap in snaps]
        unique = len(set(values))
        if unique < 3:
            continue  # static or near-static

        # count distinct consecutive changes
        changes = sum(1 for i in range(n_pairs) if values[i] != values[i + 1])
        change_ratio = changes / n_pairs

        # run-length analysis
        runs = []
        cur_len = 1
        for i in range(1, n):
            if values[i] == values[i - 1]:
                cur_len += 1
            else:
                runs.append(cur_len)
                cur_len = 1
        runs.append(cur_len)
        avg_run = sum(runs) / len(runs)

        # delta-bits-set: for each pair, count bits in xor
        delta_bits = 0
        for i in range(n_pairs):
            delta_bits += bin(values[i] ^ values[i + 1]).count("1")
        avg_delta_bits = delta_bits / n_pairs

        # Heuristic: RNG state has high unique, high change_ratio, low avg_run,
        # and middle delta_bits (typical LFSR has ~4 bits change per step).
        if change_ratio >= 0.5 and unique >= 5:
            rng_candidates.append({
                "addr": 0x400000 + offset,
                "unique": unique,
                "change_ratio": change_ratio,
                "avg_run": avg_run,
                "avg_delta_bits": avg_delta_bits,
                "values_first6": values[:6],
                "values_last6": values[-6:],
            })

    # Sort by chaos: high unique, low avg_run, mid delta_bits (closer to 4)
    def chaos_score(c):
        # Distance from "ideal LFSR" delta = 4
        delta_ok = -abs(c["avg_delta_bits"] - 4)
        return (c["unique"], -c["avg_run"], delta_ok)

    rng_candidates.sort(key=chaos_score, reverse=True)

    print(f"# {len(rng_candidates)} candidate RNG cells (filtered)")
    print(f"# columns: addr  unique  change%  avg_run  avg_dbits  first6 → last6")
    print()
    for c in rng_candidates[:60]:
        first = " ".join(f"{v:02X}" for v in c["values_first6"])
        last = " ".join(f"{v:02X}" for v in c["values_last6"])
        print(f"0x{c['addr']:06X}  u={c['unique']:3d}  c={c['change_ratio']:.0%}  "
              f"r={c['avg_run']:.1f}  db={c['avg_delta_bits']:.1f}  "
              f"[{first}] → [{last}]")

    # Cluster detection: cells that change together (= part of same struct,
    # NOT independent RNG state).
    print("\n# Adjacency clusters (3+ consecutive cells with same change_ratio):")
    candidate_addrs = sorted({c["addr"] for c in rng_candidates})
    cur_cluster = []
    for addr in candidate_addrs:
        if cur_cluster and addr == cur_cluster[-1] + 1:
            cur_cluster.append(addr)
        else:
            if len(cur_cluster) >= 3:
                print(f"  0x{cur_cluster[0]:06X}..0x{cur_cluster[-1]:06X} "
                      f"({len(cur_cluster)} cells)")
            cur_cluster = [addr]
    if len(cur_cluster) >= 3:
        print(f"  0x{cur_cluster[0]:06X}..0x{cur_cluster[-1]:06X} "
              f"({len(cur_cluster)} cells)")


def main():
    if len(sys.argv) != 2:
        print("usage: find_rng_candidates.py /tmp/ram_dump.bin", file=sys.stderr)
        return 2
    snaps = parse_dump(Path(sys.argv[1]))
    analyze(snaps)


if __name__ == "__main__":
    sys.exit(main())
