# Level Descriptor Header — Format Reference

> Verifica statica del formato del descriptor header dei sei livelli di
> Marble Madness, estratto dai consumer engine TS gia' verificati
> bit-perfect contro il binario originale. Scope: PRD
> `docs/level-header-decode-prd.md`, Phase 1 statica.
>
> **Status**: Phase 1 statica completa, MAME tap + parity ROM-side ancora
> da eseguire (vedi sezione "Aperture residue").

## Sommario

Il **level descriptor** e' una struct in ROM puntata da `*0x400474`
(level pointer). La pointer table @ ROM `0x2BE00` contiene 6 puntatori
long BE — uno per livello. La struct ha **header fisso da 0x2E byte**
seguito da una tabella per-colonna a `+0x2E` (long entries indicizzate
per col*4) e dai height records che chiudono il blocco.

Costanti gia' codificate:

| Costante | Valore | File |
| -------- | ------ | ---- |
| `LEVEL_POINTER_TABLE_OFFSET` | `0x2BE00` | `packages/engine/src/level.ts:27` |
| `LEVEL_COUNT` | `6` | `packages/engine/src/level.ts:28` |
| `LEVEL_HEADER_SIZE` | `0x2E` | `packages/engine/src/level.ts:29` (aggiornato da `36` = `0x24` errato pre-Phase 1) |
| `HEIGHT_RECORD_SIZE` | `8` | `packages/engine/src/level.ts:30` |

## Pointer table

`0x2BE00` (6 × u32 BE):

| Idx | Level | ROM offset | Slapstic-related? |
| --- | ----- | ---------- | ----------------- |
| 0 | Practice | `0x2BEE2` | No |
| 1 | Beginner | `0x2C54C` | No |
| 2 | Intermediate | `0x2CD9E` | No |
| 3 | Aerial | `0x2D648` | Si — terrain records via slapstic window |
| 4 | Silly | `0x2DE1E` | Special handling in `helper-121b8.ts` |
| 5 | Ultimate | `0x2E790` | No |

## Header fields verificati (0x00..0x2D)

Tutti i campi sotto sono **read** da almeno un consumer engine
verificato bit-perfect contro il binario originale via parity 500/500
musashi-wasm. La citazione `file:line` rimanda al punto di lettura.

| Offset | Size | Type | Semantic | Verified by |
| ------ | ---- | ---- | -------- | ----------- |
| `+0x00` | 4 | long ptr | **Direct terrain record base.** Pointer a byte-records di terrain. L4 raggiunge la window slapstic (es. `lvlPtr 0x2d648` → base `0x8123e`). Letto in `PATH_DIRECT` del tile-redraw quando `terrainCode` ∈ `[1..0x7FF]`. | `packages/engine/src/sub-1caba-tile-redraw.ts:464` |
| `+0x04` | 4 | long ptr | **Tile-word table.** Source word di `decodeBitstream1A668`. Indicizzato per scroll row × 2. | `packages/engine/src/level-init-16f6c.ts:84`<br>`packages/engine/src/refresh-helper-13ee6.ts:245` |
| `+0x08` | 4 | UNKNOWN | Nessun consumer osservato in path attract o startLevel. Candidato padding / riservato / consumed solo in path non testati. | — |
| `+0x0C` | 4 | long ptr | **RLE-compressed scroll-row source.** Espanso da `FUN_18FD0` (`rle-expand.ts`) come `(count, value)` word pairs in `0x400478+`. | `packages/engine/src/rle-expand.ts:54` |
| `+0x10` | 2 | signed word | **Y scroll base** (anchor). Boundary per calcolo scroll-index relativo. Inizializza `0x40097c` (`OFF_SRTGT`/scroll-row-target). **NON e' un timer** nonostante la nomenclatura `LEVEL_TIMER_OFF` in `level-dispatcher-16ec6.ts:26`. | `packages/engine/src/level-dispatcher-16ec6.ts:137`<br>`packages/engine/src/refresh-helper-13ee6.ts:229` (`LV_OFF_XBASE`)<br>`packages/engine/src/scroll-range-144e4.ts:152`<br>`packages/engine/src/slapstic-dispatcher-1344c.ts:159`<br>`packages/engine/src/fun-264aa.ts:250` |
| `+0x12` | 2 | signed word | **Y scroll range / aerial delta.** Aggiunto a `+0x10` durante `level-dispatcher-16ec6` SOLO se `levelIndex==4` (Aerial). In `level-init-16f6c` interpretato come `asr.w #3 - 1 = row offset start` per Aerial. In `refresh-helper-13ee6:695` letto come `lxrng` per il tail path. | `packages/engine/src/level-dispatcher-16ec6.ts:139`<br>`packages/engine/src/level-init-16f6c.ts:90`<br>`packages/engine/src/refresh-helper-13ee6.ts:695` (`LV_OFF_XRANGE`) |
| `+0x14`<br>`+0x16` | 2 each | packed word | **Entity initial position** (P1, P2). Packed `hi = vx >> 8`, `lo = vy >> 8`. Letto solo se entity ha `obj+0x18 == 3` (state==3). Indicizzato `+0x14 + i*2` ma in attract/playable solo i = 0,1 sono attivi. | `packages/engine/src/object-init-259b4.ts:134` |
| `+0x18` | 2 | signed word | **Max tile bound.** Limite superiore signed per `D4w` column-index nel tile-redraw loop. Anche boundary per la string-dispatch `FUN_177F8`. | `packages/engine/src/sub-1caba-tile-redraw.ts:310`<br>`packages/engine/src/string-dispatch-table-177f8.ts:361` (`LEVEL_HEADER_BOUND_OFF`) |
| `+0x1A..0x1F` | 6 | UNKNOWN | Range tecnicamente parte del "entity init array" (`+0x14 + i*2` per i = 3..5) ma nessun obj con `state==3` osservato a quegli indici in attract/playable. Status: tecnicamente raggiungibile dal codice, non esercitato. | — |
| `+0x20` | 4 | long ptr | **Sub-pattern pointer table.** Long pointer a una tabella di long entries indicizzate per `sub_index << 2` (sub_index 0..31, 5 bit). Ogni entry e' un "data ptr" letto byte-by-byte; valore `0x80` resetta il pointer (loop dei dati). | `packages/engine/src/render-tile-line-1ad54.ts:246` |
| `+0x24..0x25` | 2 | UNKNOWN | Nessun consumer osservato. Candidato padding tra `+0x20` (long ptr) e `+0x26` (long ptr). | — |
| `+0x26` | 4 | long ptr | **Binsearch base.** Pointer a terrain-code lookup table. Stored a `0x40065a` dal `level-dispatcher-16ec6`. Letto da `sub-1caba-tile-redraw` come `bsearchBase` per la dispatch di `terrainCode`. | `packages/engine/src/level-dispatcher-16ec6.ts:131`<br>`packages/engine/src/sub-1caba-tile-redraw.ts:376` |
| `+0x2A` | 4 | long ptr | **Extra-byte table.** Source byte di `decodeBitstream1A668` (offset ext stream). | `packages/engine/src/level-init-16f6c.ts:85`<br>`packages/engine/src/refresh-helper-13ee6.ts:261` (`LV_OFF_EXTTB`)<br>`packages/engine/src/slapstic-dispatcher-1344c.ts:176` |

### Note sul conflitto di overlap `+0x14..+0x1F` vs `+0x18`

`object-init-259b4.ts:134` ha:

```ts
const packed = readAbsU16(state, rom, statePtr + 0x14 + i * 2);
```

Indicizzato per entity index `i` su `count` obj. In teoria
`+0x14, +0x16, +0x18, +0x1A, +0x1C, +0x1E` sono usate per entity 0..5.
In pratica solo P1 (i=0, offset `+0x14`) e P2 (i=1, offset `+0x16`)
hanno mai `obj+0x18 == 3` nei path testati. Le entry da `+0x18` a
`+0x1F` non sono effettivamente lette come entity-init.

Lo stesso byte `+0x18` *e'* invece letto come **max tile bound** da
`sub-1caba-tile-redraw.ts` e `string-dispatch-table-177f8.ts`. Quindi
i due semantici coesistono solo perche' i path che leggerebbero `+0x18`
come entity init non si attivano in attract/playable.

**Implicazione per chi vuole aggiungere un livello custom con 3+
entities attive in stato 3**: il valore a `+0x18` deve essere
contemporaneamente un *packed entity init pos* AND un *max tile bound*.
Sono semantiche dimensionalmente incompatibili — questo e' un'asimmetria
del design originale, non un decode-error.

## Tabella per-colonna a `+0x2E..`

Inizia immediatamente dopo il fixed header. Entries long (4 byte
ciascuna), indicizzate per `startCol << 2`. Usata da `fun-264aa.ts:244`:

```ts
const levelHeader = rlWork(state, WR_LEVEL_HEADER_PTR);
let levelTablePtr = (
  s16(rwWork(state, WR_LEVEL_Y_BASE)) +
  ((levelHeader + 0x2e + (s16(startCol) << 2)) >>> 0) -
  4
) >>> 0;
```

Ogni entry e' un long pointer a row-base data per la colonna.
Numero di colonne effettivo: bound da `+0x18` (max tile bound).

## Height records (post column table)

Inizio: dopo la tabella per-colonna a `+0x2E + ncols*4`. Posizione
esatta non ancora isolata staticamente — richiede MAME tap per
identificare il primo offset effettivamente letto.

Layout per record (8 byte = 4 word BE):

| Word | Bits | Field | Status |
| ---- | ---- | ----- | ------ |
| `w0` | `[15:12]` | `slopeOrient` (0..15) | Verified guess (da `marble-madness-2026`) |
| `w0` | `[11:8]` | `slopeVal` magnitudo (0..15) | Verified guess (da `marble-madness-2026`) |
| `w0` | `[7:0]` | UNKNOWN | — |
| `w1` | full | UNKNOWN | — |
| `w2` | full | UNKNOWN | — |
| `w3` | full | UNKNOWN | — |

Formula fisica supposta:
`z_cell = z_base + (dx * sdx + dy * sdy) * slopeVal`

Non c'e' parity test attivo sui record (solo smoke su `loadLevel`
size). La decode dei word 1-3 e' Open.

## Riferimenti consumer (mapping completo)

File engine che usano `*0x400474` (level header ptr):

- `packages/engine/src/level.ts` — parser entry point.
- `packages/engine/src/init-level-load-1a236.ts` — scrive il ptr da ROM.
- `packages/engine/src/level-dispatcher-16ec6.ts` — `FUN_16EC6`, init runtime al level-start.
- `packages/engine/src/level-init-16f6c.ts` — `FUN_16F6C`, dispatch del row builder.
- `packages/engine/src/level-dispatcher-helper-18fd0.ts` → `rle-expand.ts` — RLE source.
- `packages/engine/src/object-init-259b4.ts` — entity initial position read.
- `packages/engine/src/refresh-helper-13ee6.ts` — main scroll/tile refresh.
- `packages/engine/src/render-tile-line-1ad54.ts` — render dispatch su sub-pattern table.
- `packages/engine/src/scroll-range-144e4.ts` — Y-base boundary read.
- `packages/engine/src/slapstic-dispatcher-1344c.ts` — Y-base usage per camera.
- `packages/engine/src/string-dispatch-table-177f8.ts` — max-tile-bound boundary.
- `packages/engine/src/sub-1caba-tile-redraw.ts` — direct terrain + binsearch read.
- `packages/engine/src/fun-264aa.ts` — column table base + Y scroll base.
- `packages/engine/src/rle-expand.ts` — RLE source read.
- `packages/engine/src/helper-121b8.ts` — L5 descriptor match (only).

## Aperture residue (richiedono ROM + MAME + Ghidra)

Per chiudere il PRD ai 7 success criteria, restano:

1. **MAME Lua tap su 6 livelli** — verifica che i field letti dai
   consumer Phase-1 coincidano coi valori realmente letti dal 68010
   sul binario originale. Script template:
   `oracle/mame_level_header_tap.lua` (da scrivere).
2. **Probe ROM dump** — stampa i 6 header reali con i field decoded.
   `packages/cli/src/probe-level-header.ts` (da scrivere, lanciato
   con `MARBLE_LOVE_ROM_BLOB=path npx tsx ...`).
3. **Decode dei field UNKNOWN restanti**: `+0x08` (long), `+0x24..0x25`
   (word). Richiede tap MAME + xref Ghidra.
4. **Decode word 1-3 dei height records**. Richiede MAME play-trace +
   xref Ghidra sui consumer della fisica del marble (`helper-1cd00.ts`,
   `bbox-hit-test-19d94.ts`).
5. **Parity test musashi-wasm** del nuovo `decodeLevelHeader` come
   componente nuovo: 500/500 random ROM-region inputs match raw bytes.
6. **Doc finale link** da `docs/findings/README.md` o `STATUS.md` al
   merge.

## Implicazioni per "aggiungere un livello custom"

Con la decode Phase-1, un livello custom valido **deve fornire**:

- `+0x00` (long): pointer a un blob di terrain byte-records.
- `+0x04` (long): pointer a un tile-word table (length = `tableSize` proporzionale al level).
- `+0x0C` (long): pointer a RLE-compressed scroll-row source.
- `+0x10` (signed word): Y scroll base — anchor di partenza.
- `+0x12` (signed word): Y scroll range — usato solo se levelIndex==4.
- `+0x14, +0x16` (packed words): posizione iniziale P1, P2.
- `+0x18` (signed word): max tile bound (column count for the level).
- `+0x20` (long): pointer a sub-pattern pointer table.
- `+0x26` (long): pointer a binsearch base (terrain-code LUT).
- `+0x2A` (long): pointer a extra-byte table.
- `+0x2E..` (long[]): per-column terrain table.
- height records (8 byte each) dopo la column table.

`+0x08`, `+0x24..0x25`, `+0x1A..0x1F` possono essere zero — il decode
TS Phase-1 non vede consumer di quei byte. Rischio: in path non
testati (es. game-mode 2 = post-victory) potrebbero essere letti.

Strategie di iniezione (vedi `docs/level-header-decode-prd.md` "Inserimento"):

- **Strategia A**: estendere il blob ROM con la pointer table aggiornata. Richiede gestire la slapstic window se il livello include terrain records nel range `0x80000-0x87FFF`.
- **Strategia B**: intercettare `initLevelLoad1A236` (`packages/engine/src/init-level-load-1a236.ts:129-173`) con una callback custom che scrive `*0x400474` puntando a un blob TS sintetico (in workRam o memoria virtuale). Piu' pulito, no slapstic interference.
