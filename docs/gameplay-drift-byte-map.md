# Gameplay drift byte map @ f+99

Totale: **215 byte gameplay** (di cui 172B stack residue esclusi da invariante).

Generato da `packages/cli/src/probe-gameplay-byte-map.ts`.

## Top-10 bottleneck "early diverge"

I byte che divergono prima sono i candidati root cascade. Una volta fixati questi, molti downstream collassano.

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0003 | E4 | EE | f+1 | `g_timer_b3` | unknown |
| 0x0014 | 00 | 01 | f+1 | `unknown_+0x14` | unknown |
| 0x01df | A8 | BA | f+1 | `obj2.z_long_b1` | helper121B8 or sub-fa0-marble-emit |
| 0x01e1 | 05 | FE | f+1 | `obj2.z_long_b3` | helper121B8 or sub-fa0-marble-emit |
| 0x01e5 | AE | C0 | f+1 | `obj2.substate_byte` | helper121B8 or sub-fa0-marble-emit |
| 0x01e7 | 0B | 04 | f+1 | `obj2.flags_b1` | helper121B8 or sub-fa0-marble-emit |
| 0x01f1 | 98 | 89 | f+1 | `obj2.field_+0x27` | helper121B8 or sub-fa0-marble-emit |
| 0x01f7 | 9E | 8F | f+1 | `obj2.savedZ_b3` | helper121B8 or sub-fa0-marble-emit |
| 0x039a | 00 | 01 | f+1 | `g_av_latch` | AV-control latch / refresh-frame |
| 0x03a6 | 4A | E9 | f+1 | `g_av_r3a6` | AV-control latch / refresh-frame |

## Cluster ranking (by byte count)

| rank | cluster | bytes | cum | %tot | earliest diverge | dominant writer |
|---|---|---:|---:|---:|---|---|
| #1 | `0x0700..0x073f` | 58 | 58 | 27.0% | f+2 | decodeBitstream1A668 (via refreshHelper13EE6) |
| #2 | `0x0740..0x077f` | 16 | 74 | 34.4% | f+1 | decodeBitstream1A668 (via refreshHelper13EE6) |
| #3 | `0x0680..0x06bf` | 15 | 89 | 41.4% | f+4 | stateDispatch160F6 (cascade da P2 slot drift) |
| #4 | `0x0a00..0x0a3f` | 15 | 104 | 48.4% | f+8 | objectUpdatePair158CC + fun158F6(P2) |
| #5 | `0x0640..0x067f` | 12 | 116 | 54.0% | f+4 | stateDispatch160F6 (cascade da P2 slot drift) |
| #6 | `0x13c0..0x13ff` | 11 | 127 | 59.1% | f+1 | helper12896 / slotArrayTick (4-slot script) |
| #7 | `0x0200..0x023f` | 10 | 137 | 63.7% | f+3 | helper121B8 or sub-fa0-marble-emit |
| #8 | `0x01c0..0x01ff` | 9 | 146 | 67.9% | f+1 | helper121B8 or sub-fa0-marble-emit |
| #9 | `0x0000..0x003f` | 6 | 152 | 70.7% | f+1 | unknown |
| #10 | `0x00c0..0x00ff` | 6 | 158 | 73.5% | f+2 | helper121B8(obj0 chain) |
| #11 | `0x03c0..0x03ff` | 6 | 164 | 76.3% | f+1 | AV-control latch / refresh-frame |
| #12 | `0x0400..0x043f` | 6 | 170 | 79.1% | f+1 | stateSub* family |
| #13 | `0x0a40..0x0a7f` | 6 | 176 | 81.9% | f+56 | objectUpdatePair158CC + fun158F6(P2) |
| #14 | `0x0440..0x047f` | 5 | 181 | 84.2% | f+57 | stateSub* family |
| #15 | `0x1340..0x137f` | 5 | 186 | 86.5% | f+18 | helper12896 / slotArrayTick (4-slot script) |
| #16 | `0x1380..0x13bf` | 5 | 191 | 88.8% | f+2 | helper12896 / slotArrayTick (4-slot script) |
| #17 | `0x1400..0x143f` | 5 | 196 | 91.2% | f+3 | helper12896 / slotArrayTick (4-slot script) |
| #18 | `0x0380..0x03bf` | 4 | 200 | 93.0% | f+1 | AV-control latch / refresh-frame |
| #19 | `0x1440..0x147f` | 4 | 204 | 94.9% | f+1 | unknown |
| #20 | `0x0a80..0x0abf` | 3 | 207 | 96.3% | f+57 | objectUpdatePair158CC + fun158F6(P2) |
| #21 | `0x0040..0x007f` | 2 | 209 | 97.2% | f+4 | helper121B8(obj0 chain) |
| #22 | `0x1f40..0x1f7f` | 2 | 211 | 98.1% | f+11 | unknown |
| #23 | `0x06c0..0x06ff` | 1 | 212 | 98.6% | f+60 | unknown |
| #24 | `0x0940..0x097f` | 1 | 213 | 99.1% | f+56 | refreshHelper13EE6 (srtgt scroll) |
| #25 | `0x0980..0x09bf` | 1 | 214 | 99.5% | f+1 | unknown |
| #26 | `0x0ac0..0x0aff` | 1 | 215 | 100.0% | f+59 | claimScriptSlot / scriptSlotStep13068 |

## Per-cluster detail

### Priority 1: cluster `0x0700..0x073f` — 58 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0706 | 0F | 31 | f+2 | `decodeBuf.w3_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0707 | FF | C4 | f+2 | `decodeBuf.w3_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0708 | 0F | 31 | f+2 | `decodeBuf.w4_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0709 | FF | C5 | f+2 | `decodeBuf.w4_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x070a | 0F | 31 | f+2 | `decodeBuf.w5_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x070b | FF | 73 | f+2 | `decodeBuf.w5_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x070c | 0F | 32 | f+2 | `decodeBuf.w6_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x070d | FF | 45 | f+2 | `decodeBuf.w6_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x070e | 0F | 30 | f+2 | `decodeBuf.w7_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x070f | FF | 8A | f+2 | `decodeBuf.w7_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0710 | 0F | 30 | f+2 | `decodeBuf.w8_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0711 | FF | 8A | f+2 | `decodeBuf.w8_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0712 | 0F | 31 | f+2 | `decodeBuf.w9_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0713 | FF | C7 | f+2 | `decodeBuf.w9_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0714 | 0F | 34 | f+2 | `decodeBuf.w10_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0715 | FF | AF | f+2 | `decodeBuf.w10_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0716 | 0F | 30 | f+2 | `decodeBuf.w11_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0717 | FF | 4D | f+2 | `decodeBuf.w11_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0718 | 0F | 30 | f+2 | `decodeBuf.w12_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0719 | FF | 4E | f+2 | `decodeBuf.w12_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x071a | 0F | 30 | f+2 | `decodeBuf.w13_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x071b | FF | 4D | f+2 | `decodeBuf.w13_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x071c | 0F | 30 | f+2 | `decodeBuf.w14_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x071d | FF | 4E | f+2 | `decodeBuf.w14_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x071e | 0F | 30 | f+2 | `decodeBuf.w15_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x071f | FF | 4D | f+2 | `decodeBuf.w15_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0720 | 0F | 30 | f+2 | `decodeBuf.w16_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0721 | FF | 4E | f+2 | `decodeBuf.w16_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0722 | 0F | 30 | f+2 | `decodeBuf.w17_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0723 | FF | 4D | f+2 | `decodeBuf.w17_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0724 | 0F | 30 | f+2 | `decodeBuf.w18_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0725 | FF | 4E | f+2 | `decodeBuf.w18_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0726 | 0F | 30 | f+2 | `decodeBuf.w19_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0727 | FF | 4D | f+2 | `decodeBuf.w19_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0728 | 0F | 30 | f+2 | `decodeBuf.w20_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0729 | FF | 4E | f+2 | `decodeBuf.w20_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x072a | 0F | 11 | f+2 | `decodeBuf.w21_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x072b | FF | 71 | f+2 | `decodeBuf.w21_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x072c | 0F | 11 | f+2 | `decodeBuf.w22_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x072d | FF | 72 | f+2 | `decodeBuf.w22_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x072e | 0F | 10 | f+2 | `decodeBuf.w23_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x072f | FF | 8A | f+2 | `decodeBuf.w23_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0730 | 0F | 12 | f+2 | `decodeBuf.w24_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0731 | FF | B5 | f+2 | `decodeBuf.w24_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0732 | 0F | 14 | f+2 | `decodeBuf.w25_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0733 | FF | 23 | f+2 | `decodeBuf.w25_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0734 | 0F | 11 | f+2 | `decodeBuf.w26_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0735 | FF | C5 | f+2 | `decodeBuf.w26_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0736 | 0F | 10 | f+2 | `decodeBuf.w27_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0737 | FF | 8A | f+2 | `decodeBuf.w27_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0738 | 0F | 11 | f+2 | `decodeBuf.w28_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0739 | FF | 73 | f+2 | `decodeBuf.w28_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x073a | 0F | 11 | f+2 | `decodeBuf.w29_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x073b | FF | 5F | f+2 | `decodeBuf.w29_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x073c | 0F | 11 | f+2 | `decodeBuf.w30_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x073d | FF | 72 | f+2 | `decodeBuf.w30_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x073e | 0F | 10 | f+2 | `decodeBuf.w31_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x073f | FF | 8A | f+2 | `decodeBuf.w31_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |

### Priority 2: cluster `0x0740..0x077f` — 16 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0740 | 0F | 12 | f+2 | `decodeBuf.w32_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0741 | FF | D7 | f+2 | `decodeBuf.w32_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0742 | 0F | 14 | f+2 | `decodeBuf.w33_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0743 | FF | B0 | f+2 | `decodeBuf.w33_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0744 | 0F | 14 | f+2 | `decodeBuf.w34_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0745 | FF | B1 | f+2 | `decodeBuf.w34_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0746 | 0F | 10 | f+2 | `decodeBuf.w35_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0747 | FF | 4D | f+2 | `decodeBuf.w35_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0748 | 0F | 10 | f+2 | `decodeBuf.w36_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0749 | FF | 4E | f+2 | `decodeBuf.w36_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x074a | 0F | 10 | f+2 | `decodeBuf.w37_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x074b | FF | 4D | f+2 | `decodeBuf.w37_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x074c | 0F | 10 | f+2 | `decodeBuf.w38_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x074d | FF | 4E | f+2 | `decodeBuf.w38_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0750 | 13 | 14 | f+1 | `decodeBuf.w40_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0751 | EE | 4E | f+1 | `decodeBuf.w40_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |

### Priority 3: cluster `0x0680..0x06bf` — 15 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0680 | A4 | A6 | f+20 | `g_velSE_hi` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0681 | 46 | C0 | f+4 | `g_velSE_lo` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0682 | A4 | A6 | f+20 | `g_velSW_hi` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0683 | 46 | C0 | f+4 | `g_velSW_lo` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0685 | AB | BC | f+70 | `g_savedX_b1` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0686 | B0 | 2C | f+70 | `g_savedX_b2` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0687 | ED | FC | f+70 | `g_savedX_b3` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0689 | 07 | 02 | f+70 | `g_savedY_b1` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x068a | D9 | 37 | f+70 | `g_savedY_b2` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x068b | 56 | AC | f+70 | `g_savedY_b3` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0697 | 15 | 17 | f+76 | `g_tileX_lo` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0699 | 21 | 20 | f+98 | `g_tileY_lo` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x069b | 15 | 17 | f+78 | `g_trackX_lo` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x069f | 03 | 05 | f+68 | `unknown_+0x69f` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x06a1 | 00 | 01 | f+68 | `unknown_+0x6a1` | stateDispatch160F6 (cascade da P2 slot drift) |

### Priority 4: cluster `0x0a00..0x0a3f` — 15 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0a20 | FF | 00 | f+76 | `slotP2.vx_b0` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a21 | FF | 01 | f+24 | `slotP2.vx_b1` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a22 | DB | 9B | f+8 | `slotP2.vx_b2` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a23 | 38 | 9A | f+8 | `slotP2.vx_b3` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a24 | 00 | FF | f+86 | `slotP2.vy_b0` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a25 | 00 | FF | f+86 | `slotP2.vy_b1` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a26 | 3B | 9F | f+8 | `slotP2.vy_b2` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a27 | 0A | E4 | f+8 | `slotP2.vy_b3` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a2d | AB | BD | f+68 | `slotP2.x_b1` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a2e | 8A | D5 | f+68 | `slotP2.x_b2` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a2f | F3 | A5 | f+68 | `slotP2.x_b3` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a31 | 08 | 01 | f+68 | `slotP2.y_b1` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a32 | 16 | D5 | f+68 | `slotP2.y_b2` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a33 | B1 | 54 | f+68 | `slotP2.y_b3` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a3f | E5 | CC | f+68 | `slotP2.+0x1f` | objectUpdatePair158CC + fun158F6(P2) |

### Priority 5: cluster `0x0640..0x067f` — 12 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0674 | 89 | 8B | f+20 | `g_velLeft_hi` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0675 | 67 | E1 | f+4 | `g_velLeft_lo` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0676 | F0 | F2 | f+14 | `g_velDown_hi` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0677 | 0F | 89 | f+4 | `g_velDown_lo` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0678 | 07 | 09 | f+24 | `g_velRight_hi` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x0679 | 2D | A7 | f+4 | `g_velRight_lo` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x067a | A4 | A6 | f+10 | `g_velUp_hi` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x067b | 31 | AB | f+4 | `g_velUp_lo` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x067c | A4 | A6 | f+20 | `g_velNE_hi` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x067d | 46 | C0 | f+4 | `g_velNE_lo` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x067e | 8E | 91 | f+12 | `g_velNW_hi` | stateDispatch160F6 (cascade da P2 slot drift) |
| 0x067f | A1 | 1B | f+4 | `g_velNW_lo` | stateDispatch160F6 (cascade da P2 slot drift) |

### Priority 6: cluster `0x13c0..0x13ff` — 11 byte

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

### Priority 7: cluster `0x0200..0x023f` — 10 byte

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

### Priority 8: cluster `0x01c0..0x01ff` — 9 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x01df | A8 | BA | f+1 | `obj2.z_long_b1` | helper121B8 or sub-fa0-marble-emit |
| 0x01e0 | 01 | 00 | f+42 | `obj2.z_long_b2` | helper121B8 or sub-fa0-marble-emit |
| 0x01e1 | 05 | FE | f+1 | `obj2.z_long_b3` | helper121B8 or sub-fa0-marble-emit |
| 0x01e5 | AE | C0 | f+1 | `obj2.substate_byte` | helper121B8 or sub-fa0-marble-emit |
| 0x01e7 | 0B | 04 | f+1 | `obj2.flags_b1` | helper121B8 or sub-fa0-marble-emit |
| 0x01f1 | 98 | 89 | f+1 | `obj2.field_+0x27` | helper121B8 or sub-fa0-marble-emit |
| 0x01f7 | 9E | 8F | f+1 | `obj2.savedZ_b3` | helper121B8 or sub-fa0-marble-emit |
| 0x01fb | 90 | 88 | f+39 | `obj2.tileY_word_lo` | helper121B8 or sub-fa0-marble-emit |
| 0x01fd | 68 | 58 | f+7 | `obj2.trackX_lo` | helper121B8 or sub-fa0-marble-emit |

### Priority 9: cluster `0x0000..0x003f` — 6 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0001 | E4 | EF | f+56 | `g_timer_b1` | unknown |
| 0x0003 | E4 | EE | f+1 | `g_timer_b3` | unknown |
| 0x0014 | 00 | 01 | f+1 | `unknown_+0x14` | unknown |
| 0x002d | 97 | 88 | f+2 | `obj0.z_long_b1` | helper121B8(obj0 chain) |
| 0x0039 | 4F | 4B | f+2 | `obj0.field_+0x21` | helper121B8(obj0 chain) |
| 0x003d | 4F | 4B | f+4 | `obj0.field_+0x25` | helper121B8(obj0 chain) |

### Priority 10: cluster `0x00c0..0x00ff` — 6 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x00c1 | 50 | 4C | f+2 | `obj0.field_+0xa9` | helper121B8(obj0 chain) |
| 0x00c7 | 50 | 4C | f+2 | `obj0.field_+0xaf` | helper121B8(obj0 chain) |
| 0x00cd | 50 | 4C | f+2 | `obj0.field_+0xb5` | helper121B8(obj0 chain) |
| 0x00d3 | 4F | 4B | f+2 | `obj0.field_+0xbb` | helper121B8(obj0 chain) |
| 0x00d7 | BE | DC | f+8 | `obj0.accum_b3` | helper121B8(obj0 chain) |
| 0x00dd | 74 | 3C | f+2 | `obj0.field_+0xc5` | helper121B8(obj0 chain) |

### Priority 11: cluster `0x03c0..0x03ff` — 6 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x03f0 | 26 | 8A | f+1 | `g_frame_counter` | AV-control latch / refresh-frame |
| 0x03f2 | 26 | 88 | f+2 | `g_frame_counter_b2` | AV-control latch / refresh-frame |
| 0x03f8 | 22 | 20 | f+1 | `avControl.+0x3f8` | AV-control latch / refresh-frame |
| 0x03f9 | 0E | 36 | f+2 | `avControl.+0x3f9` | AV-control latch / refresh-frame |
| 0x03fc | 22 | 20 | f+1 | `avControl.+0x3fc` | AV-control latch / refresh-frame |
| 0x03fd | 8E | B6 | f+2 | `avControl.+0x3fd` | AV-control latch / refresh-frame |

### Priority 12: cluster `0x0400..0x043f` — 6 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0400 | 23 | 21 | f+1 | `stateMachine.+0x400` | stateSub* family |
| 0x0401 | 0E | 36 | f+2 | `stateMachine.+0x401` | stateSub* family |
| 0x0404 | 23 | 21 | f+1 | `stateMachine.+0x404` | stateSub* family |
| 0x0405 | 8C | B4 | f+2 | `stateMachine.+0x405` | stateSub* family |
| 0x0407 | 07 | 1B | f+2 | `stateMachine.+0x407` | stateSub* family |
| 0x040b | 0C | 0D | f+59 | `stateMachine.+0x40b` | stateSub* family |

### Priority 13: cluster `0x0a40..0x0a7f` — 6 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0a41 | 23 | 28 | f+56 | `slotP2.+0x21` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a43 | E4 | CE | f+56 | `slotP2.+0x23` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a45 | 22 | 27 | f+56 | `slotP2.+0x25` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a47 | E4 | D0 | f+72 | `slotP2.+0x27` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a49 | 21 | 27 | f+56 | `slotP2.+0x29` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a53 | 15 | 17 | f+78 | `slotP2.+0x33` | objectUpdatePair158CC + fun158F6(P2) |

### Priority 14: cluster `0x0440..0x047f` — 5 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0451 | 76 | 7A | f+63 | `stateMachine.+0x451` | stateSub* family |
| 0x0455 | B2 | B6 | f+63 | `stateMachine.+0x455` | stateSub* family |
| 0x0456 | 0B | 0A | f+57 | `stateMachine.+0x456` | stateSub* family |
| 0x0458 | 01 | 03 | f+57 | `stateMachine.+0x458` | stateSub* family |
| 0x045a | 01 | 03 | f+57 | `stateMachine.+0x45a` | stateSub* family |

### Priority 15: cluster `0x1340..0x137f` — 5 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x1362 | FF | 00 | f+18 | `slot4[1].+0x0` | helper12896 / slotArrayTick (4-slot script) |
| 0x1363 | F8 | 00 | f+18 | `slot4[1].+0x1` | helper12896 / slotArrayTick (4-slot script) |
| 0x1367 | 00 | 08 | f+18 | `slot4[1].+0x5` | helper12896 / slotArrayTick (4-slot script) |
| 0x136f | EC | DC | f+18 | `slot4[1].+0xd` | helper12896 / slotArrayTick (4-slot script) |
| 0x1373 | 9C | A4 | f+50 | `slot4[1].+0x11` | helper12896 / slotArrayTick (4-slot script) |

### Priority 16: cluster `0x1380..0x13bf` — 5 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x1386 | 32 | 00 | f+2 | `slot4[1].+0x24` | helper12896 / slotArrayTick (4-slot script) |
| 0x138b | 38 | 50 | f+18 | `slot4[1].+0x29` | helper12896 / slotArrayTick (4-slot script) |
| 0x138d | E4 | F3 | f+8 | `slot4[1].+0x2b` | helper12896 / slotArrayTick (4-slot script) |
| 0x13af | 7E | 82 | f+82 | `slot4[1].+0x4d` | helper12896 / slotArrayTick (4-slot script) |
| 0x13bd | C0 | 7C | f+2 | `slot4[1].+0x5b` | helper12896 / slotArrayTick (4-slot script) |

### Priority 17: cluster `0x1400..0x143f` — 5 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x140f | 46 | 4A | f+67 | `slot4[2].+0x4d` | helper12896 / slotArrayTick (4-slot script) |
| 0x141d | D0 | 90 | f+3 | `slot4[2].+0x5b` | helper12896 / slotArrayTick (4-slot script) |
| 0x1421 | B4 | 90 | f+3 | `slot4[2].+0x5f` | helper12896 / slotArrayTick (4-slot script) |
| 0x142f | 9C | 8C | f+3 | `slot4[3].+0xd` | unknown |
| 0x1433 | 6C | 5C | f+35 | `slot4[3].+0x11` | unknown |

### Priority 18: cluster `0x0380..0x03bf` — 4 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x039a | 00 | 01 | f+1 | `g_av_latch` | AV-control latch / refresh-frame |
| 0x03a6 | 4A | E9 | f+1 | `g_av_r3a6` | AV-control latch / refresh-frame |
| 0x03a7 | 06 | 9C | f+1 | `g_av_r3a7` | AV-control latch / refresh-frame |
| 0x03b1 | 88 | 80 | f+1 | `avControl.+0x3b1` | AV-control latch / refresh-frame |

### Priority 19: cluster `0x1440..0x147f` — 4 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x1446 | 31 | 00 | f+1 | `slot4[3].+0x24` | unknown |
| 0x144d | 24 | 3F | f+1 | `slot4[3].+0x2b` | unknown |
| 0x146f | 0E | 12 | f+67 | `slot4[3].+0x4d` | unknown |
| 0x147d | D0 | B4 | f+3 | `slot4[3].+0x5b` | unknown |

### Priority 20: cluster `0x0a80..0x0abf` — 3 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0a89 | 01 | 07 | f+68 | `slotP2.+0x69` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0a91 | 8C | 7A | f+68 | `slotP2.+0x71` | objectUpdatePair158CC + fun158F6(P2) |
| 0x0ab9 | 09 | 08 | f+57 | `scriptSlot[0].+0x1d` | claimScriptSlot / scriptSlotStep13068 |

### Priority 21: cluster `0x0040..0x007f` — 2 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0041 | 4F | 4B | f+6 | `obj0.field_+0x29` | helper121B8(obj0 chain) |
| 0x0043 | 97 | 88 | f+4 | `obj0.savedZ_b1` | helper121B8(obj0 chain) |

### Priority 22: cluster `0x1f40..0x1f7f` — 2 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x1f56 | 0B | 01 | f+12 | `unknown_+0x1f56` | unknown |
| 0x1f57 | 0B | 01 | f+11 | `unknown_+0x1f57` | unknown |

### Priority 23: cluster `0x06c0..0x06ff` — 1 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x06f5 | 32 | 31 | f+60 | `unknown_+0x6f5` | unknown |

### Priority 24: cluster `0x0940..0x097f` — 1 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x097f | CC | D7 | f+56 | `g_srtgt_b3` | refreshHelper13EE6 (srtgt scroll) |

### Priority 25: cluster `0x0980..0x09bf` — 1 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x098b | 00 | 01 | f+1 | `unknown_+0x98b` | unknown |

### Priority 26: cluster `0x0ac0..0x0aff` — 1 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0aed | D4 | DF | f+59 | `scriptSlot[0].+0x51` | claimScriptSlot / scriptSlotStep13068 |
