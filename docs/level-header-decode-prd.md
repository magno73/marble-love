# PRD — Decode completo del Level Descriptor Header

> Task per AI agent (Codex / Claude Code in worktree isolato).
> Branch consigliato: `codex/level-header-decode`.
> Prerequisito: leggere integralmente `docs/agent-briefing.md` e `CLAUDE.md`
> (12-rule). Rule 12 (fail loud) e Rule 1 (think before coding) sono critiche
> qui — questo task richiede reverse engineering con incertezza alta, non
> replica meccanica.

## Contesto

Marble Love e' un porting TypeScript bit-perfect del binario arcade originale
di Marble Madness (Atari, 1984; Atari System 1; M68010 main + 6502 audio).
Ground truth = ROM originali. Oracolo di misura = MAME via musashi-wasm e
Lua taps. La pipeline di verifica e' descritta in `docs/codex-prd.md` e
`docs/agent-briefing.md`.

I sei livelli del gioco sono codificati come record binari in ROM, puntati
da una pointer table a `0x2BE00`. Ogni livello inizia con un **descriptor
header** seguito da N **height records** di 8 byte ciascuno. Il parser di
base e' in `packages/engine/src/level.ts`, ma la **decode del header e
delle word non-slope dei record e' incompleta**.

Questo PRD chiude quel gap.

## Stato corrente

### Pointer table (verificata)

`packages/engine/src/level.ts:6-12` — pointer table a `0x2BE00`, 6 × u32 BE:

| Idx | Level             | ROM offset |
| --- | ----------------- | ---------- |
| 0   | Practice          | `0x2BEE2`  |
| 1   | Beginner          | `0x2C54C`  |
| 2   | Intermediate      | `0x2CD9E`  |
| 3   | Aerial            | `0x2D648`  |
| 4   | Silly             | `0x2DE1E`  |
| 5   | Ultimate          | `0x2E790`  |

### Offset del header gia' identificati

Letti grep-ando `statePtr + 0x` nei consumer engine. Confermati da:

- `packages/engine/src/level-dispatcher-16ec6.ts:107-141` (`FUN_16EC6`)
- `packages/engine/src/level-init-16f6c.ts:65-113` (`FUN_16F6C`)
- `packages/engine/src/object-init-259b4.ts:124-149` (`FUN_259B4`)

| Offset       | Size | Consumer                          | Meaning (verified)                                      |
| ------------ | ---- | --------------------------------- | ------------------------------------------------------- |
| `+0x04`      | long | `level-init-16f6c.ts:84`          | Pointer to **ctrlList** (bitstream control words)       |
| `+0x10`      | word | `level-dispatcher-16ec6.ts:137`   | **Level timer** (sign-extended), bonus seconds          |
| `+0x12`      | word | `level-dispatcher-16ec6.ts:139`<br>`level-init-16f6c.ts:90` | **Aerial bonus** (added when level==4 / Aerial), also **row-offset** (`asr #3 -1`) for ctrl/ext list start on Aerial |
| `+0x14..0x1F` | 6 word | `object-init-259b4.ts:134`        | **Entity initial position** packed per entity i: `hi=vx>>8, lo=vy>>8`. Indexed `+0x14 + i*2` per entity slot i (0..5 = 6 entities) |
| `+0x26`      | long | `level-dispatcher-16ec6.ts:131`   | Pointer to **binsearch base** (probably tile-graphic LUT) |
| `+0x2A`      | long | `level-init-16f6c.ts:85`          | Pointer to **extList** (bitstream ext bytes)            |

### Costanti gia' codificate ma sospette

`packages/engine/src/level.ts:29`:

```ts
export const LEVEL_HEADER_SIZE = 36 as const;
```

**Sospetta:** `+0x2A` (ultimo pointer noto) finisce a byte `+0x2D`. Quindi
il header e' >=46 byte, non 36. La costante e' un best-guess preso da un
progetto precedente (`marble-madness-2026`) e non e' mai stata verificata
su Marble Love. Vedi `level.ts:14-21` per il caveat originale.

### Height record (parzialmente decodato)

`packages/engine/src/level.ts:108-123`. 8 byte = 4 word BE:

| Word    | Meaning                                |
| ------- | -------------------------------------- |
| `w0[15:12]` | `slopeOrient` (0..15) — verified guess |
| `w0[11:8]`  | `slopeVal` magnitudo (0..15) — verified guess |
| `w0[7:0]`   | **UNKNOWN**                            |
| `w1`        | **UNKNOWN**                            |
| `w2`        | **UNKNOWN**                            |
| `w3`        | **UNKNOWN**                            |

Formula fisica supposta (`level.ts:42`):
`z_cell = z_base + (dx*sdx + dy*sdy) * slopeVal`

Non c'e' parity test attivo sui record. La formula e' presa dal progetto
precedente.

## Goal del task

Chiudere il reverse engineering del **descriptor header completo** e dei
**word non-slope dei height record** per tutti e 6 i livelli, con
verifica differenziale.

### Deliverable

1. **Documento `docs/level-header-format.md`** che descrive:
   - Layout byte-per-byte del header (offset, size, type, semantic, consumer).
   - Layout byte-per-byte del height record (4 word).
   - Per ogni campo: lista dei consumer (file + line) e parity test
     associato.
   - Esempi concreti per i 6 livelli (i 6 header dumped con annotation).

2. **Aggiornamento `packages/engine/src/level.ts`**:
   - `LEVEL_HEADER_SIZE` aggiornato al valore reale verificato.
   - `interface LevelHeader` con campi tipizzati (non solo `raw: Uint8Array`).
   - `interface HeightRecord` con campi tipizzati al posto di word0..word3
     opachi.
   - Decode function complete `decodeLevelHeader()` e `decodeHeightRecord()`.

3. **Parity test** (`packages/engine/test/level-header-decode.test.ts`):
   - Per ogni campo identificato: smoke test che legge i 6 header reali
     e verifica che il valore decoded coincida con il comportamento
     osservato nei consumer engine bit-perfect (gia' verificati 100%).
   - Negative test su offset finora UNKNOWN: documento esplicito
     "non consumato da nessun path osservato in attract f12000-12099"
     se nessun consumer e' trovato.

4. **Probe CLI** (`packages/cli/src/probe-level-header.ts`):
   - Stampa tabella formattata dei 6 header, con campi nominati.
   - Stampa heuristics per i record: distribuzione `slopeOrient`,
     range `w1/w2/w3`, eventuali pattern.

### Non-deliverable (out of scope)

- Editor di livelli. Solo *lettura* + *decode* + *documentazione*.
- Replica della formula fisica del marble (z_cell, collision). Solo
  identificare i campi del record. La fisica reale e' in
  `helper-1cd00.ts`, `bbox-hit-test-19d94.ts`, e tocca un track separato.
- Modifica di sub-routine engine gia' bit-perfect. Se la tua decode
  contraddice un consumer gia' verificato 500/500, **stop e fail loud**:
  significa che la tua decode e' sbagliata, non il consumer.

## Metodo

Workflow di scoperta **differential**, non guessing.

### Passo 1 — Inventario consumer

Per ogni candidato consumer del header, fai grep esaustivo:

```bash
grep -rn "statePtr + 0x\|levelPtr + 0x\|descriptorPtr + 0x" \
  /home/user/marble-love/packages/engine/src/ \
  | grep -v test
```

Verifica anche il path ROM diretto via Ghidra:

```bash
# In ghidra_project/dump_*.txt, cerca xref a 0x2BEE2 + offset
grep -E "0x0002be|0x0002c5|0x0002cd|0x0002d6|0x0002de|0x0002e7" \
  ghidra_project/dump_*.txt
```

Deliverable di questo passo: lista esaustiva di tutti gli offset toccati
nel codice TS e nel disassemblato ROM. Confrontala con la tabella
"Offset gia' identificati" sopra — eventuali nuovi offset trovati sono
field non documentati da chiudere.

### Passo 2 — Per ogni offset UNKNOWN, formula ipotesi falsificabile

Esempio: `+0x08` (word). Ipotesi candidate:
- (a) Counter di entity (numero di marble nemiche).
- (b) Sub-level ID per palette init.
- (c) Bonus secondario non documentato.

Per ognuna: formula un comportamento osservabile dalla MAME tap.
Esempio per (a): *"Se +0x08 = N, allora al frame N post-start ci sono
esattamente N obj con obj+0x18=3 (active=type 3 = nemica)."*

Se non riesci a formulare un test osservabile per un'ipotesi, **scarta
l'ipotesi**, non testarla. Rule 5 (use model only for judgment).

### Passo 3 — Verifica via MAME tap + disasm

Per ogni offset candidato, scrivi un Lua tap MAME che logga read/write
all'address `levelPtr + offset` durante una run scriptata dei 6 livelli.

Template tap (modifica da `oracle/mame_dumper.lua`):

```lua
-- Esempio: tap su read di levelPtr+0x08
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]

local level_offsets = { 0x2BEE2, 0x2C54C, 0x2CD9E, 0x2D648, 0x2DE1E, 0x2E790 }
for _, base in ipairs(level_offsets) do
  space:install_read_tap(base + 0x08, base + 0x09,
    "level_header_0x08_read",
    function(offset, data, mask)
      local pc = cpu.state["PC"].value
      print(string.format("READ 0x%06x = 0x%04x from PC=0x%06x (level=%d)",
        offset, data, pc, ...))
    end)
end
```

Esegui sui 6 livelli (`oracle/run-mame.sh` + `MARBLE_PLAYABLE_BOOTSTRAP_TARGET_LEVEL=1..6`
documentato in `docs/archive/readme-status-2026-05-18/README.full.md:166-176`)
e cattura le finestre di PC che leggono ogni offset. Quei PC sono i
consumer da reversare in Ghidra.

### Passo 4 — Disasm dei consumer

Per ogni PC consumer identificato dal tap, dump del disasm Ghidra:

```bash
tools/ghidra_dump_range.py <PC> <PC+0x40>
```

Leggi il codice 68010, capisci come il valore viene usato (math, branch,
indirect, store), e dichiara la semantica del campo. **Includi il
disassemblato citato nel doc finale** (5-15 righe per campo).

### Passo 5 — Parity test

Per ogni campo decoded:

1. Scrivi una funzione di decode `decodeFieldX(header: Uint8Array): T`.
2. Test smoke: i 6 livelli reali producono valori che combaciano col
   tap MAME.
3. Test parity contro musashi-wasm se il consumer e' isolabile (es. una
   sub piccola che legge solo quel campo): 500/500 random inputs.
4. Test negativo: il valore alterato fa fallire il consumer in un modo
   osservabile (es. timer sbagliato → MAME diverge a frame N).

## Tooling esistente

Vedi `docs/agent-briefing.md` sezione 11 per inventario completo. Quelli
rilevanti per questo task:

- `tools/ghidra_dump_range.py` — dump disasm di range.
- `tools/ghidra_disasm_at.py` — force-disasm + analysis a indirizzi
  specifici.
- `oracle/mame_dumper.lua` — template Lua per write/read taps.
- `oracle/run-mame.sh` — wrapper headless MAME.
- `packages/cli/src/probe-*.ts` — esempi di probe diagnostici.
- `packages/cli/src/test-*-parity.ts` — esempi di parity test
  musashi-wasm.
- `ghidra_project/dump_xrefs_*.txt` — xref dump precalcolati.

ROM file path locale: `roms/marble.zip` + `roms/atarisy1.zip`. Blob
disassemblabile: `ghidra_project/marble_program.bin` (generato da
`tools/rom_prep.py`).

## Constraints

### File modificabili

| File                                                | Modifica? |
| --------------------------------------------------- | --------- |
| `packages/engine/src/level.ts`                      | si (e' il target principale) |
| `packages/engine/src/index.ts`                      | una riga di export (in fondo) |
| `packages/engine/test/level-header-decode.test.ts`  | si (file nuovo) |
| `packages/cli/src/probe-level-header.ts`            | si (file nuovo) |
| `docs/level-header-format.md`                       | si (file nuovo) |
| Consumer gia' bit-perfect (`level-dispatcher-16ec6.ts`, `level-init-16f6c.ts`, `object-init-259b4.ts`) | NO. Se la tua decode contraddice il loro comportamento, la decode e' sbagliata. |
| `state.ts`, `main-tick.ts`, `boot-init.ts`          | NO |
| `STATUS.md`, `README.md`                            | NO |

### Guardrail di non-regressione

Prima di iniziare e prima di committare:

```bash
npm run typecheck
npm run test --silent
npx tsx packages/cli/src/probe-cluster-histogram.ts | head -1
npx tsx packages/cli/src/probe-100f-diff.ts | grep "obj0.x"
```

Tutti devono restare verdi/invariati:

- `npm test`: 1982/1982 pass (vedi `agent-briefing.md` sezione 13).
- `obj0.x bit-perfect 99/99` MAME.
- Drift workRam @ f+99 invariato rispetto alla baseline corrente
  (`total=172 | gameplay=0 | stack-residue=172` su `origin/main` `0edb629`;
  il vecchio `387B/215B` del briefing e' stale).

Se uno di questi degrada, hai introdotto regressione: **rollback,
non avanzare**.

### Comportamento atteso quando incerto

Rule 12 (fail loud) e' OBBLIGATORIA qui. Se un campo del header non
ha consumer osservato in nessun tap MAME ne' xref Ghidra, NON inventare
una semantica. Documenta come:

```md
+0x08 (word) — UNKNOWN
- Nessun read osservato in tap MAME su run scriptata dei 6 livelli
  attract + playable.
- Nessun xref Ghidra a 0x2BEEA / 0x2C554 / ecc.
- Possibili interpretazioni: padding, riservato, used by post-attract
  paths non testati.
- Status: open. Non decoded.
```

**Un campo onestamente "UNKNOWN" e' un deliverable valido.** Un campo
con semantica inventata e non verificata e' un bug da rollback.

### Tooling vietato in questo task

- **NO patch al binario** per testare ipotesi (es. modificare un byte
  del header in ROM live e vedere cosa succede in MAME). Tecnica utile
  ma fuori scope: contamina il workflow e puo' produrre artefatti
  non-replicabili. Usa solo letture / taps / xref.
- **NO modifica di parity test esistenti** per "farli passare" se la
  tua decode rompe la loro assumption. I parity esistenti sono ground
  truth.

## Success criteria

Il task e' completato quando, in ordine:

1. **Disasm verified**: ogni offset del header documentato ha almeno un
   consumer M68010 disassemblato e citato nel doc (`level-header-format.md`).
2. **Tap verified**: per ogni offset *consumato*, c'e' una run MAME
   scriptata che logga il read e i valori coincidono con quanto la
   decode TS produce sui 6 ROM header reali.
3. **Parity locked**: i 3 consumer engine attualmente bit-perfect
   (`FUN_16EC6`, `FUN_16F6C`, `FUN_259B4`) restano 500/500 dopo il
   refactor di `LevelHeader` e `HeightRecord`.
4. **Doc completo**: `docs/level-header-format.md` esiste, e' linkato
   da `docs/findings/README.md` (se sale a livello di finding) o da
   `STATUS.md` (se task chiuso routine), e include la tabella offset
   completa con citation file:line.
5. **Test nuovi verdi**: `packages/engine/test/level-header-decode.test.ts`
   e `packages/cli/src/probe-level-header.ts` girano senza errori.
6. **Suite verde**: `npm test` e' 1982 + N nuovi pass, drift e obj0.x
   invariati.
7. **Bytes UNKNOWN onesti**: se restano byte non decoded, sono
   esplicitamente marcati UNKNOWN con motivazione (no xref, no tap,
   no consumer trovato).

## Aspettative di scope

Conservative estimate:
- **Disasm + tap dei consumer noti** (rifinitura field gia' identificati): 1-2 giorni.
- **Identificazione field nuovi** (offset `+0x00..0x03`, `+0x08..0x0F`, `+0x20..0x25`, eventuale tail post-`+0x2D`): 3-7 giorni di tap + disasm.
- **Word non-slope dei record** (`w1`, `w2`, `w3`): 2-5 giorni. Probabili candidati: z_base, neighbor link, surface type — ma sono ipotesi, non verifica.
- **Doc + test + probe**: 1-2 giorni.

Totale ragionevole: **2-3 settimane** di lavoro focalizzato di un agent
o developer. Se l'agent fa stima drasticamente sotto (1-2 giorni),
probabilmente sta saltando la verifica differenziale — flag.

## Rischi noti

1. **Header size variabile per livello.** Possibile che il header non
   sia size-fixed: Aerial (level 4) ha un consumo speciale di `+0x12`
   come row-offset (`level-init-16f6c.ts:90-96`). Verifica esplicitamente
   che i 6 header hanno tutti la stessa lunghezza prima di assumerlo.
2. **Campi usati solo in path post-attract.** Le run MAME canoniche del
   progetto (`f12000-12099` attract) potrebbero non esercitare tutti
   gli use case. Estendi a true-start L1..L6 minimo (vedi
   `STATUS.md` "Livelli Cablate" per i seed) prima di dichiarare un
   campo "non usato".
3. **Confusione descriptor / record / extra tables.** I pointer
   `+0x04`, `+0x26`, `+0x2A` puntano fuori dal blocco descriptor a
   tabelle separate (ctrlList, binsearch, extList). Non includerle
   nel header — sono dati raggiunti via pointer.
4. **Slope formula non verificata.** La formula `z_cell = z_base +
   (dx*sdx + dy*sdy) * slopeVal` e' un'ipotesi. Se reversi i word
   `w1/w2/w3` del record e contraddicono la formula, fail loud e
   documenta — non e' compito di questo PRD fissare la fisica, ma il
   reverse del record puo' implicarla.

## References

- `packages/engine/src/level.ts` — parser corrente (incompleto).
- `packages/engine/src/level-dispatcher-16ec6.ts` — consumer principale
  del header.
- `packages/engine/src/level-init-16f6c.ts` — consumer ctrlList/extList.
- `packages/engine/src/object-init-259b4.ts` — consumer entity init array.
- `docs/agent-briefing.md` — briefing pack per agent (12-rule, tooling).
- `docs/codex-prd.md` — template task agent + non-interferenza rules.
- `docs/findings/README.md` — dove andra' linkato il doc finale.

## Apertura del task per l'agent

Prompt suggerito da incollare al lancio:

> Leggi PRIMA `docs/agent-briefing.md` e `docs/level-header-decode-prd.md`
> integralmente. Il tuo task e' descritto nel PRD. Aderisci alle 12-rule
> (`CLAUDE.md`), in particolare Rule 12 fail-loud e Rule 5 no-judgment-
> by-guessing. Non re-investigare ipotesi gia' falsificate (sezione 3
> del briefing). Non re-testare sub gia' verificate bit-perfect (sezione
> 5). Lavora nel branch `codex/level-header-decode` (o equivalente
> worktree). Quando finisci ogni passo del metodo (1-5), checkpoint
> esplicito con cosa hai verificato e cosa resta UNKNOWN.

## Phase 2 Checkpoints

Status 2026-05-19: D1/D2 completati; D3 parziale; D4 completato.
`FUN_1A444` ha chiuso i vecchi UNKNOWN `+0x08` e `+0x24`, e ha chiarito
gli overlap `+0x1A` e `+0x1C`. MAME tap phase2 sui 6 livelli:
`/tmp/marble-level-header-tap-phase2-L{1..6}.log`; comparazione raw
ROM-vs-tap: `/tmp/marble-headers-vs-tap-phase2.diff` con
`checked=2943 mismatches=0`.

Entity-init slot 4..5: UNKNOWN-verified per uso entity nei path testati.
La run diagnostica `/tmp/marble-level-header-tap-L1-entities6.log` ha
forzato `MARBLE_LEVEL_TAP_FORCE_ENTITY_INIT_COUNT=6`, ma il ROM consumer
`FUN_259B4` ha comunque letto solo `entityInitPos_0..3`. I byte
`+0x1C..+0x1F` restano decodati come `tileLineDescriptorPtr`.

D4 parity artifacts:

- `runs/level-header-parity-16ec6.txt`: `Match: 500/500 = 100.0%`.
- `runs/level-header-parity-16f6c.txt`: `Match: 500/500 = 100.0%`.
- `runs/level-header-parity-259b4.txt`: `Match: 500/500 = 100.0%`.

Resta grigio per Rule 12: legacy `HeightRecord` post-header. I target
indicati dal PRD (`FUN_121B8`, `FUN_1CD00`, `FUN_19D94`) non hanno mostrato
read diretti del blocco post-header; non viene inventata semantica per
`word1..word3`.

D5 validation: completato dopo la correzione dei failure baseline presenti
anche su `origin/main` (`0edb629`) e dell'hang in
`integration-playfield-chain.test.ts` causato da caricamento ROM senza
`loadRomBlob`.

Gate eseguiti:

- `npm run typecheck` -> PASS.
- `npm run test --silent` -> PASS, `255 passed | 3 skipped` test files,
  `2206 passed | 17 skipped` tests.
- `npx tsc -b` -> PASS.
- `npm run lint` -> PASS.
- `npx eslint packages/` -> PASS.
- `npx tsx packages/cli/src/test-level-header-decode-parity.ts 500` ->
  PASS per `16ec6`, `16f6c`, `259b4`.
- `/tmp/mame_100f.json` rigenerato con `oracle/mame_state_multidump.lua`
  su frame `12000..12099`; `probe-cluster-histogram.ts` -> `total=172 |
  gameplay=0 | stack-residue=172`. Lo stesso valore e' stato verificato su
  `origin/main` (`0edb629`), quindi il vecchio atteso `387/215` del briefing
  e' stale rispetto alla baseline corrente, non una regressione di questo
  branch.
- `probe-100f-diff.ts | grep "obj0.x"` -> tutti i checkpoint stampati,
  incluso `f+99`, restano `TS == MAME`.
