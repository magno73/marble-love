# Level Descriptor Header — Format Reference

> Verifica statica del formato del descriptor header dei sei livelli di
> Marble Madness, estratto dai consumer engine TS gia' verificati
> bit-perfect contro il binario originale. Scope: PRD
> `docs/level-header-decode-prd.md`, Phase 2 tap/decode.
>
> **Status**: Phase 2 tap/probe/parity completati per i field header
> consumati; follow-up post-header/terrain-code decode completato. Il vecchio
> `HeightRecord` resta solo come vista legacy compatibile, non come formato
> geometrico verificato.

## Sommario

Il **level descriptor** e' una struct in ROM puntata da `*0x400474`
(level pointer). La pointer table @ ROM `0x2BE00` contiene 6 puntatori
long BE — uno per livello. La struct ha **header fisso da 0x2E byte**
seguito da un corpo post-header composto da piu' strutture distinte:
terrain row pointer table, sub-pattern pointer table, tile-line descriptors,
row-build script e RLE row offsets. Il vecchio nome `HeightRecord` nel parser
TS e' legacy: la segmentazione post-header a blocchi da 8 byte non e' un
record geometrico uniforme.

Costanti gia' codificate:

| Costante | Valore | File |
| -------- | ------ | ---- |
| `LEVEL_POINTER_TABLE_OFFSET` | `0x2BE00` | `packages/engine/src/level.ts:31` |
| `LEVEL_COUNT` | `6` | `packages/engine/src/level.ts:32` |
| `LEVEL_HEADER_SIZE` | `0x2E` | `packages/engine/src/level.ts:34` (aggiornato da `36` = `0x24` errato pre-Phase 1) |
| `HEIGHT_RECORD_SIZE` | `8` | `packages/engine/src/level.ts:35` |
| `TERRAIN_COEFFICIENT_TABLE_OFFSET` | `0x1ED62` | `packages/engine/src/level.ts` + `packages/engine/src/sub-1caba-tile-redraw.ts` |

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

## Corpo post-header decodato

`packages/engine/src/level.ts` espone ora `LevelData.postHeader`, una vista
consumer-backed del blocco dopo il fixed header:

| Struct | Range / origine | Layout | Consumer |
| ------ | --------------- | ------ | -------- |
| `terrainRowPointers` | `levelPtr + 0x2E .. subPatternTablePtr` | long pointers, terminatore word `0xFFFF` | `FUN_264AA` (`packages/engine/src/fun-264aa.ts`) |
| `subPatternPointers` | `subPatternTablePtr .. tileLineDescriptorPtr` | long pointer table indicizzata da `subIndex` | `FUN_1AD54` |
| `tileLineDescriptors` | `tileLineDescriptorPtr .. rowBuildBitListPtr` | descriptor 8-byte; count consumato = `rowBuildEntryCount` | `FUN_1A444` → `FUN_1AD54` |
| `rowBuildScript` | `rowBuildBitListPtr .. rleSourcePtr` | chunk script: bit words, patch records, terminator `0xFFFE/0xFFFF` | `FUN_1A444` |
| `rleRuns` | `rleSourcePtr .. terminatore count=0` | `(count,value)` word pairs; expanded words = `maxTileBound` | `FUN_18FD0` |

Conteggi sui 6 livelli reali:

| Level | row ptrs | sub-pattern ptrs | tile descriptors | row-build chunks | row-build patches | RLE runs / words |
| ----- | -------- | ---------------- | ---------------- | ---------------- | ----------------- | ---------------- |
| L1 | 36 | 12 | 66 decoded / 67 physical | 7 | 12 | 3 / 160 |
| L2 | 36 | 21 | 79 / 79 | 9 | 20 | 6 / 216 |
| L3 | 36 | 9 | 71 / 71 | 8 | 110 | 5 / 192 |
| L4 | 36 | 13 | 78 / 78 | 9 | 0 | 5 / 216 |
| L5 | 36 | 15 | 110 / 110 | 10 | 0 | 11 / 238 |
| L6 | 144 | 7 | 53 / 53 | 9 | 272 | 4 / 200 |

I conteggi sono bloccati da `packages/engine/test/level.test.ts`.

### Terrain row pointer table a `+0x2E..`

Inizia immediatamente dopo il fixed header. Entries long (4 byte
ciascuna) e terminatore word `0xFFFF`. E' usata da `fun-264aa.ts:244`
con un offset runtime signed in `0x40045C`:

```ts
const levelHeader = rlWork(state, WR_LEVEL_HEADER_PTR);
let levelTablePtr = (
  s16(rwWork(state, WR_LEVEL_Y_BASE)) +
  ((levelHeader + 0x2e + (s16(startCol) << 2)) >>> 0) -
  4
) >>> 0;
```

Ogni entry e' un long pointer a row-base data. Non va interpretata come
semplice `entry[col]` in ogni path, perche' `0x40045C` puo' spostare la base
logica del lookup.

### Tile-line descriptor 8-byte

Decodato da `packages/engine/src/render-tile-line-1ad54.ts` e ora esposto nel
parser:

| Byte | Field | Semantica |
| ---- | ----- | --------- |
| `0` | `xBase` | signed byte |
| `1` | `xCount` | unsigned byte |
| `2` | `yBase` | signed byte |
| `3` | `yCount` | unsigned byte |
| `4..5` | `flagsWord` | flags/mode base e valore usato nel dato scritto |
| `6` | `extraByte` | bit flags + `subIndex = extra & 0x1F` |
| `7` | `lookupByte` | `directionIndex = lookup & 7`, `subMode = bit 3` |

### Row-build script

`FUN_1A444` legge da `rowBuildBitListPtr` un mini-script per chunk verticali:

1. `ceil(rowBuildEntryCount / 16)` bit words. Ogni bit e' passato come flag
   a `FUN_1AD54` per il descriptor corrispondente.
2. Zero o piu' patch records: `cellWord`, `valueWord`.
   `cellWord` codifica `row = high byte`, `col = low byte`; il consumer scrive
   `valueWord` nel buffer scratch tilemap.
3. Terminatore `0xFFFE` per continuare al chunk successivo, `0xFFFF` per fine
   script. Nei sei livelli reali l'end pointer coincide sempre con
   `rleSourcePtr`.

### RLE row offsets

`FUN_18FD0` espande `(count,value)` word pairs in `0x400478+` finche'
`count == 0`. Per ogni livello il totale `sum(count)` coincide con
`maxTileBound`.

## Terrain code format (`FUN_1CABA`)

La fisica/proiezione terreno live non legge i legacy `HeightRecord`.
Il path reale e':

```text
playfield bits -> binsearch table (`+0x26`) -> terrainCode
terrainCode + directTerrainPtr/alt table/coefficient table -> STRUCT 0x401c28
STRUCT 0x401c28 -> FUN_1CC62 -> projection/z
```

`packages/engine/src/level.ts` espone `decodeTerrainCode()` e
`decodeDirectTerrainByteRecord()` per questa codifica.

| Range | Kind | Semantica |
| ----- | ---- | --------- |
| `0x0000` | `empty` | `FUN_1CABA` scrive quattro sample zero. |
| `0x0001..0x07FF` | `direct` | offset dentro `directTerrainPtr`; record 4 byte. Ogni byte 0 produce sample 0, altrimenti `byte + (columnBaseWord - 0x80)`. |
| `0x0800..0x0FFF` | `indirect` | `code & 0x7FE` indicizza la alt bsearch table runtime `0x40076E`; il valore letto viene redispatchato. |
| `0x1000..0xEFFF` | `quad` | `baseHeightDelta = (code & 0x7F) - 0x40`; `coefficientIndex = ((code >>> 6) & 0x3E) / 2`; sample mask = high nibble bits 12..15. Bit set usa base height, bit clear usa alternative height. |
| `0xF000..0xFFFF` | `flat` | quattro sample uguali a `columnBaseWord + baseHeightDelta`. |

La coefficient table e' ROM `0x1ED62`, 32 word. Il valore speciale
`0x1000` produce alternative height zero; altrimenti:

```text
base = columnBaseWord + ((code & 0x7F) - 0x40)
alt  = base - coefficientWord
```

## Legacy `HeightRecord` parser (compat only)

Il parser TS storico chiama `records` tutto il blocco dopo `+0x2E` e lo
segmenta a 8 byte. Il follow-up post-header ha chiuso il punto: quel blocco
non e' un array geometrico uniforme. Contiene le strutture elencate sopra e
la fisica/proiezione live passa da `terrainCode` + `FUN_1CABA`.

Layout legacy ancora esposto da `HeightRecord`:

| Word | Bits | Field | Status |
| ---- | ---- | ----- | ------ |
| `w0` | `[15:12]` | legacy `slopeOrient` | Deprecated; artifact della segmentazione a 8 byte |
| `w0` | `[11:8]` | legacy `slopeVal` | Deprecated; artifact della segmentazione a 8 byte |
| `w0` | `[7:0]` | raw byte | Non geometria verificata |
| `w1` | full | raw word | Non geometria verificata |
| `w2` | full | raw word | Non geometria verificata |
| `w3` | full | raw word | Non geometria verificata |

Formula fisica supposta legacy:
`z_cell = z_base + (dx * sdx + dy * sdy) * slopeVal`

La formula non e' usata come proof di fisica marble. Le correzioni a salite,
collisioni o floating devono partire dal path `terrainCode`/`FUN_1CABA` e
dalla struct `0x401c28`, non da `HeightRecord.word1..word3`.

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

## Aperture residue

Stato dopo il follow-up post-header/terrain-code:

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
4. **Legacy `HeightRecord.word1..word3`** — chiuso come non-formato:
   sono raw words derivati da una segmentazione obsoleta. Il formato
   verificato e' `LevelData.postHeader` + `terrainCode`.
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
- `+0x2E..subPatternTablePtr`: terrain row pointer table, long entries,
  terminatore `0xFFFF`.
- `subPatternTablePtr..tileLineDescriptorPtr`: sub-pattern pointer table.
- `tileLineDescriptorPtr..rowBuildBitListPtr`: tile-line descriptors 8-byte.
- `rowBuildBitListPtr..rleSourcePtr`: row-build script.
- `rleSourcePtr..count=0`: RLE row offsets.
- binsearch table (`+0x26`) con terrain codes nei range documentati sopra.

Strategie di iniezione (vedi `docs/level-header-decode-prd.md` "Inserimento"):

- **Strategia A**: estendere il blob ROM con la pointer table aggiornata. Richiede gestire la slapstic window se il livello include terrain records nel range `0x80000-0x87FFF`.
- **Strategia B**: intercettare `initLevelLoad1A236` (`packages/engine/src/init-level-load-1a236.ts:129-173`) con una callback custom che scrive `*0x400474` puntando a un blob TS sintetico (in workRam o memoria virtuale). Piu' pulito, no slapstic interference.
