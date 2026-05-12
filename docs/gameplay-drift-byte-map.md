# Gameplay drift byte map @ f+99

Totale: **40 byte gameplay** (di cui 172B stack residue esclusi da invariante).

Generato da `packages/cli/src/probe-gameplay-byte-map.ts`.

## Top-10 bottleneck "early diverge"

I byte che divergono prima sono i candidati root cascade. Una volta fixati questi, molti downstream collassano.

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x03b1 | 88 | 80 | f+1 | `avControl.+0x3b1` | AV-control latch / refresh-frame |
| 0x03f8 | 22 | 20 | f+1 | `avControl.+0x3f8` | AV-control latch / refresh-frame |
| 0x03fc | 22 | 20 | f+1 | `avControl.+0x3fc` | AV-control latch / refresh-frame |
| 0x0400 | 23 | 21 | f+1 | `stateMachine.+0x400` | stateSub* family |
| 0x0404 | 23 | 21 | f+1 | `stateMachine.+0x404` | stateSub* family |
| 0x0750 | 13 | 14 | f+1 | `decodeBuf.w40_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0751 | EE | 4E | f+1 | `decodeBuf.w40_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x098b | 00 | 01 | f+1 | `unknown_+0x98b` | unknown |
| 0x13f3 | A6 | 02 | f+1 | `slot4[2].+0x31` | helper12896 / slotArrayTick (4-slot script) |
| 0x00dd | 74 | 3C | f+2 | `obj0.field_+0xc5` | helper121B8(obj0 chain) |

## Cluster ranking (by byte count)

| rank | cluster | bytes | cum | %tot | earliest diverge | dominant writer |
|---|---|---:|---:|---:|---|---|
| #1 | `0x13c0..0x13ff` | 7 | 7 | 17.5% | f+1 | helper12896 / slotArrayTick (4-slot script) |
| #2 | `0x0400..0x043f` | 6 | 13 | 32.5% | f+1 | stateSub* family |
| #3 | `0x03c0..0x03ff` | 4 | 17 | 42.5% | f+1 | AV-control latch / refresh-frame |
| #4 | `0x1380..0x13bf` | 4 | 21 | 52.5% | f+8 | helper12896 / slotArrayTick (4-slot script) |
| #5 | `0x1340..0x137f` | 3 | 24 | 60.0% | f+18 | helper12896 / slotArrayTick (4-slot script) |
| #6 | `0x1400..0x143f` | 3 | 27 | 67.5% | f+2 | helper12896 / slotArrayTick (4-slot script) |
| #7 | `0x00c0..0x00ff` | 2 | 29 | 72.5% | f+2 | helper121B8(obj0 chain) |
| #8 | `0x0200..0x023f` | 2 | 31 | 77.5% | f+22 | helper121B8 or sub-fa0-marble-emit |
| #9 | `0x0380..0x03bf` | 2 | 33 | 82.5% | f+1 | AV-control latch / refresh-frame |
| #10 | `0x0740..0x077f` | 2 | 35 | 87.5% | f+1 | decodeBitstream1A668 (via refreshHelper13EE6) |
| #11 | `0x1f40..0x1f7f` | 2 | 37 | 92.5% | f+11 | unknown |
| #12 | `0x06c0..0x06ff` | 1 | 38 | 95.0% | f+60 | unknown |
| #13 | `0x0980..0x09bf` | 1 | 39 | 97.5% | f+1 | unknown |
| #14 | `0x1440..0x147f` | 1 | 40 | 100.0% | f+67 | unknown |

## Per-cluster detail

### Priority 1: cluster `0x13c0..0x13ff` — 7 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x13c1 | 90 | 6C | f+18 | `slot4[1].+0x5f` | helper12896 / slotArrayTick (4-slot script) |
| 0x13c2 | FF | 00 | f+2 | `slot4[2].+0x0` | helper12896 / slotArrayTick (4-slot script) |
| 0x13c3 | F8 | 00 | f+2 | `slot4[2].+0x1` | helper12896 / slotArrayTick (4-slot script) |
| 0x13c6 | 00 | FF | f+2 | `slot4[2].+0x4` | helper12896 / slotArrayTick (4-slot script) |
| 0x13c7 | 00 | F8 | f+2 | `slot4[2].+0x5` | helper12896 / slotArrayTick (4-slot script) |
| 0x13f2 | FF | 00 | f+85 | `slot4[2].+0x30` | helper12896 / slotArrayTick (4-slot script) |
| 0x13f3 | A6 | 02 | f+1 | `slot4[2].+0x31` | helper12896 / slotArrayTick (4-slot script) |

### Priority 2: cluster `0x0400..0x043f` — 6 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0400 | 23 | 21 | f+1 | `stateMachine.+0x400` | stateSub* family |
| 0x0401 | 0E | 36 | f+2 | `stateMachine.+0x401` | stateSub* family |
| 0x0404 | 23 | 21 | f+1 | `stateMachine.+0x404` | stateSub* family |
| 0x0405 | 8C | B4 | f+2 | `stateMachine.+0x405` | stateSub* family |
| 0x0407 | 07 | 1B | f+2 | `stateMachine.+0x407` | stateSub* family |
| 0x040b | 0C | 0D | f+58 | `stateMachine.+0x40b` | stateSub* family |

### Priority 3: cluster `0x03c0..0x03ff` — 4 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x03f8 | 22 | 20 | f+1 | `avControl.+0x3f8` | AV-control latch / refresh-frame |
| 0x03f9 | 0E | 36 | f+2 | `avControl.+0x3f9` | AV-control latch / refresh-frame |
| 0x03fc | 22 | 20 | f+1 | `avControl.+0x3fc` | AV-control latch / refresh-frame |
| 0x03fd | 8E | B6 | f+2 | `avControl.+0x3fd` | AV-control latch / refresh-frame |

### Priority 4: cluster `0x1380..0x13bf` — 4 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x138b | 40 | 50 | f+50 | `slot4[1].+0x29` | helper12896 / slotArrayTick (4-slot script) |
| 0x138d | FB | F3 | f+8 | `slot4[1].+0x2b` | helper12896 / slotArrayTick (4-slot script) |
| 0x13af | 7E | 82 | f+82 | `slot4[1].+0x4d` | helper12896 / slotArrayTick (4-slot script) |
| 0x13bd | A0 | 7C | f+18 | `slot4[1].+0x5b` | helper12896 / slotArrayTick (4-slot script) |

### Priority 5: cluster `0x1340..0x137f` — 3 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x1366 | FF | 00 | f+18 | `slot4[1].+0x4` | helper12896 / slotArrayTick (4-slot script) |
| 0x1367 | F8 | 08 | f+18 | `slot4[1].+0x5` | helper12896 / slotArrayTick (4-slot script) |
| 0x1373 | 94 | A4 | f+50 | `slot4[1].+0x11` | helper12896 / slotArrayTick (4-slot script) |

### Priority 6: cluster `0x1400..0x143f` — 3 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x140f | 46 | 4A | f+67 | `slot4[2].+0x4d` | helper12896 / slotArrayTick (4-slot script) |
| 0x141d | B4 | 90 | f+2 | `slot4[2].+0x5b` | helper12896 / slotArrayTick (4-slot script) |
| 0x1421 | B4 | 90 | f+2 | `slot4[2].+0x5f` | helper12896 / slotArrayTick (4-slot script) |

### Priority 7: cluster `0x00c0..0x00ff` — 2 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x00d7 | BE | DC | f+8 | `obj0.accum_b3` | helper121B8(obj0 chain) |
| 0x00dd | 74 | 3C | f+2 | `obj0.field_+0xc5` | helper121B8(obj0 chain) |

### Priority 8: cluster `0x0200..0x023f` — 2 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0219 | 88 | A0 | f+22 | `obj2.field_+0x4f` | helper121B8 or sub-fa0-marble-emit |
| 0x021f | 98 | B0 | f+23 | `obj2.field_+0x55` | helper121B8 or sub-fa0-marble-emit |

### Priority 9: cluster `0x0380..0x03bf` — 2 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x03af | 80 | 88 | f+2 | `avControl.+0x3af` | AV-control latch / refresh-frame |
| 0x03b1 | 88 | 80 | f+1 | `avControl.+0x3b1` | AV-control latch / refresh-frame |

### Priority 10: cluster `0x0740..0x077f` — 2 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x0750 | 13 | 14 | f+1 | `decodeBuf.w40_hi` | decodeBitstream1A668 (via refreshHelper13EE6) |
| 0x0751 | EE | 4E | f+1 | `decodeBuf.w40_lo` | decodeBitstream1A668 (via refreshHelper13EE6) |

### Priority 11: cluster `0x1f40..0x1f7f` — 2 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x1f56 | 0B | 01 | f+12 | `unknown_+0x1f56` | unknown |
| 0x1f57 | 0B | 01 | f+11 | `unknown_+0x1f57` | unknown |

### Priority 12: cluster `0x06c0..0x06ff` — 1 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x06f5 | 32 | 31 | f+60 | `unknown_+0x6f5` | unknown |

### Priority 13: cluster `0x0980..0x09bf` — 1 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x098b | 00 | 01 | f+1 | `unknown_+0x98b` | unknown |

### Priority 14: cluster `0x1440..0x147f` — 1 byte

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|
| 0x146f | 0E | 12 | f+67 | `slot4[3].+0x4d` | unknown |
