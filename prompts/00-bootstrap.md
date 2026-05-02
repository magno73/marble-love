# Prompt — Bootstrap (entry point per ogni sessione)

**Leggimi sempre per primo.**

## Cosa fai oggi

1. Apri e leggi:
   - `marble-love-prd-v0.2.md` (PRD completo)
   - `STATUS.md` (fase corrente, ultimo deliverable, prossimo task)
   - Eventuale `BLOCKED.md` (se esiste, c'è un blocco da risolvere PRIMA)
   - L'ultimo `runs/<timestamp>.md` (cosa ha fatto la sessione precedente)

2. Identifica la fase corrente da `STATUS.md`. Apri il prompt corrispondente:
   - Phase 1 → `prompts/01-mame-driver.md`
   - Phase 2 → `prompts/02-static-foundation.md`
   - Phase 3 → `prompts/03-oracle.md`
   - Phase 4 → `prompts/04-typescript-skeleton.md`
   - Phase 5 → `prompts/05-diff-harness.md`
   - Phase 6 → `prompts/06-hill-climbing.md`
   - Phase 7 → `prompts/07-web.md`

3. Esegui seguendo i criteri di accettazione di quella fase.

4. Aggiorna `STATUS.md` ad ogni step. Mai lasciare `STATUS.md` non sincronizzato con il repo.

5. Commit atomici con messaggio descrittivo. Branch separati per fase.

6. Se una sessione di lavoro autonomo è significativa: scrivi un log in `runs/YYYY-MM-DD-HHMM.md`.

## Regole non-negoziabili (riassunte da `PROMPT.md`)

- Mai distribuire ROM o byte derivati da ROM
- Mai `Math.random()` o `Date.now()` in `@marble-love/engine`
- Mai aritmetica diretta su branded types (la ESLint custom rule fallisce)
- Mai copiare layout funzione-per-funzione del binario originale
- Determinismo MAME è non-negoziabile
- Quando il diff diverge: NON normalizzare per nascondere la divergenza
- 3 iterazioni senza progresso → `BLOCKED.md`, escalation a Marco

## Tool sulla macchina

- ✅ Node.js 25, npm, MAME 0.286, Python 3, git, gh CLI (auth `magno73`)
- ✅ Bun 1.3.13 (`~/.bun/bin/bun`, in `~/.zshrc`)
- ✅ Ghidra 12.0.4 (formula brew). Headless wrapper: `./tools/ghidra_headless.sh`
- ✅ OpenJDK 21.0.10 (`/opt/homebrew/opt/openjdk@21`)
- ⚠️ `uv` da verificare in Phase 2 (per PyGhidra/reaper)
- GitHub repo: `https://github.com/magno73/marble-love` (privato)

Se manca un tool che ti serve: documenta in `BLOCKED.md` e chiedi a Marco di installarlo.
