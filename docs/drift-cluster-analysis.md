# Drift cluster analysis @ f+99 — 2026-05-11

Baseline: 390 byte workRam divergenti su 8192 (4.8%) — obj0.x bit-perfect 99/99.
Probe: `packages/cli/src/probe-cluster-diff.ts` (nuovo).

## 1) Bucket summary (per offset range)

| Bucket | Range | Byte diff |
|---|---|---|
| header globals | 0x000-0x017 | 5 |
| obj0 struct | 0x018-0x0F9 | 11 |
| obj1 struct | 0x0FA-0x1DB | 0 |
| other objs + globals | 0x1DC-0x6FF | 69 |
| pre-slot region | 0x700-0xA9B | **99** |
| slot table (post helper12896) | 0xA9C-0x12FF | 2 |
| 4-slot script array | 0x1300-0x1421 | 24 |
| slot3-4 + tail | 0x1422-0x14FF | 6 |
| scratch + STRUCT 0x1C28 | 0x1500-0x1FFF | **174** |
| **TOTAL** | | **390** |

## 2) Top-3 cluster + sub responsabile

### Cluster A — 0x1500-0x1FFF "stack frame + bbox scratch" — **174 byte (45% drift)**

- 96 byte in `0x1D00-0x1DFF`, 76 byte in `0x1E00-0x1EFF`, 2 byte in `0x1F00-0x1FFF`.
- Run più lunghi: `0x1DC1..0x1DCD` (13B), `0x1DFD..0x1E09` (13B), `0x1E0F..0x1E1B` (13B).
- Region è **stack frame area + entity/bbox scratch buffer**:
  - SP init = `0x401F00`, scende ~0x100 byte → finisce nel cluster.
  - `0x401E00` è entity-arg buffer (vedi test-state-sub-1881c-parity, bbox-hit-test-19d94, string-target-step-176d2).
- **Sub responsabile**: TUTTE le sub via `LINK/UNLK/movem.l -(SP)`. NO single sub. È **residuo cumulativo** di:
  1. Sub mancanti / PARTIAL replicate (`sub-14966-stub`, `sub-1caba-tile-redraw` non wired)
  2. Sequenza JSR differente da MAME (es. `fun_19e42` non chiamato in chain canonical)
- **NON è "STRUCT @ 0x1C28"**: i diff iniziano @ 0x1D43, NON @ 0x1C28. STRUCT @ 0x1C28 (16 word, 0x1C28..0x1C47) è bit-perfect modulo lo stub `fun_1cc62 → obj.z`.

### Cluster B — 0x700-0xA9B "pre-slot region" — **99 byte (25% drift)**

- Run principale: **`0x0706..0x074D` (72 byte consecutivi)** = decode output buffer `*0x400706` (0x48 byte) scritto da `refreshHelper13EE6`.
- TS pattern: `0F FF 0F FF 0F FF ...` (= valori default uninizializzati).
- MAME pattern: word reali (es. `31 C4, 31 C5, 31 73, 32 45, ...`).
- **Sub responsabile**: `decodeBitstream1A668(state, rom, 0x400706, ctrlStream, extStream)` chiamato da `refreshHelper13EE6` @ 0x13F96.
- Run secondari: `0x0A20..0x0A27` (8B), `0x0A2D..0x0A33` (6B). Cluster `0x0A20..0x0A4F` = pre-slot area che precede slot table @ 0xA9C (probabile output di stesso decode pipeline).

### Cluster C — 0x1DC-0x6FF "other objs + globals" — **69 byte (18% drift)**

- Run principale: **`0x0674..0x0683` (16 byte) + `0x0685..0x068B` (6 byte)** = `velLeft/velDown/velRight/velUp + velNE/velNW/velSE/velSW` (4 word + 4 word, 16 byte) scritti da **`stateDispatch160F6`** (FUN_160F6).
- Valori TS: vicini-ma-diversi (es. `0x8967` vs MAME `0x8BE1`). Cluster downstream: `velX` differiscono perché input upstream (`0x66c..0x672 input bits`, `0x66a diag mask`) sono accumulatori RNG/sound che differiscono.
- Altri run: `0x01DF..0x01E1` (3B), `0x03A6..0x03A7` (2B = AV-control latch byte), `0x03F0..0x0455` sparso = tile-render/sound mailbox.
- **Sub responsabile**: `stateDispatch160F6` (già wired ed eseguito), MA i suoi input differiscono perché **`fun_19e42` (`marbleCellDispatch19E42`) NON è wired** in `state-sub-19baa.ts` chain — vedi sez. 3.

## 3) Match con 4 candidati (FUN_19E42, FUN_1924E, FUN_2822E, FUN_17934)

| Candidato | Replica esiste? | Wired? | Disasm size | Match cluster | ROI |
|---|---|---|---|---|---|
| **FUN_19E42** marbleCellDispatch19E42 | ✓ replicato ([marble-cell-dispatch-19e42.ts](../packages/engine/src/marble-cell-dispatch-19e42.ts)) | ✗ **NON wired** — `subs?.fun_19e42` callback omesso in `refresh-frame-10fce.ts:344` | 194 byte | **Cluster C** (vel inputs 0x674-0x68B): scrive `*0x400690/692` (POS_X/Y globals) + entity[0x20..0x23] + entity[0x26/2C/32] | **ALTA** |
| FUN_1924E helper1924E | ✓ replicato ([helper-1924e.ts](../packages/engine/src/helper-1924e.ts)) | ✓ wired in `helper-121b8.ts:737` | ~80 instr | NO cluster diretto match | bassa (già wired) |
| FUN_2822E | ✗ no replica | ✗ no wire (callback `fun_2822E?` default no-op) | 4 byte (loop infinito `addq.b 0x1,D0b; bra 0x2822e`) | Dead-code/trap. NEVER called in attract (gate `obj+0x6A.w > 0x190`) | **NULLA** |
| FUN_17934 | ✗ no replica | ✗ no wire (callback `fun_17934?` default no-op) | 36 lines disasm | Pre-init helper respawn block. Nessun match con cluster top-3 | bassa |

## 4) Raccomandazione

**REPLICARE PRIMA: wirare `marbleCellDispatch19E42` nel chain `stateSub19BAA`.**

Motivazione (Rule 4 — goal-driven):
1. **Replica già esistente e completa** (194 byte disasm, replicata bit-perfect in `marble-cell-dispatch-19e42.ts`).
2. **NON wired runtime**: `refresh-frame-10fce.ts:344` chiama `stateSub19BAA(state, rom)` senza passare `subs.fun_19e42`. Quindi side-effect persi.
3. **Effetto a cascata**: la sub scrive globali `*0x400690/692` (POS_X/Y) usati DOPO da:
   - `stateDispatch160F6` → cluster C 0x674-0x68B (velocity dispatcher)
   - Down-stream sui side-effect screen-Y in obj struct (cluster A scratch)
4. **Effort minimo**: solo wire + parity test, NO nuova replica.

Fix proposto (1 riga):
```ts
// refresh-frame-10fce.ts:344
(subs.stateSub19BAA ?? ((s) => {
  stateSub19BAA(s, rom, { fun_19e42: marbleCellDispatch19E42 });
}))(state);
```

## 5) Estimate drift improvement

Conservative estimate:
- Cluster C diretto (POS_X/Y → vel inputs): **-22 byte** workRam (cluster 0x674-0x68B + 0x685-0x68B + 0x1DF-0x1E7)
- Cascade su cluster A stack frame (push/pop indiretto): **-15 a -40 byte** scratch
- **Totale stimato: -40 a -60 byte → drift 390 → 330-350 byte (-10% a -15%)**

NON è bullet (cluster B `0x706..0x74D = decodeBitstream1A668 output stub` resta — quello richiede replica `decodeBitstream1A668` reale, ~200 LOC).

## 6) Secondary recommendation (post-19E42 wire)

Replicare/completare **`decodeBitstream1A668`** (cluster B 0x706-0x74D, 72 byte consecutivi):
- Sub esiste come stub no-op in `decode-bitstream-1a668.ts`.
- 72 byte consecutivi = quick win se replicata reale.
- Effort: 200-300 LOC (bitstream decoder).
- Drift estimate: **-72 byte cluster B + cascade (PF RAM tile updates) → -80 a -100 byte ulteriori**.

## 7) NON raccomandato

- **FUN_2822E**: dead-code (`addq.b 0x1,D0b; bra 0x2822e` — loop infinito). NEVER called in attract window. NO replica.
- **FUN_17934**: pre-init respawn helper, gate `obj+0x6A.w > 0x190` chiuso in attract. NO drift contribution diretto.
- **Stack scratch 0x1D40-0x1E40**: bit-perfect richiede sequenza JSR identica frame-by-frame — implausibile senza replica completa di TUTTE le sub.
