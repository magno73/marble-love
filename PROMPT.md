# PROMPT.md — entry point per Claude Code

Sei un'agente di sviluppo autonomo per **Marble Love**. Il tuo compito è portare avanti il progetto descritto in `marble-love-prd-v0.2.md` fase per fase.

## Protocollo

1. **Leggi sempre prima:**
   - `marble-love-prd-v0.2.md` (PRD completo, fonte di verità sul cosa)
   - `STATUS.md` (fase corrente, ultimo deliverable, prossimo task)
   - Eventuali `BLOCKED.md` o `runs/` recenti

2. **Identifica la fase corrente** da `STATUS.md` e apri il prompt corrispondente in `prompts/0X-<nome>.md`.

3. **Esegui** seguendo i criteri di accettazione di quella fase.

4. **Aggiorna `STATUS.md`** a ogni step completato. Mai lasciare `STATUS.md` non sincronizzato con la realtà del repo.

5. **Commit atomici** (un task → un commit) con messaggio descrittivo. Branch separati per fase: `phase-1-mame`, `phase-2-static`, …

6. **Cita le sorgenti** (file/linea Ghidra, file/linea MAME, riga datasheet 68010) quando giustifichi una scelta.

7. **Loop autonomo bloccato per 3 iterazioni senza progresso** → stop, scrivi `BLOCKED.md` con domanda specifica. Non insistere.

## Regole non-negoziabili

- **Mai** distribuire ROM o byte derivati direttamente (sprite/audio raw). Le ROM stanno in `roms/` (gitignored), il codice le legge a runtime.
- **Mai** `Math.random()` o `Date.now()` nel package `@marble-love/engine`. Il core è puro e deterministico.
- **Mai** aritmetica diretta (`+ - * / >>`) su valori `u8 | u16 | u32` (branded types). Solo helper di `engine/src/wrap.ts`. La ESLint custom rule deve passare.
- **Mai** copiare layout funzione-per-funzione del binario originale. Approccio "clean-ish": stato e RNG bit-identici, ma codice idiomatic TS.
- Determinismo MAME è **non negoziabile**: due run dello stesso scenario producono trace bit-identici.
- Quando il diff diverge, **non normalizzare il trace per mascherare la divergenza**. La divergenza è il segnale.

## Logging run autonomi

Per ogni sessione di hill-climbing significativa, crea `runs/YYYY-MM-DD-HHMM.md` con:
- Durata wall-clock
- Token spesi (stima)
- Scenari attaccati
- Fix applicati (commit hash + 1 riga)
- Stato finale (parità %, primo frame divergente sui rimasti)

## Escalation

Scrivi `BLOCKED.md` (e svuotalo quando risolto) quando:
- 3 iterazioni di fix consecutive non riducono la divergenza
- Una funzione critica (RNG, level loader, fisica core) richiede static analysis che reaper non risolve
- Manca un tool sulla macchina (Bun, Ghidra, MAME version) che il PRD assume

Format `BLOCKED.md`:

```md
## Blocco: <titolo>
**Fase:** <N>
**Da quanto:** <ore o iter>
**Cosa ho provato:**
- ...
**Cosa serve da Marco:**
- <domanda specifica>
```
