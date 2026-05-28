# PRD: Riduzione Context Bloat Per Agenti AI

## Obiettivo

Rendere `marble-love` lavorabile da agenti AI per sessioni piu' lunghe e piu'
affidabili, riducendo il contesto caricato automaticamente, impedendo letture
accidentali di artifact enormi e separando istruzioni operative, stato corrente
e cronologia investigativa.

Il problema da risolvere non e' solo la dimensione fisica del repository: e'
il fatto che gli agenti leggono o rileggono file troppo lunghi, output
diagnostici, JSON oracle, screenshot e diari storici dopo ogni compaction.

## Stato Di Partenza Misurato

Snapshot locale del 2026-05-20:

- repo root: `/Users/magnus-bot/Code/marble-love`
- dimensione totale: `1.8G`
- file tracciati Git: `1171`
- file TypeScript tracciati: `951`, circa `222k` righe
- JSON tracciati: `86`, circa `2.48M` parole se letti interi
- `.claude/worktrees`: `966M`, 19 worktree
- `node_modules`: `534M`
- `packages/web/public/scenarios`: `80M`
- `oracle/scenarios`: `97M`
- `oracle/tom_harte_m68000`: `22M`
- `packages/web/dist`: `87M`
- `screenshots`: `12M`, non attualmente escluso da `rg --files`
- `GOAL.md`: circa `957` righe e `5819` parole

## Principi

1. Le istruzioni sempre caricate devono essere brevi, stabili e applicabili a
   quasi ogni task.
2. La cronologia lunga non deve stare nei file letti a inizio sessione.
3. Gli artifact grandi devono essere esclusi dalla normale esplorazione testuale.
4. Ogni task deve dichiarare quali file leggere e quali non leggere.
5. Le proof MAME/oracle devono passare da probe mirati, manifest piccoli o
   comandi `jq`, non da lettura integrale di snapshot JSON.
6. Nessuna modifica deve cancellare lavoro sporco o untracked senza conferma
   esplicita dell'utente.

## Non Obiettivi

- Non riscrivere gameplay, renderer, oracle o test di parita'.
- Non cancellare `.claude/worktrees`, `screenshots`, seed o capture esistenti.
- Non cambiare policy legali su ROM o asset.
- Non introdurre nuove dipendenze npm.
- Non fare refactor architetturali del motore.

## Deliverable

### D1: `AGENTS.md` Root Compatto

Creare `AGENTS.md` nella root del repo.

Contenuto massimo consigliato: 80-120 righe.

Deve includere:

- root di lavoro: `/Users/magnus-bot/Code/marble-love`
- layout essenziale:
  - `packages/engine`: engine, state, renderer model, audio model, test
  - `packages/web`: Vite/PixiJS, ROM loader, input live, renderer browser
  - `packages/cli`: probe, audit, route search, parity runner
  - `oracle`: script Lua MAME e scenari oracle
  - `harness`: diff/report tooling
  - `docs`: PRD e note tecniche
- comandi base:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test --silent`
  - `npm --workspace @marble-love/web run build`
  - typecheck mirati engine/web/cli
- regole operative:
  - non revertare file sporchi o untracked non propri
  - non leggere JSON grandi per intero
  - non leggere `docs/archive/**` salvo richiesta esplicita
  - non leggere `screenshots/**` come testo
  - usare `rg`, `jq`, `du`, `git ls-files`, `git check-ignore`
  - usare probe/script mirati per oracle e snapshot
- definizione di done:
  - diff controllato
  - test mirati eseguiti
  - eventuali test non eseguiti dichiarati
  - `git diff --check`
  - `git status --short --branch`

Non deve includere cronologia investigativa lunga.

Acceptance:

- `wc -l AGENTS.md` <= 120
- `wc -w AGENTS.md` <= 1200
- un nuovo agente puo' capire layout, comandi e guardrail senza leggere
  `GOAL.md`

### D2: `CLAUDE.md` Allineato

Aggiornare `CLAUDE.md` per evitare divergenza tra Claude e Codex.

Opzione preferita:

- mantenere le regole comportamentali brevi gia' presenti
- aggiungere una sezione breve: "Project context lives in `AGENTS.md`; follow
  it for repo layout, commands, large-file guardrails, and done criteria"
- non importare automaticamente PRD lunghi

Acceptance:

- `CLAUDE.md` resta <= 100 righe
- non contiene cronologia task
- non duplica lunghi blocchi gia' in `AGENTS.md`

### D3: `GOAL.md` Current-Only

Ridurre `GOAL.md` a stato corrente operativo.

Prima di modificarlo:

1. Controllare `git status --short GOAL.md`.
2. Se contiene modifiche non proprie, preservarle.
3. Copiare il contenuto corrente in un archivio:
   `docs/archive/goals/2026-05-20-sprite-goal-full.md`
4. Solo dopo sostituire `GOAL.md` con una versione breve.

Nuovo `GOAL.md` massimo consigliato:

- active goal in 3-5 righe
- current status in 5-10 bullet
- current blockers
- next concrete action
- file specifici da leggere per questo goal
- file da non leggere salvo bisogno esplicito
- done when
- link all'archivio full

Acceptance:

- `wc -l GOAL.md` <= 160
- `wc -w GOAL.md` <= 1200
- cronologia lunga salvata in `docs/archive/goals/`
- nessuna informazione corrente critica persa: deve restare almeno un link al
  PRD sprite e all'archivio full

### D4: Handoff E Task Template

Creare un template per task futuri:

- `docs/task-template.md`

Struttura richiesta:

```md
# Task: <nome>

## Goal

## Context Files To Read

## Do Not Read Unless Needed

## Constraints

## Investigation Commands

## Implementation Plan

## Validation

## Done When

## Handoff Notes
```

Creare anche:

- `docs/context-map.md`

Contenuto:

- mappa compatta dei moduli principali
- entry point piu' importanti
- routine/test frequentemente toccati
- dove si trovano seed, scenario, oracle, screenshot, dist e archive
- quali directory sono artifact/scratch

Acceptance:

- `docs/task-template.md` esiste
- `docs/context-map.md` esiste
- `docs/context-map.md` <= 250 righe
- `AGENTS.md` punta a questi file, ma non li copia per intero

### D5: Istruzioni Scoped Per Directory

Creare istruzioni locali leggere:

- `packages/engine/AGENTS.md`
- `packages/web/AGENTS.md`
- `packages/cli/AGENTS.md`
- `oracle/AGENTS.md`

Ogni file deve stare sotto 80 righe.

Contenuto richiesto per `packages/engine/AGENTS.md`:

- engine e test sono il riferimento per behavior runtime
- routine replicate modellano side effect MAME-specifici
- test mirati consigliati
- vietato cambiare behavior solo per far passare vecchi smoke

Contenuto richiesto per `packages/web/AGENTS.md`:

- frontend Vite/PixiJS
- URL diagnostici principali
- build/typecheck web
- non committare `dist`, cache Vite o ROM
- screenshot solo come artifact, non come contesto testuale

Contenuto richiesto per `packages/cli/AGENTS.md`:

- CLI per probe, audit e route search
- preferire output piccolo, JSON manifest e summary
- non stampare snapshot complete in console

Contenuto richiesto per `oracle/AGENTS.md`:

- MAME e' ground truth
- script Lua e scenario JSON sono sensibili
- non leggere scenari grandi per intero
- usare `jq`, probe o script mirati
- distinguere capture/proof MAME da wiring web

Acceptance:

- i 4 file esistono
- ogni file <= 80 righe
- nessun file contiene cronologia task-specific lunga

### D6: `.gitignore` E Artifact Guardrails

Aggiornare `.gitignore` in modo conservativo.

Aggiunte candidate:

```gitignore
# --- Agent/context artifacts ---
screenshots/
tasks/*/artifacts/
docs/archive/goals/

# --- AI tool caches / temporary outputs ---
.codex/worktrees/
.cursor/
.continue/

# --- Local investigation outputs ---
*.seed.tmp.json
*.probe.tmp.json
```

Prima di aggiungere una regola:

- verificare se esistono file gia' tracciati che matchano:
  `git ls-files <pattern>`
- non ignorare file tracciati senza decidere esplicitamente se rimuoverli dal
  tracking in un PR separato

Nota:

- `docs/archive/goals/` puo' essere ignorato solo se si decide che gli archivi
  goal sono locali. Se invece devono essere condivisi, non ignorarlo.
- Se viene creato `docs/archive/goals/2026-05-20-sprite-goal-full.md` come
  deliverable condiviso, non aggiungere `docs/archive/goals/` a `.gitignore`.

Acceptance:

- `git check-ignore screenshots/foo.png` mostra la regola se `screenshots/`
  viene aggiunto
- `git check-ignore packages/web/dist/foo.js` resta ignorato
- nessun file tracciato importante viene nascosto accidentalmente

### D7: Script Di Audit Contesto

Creare `tools/context_audit.sh`.

Lo script deve stampare:

- dimensione totale repo
- top-level directory size
- numero file da `rg --files`
- numero file tracciati Git
- top 30 file piu' grandi esclusi `.git`, `node_modules`, `.claude`
- top 30 markdown per word count
- top 30 JSON per word count
- stato ignore per artifact principali:
  - `screenshots/foo.png`
  - `packages/web/dist/foo.js`
  - `node_modules/foo`
  - `.claude/worktrees/foo`

Aggiungere script npm:

```json
"context:audit": "bash tools/context_audit.sh"
```

Acceptance:

- `npm run context:audit` passa
- output resta sotto circa 250 righe
- script non usa dipendenze nuove

### D8: Workflow Per Nuovi Task

Aggiornare `README.md` o creare `docs/agent-workflow.md` con una sezione breve.

Workflow richiesto:

1. Avviare una sessione nuova per ogni task non banale.
2. Leggere `AGENTS.md`.
3. Leggere `docs/context-map.md`.
4. Leggere solo i file indicati dal task.
5. Se serve esplorazione larga, prima produrre una research note piccola in
   `/tmp/marble-love/<task>/research.md` o `tasks/<id>/research.md`.
6. Per implementare, partire da una sessione pulita con research note e task.
7. Usare subagent solo per investigazioni parallele e con output summary.
8. Dopo compaction, non rileggere tutto: rileggere solo task, current goal e
   file toccati.

Acceptance:

- workflow documentato in massimo 120 righe
- `AGENTS.md` punta al workflow

## Ordine Di Implementazione

Implementare in questo ordine:

1. Misurare baseline con i comandi sotto.
2. Creare `AGENTS.md`.
3. Allineare `CLAUDE.md`.
4. Creare `docs/context-map.md`.
5. Creare `docs/task-template.md`.
6. Archiviare e ridurre `GOAL.md`.
7. Creare istruzioni scoped in `packages/*/AGENTS.md` e `oracle/AGENTS.md`.
8. Aggiornare `.gitignore` in modo conservativo.
9. Creare `tools/context_audit.sh` e script npm.
10. Documentare workflow agente.
11. Eseguire validazione finale.

## Comandi Baseline

Eseguire prima di iniziare:

```sh
pwd
git status --short --branch
du -sh .
rg --files | wc -l
git ls-files | wc -l
du -sh ./* ./.??* 2>/dev/null | sort -h | tail -80
find . -path './.git' -prune -o -path './node_modules' -prune -o -path './.claude' -prune -o -type f -exec stat -f '%z\t%N' {} + | sort -nr | head -80
git ls-files '*.md' | xargs wc -w | sort -nr | head -40
git ls-files '*.json' | xargs wc -w | sort -nr | head -40
```

## Validazione Finale

Eseguire:

```sh
npm run context:audit
npm run typecheck
git diff --check
git status --short --branch
```

Se `npm run typecheck` fallisce per motivi preesistenti non collegati al PRD,
documentare il fallimento e rieseguire almeno i typecheck mirati non impattati.

Verifiche manuali:

- `AGENTS.md` e `CLAUDE.md` sono brevi.
- `GOAL.md` non e' piu' un diario storico.
- gli archivi lunghi sono raggiungibili tramite link.
- gli agenti hanno una mappa compatta del repo.
- artifact e JSON grandi sono esplicitamente marcati come "non leggere per
  intero".

## Rischi

- Archiviare male `GOAL.md` puo' perdere contesto operativo. Mitigazione:
  salvare full copy prima della riduzione.
- Ignorare `screenshots/` puo' nascondere artifact che qualcuno voleva
  committare. Mitigazione: controllare `git ls-files screenshots` prima.
- Istruzioni troppo lunghe ricreano lo stesso problema. Mitigazione: budget
  rigidi di righe/parole e review del diff.
- Aggiungere troppi documenti puo' confondere gli agenti. Mitigazione:
  `AGENTS.md` deve dire quale file leggere per quale scenario.

## Done When

Il PRD e' completato quando:

- un agente nuovo puo' iniziare leggendo solo `AGENTS.md` e
  `docs/context-map.md`
- `GOAL.md` contiene solo stato corrente e link ad archivio
- directory e file rumorosi sono esclusi o chiaramente marcati
- esiste un template per task futuri
- esiste un audit ripetibile del context bloat
- validazione finale eseguita e risultati riportati
