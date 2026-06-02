# PRD — Marble Love: HN Readiness

**Owner**: Marco Magnocavallo (marco@magno.me)
**Branch base**: `main` @ `71f0f07` (merge of the worm/heuristic gameplay fixes into the PRD branch; original base was `7cb4de8`)
**Target outcome**: il repository regge una submission su Hacker News + un articolo standalone sulla finding dello slapstic, senza che la prima ondata di commentatori trovi gap evidenti di igiene, parità o trasparenza.
**Non-goal**: aggiungere feature di gameplay, chiudere bug noti del gameplay, alzare la copertura di parità del marble o dell'audio. **Tutto il lavoro è di consolidamento, non di funzionalità.**

> **Revision note (audit 2026-06-02).** Il codice è stato riverificato contro lo stato attuale. Correzioni applicate: **W1 era basato su una diagnosi sbagliata** — i "44 test rossi" non sono codice rotto, sono i test che caricano il ROM `ghidra_project/marble_program.bin` (gitignored, copyright, non shippabile): con il ROM presente fallisce **1 solo** test (`l5-silly-race-surface`, bug birds noto), senza il ROM ne falliscono **44 (test) in 9 file** (clone pulito / CI). W1 è stato riscritto di conseguenza. Aggiornati anche i numeri stale (branch 21 non 22, oracle ~120 MB non 97, naming 212/309). Nota: i bug gameplay worm-freeze/music-loop/vacuum sono stati **risolti** dopo la stesura originale → la lista "Known Gameplay Bugs" del README è più corta (rilevante per W4).

---

## Contesto rapido (per un agent senza memoria conversazionale)

Marble Love è una reimplementazione TypeScript di Marble Madness (Atari 1984), portata function-by-function dal binario 68010 contro MAME come oracolo. Lo stato attuale, verificato:

- 727 commit in 9 giorni (20–28 maggio 2026), **21** branch `codex/*` e `claude/*` sul remote.
- La CI esegue **3** test (web). La suite engine ha **2343 test in 258 file**; con il ROM presente fallisce **1 solo** test (`l5-silly-race-surface`, bug birds documentato). **Senza** il ROM `ghidra_project/marble_program.bin` (gitignored → assente su clone pulito / CI) **falliscono 44 test in 9 file** che lo caricano via `readFileSync`. Questo, non "codice rotto", è il vero problema di W1 (vedi W1 riscritto).
- ~120 MB di JSON oracle trackati in git: **97 MB** sotto `oracle/scenarios/` + **22 MB** sotto `oracle/tom_harte_m68000/` (`.git` pesa 44 MB).
- Commenti misti italiano/inglese in `packages/engine/src/*.ts` (modesto: ~8 file con spy-word).
- Naming dei file ancora a indirizzo Ghidra (`state-sub-2678.ts`, `helper-1cd00.ts`, ecc.) per **212 file su 309** in `packages/engine/src` (426/720 su tutto `packages/*/src`).
- Un solo finding pubblicato: `docs/findings/slapstic-prefetch-side-channel.md`.
- Stato dichiarato bene in README ("Known Limitations" + "Known Gameplay Bugs"). **Da preservare** — ma nota che worm-freeze, music-loop e vacuum-sound sono **già risolti**, quindi la lista è più corta della stesura originale.

---

## Guardrail globali (validi per ogni workstream)

1. **Una PR per workstream**, mai un PR omnibus. Branch naming: `claude/hn-ready/<W#>-<slug>`.
2. **Non modificare runtime behavior dell'engine** (gameplay, fisica, rendering, audio, parità). Se una modifica di hygiene rischia di cambiare un byte di output, esce dal scope e chiede review.
3. **Non aggiornare fixture JSON o seed** sotto `oracle/scenarios/`, `packages/web/public/scenarios/`, `oracle/tom_harte_m68000/`. Se un test fallisce perché il fixture è stale, **non** aggiornare il fixture; segnalalo e fermati.
4. **Non skippare test senza issue tracker**. Ogni `.skip` deve avere accanto un commento `// TODO(hn-ready W1): <ragione 1 riga> — see docs/status.md#<anchor>` o equivalente puntatore a STATUS.
5. **Non rinominare file `FUN_xxxxx` se non hai un nome semantico verificato dal disasm-header in cima al file.** I rename ciechi sono peggio del problema.
6. **Conserva i file `AGENTS.md`** e le loro istruzioni esistenti.
7. **Validazione obbligatoria prima di ogni commit**:
   ```
   npm run typecheck
   npx tsc -p packages/engine/tsconfig.json --noEmit
   npx tsc -p packages/web/tsconfig.json --noEmit
   npx tsc -p packages/cli/tsconfig.json --noEmit
   npm --workspace @marble-love/web run build
   git diff --check
   ```
   + i test mirati definiti dal workstream specifico.
8. **No emoji nei sorgenti, nei commit, nei doc**. Mantieni il tono del repo esistente.
9. **Lingua**: codice e doc pubblici in inglese; commit message in inglese; PR description in italiano OK (rivolto a Marco).
10. **Foreground first**: se una PR è bloccata da un fallimento, ferma il workstream e chiedi prima di tentare workaround.

---

## Sequenza e dipendenze

```
W1 (test health) ──┬─> W4 (STATUS.md)
                   ├─> W6 (CPU model doc)
W2 (hygiene)  ─────┘
W3 (lingua) ── parallelo, indipendente
W5 (naming) ── dopo W3 (evita re-touch dei commenti)
W7 (fixtures) ── parallelo, indipendente, ma alto rischio
W8 (2° finding) ── dopo W4 (riusa la matrice)
W9 (video/GIF) ── dopo W1 (vuole CI verde)
W10 (articolo) ── ultimo, riusa tutto il resto
W11 (diff demo) ── opzionale, post-launch
```

Ordine di esecuzione consigliato: **W1 → W2 → W3 → W4 → W5 → W6 → W7 → W8 → W9 → W10**. W11 fuori scope di questo PRD.

---

## W1 — Health della suite di test e CI (ROM-gating)

**Problema (RIDIAGNOSTICATO)**: NON ci sono test "rotti". Misurato: con il ROM presente la suite engine ha **1 solo** fallimento (`l5-silly-race-surface`, bug birds noto/documentato); **senza** il ROM `ghidra_project/marble_program.bin` (gitignored, copyright → assente su ogni clone pulito e in CI) **falliscono 44 test in 9 file** perché lo caricano con `readFileSync` e nessuno ha un guard. Quindi un commentatore HN clona, fa `npm test`, e vede 44 rossi **non perché il codice sia rotto, ma perché manca un ROM che il repo non può legalmente distribuire**. È questo il problema da risolvere.

**In-scope**:
- **Guard ROM**: helper condiviso `packages/engine/test/_rom-fixture.ts` che esporta `ROM_AVAILABLE` (`existsSync` di `ghidra_project/marble_program.bin`) e logga un warning una volta se assente. Applicarlo ai **9 file ROM-dipendenti** (44 test): 7 ALL-ROM via `describe.skipIf(!ROM_AVAILABLE)`, 2 misti (`boot-init` 1/12, `main-tick` 2/13) via `it.skipIf` sui soli test ROM. [FATTO in questo workstream.]
- **Inventario**: `docs/work/hn-ready/test-failures-inventory.md` con i due numeri (1 con ROM / 44 senza) e la lista dei file ROM-gated (working note, non pubblicare).
- **Il fallimento reale** (`l5-silly-race-surface`, birds): `.skip` con `// TODO(hn-ready W1): L5 flying-bird sprite indices diverge — see docs/STATUS.md#known-gaps` (è un Known Gameplay Bug, non una regressione).
- **CI**: estendere `.github/workflows/ci.yml` per eseguire `vitest run packages/engine` — **ma solo dopo il guard ROM**, altrimenti la CI (che non ha il ROM) passerebbe da 3-verdi a 44-rossi. Con il guard, la CI gira il sottoinsieme ROM-free verde + onesto. Target: < 60 s.
- **Documentare la dipendenza dal ROM** in README ("Validation") e CONTRIBUTING: la suite engine completa richiede un ROM locale; senza, i file ROM-gated vengono skippati di proposito.

**Out-of-scope**: aggiornare fixture, modificare logica gameplay/audio, aggiungere nuovi test, committare il ROM.

**Acceptance criteria**:
- Su un clone **senza** ROM: `npx vitest run packages/engine` → **0 failures**, gli unici skip sono i file ROM-gated (con messaggio) + il birds-TODO.
- Su un ambiente **con** ROM: stesso comando → 0 failures, 0 skip oltre il birds-TODO.
- CI di PR + push esegue: typecheck, `vitest run packages/engine` (verde grazie al guard), i 3 test web esistenti, web build, git diff check.
- README "Validation" + CONTRIBUTING allineati sulla dipendenza dal ROM.

**Validazione**: comandi globali + `npx vitest run packages/engine` **due volte** (con e senza il ROM rinominato temporaneamente — entrambe verdi).

**Risk note per l'agent**: NON inseguire i "44 fallimenti" come bug — sono tutti l'assenza del ROM. L'unico fallimento da trattare come bug-noto è `l5-silly-race-surface` (birds), e va **skippato** con TODO, non fixato (è gameplay/runtime — fuori scope). Verifica con: rinomina `ghidra_project/marble_program.bin`, esegui la suite, conta i fallimenti, ripristina il ROM.

---

## W2 — Igiene del repo

**Problema**: 22 branch attive `codex/*`/`claude/*` sul remote, file orfani (è già stato cancellato `physics.ts` in `0e8bba3`, probabilmente ce ne sono altri), nessun controllo automatico per dead exports.

**In-scope**:
1. Eseguire `npx knip --no-exit-code` (o `ts-prune`) sull'intero workspace e produrre `docs/work/hn-ready/dead-code-inventory.md`.
2. Cancellare file/funzioni morte **solo se**:
   - zero referenze cross-file,
   - zero referenze in `package.json exports`,
   - zero referenze in test,
   - il file non contiene disasm-header tracciante con TODO/WIP esplicito (potrebbe essere work-in-progress legittimo).
3. Per ogni cancellazione, un commit separato con commit-message che spiega *perché* è orfano.
4. Branch sul remote: **NON cancellare** branch remote autonomamente. Produrre invece `docs/work/hn-ready/branch-triage.md` con lista delle 22 branch + raccomandazione (keep / merge / close) + ultima data attività. Marco decide cosa cancellare.
5. Aggiungere `knip` (o `ts-prune`) come script `npm run dead-check` in `package.json` root.

**Out-of-scope**: refactor di file vivi, riorganizzazione directory, modifiche all'export map principale di `@marble-love/engine` (`./` entry).

**Acceptance criteria**:
- Inventario file morti scritto.
- Almeno i file *certamente* orfani cancellati con commit indipendenti.
- `npm run dead-check` esiste e produce output utile.
- File triage branch consegnato a Marco.

**Validazione**: comandi globali + `npm run dead-check` esegue.

---

## W3 — Unificazione lingua

**Problema**: doc-comment misti IT/EN nei sorgenti pubblici.

**In-scope**:
- Identificare commenti italiani con uno script grep (parole-spia: `uso tipico`, `fallisce`, `sostituisce`, `simile a`, `esempio`, `con il`, `per ogni`, `quindi`, `però`, `infatti`, `tre fasi`, `non è`).
- Tradurre in inglese conservando contenuto tecnico e header `Disasm 0x.... 0x....`. Mantenere gli indirizzi ROM, i nomi `FUN_xxxxx`, le tabelle in formato originale.
- Inglese tecnico, non letterario.
- Solo file in `packages/*/src/**`, `oracle/**/*.ts`, `harness/**/*.ts`, `docs/**/*.md`. Lasciare in pace `runs/`, fixture, `.md` di working note locali.

**Out-of-scope**: cambiare la sostanza del commento, rinominare identificatori, "migliorare" prosa esistente.

**Acceptance criteria**:
- `grep -rnE "(uso|fallisce|sostituisce|simile a|tre fasi|però|infatti|quindi)" packages/*/src oracle harness docs` ha 0 hit dopo il commit (modulo falsi positivi documentati).
- `git diff --check` pulito.
- Suite test verde (nessun side effect su stringhe runtime — un test che fa `expect(comment).toContain("italiano")` non esiste ed è improbabile, ma verificare).

**Validazione**: comandi globali + grep negativo sopra.

**Risk note**: un commento può documentare un bug che il tester ha lasciato in italiano apposta. Se trovi commenti di tipo `// HACK ...` o `// FIXME ...` in italiano, **non tradurre da solo** — lasciali, segnala in working note, e procedi.

---

## W4 — `STATUS.md` con matrice di parità

**Problema**: il README dichiara "many low-level routines are parity-tested" senza specificare quali. HN vuole la matrice.

**In-scope**: creare `docs/STATUS.md` (linkato dal README) con almeno queste sezioni:

1. **Parity Matrix** — tabella subsystem × parity-claim × evidence × test-id. Esempio di righe attese:
   - Slapstic 137412-103 FSM | Bit-perfect | MAME diff @ f12950 closed | `slapstic-103.test.ts` 27/27
   - Trackball delta read | Behavioral | FUN_1AC18 port | `trackball-input.test.ts`
   - Slope/waypoint attractor | Behavioral | FUN_1815A port + parity probe | `waypoint-list-step-1815a.test.ts`
   - Audio chip writes | Ordered event parity | sound-cmd-tape diff | sound replay tests
   - PCM audio windows | Close but not bit-perfect | window diff tool | `sound-window` probes
   - 68010 cycle timing | Heuristic ±15% | `sub-cycle-costs.ts` | none
   - Tom Harte 68000 CPU fixtures | N/A (not run in engine) | reference only | external

2. **Non-goals dichiarati**: non emuliamo il 68010 a istruzione, non puntiamo a parità PCM bit-perfect game-wide, non sostituiamo MAME come emulatore.
3. **Known gaps**: copia/sincronizza dalla sezione "Known Limitations" + "Known Gameplay Bugs" del README. Una sola fonte di verità (suggerisci di spostare e linkare dal README).
4. **How to verify a claim**: per ogni riga della matrice, comando esatto che il lettore può eseguire per confermarla. Es: `npx vitest run packages/engine/test/slapstic-103.test.ts`.

**Out-of-scope**: rivendicare parità non già documentata, parlare di roadmap o timeline.

**Acceptance criteria**:
- Documento creato, **ogni claim ha un'evidenza linkabile** (commit, finding, test file).
- README linka `docs/STATUS.md` nel header (prima riga sotto il titolo).
- Nessun claim si contraddice con il README o con `docs/sound-system.md` esistente.

**Validazione**: comandi globali. *Inoltre*: l'agent **esegue** i comandi citati nella sezione "How to verify" per ogni riga, e conferma che producano l'output dichiarato. Se uno fallisce, la riga va modificata o rimossa.

**Risk note**: questa è la pagina più importante dell'intero lavoro. Se l'agent non è sicuro di un claim, **rimuovi la riga**, non gonfiarla. Sotto-dichiarare è una scelta strategica, non un bug.

---

## W5 — Naming sweep dei file critici

**Problema**: 250+ file con nomi a indirizzo Ghidra leggono come Ghidra, non come codice.

**In-scope**:
1. Identificare i **top-50 file per centralità** nel grafo di chiamata partendo da `packages/engine/src/main-tick.ts`. Strumento: BFS sul grafo `import` (script ad hoc OK; non aggiungere dipendenze npm).
2. Per ognuno, leggere l'header `Disasm 0xXXXX..0xYYYY` e il commento JSDoc per derivare un **nome semantico** verificato. Esempi:
   - `state-sub-2678.ts` → `state-update-mode-default.ts` (solo se il disasm-header lo giustifica)
   - `helper-12896.ts` → solo se il commento dichiara cosa fa; altrimenti **lascia stare**.
3. Per ogni rinomina, mantenere `// FUN_xxxxx` come alias nell'header del file e nel JSDoc di ogni export per tracciabilità.
4. Aggiornare tutti gli import (TypeScript fa il refactor — verifica con typecheck), gli export in `index.ts`, e l'eventuale entry in `package.json` `exports`.
5. Massimo **20 rinomine per PR**. Una rinomina = 1 commit nel PR.

**Out-of-scope**: rinomine senza giustificazione dal disasm-header, rinomine di identificatori (funzioni, variabili) — solo file. Rinomine in `packages/cli/src/` (basso ROI HN).

**Acceptance criteria**:
- 20–50 file rinominati con nome semantico.
- Ogni file mantiene `FUN_xxxxx` come alias in cima.
- Typecheck verde, tutti i test che erano verdi prima sono verdi dopo.
- README sezione "Repository Layout" non rotta.

**Validazione**: comandi globali + `npx vitest run packages/engine`. *Inoltre*: `git log --follow` su un campione di file rinominati deve mostrare la storia preservata (verifica che `git mv` sia stato usato correttamente, non `rm`+`add`).

**Risk note**: dopo il rename, una singola string-literal con il vecchio path in un test rompe tutto. `grep -r "old-filename" packages/` prima di committare ogni rename.

---

## W6 — Documento di scelta sul modello CPU

**Problema**: l'architettura ibrida (6502 emulato + 68010 hand-port + cycle table ±15%) confonde. Va dichiarata.

**In-scope**:
- Espandere `docs/cpu-config.md` (esistente) con:
  - **Scelta esplicita**: source-level reimplementation, **non** cycle-accurate emulation.
  - Conseguenze: cosa garantiamo (event ordering, byte parity dello state RAM nei punti verificati) e cosa **no** (cycle-accurate timing del bus, race condition rare).
  - Rationale: leggibilità del codice gameplay > velocità di sviluppo dell'emulatore.
  - Tabella mini: per ogni componente, scelta del modello (6502 → instruction emulator; 68010 → hand-port; slapstic → FSM port; YM2151/POKEY → behavioral chip models).
  - Sezione "Future: if we ever want cycle-accurate" con menzione di Musashi-WASM come opzione, *senza commitment*.

**Out-of-scope**: rimuovere `sub-cycle-costs.ts` (rischia di rompere `main-tick.ts`), implementare Musashi-WASM.

**Acceptance criteria**:
- Documento aggiornato, non si contraddice con `docs/STATUS.md` o README.
- Linkato da README e da STATUS.

**Validazione**: comandi globali.

---

## W7 — Relocate dei fixture pesanti

**Problema**: ~120 MB di JSON oracle in git (97 MB `oracle/scenarios/` + 22 MB `oracle/tom_harte_m68000/`) → pack pesa (`.git` ≈ 44 MB), clone lento, commento HN garantito.

**In-scope** (scelta da Marco, default: **opzione B**):

- **Opzione A — LFS**: configurare Git LFS per `oracle/scenarios/**/*.json` e `oracle/tom_harte_m68000/*.json`. Rischio: rewrite della storia del repo per pulire il pack, **non fattibile autonomamente** da un agente. Se Marco sceglie A, l'agente predispone il `.gitattributes` e documenta lo step manuale; **non riscrive la storia**.

- **Opzione B — Repo separato `marble-love-fixtures`**: l'agente **non** crea il nuovo repo (azione esterna). Predispone:
  - Uno script `tools/fetch_fixtures.sh` che scarica i fixture da un URL configurabile (placeholder: `https://github.com/magno73/marble-love-fixtures/releases/...`).
  - Un `.gitignore` che esclude i path dopo la rimozione.
  - Un commit unico che `git rm` i fixture, aggiorna AGENTS/STATUS/README.
  - Documenta lo step "Marco crea il fork repo + carica i fixture" come prerequisito manuale.
  - **NON** spinge il commit di rimozione finché Marco non ha confermato la creazione del repo esterno.

- **Opzione C — Status quo + documentazione**: solo aggiornare `docs/fixture-inventory.md` con spiegazione esplicita del trade-off e renderlo linkato da README.

**Default raccomandato**: C per il lancio HN (più sicuro), B come follow-up post-lancio.

**Out-of-scope**: rewrite della storia git in ogni opzione.

**Acceptance criteria** (per ogni opzione):
- A: `.gitattributes` configurato, doc dello step manuale scritto.
- B: script + doc + commit pronto in branch, **non pushato finché Marco non conferma**.
- C: `fixture-inventory.md` aggiornato, linkato dal README header.

**Validazione**: comandi globali (l'opzione B richiede che `git status` post-commit sia clean e i fixture rimossi non rompano nessun test che non era già rosso).

**Risk note**: B è la più rischiosa. Test e CLI probes potrebbero importare fixture per path relativo. Verifica con `grep -rn "oracle/scenarios" packages/ harness/` prima di rimuovere.

---

## W8 — Secondo finding pubblicato

**Problema**: una sola finding = "fortuna". Due = "metodologia".

**In-scope**:
1. Identificare un candidato dalla storia commit + dai commenti `FIXME`/`HACK`/`AHA` nei sorgenti. Candidati noti:
   - L'inversione di segno condizionata da `*0x400394 == 4` in `trackball-apply.ts` (FUN_25DF6) — perché esiste questa modalità di compensazione e cosa la triggera?
   - La quirk `lsr.w #3 / mulu.w #3` invece di `>>3` in `waypoint-list-step-1815a.ts` — overflow protection? approximation?
   - La cadenza dinamica 30/60Hz del main loop dettata dal cycle budget — quando si triggera e con quale magnitudo è osservabile in MAME? **(Candidato forte, con dato fresco: durante il debug del worm-freeze L5 si è osservato che la logica oggetti avanza ~1 frame ogni ~2 frame video — un wobble da 0x28 step ci mette ~170 frame video ≈ 2.7s. Il timer/contatore che governa la cadenza è già parzialmente isolato in `helper-285b0`/`refresh-frame-10fce`.)**
2. Scrivere `docs/findings/<topic>-<short-desc>.md` seguendo **lo stesso template** dello slapstic finding: TL;DR, Background, Anomaly, Discovery, Fix, Reflections, References, Commits.
3. Aggiungere voce nel `docs/findings/README.md`.
4. Eventuale test di regressione se l'analisi ne rivela uno mancante (max 1 test nuovo).

**Out-of-scope**: aprire un nuovo grosso reverse-engineering. Se il candidato richiede > 1 giornata di analisi nuova, l'agent si ferma e propone un altro candidato.

**Acceptance criteria**:
- Documento scritto seguendo il template.
- Tutte le evidenze cited sono link verificabili (commit, test, ROM offset).
- Suite test verde.

**Validazione**: comandi globali.

---

## W9 — Demo video + GIF per README

**Problema**: il README non mostra **nessuna immagine in movimento**.

**In-scope**:
- L'agent **non** può registrare video direttamente. Prepara invece:
  - Uno script `tools/record_demo.sh` che lancia il dev server, apre headless Chromium con `?autoLoad=1&coinStart=1`, registra 60s di canvas con `ffmpeg`/`puppeteer` (l'agent verifica che le dipendenze siano disponibili o documenta l'install).
  - Output target: `docs/media/demo.mp4` + `docs/media/demo.gif` (≤ 6 MB).
  - Aggiunge sezione "Demo" al README con embed/link.
- Se le dipendenze (puppeteer/ffmpeg) non sono installabili in CI, lascia tutto in `tools/` con TODO per esecuzione manuale.

**Out-of-scope**: registrare il video autonomamente (richiede ROM legali → ambiente Marco).

**Acceptance criteria**:
- Script funzionante e documentato.
- README sezione Demo predisposta con placeholder per il media.
- Niente binari grossi committati senza il media reale.

**Validazione**: comandi globali + `bash -n tools/record_demo.sh`.

---

## W10 — Bozza articolo HN

**Problema**: il post HN richiede un articolo standalone.

**In-scope**:
- Scrivere `docs/articles/slapstic-finding-hn-draft.md` (non pubblico, solo working copy):
  - Titolo proposto: "Finding an undocumented Atari Slapstic side-channel by differential debugging in TypeScript".
  - Lunghezza target: 1500–2500 parole.
  - Struttura: hook → context (cos'è Marble Love, perché TS, perché MAME come oracolo) → la finding (riusare `slapstic-prefetch-side-channel.md`, riformulato per pubblico generale) → metodologia generale → riflessioni sul ruolo dell'agent loop (frontale, onesta) → call to action (link al repo, link a STATUS).
  - Tono: tecnico, niente hype, niente "AI-powered". L'AI loop è uno strumento, non il pitch.
  - Includere: 2–3 snippet di codice, 1 diagramma (Mermaid OK), comandi riproducibili.
- Scrivere `docs/articles/show-hn-post-draft.md`: il post di accompagnamento HN, max 300 parole, link all'articolo + 3 punti di sostanza.

**Out-of-scope**: pubblicare. L'agent **non** posta su HN, blog, social.

**Acceptance criteria**:
- Bozza completa, in inglese.
- Tutti i comandi/snippet sono stati eseguiti dall'agent come sanity check (e producono l'output dichiarato).
- Nessuna falsa rivendicazione rispetto a STATUS.md.

**Validazione**: comandi globali.

---

## Definition of Done (globale)

- Workstream 1–10 completati, ognuno con la sua PR su `claude/hn-ready/<W#>-<slug>`.
- `main` (dopo merge sequenziale): typecheck verde, `npx vitest run` verde (con eventuali `.skip` documentati in STATUS), web build verde, `git diff --check` pulito.
- README aggiornato: header punta a STATUS.md, sezione Demo presente (anche se media è placeholder).
- `docs/STATUS.md`, `docs/cpu-config.md`, almeno 2 file in `docs/findings/` presenti e linkati.
- Lista delle 22 branch remote triata (decisione di cancellazione resta a Marco).
- Test failures inventory consegnata.
- Articolo HN bozza consegnata.
- **Pesante**: pack git pre/post W7 documentato (anche se opzione C, è un check di sanità).

---

## Formato handoff per ogni PR

Ogni PR description **deve** contenere:

```
## Workstream
W<#> — <nome>

## Cosa cambia
<bullet list, 3-5 voci max>

## Cosa NON cambia (esplicito)
<bullet list di subsistemi non toccati>

## Validazione eseguita
- npm run typecheck: <ok/fail + tempo>
- per-package tsc: <ok/fail>
- npm --workspace @marble-love/web run build: <ok/fail>
- vitest mirato: <comando + risultato>
- git diff --check: <ok>

## Rischi residui
<bullet list, onesta>

## Open question per Marco
<solo se davvero servono>
```

---

## Quello che l'agent **non** deve fare mai

- Non toccare `runs/`, `oracle/scenarios/**/*.json`, `oracle/tom_harte_m68000/**`.
- Non aggiornare expected values di test per farli passare (regola già in CONTRIBUTING).
- Non aprire PR direttamente sul `main` upstream — sempre via branch + PR descrizione.
- Non riscrivere la storia git (`rebase -i`, `filter-branch`, `commit --amend` su commit pushati).
- Non aggiungere dipendenze npm runtime; dipendenze dev solo se strettamente necessarie (es. `knip`), con approvazione esplicita nella PR.
- Non aggiungere emoji.
- Non chiamare il progetto "AI-powered" o "AI-built".
- Non scrivere markers tipo "Generated with Claude" nei commit/PR.

---

## Note di stima (per gestire le aspettative)

| W# | Sforzo stimato | Bloccante per HN | Rischio |
|---|---|---|---|
| W1 | 1–2 gg | Sì | Medio (potresti trovare bug runtime) |
| W2 | 0.5 gg | No | Basso |
| W3 | 0.5 gg | No | Basso |
| W4 | 0.5 gg | **Sì** | Basso (è scrittura, non codice) |
| W5 | 1 gg | No | Medio (rinomine rompono import facilmente) |
| W6 | 2 h | No | Basso |
| W7 | 0.5 gg (opz C) – 1.5 gg (opz B) | No | Alto se B/A |
| W8 | 1 gg | No | Medio (può sfuggire in analisi) |
| W9 | 0.5 gg | No | Basso |
| W10 | 1 gg | **Sì** | Basso (scrittura) |

**MVP per postare**: W1 + W4 + W10 (~3 gg). Tutto il resto è qualità del post.

---

Fine PRD. L'agent che lo riceve lavora workstream per workstream, una PR per volta, sequenza definita sopra, e ferma il lavoro chiedendo conferma a Marco ai gate W7 (opzione fixtures) e prima di mergeare W5 (rinomine).
