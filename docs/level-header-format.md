# Level Descriptor Header — Format Reference

> Verifica statica del formato del descriptor header dei sei livelli di
> Marble Madness, estratto dai consumer engine TS gia' verificati
> bit-perfect contro il binario originale. Scope: PRD
> `docs/level-header-decode-prd.md`, Phase 2 tap/decode.
>
> **Status**: Phase 2 tap/probe/parity completati per i field header
> consumati; legacy `HeightRecord` resta in "Aperture residue".

## Sommario

Il **level descriptor** e' una struct in ROM puntata da `*0x400474`
(level pointer). La pointer table @ ROM `0x2BE00` contiene 6 puntatori
long BE — uno per livello. La struct ha **header fisso da 0x2E byte**
seguito da una tabella per-colonna a `+0x2E` (long entries indicizzate
per col*4) e da strutture terrain/row-builder ROM-specifiche che
chiudono il blocco. Il vecchio nome `HeightRecord` nel parser TS e'
legacy: la segmentazione post-header non e' ancora un record geometrico
uniforme.

Costanti gia' codificate:

| Costante | Valore | File |
| -------- | ------ | ---- |
| `LEVEL_POINTER_TABLE_OFFSET` | `0x2BE00` | `packages/engine/src/level.ts:31` |
| `LEVEL_COUNT` | `6` | `packages/engine/src/level.ts:32` |
| `LEVEL_HEADER_SIZE` | `0x2E` | `packages/engine/src/level.ts:34` (aggiornato da `36` = `0x24` errato pre-Phase 1) |
| `HEIGHT_RECORD_SIZE` | `8` | `packages/engine/src/level.ts:35` |

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

Tutti i campi sotto sono **read** da almeno un consumer M68010/engine
identificato e verificati con MAME tap quando il path e' esercitabile.
La citazione `file:line` rimanda al punto di lettura TS; le righe MAME
indicano il PC ROM che ha letto lo stesso offset.

| Offset | Size | Type | Semantic | Verified by |
| ------ | ---- | ---- | -------- | ----------- |
| `+0x00` | 4 | long ptr | **Direct terrain record base.** Pointer a byte-records di terrain. L4 raggiunge la window slapstic (es. `lvlPtr 0x2d648` → base `0x8123e`). Letto in `PATH_DIRECT` del tile-redraw quando `terrainCode` ∈ `[1..0x7FF]`. | `packages/engine/src/sub-1caba-tile-redraw.ts:464` |
| `+0x04` | 4 | long ptr | **Tile-word table.** Source word di `decodeBitstream1A668`. Indicizzato per scroll row × 2. | `packages/engine/src/level-init-16f6c.ts:84`<br>`packages/engine/src/refresh-helper-13ee6.ts:245` |
| `+0x08` | 4 | long ptr | **Row-build bit-list pointer.** `FUN_1A444` lo carica in A4 e consuma una word ogni 16 tile-line descriptor; ogni bit diventa il flag passato a `FUN_1AD54`. | `packages/engine/src/tilemap-row-build-1a444.ts:129`<br>MAME PC `0x01A462` |
| `+0x0C` | 4 | long ptr | **RLE-compressed scroll-row source.** Espanso da `FUN_18FD0` (`rle-expand.ts`) come `(count, value)` word pairs in `0x400478+`. | `packages/engine/src/rle-expand.ts:54` |
| `+0x10` | 2 | signed word | **Y scroll base** (anchor). Boundary per calcolo scroll-index relativo. Inizializza `0x40097c` (`OFF_SRTGT`/scroll-row-target). **NON e' un timer** nonostante la nomenclatura `LEVEL_TIMER_OFF` in `level-dispatcher-16ec6.ts:26`. | `packages/engine/src/level-dispatcher-16ec6.ts:137`<br>`packages/engine/src/refresh-helper-13ee6.ts:229` (`LV_OFF_XBASE`)<br>`packages/engine/src/scroll-range-144e4.ts:152`<br>`packages/engine/src/slapstic-dispatcher-1344c.ts:159`<br>`packages/engine/src/fun-264aa.ts:250` |
| `+0x12` | 2 | signed word | **Y scroll range / aerial delta.** Aggiunto a `+0x10` durante `level-dispatcher-16ec6` SOLO se `levelIndex==4` (Aerial). In `level-init-16f6c` interpretato come `asr.w #3 - 1 = row offset start` per Aerial. In `refresh-helper-13ee6:695` letto come `lxrng` per il tail path. | `packages/engine/src/level-dispatcher-16ec6.ts:139`<br>`packages/engine/src/level-init-16f6c.ts:90`<br>`packages/engine/src/refresh-helper-13ee6.ts:695` (`LV_OFF_XRANGE`) |
| `+0x14`<br>`+0x16` | 2 each | packed word | **Entity initial position** (P1, P2 nei path naturali). Packed `hi = vx >> 8`, `lo = vy >> 8`. Letto solo se entity ha `obj+0x18 == 3` (state==3). Il codice indicizza `+0x14 + i*2`; i = 2..5 sono semanticamente sovrapposti ad altri field del row-builder. | `packages/engine/src/object-init-259b4.ts:134` |
| `+0x18` | 2 | signed word | **Max tile bound.** Limite superiore signed per `D4w` column-index nel tile-redraw loop. Anche boundary per la string-dispatch `FUN_177F8`. | `packages/engine/src/sub-1caba-tile-redraw.ts:310`<br>`packages/engine/src/string-dispatch-table-177f8.ts:361` (`LEVEL_HEADER_BOUND_OFF`) |
| `+0x1A` | 2 | signed word | **Row-build entry count.** Limite del loop `D3 < entryCount` in `FUN_1A444`, cioe' numero di tile-line descriptor da passare a `FUN_1AD54` per chunk. Sovrapposto fisicamente a `entityInitPositions[3]`. | `packages/engine/src/tilemap-row-build-1a444.ts:128`<br>MAME PC `0x01A45A` |
| `+0x1C` | 4 | long ptr | **Tile-line descriptor table pointer.** Base dei descriptor 8-byte passati a `FUN_1AD54` con stride 8. La struct 8-byte e' documentata in `render-tile-line-1ad54.ts`. Sovrapposto fisicamente a `entityInitPositions[4..5]`. | `packages/engine/src/tilemap-row-build-1a444.ts:152`<br>`packages/engine/src/render-tile-line-1ad54.ts:20`<br>MAME PC `0x01A4D0` |
| `+0x20` | 4 | long ptr | **Sub-pattern pointer table.** Long pointer a una tabella di long entries indicizzate per `sub_index << 2` (sub_index 0..31, 5 bit). Ogni entry e' un "data ptr" letto byte-by-byte; valore `0x80` resetta il pointer (loop dei dati). | `packages/engine/src/render-tile-line-1ad54.ts:246` |
| `+0x24` | 2 | signed word | **Binsearch end index.** `FUN_1A444` calcola `0x40065e = binsearchBasePtr + value*2 - 2`; in pratica e' l'indice/count esclusivo dell'ultima word valida della binsearch table runtime. | `packages/engine/src/tilemap-row-build-1a444.ts:132`<br>MAME PC `0x01A470` |
| `+0x26` | 4 | long ptr | **Binsearch base.** Pointer a terrain-code lookup table. Stored a `0x40065a` dal `level-dispatcher-16ec6`. Letto da `sub-1caba-tile-redraw` come `bsearchBase` per la dispatch di `terrainCode`. | `packages/engine/src/level-dispatcher-16ec6.ts:131`<br>`packages/engine/src/sub-1caba-tile-redraw.ts:376` |
| `+0x2A` | 4 | long ptr | **Extra-byte table.** Source byte di `decodeBitstream1A668` (offset ext stream). | `packages/engine/src/level-init-16f6c.ts:85`<br>`packages/engine/src/refresh-helper-13ee6.ts:261` (`LV_OFF_EXTTB`)<br>`packages/engine/src/slapstic-dispatcher-1344c.ts:176` |

### Note sugli overlap `+0x14..+0x1F`

`object-init-259b4.ts:134` ha:

```ts
const packed = readAbsU16(state, rom, statePtr + 0x14 + i * 2);
```

Indicizzato per entity index `i` su `count` obj. In teoria
`+0x14, +0x16, +0x18, +0x1A, +0x1C, +0x1E` sono usate per entity 0..5.
In pratica solo P1 (i=0, offset `+0x14`) e P2 (i=1, offset `+0x16`)
hanno mai `obj+0x18 == 3` nei path naturali testati. Le run diagnostiche
RAM-only hanno esercitato anche i = 2 e i = 3, ma non i = 4..5 in modo
stabile.

Gli stessi byte sono pero' consumati naturalmente da altri path:

- `+0x18`: **max tile bound** (`sub-1caba-tile-redraw.ts`,
  `string-dispatch-table-177f8.ts`, `FUN_1A444`).
- `+0x1A`: **row-build entry count** (`FUN_1A444`).
- `+0x1C..+0x1F`: **tile-line descriptor table pointer** (`FUN_1A444`).

Quindi le semantiche coesistono perche' il codice originale riusa lo
stesso header per sottosistemi diversi e perche' gli slot entity 2..5 in
stato 3 non sono parte dei path naturali coperti.

**Implicazione per chi vuole aggiungere un livello custom con 3+
entities attive in stato 3**: il valore a `+0x18` deve essere
contemporaneamente un *packed entity init pos* AND un *max tile bound*;
`+0x1A..+0x1F` hanno vincoli equivalenti con row-builder e descriptor
table. Sono semantiche dimensionalmente incompatibili; e' un'asimmetria
del design originale, non un decode-error.

### MAME Phase 2 evidence per `FUN_1A444`

I nuovi field del row-builder sono stati osservati sui 6 livelli con
`oracle/mame_level_header_tap.lua` esteso:

| Level | `+0x08` rowBuildBitListPtr | `+0x1A` rowBuildEntryCount | `+0x1C` tileLineDescriptorPtr | `+0x24` binsearchEndIndex |
| ----- | -------------------------- | -------------------------- | ----------------------------- | ------------------------- |
| L1 | PC `0x01A462` value `0x2C1EA` | PC `0x01A45A` value `0x0042` | PC `0x01A4D0` value `0x2BFD2` | PC `0x01A470` value `0x00A0` |
| L2 | PC `0x01A462` value `0x2C8D8` | PC `0x01A45A` value `0x004F` | PC `0x01A4D0` value `0x2C660` | PC `0x01A470` value `0x03D6` |
| L3 | PC `0x01A462` value `0x2D0BA` | PC `0x01A45A` value `0x0047` | PC `0x01A4D0` value `0x2CE82` | PC `0x01A470` value `0x03D6` |
| L4 | PC `0x01A462` value `0x2D9AC` | PC `0x01A45A` value `0x004E` | PC `0x01A4D0` value `0x2D73C` | PC `0x01A470` value `0x03D6` |
| L5 | PC `0x01A462` value `0x2E28A` | PC `0x01A45A` value `0x006E` | PC `0x01A4D0` value `0x2DF1A` | PC `0x01A470` value `0x03D6` |
| L6 | PC `0x01A462` value `0x2EBC4` | PC `0x01A45A` value `0x0035` | PC `0x01A4D0` value `0x2EA1C` | PC `0x01A470` value `0x03D6` |

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

## Legacy `HeightRecord` parser (post-header block)

Il parser TS storico chiama `records` tutto il blocco dopo `+0x2E` e lo
segmenta a 8 byte. Phase 2 ha verificato che questa e' una
semplificazione legacy: nel blocco post-header ci sono almeno column table,
row-build bit list (`+0x08`), tile-line descriptor table (`+0x1C`) e altre
strutture puntate dal descriptor. Non e' ancora dimostrato un layout unico
di "height records" da 8 byte.

Layout legacy ancora esposto da `HeightRecord`:

| Word | Bits | Field | Status |
| ---- | ---- | ----- | ------ |
| `w0` | `[15:12]` | `slopeOrient` (0..15) | Legacy guess (da `marble-madness-2026`), non ancora MAME-proven |
| `w0` | `[11:8]` | `slopeVal` magnitudo (0..15) | Legacy guess (da `marble-madness-2026`), non ancora MAME-proven |
| `w0` | `[7:0]` | UNKNOWN | — |
| `w1` | full | UNKNOWN | — |
| `w2` | full | UNKNOWN | — |
| `w3` | full | UNKNOWN | — |

Formula fisica supposta legacy:
`z_cell = z_base + (dx * sdx + dy * sdy) * slopeVal`

Non c'e' parity test attivo sui record (solo smoke su `loadLevel`
size). La decode dei word 1-3 resta Open e non va usata come proof di
fisica marble.

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
- `packages/engine/src/tilemap-row-build-1a444.ts` — row-build bit list,
  descriptor count, tile-line descriptor table, binsearch end index.
- `packages/engine/src/rle-expand.ts` — RLE source read.
- `packages/engine/src/helper-121b8.ts` — L5 descriptor match (only).

## Aperture residue (richiedono ROM + MAME + Ghidra)

Per chiudere il PRD ai 7 success criteria, restano:

1. **MAME Lua tap su 6 livelli** — completato per i field header
   consumati in path bootstrap/playable, incluse le nuove letture
   `FUN_1A444`.
2. **Probe ROM dump** — completato con `/tmp/marble-headers.txt`;
   la comparazione tap-vs-probe e' `/tmp/marble-headers-vs-tap.diff`.
3. **Entity init pos 4..5** — UNKNOWN-verified per uso entity nei path
   testati. Il codice `FUN_259B4` li puo' indicizzare sintatticamente, ma
   non sono stati osservati in path naturali; una run diagnostica
   `MARBLE_LEVEL_TAP_FORCE_ENTITY_INIT_COUNT=6` su L1
   (`/tmp/marble-level-header-tap-L1-entities6.log`) ha comunque prodotto
   read solo per `entityInitPos_0..3`. I byte `+0x1C..+0x1F` sono invece
   consumati naturalmente e decodati come `tileLineDescriptorPtr`.
4. **Decode word 1-3 dei legacy `HeightRecord`**. Richiede una nuova
   prova MAME/disasm sul formato post-header effettivo; il PRD originale
   puntava alla fisica marble (`helper-1cd00.ts`, `bbox-hit-test-19d94.ts`),
   ma questi consumer non leggono direttamente il blocco post-header.
5. **Parity test musashi-wasm** — completato con
   `packages/cli/src/test-level-header-decode-parity.ts`:
   `FUN_16EC6`, `FUN_16F6C`, `FUN_259B4` sono 500/500 nei file
   `runs/level-header-parity-{16ec6,16f6c,259b4}.txt`.
6. **Doc finale link** — completato in `docs/findings/README.md` con la
   voce "Level descriptor header format".

## Implicazioni per "aggiungere un livello custom"

Con la decode Phase 2, un livello custom valido **deve fornire**:

- `+0x00` (long): pointer a un blob di terrain byte-records.
- `+0x04` (long): pointer a un tile-word table (length = `tableSize` proporzionale al level).
- `+0x08` (long): pointer alla row-build bit list consumata da `FUN_1A444`.
- `+0x0C` (long): pointer a RLE-compressed scroll-row source.
- `+0x10` (signed word): Y scroll base — anchor di partenza.
- `+0x12` (signed word): Y scroll range — usato solo se levelIndex==4.
- `+0x14, +0x16` (packed words): posizione iniziale P1, P2.
- `+0x18` (signed word): max tile bound (column count for the level).
- `+0x1A` (signed word): row-build entry count.
- `+0x1C` (long): pointer alla tile-line descriptor table (descriptor da 8 byte).
- `+0x20` (long): pointer a sub-pattern pointer table.
- `+0x24` (signed word): binsearch end index.
- `+0x26` (long): pointer a binsearch base (terrain-code LUT).
- `+0x2A` (long): pointer a extra-byte table.
- `+0x2E..` (long[]): per-column terrain table.
- strutture post-header puntate dai field sopra; non assumere un unico
  array di height record da 8 byte senza proof.

Strategie di iniezione (vedi `docs/level-header-decode-prd.md` "Inserimento"):

- **Strategia A**: estendere il blob ROM con la pointer table aggiornata. Richiede gestire la slapstic window se il livello include terrain records nel range `0x80000-0x87FFF`.
- **Strategia B**: intercettare `initLevelLoad1A236` (`packages/engine/src/init-level-load-1a236.ts:129-173`) con una callback custom che scrive `*0x400474` puntando a un blob TS sintetico (in workRam o memoria virtuale). Piu' pulito, no slapstic interference.
