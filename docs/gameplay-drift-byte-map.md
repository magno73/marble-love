# Gameplay drift byte map @ f+99

Totale: **263 byte gameplay** (di cui 172B stack residue esclusi da invariante).

Generato da `packages/cli/src/probe-gameplay-byte-map.ts`.

## Top-10 bottleneck "early diverge"

I byte che divergono prima sono i candidati root cascade. Una volta fixati questi, molti downstream collassano.

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0003 | E4 | EE | f+1 | `g_timer_b3` | unknown |
| 0x0014 | 00 | 01 | f+1 | `unknown_+0x14` | unknown |
| 0x01df | BE | BA | f+1 | `obj2.z_long_b1` | helper121B8 or sub-fa0-marble-emit |
| 0x01e1 | 21 | FE | f+1 | `obj2.z_long_b3` | helper121B8 or sub-fa0-marble-emit |
| 0x01e5 | C4 | C0 | f+1 | `obj2.substate_byte` | helper121B8 or sub-fa0-marble-emit |
| 0x01e7 | 27 | 04 | f+1 | `obj2.flags_b1` | helper121B8 or sub-fa0-marble-emit |
| 0x01f1 | 98 | 89 | f+1 | `obj2.field_+0x27` | helper121B8 or sub-fa0-marble-emit |
| 0x01f7 | 9E | 8F | f+1 | `obj2.savedZ_b3` | helper121B8 or sub-fa0-marble-emit |
| 0x039a | 00 | 01 | f+1 | `g_av_latch` | AV-control latch / refresh-frame |
| 0x03a6 | 4A | E9 | f+1 | `g_av_r3a6` | AV-control latch / refresh-frame |

## Cluster ranking (by byte count)

| rank | cluster | bytes | cum | %tot | earliest diverge | dominant writer |
|---|---|---:|---:|---:|---|---|
| #1 | `0x0700..0x073f` | 58 | 58 | 22.1% | f+2 | decodeBitstream1A668 (via refreshHelper13EE6) |
| #2 | `0x1c00..0x1c3f` | 24 | 82 | 31.2% | f+2 | helper-1cd00 STRUCT 0x1C28 (16 word) |
| #3 | `0x0680..0x06bf` | 19 | 101 | 38.4% | f+4 | stateDispatch160F6 (cascade da P2 slot drift) |
| #4 | `0x0a00..0x0a3f` | 19 | 120 | 45.6% | f+2 | objectUpdatePair158CC + fun158F6(P2) |
| #5 | `0x0740..0x077f` | 16 | 136 | 51.7% | f+1 | decodeBitstream1A668 (via refreshHelper13EE6) |
| #6 | `0x0640..0x067f` | 12 | 148 | 56.3% | f+6 | stateDispatch160F6 (cascade da P2 slot drift) |
| #7 | `0x0a40..0x0a7f` | 12 | 160 | 60.8% | f+2 | objectUpdatePair158CC + fun158F6(P2) |
| #8 | `0x01c0..0x01ff` | 11 | 171 | 65.0% | f+1 | helper121B8 or sub-fa0-marble-emit |
| #9 | `0x13c0..0x13ff` | 11 | 182 | 69.2% | f+1 | helper12896 / slotArrayTick (4-slot script) |
| #10 | `0x0200..0x023f` | 10 | 192 | 73.0% | f+3 | helper121B8 or sub-fa0-marble-emit |
| #11 | `0x1c40..0x1c7f` | 8 | 200 | 76.0% | f+2 | helper-1cd00 STRUCT 0x1C28 (16 word) |
| #12 | `0x0000..0x003f` | 6 | 206 | 78.3% | f+1 | unknown |
| #13 | `0x00c0..0x00ff` | 6 | 212 | 80.6% | f+2 | helper121B8(obj0 chain) |
| #14 | `0x03c0..0x03ff` | 6 | 218 | 82.9% | f+1 | AV-control latch / refresh-frame |
| #15 | `0x0400..0x043f` | 6 | 224 | 85.2% | f+1 | stateSub* family |
| #16 | `0x0440..0x047f` | 5 | 229 | 87.1% | f+57 | stateSub* family |
| #17 | `0x1340..0x137f` | 5 | 234 | 89.0% | f+18 | helper12896 / slotArrayTick (4-slot script) |
| #18 | `0x1380..0x13bf` | 5 | 239 | 90.9% | f+2 | helper12896 / slotArrayTick (4-slot script) |
| #19 | `0x1400..0x143f` | 5 | 244 | 92.8% | f+3 | helper12896 / slotArrayTick (4-slot script) |
| #20 | `0x0380..0x03bf` | 4 | 248 | 94.3% | f+1 | AV-control latch / refresh-frame |
| #21 | `0x1440..0x147f` | 4 | 252 | 95.8% | f+1 | unknown |
| #22 | `0x0a80..0x0abf` | 3 | 255 | 97.0% | f+57 | objectUpdatePair158CC + fun158F6(P2) |
| #23 | `0x0040..0x007f` | 2 | 257 | 97.7% | f+4 | helper121B8(obj0 chain) |
| #24 | `0x1f40..0x1f7f` | 2 | 259 | 98.5% | f+11 | unknown |
| #25 | `0x06c0..0x06ff` | 1 | 260 | 98.9% | f+60 | unknown |
| #26 | `0x0940..0x097f` | 1 | 261 | 99.2% | f+56 | refreshHelper13EE6 (srtgt scroll) |
| #27 | `0x0980..0x09bf` | 1 | 262 | 99.6% | f+1 | unknown |
| #28 | `0x0ac0..0x0aff` | 1 | 263 | 100.0% | f+59 | claimScriptSlot / scriptSlotStep13068 |

## Per-cluster detail

### Priority 1: cluster `0x0700..0x073f` — 58 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0706 | 00 | 31 | f+26 | `decodeBuf.w3_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0707 | 01 | C4 | f+2 | `decodeBuf.w3_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0708 | 00 | 31 | f+26 | `decodeBuf.w4_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0709 | 02 | C5 | f+2 | `decodeBuf.w4_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x070a | 00 | 31 | f+18 | `decodeBuf.w5_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x070b | 03 | 73 | f+2 | `decodeBuf.w5_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x070c | 00 | 32 | f+18 | `decodeBuf.w6_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x070d | 04 | 45 | f+2 | `decodeBuf.w6_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x070e | 00 | 30 | f+2 | `decodeBuf.w7_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x070f | 05 | 8A | f+2 | `decodeBuf.w7_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0710 | 00 | 30 | f+2 | `decodeBuf.w8_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0711 | 06 | 8A | f+2 | `decodeBuf.w8_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0712 | 00 | 31 | f+2 | `decodeBuf.w9_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0713 | 07 | C7 | f+2 | `decodeBuf.w9_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0714 | 00 | 34 | f+2 | `decodeBuf.w10_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0715 | 08 | AF | f+2 | `decodeBuf.w10_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0716 | 00 | 30 | f+10 | `decodeBuf.w11_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0717 | 09 | 4D | f+2 | `decodeBuf.w11_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0718 | 00 | 30 | f+10 | `decodeBuf.w12_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0719 | 0A | 4E | f+2 | `decodeBuf.w12_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x071a | 00 | 30 | f+10 | `decodeBuf.w13_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x071b | 0B | 4D | f+2 | `decodeBuf.w13_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x071c | 00 | 30 | f+10 | `decodeBuf.w14_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x071d | 0C | 4E | f+2 | `decodeBuf.w14_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x071e | 00 | 30 | f+10 | `decodeBuf.w15_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x071f | 0D | 4D | f+2 | `decodeBuf.w15_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0720 | 00 | 30 | f+2 | `decodeBuf.w16_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0721 | 0E | 4E | f+2 | `decodeBuf.w16_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0722 | 00 | 30 | f+2 | `decodeBuf.w17_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0723 | 0F | 4D | f+2 | `decodeBuf.w17_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0724 | 00 | 30 | f+2 | `decodeBuf.w18_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0725 | 10 | 4E | f+2 | `decodeBuf.w18_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0726 | 00 | 30 | f+2 | `decodeBuf.w19_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0727 | 11 | 4D | f+2 | `decodeBuf.w19_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0728 | 00 | 30 | f+2 | `decodeBuf.w20_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0729 | 12 | 4E | f+2 | `decodeBuf.w20_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x072a | 00 | 11 | f+2 | `decodeBuf.w21_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x072b | 13 | 71 | f+2 | `decodeBuf.w21_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x072c | 00 | 11 | f+2 | `decodeBuf.w22_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x072d | 14 | 72 | f+2 | `decodeBuf.w22_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x072e | 00 | 10 | f+2 | `decodeBuf.w23_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x072f | 15 | 8A | f+2 | `decodeBuf.w23_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0730 | 00 | 12 | f+2 | `decodeBuf.w24_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0731 | 16 | B5 | f+2 | `decodeBuf.w24_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0732 | 00 | 14 | f+2 | `decodeBuf.w25_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0733 | 17 | 23 | f+2 | `decodeBuf.w25_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0734 | 00 | 11 | f+2 | `decodeBuf.w26_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0735 | 18 | C5 | f+2 | `decodeBuf.w26_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0736 | 00 | 10 | f+2 | `decodeBuf.w27_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0737 | 19 | 8A | f+2 | `decodeBuf.w27_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0738 | 00 | 11 | f+18 | `decodeBuf.w28_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0739 | 1A | 73 | f+2 | `decodeBuf.w28_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x073a | 00 | 11 | f+2 | `decodeBuf.w29_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x073b | 1B | 5F | f+2 | `decodeBuf.w29_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x073c | 00 | 11 | f+2 | `decodeBuf.w30_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x073d | 1C | 72 | f+2 | `decodeBuf.w30_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x073e | 00 | 10 | f+2 | `decodeBuf.w31_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x073f | 1D | 8A | f+2 | `decodeBuf.w31_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |

### Priority 2: cluster `0x1c00..0x1c3f` — 24 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x1c28 | 00 | 3F | f+2 | `struct1C28.w0_hi` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c29 | 00 | DC | f+2 | `struct1C28.w0_lo` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c2a | 00 | 3F | f+2 | `struct1C28.w1_hi` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c2b | 00 | DC | f+2 | `struct1C28.w1_lo` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c2c | 00 | 3F | f+2 | `struct1C28.w2_hi` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c2d | 00 | DC | f+2 | `struct1C28.w2_lo` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c2e | 00 | 3F | f+2 | `struct1C28.w3_hi` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c2f | 00 | DC | f+2 | `struct1C28.w3_lo` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c30 | 00 | 3F | f+2 | `struct1C28.w4_hi` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c31 | 00 | DC | f+2 | `struct1C28.w4_lo` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c32 | 00 | 3F | f+2 | `struct1C28.w5_hi` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c33 | 00 | DC | f+2 | `struct1C28.w5_lo` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c34 | 00 | 3F | f+2 | `struct1C28.w6_hi` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c35 | 00 | DC | f+2 | `struct1C28.w6_lo` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c36 | 00 | 3F | f+2 | `struct1C28.w7_hi` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c37 | 00 | DC | f+2 | `struct1C28.w7_lo` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c38 | 00 | 3F | f+2 | `struct1C28.w8_hi` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c39 | 00 | DC | f+2 | `struct1C28.w8_lo` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c3a | 00 | 3F | f+2 | `struct1C28.w9_hi` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c3b | 00 | DC | f+2 | `struct1C28.w9_lo` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c3c | 00 | 3F | f+2 | `struct1C28.w10_hi` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c3d | 00 | DC | f+2 | `struct1C28.w10_lo` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c3e | 00 | 3F | f+2 | `struct1C28.w11_hi` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c3f | 00 | DC | f+2 | `struct1C28.w11_lo` | helper-1cd00 STRUCT 0x1C28 (16 word) |

### Priority 3: cluster `0x0680..0x06bf` — 19 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0680 | E8 | A6 | f+26 | `g_velSE_hi` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0681 | CA | C0 | f+6 | `g_velSE_lo` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0682 | E8 | A6 | f+26 | `g_velSW_hi` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0683 | CA | C0 | f+6 | `g_velSW_lo` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0684 | 01 | 00 | f+66 | `g_savedX_b0` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0685 | 7E | BC | f+10 | `g_savedX_b1` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0686 | 0C | 2C | f+6 | `g_savedX_b2` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0687 | 76 | FC | f+6 | `g_savedX_b3` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0689 | 51 | 02 | f+10 | `g_savedY_b1` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x068a | 17 | 37 | f+6 | `g_savedY_b2` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x068b | A2 | AC | f+6 | `g_savedY_b3` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x068d | 97 | DC | f+6 | `g_savedZ_b1` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0695 | 97 | DC | f+4 | `unknown_+0x695` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0697 | 2F | 17 | f+18 | `g_tileX_lo` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0699 | 2A | 20 | f+20 | `g_tileY_lo` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x069b | 2F | 17 | f+20 | `g_trackX_lo` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x069d | 2A | 20 | f+22 | `g_trackY_lo` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x069f | 06 | 05 | f+8 | `unknown_+0x69f` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x06a1 | 02 | 01 | f+8 | `unknown_+0x6a1` | stateDispatch160F6 (cascade da P2 slot drift) |

### Priority 4: cluster `0x0a00..0x0a3f` — 19 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0a22 | 3C | 9B | f+2 | `slotP2.vx_b2` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a23 | 74 | 9A | f+2 | `slotP2.vx_b3` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a24 | 00 | FF | f+20 | `slotP2.vy_b0` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a25 | 00 | FF | f+20 | `slotP2.vy_b1` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a26 | E3 | 9F | f+2 | `slotP2.vy_b2` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a27 | E0 | E4 | f+2 | `slotP2.vy_b3` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a28 | FF | 00 | f+2 | `slotP2.vz_b0` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a29 | FB | 00 | f+2 | `slotP2.vz_b1` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a2d | C1 | BD | f+8 | `slotP2.x_b1` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a2e | 73 | D5 | f+4 | `slotP2.x_b2` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a2f | 52 | A5 | f+4 | `slotP2.x_b3` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a31 | 24 | 01 | f+8 | `slotP2.y_b1` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a32 | 5D | D5 | f+4 | `slotP2.y_b2` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a33 | 7A | 54 | f+4 | `slotP2.y_b3` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a35 | 5B | DC | f+4 | `slotP2.z_b1` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a36 | 40 | 00 | f+4 | `slotP2.z_b2` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a38 | 00 | 01 | f+64 | `slotP2.state` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a3c | 01 | 00 | f+46 | `slotP2.+0x1c` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a3f | EB | CC | f+8 | `slotP2.+0x1f` | objectUpdatePair158CC + fun158F6(P2) |

### Priority 5: cluster `0x0740..0x077f` — 16 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0740 | 00 | 12 | f+2 | `decodeBuf.w32_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0741 | 1E | D7 | f+2 | `decodeBuf.w32_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0742 | 00 | 14 | f+10 | `decodeBuf.w33_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0743 | 1F | B0 | f+2 | `decodeBuf.w33_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0744 | 00 | 14 | f+10 | `decodeBuf.w34_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0745 | 20 | B1 | f+2 | `decodeBuf.w34_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0746 | 00 | 10 | f+10 | `decodeBuf.w35_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0747 | 21 | 4D | f+2 | `decodeBuf.w35_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0748 | 00 | 10 | f+10 | `decodeBuf.w36_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0749 | 22 | 4E | f+2 | `decodeBuf.w36_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x074a | 00 | 10 | f+10 | `decodeBuf.w37_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x074b | 23 | 4D | f+2 | `decodeBuf.w37_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x074c | 00 | 10 | f+10 | `decodeBuf.w38_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x074d | 24 | 4E | f+2 | `decodeBuf.w38_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0750 | 13 | 14 | f+1 | `decodeBuf.w40_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0751 | EE | 4E | f+1 | `decodeBuf.w40_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |

### Priority 6: cluster `0x0640..0x067f` — 12 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0674 | CD | 8B | f+16 | `g_velLeft_hi` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0675 | EB | E1 | f+6 | `g_velLeft_lo` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0676 | 34 | F2 | f+24 | `g_velDown_hi` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0677 | 93 | 89 | f+6 | `g_velDown_lo` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0678 | 4B | 09 | f+20 | `g_velRight_hi` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0679 | B1 | A7 | f+6 | `g_velRight_lo` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x067a | E8 | A6 | f+20 | `g_velUp_hi` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x067b | B5 | AB | f+6 | `g_velUp_lo` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x067c | E8 | A6 | f+26 | `g_velNE_hi` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x067d | CA | C0 | f+6 | `g_velNE_lo` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x067e | D3 | 91 | f+22 | `g_velNW_hi` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x067f | 25 | 1B | f+6 | `g_velNW_lo` | stateDispatch160F6 (cascade da P2 slot drift) |

### Priority 7: cluster `0x0a40..0x0a7f` — 12 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0a40 | 00 | 01 | f+46 | `slotP2.+0x20` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a41 | 7D | 28 | f+4 | `slotP2.+0x21` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a43 | EC | CE | f+4 | `slotP2.+0x23` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a44 | 00 | 01 | f+48 | `slotP2.+0x24` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a45 | 82 | 27 | f+4 | `slotP2.+0x25` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a47 | EC | D0 | f+6 | `slotP2.+0x27` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a48 | 00 | 01 | f+50 | `slotP2.+0x28` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a49 | 87 | 27 | f+4 | `slotP2.+0x29` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a4f | 13 | 00 | f+2 | `slotP2.+0x2f` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a51 | 21 | 00 | f+2 | `slotP2.+0x31` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a53 | 13 | 17 | f+12 | `slotP2.+0x33` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a56 | 02 | 00 | f+2 | `slotP2.+0x36` | objectUpdatePair158CC + fun158F6(P2) |

### Priority 8: cluster `0x01c0..0x01ff` — 11 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x01df | BE | BA | f+1 | `obj2.z_long_b1` | helper121B8 or sub-fa0-marble-emit |
| 0x01e0 | 01 | 00 | f+43 | `obj2.z_long_b2` | helper121B8 or sub-fa0-marble-emit |
| 0x01e1 | 21 | FE | f+1 | `obj2.z_long_b3` | helper121B8 or sub-fa0-marble-emit |
| 0x01e3 | 5C | DD | f+4 | `obj2.type_byte` | helper121B8 or sub-fa0-marble-emit |
| 0x01e5 | C4 | C0 | f+1 | `obj2.substate_byte` | helper121B8 or sub-fa0-marble-emit |
| 0x01e7 | 27 | 04 | f+1 | `obj2.flags_b1` | helper121B8 or sub-fa0-marble-emit |
| 0x01e9 | 62 | E3 | f+4 | `obj2.field_+0x1f` | helper121B8 or sub-fa0-marble-emit |
| 0x01f1 | 98 | 89 | f+1 | `obj2.field_+0x27` | helper121B8 or sub-fa0-marble-emit |
| 0x01f7 | 9E | 8F | f+1 | `obj2.savedZ_b3` | helper121B8 or sub-fa0-marble-emit |
| 0x01fb | 90 | 88 | f+39 | `obj2.tileY_word_lo` | helper121B8 or sub-fa0-marble-emit |
| 0x01fd | 68 | 58 | f+7 | `obj2.trackX_lo` | helper121B8 or sub-fa0-marble-emit |

### Priority 9: cluster `0x13c0..0x13ff` — 11 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x13c1 | B4 | 6C | f+18 | `slot4[1].+0x5f` | helper12896 / slotArrayTick (4-slot script) |
| 0x13c2 | FF | 00 | f+3 | `slot4[2].+0x0` | helper12896 / slotArrayTick (4-slot script) |
| 0x13c3 | F8 | 00 | f+3 | `slot4[2].+0x1` | helper12896 / slotArrayTick (4-slot script) |
| 0x13c6 | 00 | FF | f+3 | `slot4[2].+0x4` | helper12896 / slotArrayTick (4-slot script) |
| 0x13c7 | 00 | F8 | f+3 | `slot4[2].+0x5` | helper12896 / slotArrayTick (4-slot script) |
| 0x13cf | 6C | 5C | f+3 | `slot4[2].+0xd` | helper12896 / slotArrayTick (4-slot script) |
| 0x13d3 | 9C | 8C | f+35 | `slot4[2].+0x11` | helper12896 / slotArrayTick (4-slot script) |
| 0x13e6 | 32 | 00 | f+2 | `slot4[2].+0x24` | helper12896 / slotArrayTick (4-slot script) |
| 0x13ed | 24 | 3F | f+2 | `slot4[2].+0x2b` | helper12896 / slotArrayTick (4-slot script) |
| 0x13f2 | FF | 00 | f+85 | `slot4[2].+0x30` | helper12896 / slotArrayTick (4-slot script) |
| 0x13f3 | A6 | 02 | f+1 | `slot4[2].+0x31` | helper12896 / slotArrayTick (4-slot script) |

### Priority 10: cluster `0x0200..0x023f` — 10 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0201 | 99 | 90 | f+3 | `obj2.field_+0x37` | helper121B8 or sub-fa0-marble-emit |
| 0x0203 | 70 | 60 | f+23 | `obj2.field_+0x39` | helper121B8 or sub-fa0-marble-emit |
| 0x0209 | 60 | 58 | f+71 | `obj2.field_+0x3f` | helper121B8 or sub-fa0-marble-emit |
| 0x020b | 98 | 88 | f+7 | `obj2.field_+0x41` | helper121B8 or sub-fa0-marble-emit |
| 0x020f | 69 | 60 | f+3 | `obj2.field_+0x45` | helper121B8 or sub-fa0-marble-emit |
| 0x0211 | A0 | 90 | f+23 | `obj2.field_+0x47` | helper121B8 or sub-fa0-marble-emit |
| 0x0217 | E1 | D8 | f+3 | `obj2.field_+0x4d` | helper121B8 or sub-fa0-marble-emit |
| 0x0219 | 98 | A0 | f+39 | `obj2.field_+0x4f` | helper121B8 or sub-fa0-marble-emit |
| 0x021d | F0 | E0 | f+7 | `obj2.field_+0x53` | helper121B8 or sub-fa0-marble-emit |
| 0x021f | A0 | B0 | f+23 | `obj2.field_+0x55` | helper121B8 or sub-fa0-marble-emit |

### Priority 11: cluster `0x1c40..0x1c7f` — 8 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x1c40 | 00 | 3F | f+2 | `struct1C28.w12_hi` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c41 | 00 | DC | f+2 | `struct1C28.w12_lo` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c42 | 00 | 3F | f+2 | `struct1C28.w13_hi` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c43 | 00 | DC | f+2 | `struct1C28.w13_lo` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c44 | 00 | 3F | f+2 | `struct1C28.w14_hi` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c45 | 00 | DC | f+2 | `struct1C28.w14_lo` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c46 | 00 | 3F | f+2 | `struct1C28.w15_hi` | helper-1cd00 STRUCT 0x1C28 (16 word) |
| 0x1c47 | 00 | DC | f+2 | `struct1C28.w15_lo` | helper-1cd00 STRUCT 0x1C28 (16 word) |

### Priority 12: cluster `0x0000..0x003f` — 6 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0001 | E4 | EF | f+56 | `g_timer_b1` | unknown |
| 0x0003 | E4 | EE | f+1 | `g_timer_b3` | unknown |
| 0x0014 | 00 | 01 | f+1 | `unknown_+0x14` | unknown |
| 0x002d | 97 | 88 | f+2 | `obj0.z_long_b1` | helper121B8(obj0 chain) |
| 0x0039 | 4F | 4B | f+2 | `obj0.field_+0x21` | helper121B8(obj0 chain) |
| 0x003d | 4F | 4B | f+4 | `obj0.field_+0x25` | helper121B8(obj0 chain) |

### Priority 13: cluster `0x00c0..0x00ff` — 6 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x00c1 | 50 | 4C | f+2 | `obj0.field_+0xa9` | helper121B8(obj0 chain) |
| 0x00c7 | 50 | 4C | f+2 | `obj0.field_+0xaf` | helper121B8(obj0 chain) |
| 0x00cd | 50 | 4C | f+2 | `obj0.field_+0xb5` | helper121B8(obj0 chain) |
| 0x00d3 | 4F | 4B | f+2 | `obj0.field_+0xbb` | helper121B8(obj0 chain) |
| 0x00d7 | BE | DC | f+8 | `obj0.accum_b3` | helper121B8(obj0 chain) |
| 0x00dd | 74 | 3C | f+2 | `obj0.field_+0xc5` | helper121B8(obj0 chain) |

### Priority 14: cluster `0x03c0..0x03ff` — 6 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x03f0 | 26 | 8A | f+1 | `g_frame_counter` | AV-control latch / refresh-frame |
| 0x03f2 | 26 | 88 | f+2 | `g_frame_counter_b2` | AV-control latch / refresh-frame |
| 0x03f8 | 22 | 20 | f+1 | `avControl.+0x3f8` | AV-control latch / refresh-frame |
| 0x03f9 | 12 | 36 | f+2 | `avControl.+0x3f9` | AV-control latch / refresh-frame |
| 0x03fc | 22 | 20 | f+1 | `avControl.+0x3fc` | AV-control latch / refresh-frame |
| 0x03fd | 92 | B6 | f+2 | `avControl.+0x3fd` | AV-control latch / refresh-frame |

### Priority 15: cluster `0x0400..0x043f` — 6 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0400 | 23 | 21 | f+1 | `stateMachine.+0x400` | stateSub* family |
| 0x0401 | 12 | 36 | f+2 | `stateMachine.+0x401` | stateSub* family |
| 0x0404 | 23 | 21 | f+1 | `stateMachine.+0x404` | stateSub* family |
| 0x0405 | 90 | B4 | f+2 | `stateMachine.+0x405` | stateSub* family |
| 0x0407 | 09 | 1B | f+2 | `stateMachine.+0x407` | stateSub* family |
| 0x040b | 0C | 0D | f+59 | `stateMachine.+0x40b` | stateSub* family |

### Priority 16: cluster `0x0440..0x047f` — 5 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0451 | 76 | 7A | f+63 | `stateMachine.+0x451` | stateSub* family |
| 0x0455 | B2 | B6 | f+63 | `stateMachine.+0x455` | stateSub* family |
| 0x0456 | 0B | 0A | f+57 | `stateMachine.+0x456` | stateSub* family |
| 0x0458 | 01 | 03 | f+57 | `stateMachine.+0x458` | stateSub* family |
| 0x045a | 01 | 03 | f+57 | `stateMachine.+0x45a` | stateSub* family |

### Priority 17: cluster `0x1340..0x137f` — 5 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x1362 | FF | 00 | f+18 | `slot4[1].+0x0` | helper12896 / slotArrayTick (4-slot script) |
| 0x1363 | F8 | 00 | f+18 | `slot4[1].+0x1` | helper12896 / slotArrayTick (4-slot script) |
| 0x1367 | 00 | 08 | f+18 | `slot4[1].+0x5` | helper12896 / slotArrayTick (4-slot script) |
| 0x136f | EC | DC | f+18 | `slot4[1].+0xd` | helper12896 / slotArrayTick (4-slot script) |
| 0x1373 | 9C | A4 | f+50 | `slot4[1].+0x11` | helper12896 / slotArrayTick (4-slot script) |

### Priority 18: cluster `0x1380..0x13bf` — 5 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x1386 | 32 | 00 | f+2 | `slot4[1].+0x24` | helper12896 / slotArrayTick (4-slot script) |
| 0x138b | 38 | 50 | f+18 | `slot4[1].+0x29` | helper12896 / slotArrayTick (4-slot script) |
| 0x138d | E4 | F3 | f+8 | `slot4[1].+0x2b` | helper12896 / slotArrayTick (4-slot script) |
| 0x13af | 7E | 82 | f+82 | `slot4[1].+0x4d` | helper12896 / slotArrayTick (4-slot script) |
| 0x13bd | C0 | 7C | f+2 | `slot4[1].+0x5b` | helper12896 / slotArrayTick (4-slot script) |

### Priority 19: cluster `0x1400..0x143f` — 5 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x140f | 46 | 4A | f+67 | `slot4[2].+0x4d` | helper12896 / slotArrayTick (4-slot script) |
| 0x141d | D0 | 90 | f+3 | `slot4[2].+0x5b` | helper12896 / slotArrayTick (4-slot script) |
| 0x1421 | B4 | 90 | f+3 | `slot4[2].+0x5f` | helper12896 / slotArrayTick (4-slot script) |
| 0x142f | 9C | 8C | f+3 | `slot4[3].+0xd` | unknown |
| 0x1433 | 6C | 5C | f+35 | `slot4[3].+0x11` | unknown |

### Priority 20: cluster `0x0380..0x03bf` — 4 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x039a | 00 | 01 | f+1 | `g_av_latch` | AV-control latch / refresh-frame |
| 0x03a6 | 4A | E9 | f+1 | `g_av_r3a6` | AV-control latch / refresh-frame |
| 0x03a7 | 06 | 9C | f+1 | `g_av_r3a7` | AV-control latch / refresh-frame |
| 0x03b1 | 88 | 80 | f+1 | `avControl.+0x3b1` | AV-control latch / refresh-frame |

### Priority 21: cluster `0x1440..0x147f` — 4 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x1446 | 31 | 00 | f+1 | `slot4[3].+0x24` | unknown |
| 0x144d | 24 | 3F | f+1 | `slot4[3].+0x2b` | unknown |
| 0x146f | 0E | 12 | f+67 | `slot4[3].+0x4d` | unknown |
| 0x147d | D0 | B4 | f+3 | `slot4[3].+0x5b` | unknown |

### Priority 22: cluster `0x0a80..0x0abf` — 3 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0a8d | 01 | 00 | f+66 | `slotP2.+0x6d` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a91 | 8C | 7A | f+68 | `slotP2.+0x71` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0ab9 | 09 | 08 | f+57 | `scriptSlot[0].+0x1d` | claimScriptSlot / scriptSlotStep13068 |

### Priority 23: cluster `0x0040..0x007f` — 2 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0041 | 4F | 4B | f+6 | `obj0.field_+0x29` | helper121B8(obj0 chain) |
| 0x0043 | 97 | 88 | f+4 | `obj0.savedZ_b1` | helper121B8(obj0 chain) |

### Priority 24: cluster `0x1f40..0x1f7f` — 2 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x1f56 | 0B | 01 | f+12 | `unknown_+0x1f56` | unknown |
| 0x1f57 | 0B | 01 | f+11 | `unknown_+0x1f57` | unknown |

### Priority 25: cluster `0x06c0..0x06ff` — 1 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x06f5 | 32 | 31 | f+60 | `unknown_+0x6f5` | unknown |

### Priority 26: cluster `0x0940..0x097f` — 1 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x097f | CC | D7 | f+56 | `g_srtgt_b3` | refreshHelper13EE6 (srtgt scroll) |

### Priority 27: cluster `0x0980..0x09bf` — 1 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x098b | 00 | 01 | f+1 | `unknown_+0x98b` | unknown |

### Priority 28: cluster `0x0ac0..0x0aff` — 1 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0aed | D4 | DF | f+59 | `scriptSlot[0].+0x51` | claimScriptSlot / scriptSlotStep13068 |
