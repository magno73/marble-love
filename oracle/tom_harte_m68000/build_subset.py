#!/usr/bin/env python3
"""
Build deterministic subset of Tom Harte SingleStepTests for stack-ABI
M68000 instructions.

Input:  /tmp/tom_harte_m68000_full/v1/*.json  (decoded with decode.py)
Output: oracle/tom_harte_m68000/*.json        (filtered subsets)

Reproducibility:
- python3 build_subset.py
- Requires the decoded JSON files at SRC_DIR.

License of upstream data: MIT (see UPSTREAM_LICENSE).
Upstream repo: https://github.com/SingleStepTests/m68000
Upstream commit: 64b253116a3de04aaac4346c43680960dc9b67e5
"""

import json
import os
import random
import sys

SRC_DIR = '/tmp/tom_harte_m68000_full/v1'
DST_DIR = os.path.dirname(os.path.abspath(__file__))

# Cap per output file. Source files have 2500 tests each. We keep all relevant
# tests when the count is <=CAP, otherwise sample deterministically.
CAP = 1000
SEED = 0xCAFEBABE


def load(name):
    path = os.path.join(SRC_DIR, name)
    if not os.path.isfile(path):
        sys.exit(f'missing input: {path}. Run decode.py first.')
    with open(path) as f:
        return json.load(f)


def opcode_of(t):
    return t['initial']['prefetch'][0]


def cap_sort(tests, label):
    """Deterministic sort + cap.

    Sort key: (opcode, name) so output is fully deterministic regardless of
    input order. If size exceeds CAP, sample CAP entries using a seeded RNG.
    """
    tests = sorted(tests, key=lambda t: (opcode_of(t), t['name']))
    if len(tests) > CAP:
        rng = random.Random(SEED)
        idxs = sorted(rng.sample(range(len(tests)), CAP))
        sampled = [tests[i] for i in idxs]
        print(f'  {label}: sampled {CAP}/{len(tests)}')
        return sampled
    print(f'  {label}: kept all {len(tests)}')
    return tests


def dump(name, tests):
    path = os.path.join(DST_DIR, name)
    with open(path, 'w') as f:
        json.dump(tests, f, indent=2)
    size = os.path.getsize(path)
    print(f'  wrote {name} ({len(tests)} tests, {size/1024:.1f} KB)')


def main():
    print('Building Tom Harte stack-ABI subset...')

    # 1. LINK An,#-N  (0x4E50..0x4E57)
    print('LINK:')
    src = load('LINK.json')
    link = [t for t in src if 0x4E50 <= opcode_of(t) <= 0x4E57]
    dump('LINK.json', cap_sort(link, 'LINK'))

    # 2. UNLK An  (0x4E58..0x4E5F)  — upstream filename is UNLINK.json.bin
    print('UNLK:')
    src = load('UNLINK.json')
    unlk = [t for t in src if 0x4E58 <= opcode_of(t) <= 0x4E5F]
    dump('UNLK.json', cap_sort(unlk, 'UNLK'))

    # 3. MOVEM.L register-to-mem predecrement  (0x48E0..0x48E7)
    print('MOVEM.L predecrement (reg->mem):')
    src = load('MOVEM.l.json')
    movem_pd = [t for t in src if (opcode_of(t) & 0xFFF8) == 0x48E0]
    dump('MOVEM_L_PD.json', cap_sort(movem_pd, 'MOVEM_L_PD'))

    # 4. MOVEM.L mem-to-register postincrement  (0x4CD8..0x4CDF)
    print('MOVEM.L postincrement (mem->reg):')
    movem_poi = [t for t in src if (opcode_of(t) & 0xFFF8) == 0x4CD8]
    dump('MOVEM_L_POI.json', cap_sort(movem_poi, 'MOVEM_L_POI'))

    # 5. MOVE.L with (d16,An) on either side
    # MOVE.l: 00 10 DDD MMM mmm rrr  (top 2 bits = 00 10)
    # dst mode at bits 8..6, src mode at bits 5..3. Mode 5 = (d16,An).
    print('MOVE.L (d16,An):')
    src = load('MOVE.l.json')

    def has_d16an(t):
        op = opcode_of(t)
        src_mode = (op >> 3) & 7
        dst_mode = (op >> 6) & 7
        return src_mode == 5 or dst_mode == 5

    move_l = [t for t in src if has_d16an(t)]
    dump('MOVE_L_DISP.json', cap_sort(move_l, 'MOVE_L_DISP'))

    # 6. MOVE.W with (d16,An) on either side
    print('MOVE.W (d16,An):')
    src = load('MOVE.w.json')
    move_w = [t for t in src if has_d16an(t)]
    dump('MOVE_W_DISP.json', cap_sort(move_w, 'MOVE_W_DISP'))

    # 7. JSR  (0x4E80..0x4EBF)  — full subset (relevant for PC push)
    print('JSR:')
    src = load('JSR.json')
    jsr = [t for t in src if (opcode_of(t) & 0xFFC0) == 0x4E80]
    dump('JSR_PC.json', cap_sort(jsr, 'JSR_PC'))

    # 8. RTS  (0x4E75)
    print('RTS:')
    src = load('RTS.json')
    rts = [t for t in src if opcode_of(t) == 0x4E75]
    dump('RTS.json', cap_sort(rts, 'RTS'))

    # 9. ADDQ.L #n,SP  — opcode 0101 nnn0 10 001 111 = 0x5x8F (n=0..7 → 0x508F,0x518F,...,0x5E8F)
    # mask 0xF1FF == 0x508F. ADDQ tests live in ADD.l.json.
    print('ADDQ.L #n,SP:')
    src = load('ADD.l.json')
    addq_sp = [t for t in src if (opcode_of(t) & 0xF1FF) == 0x508F]
    dump('ADDQ_L_SP.json', cap_sort(addq_sp, 'ADDQ_L_SP'))

    print('Done.')


if __name__ == '__main__':
    main()
