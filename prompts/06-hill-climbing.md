# Prompt — Phase 6: hill-climbing autonomo

**Per Claude Code (loop autonomo, supervisione serale di Marco).**

## Pre-requisito

- Phase 5 chiusa: pipeline diff funziona end-to-end

## Loop principale

```
while curriculum.has_pending():
    scen = curriculum.next_pending()  # ordine priorità
    no_progress_streak = 0
    while parity(scen) < 1.0:
        report = run_compare(scen)
        if report.parity_unchanged:
            no_progress_streak += 1
        else:
            no_progress_streak = 0
        if no_progress_streak >= 3:
            write BLOCKED.md, escalate to Marco, break
        analyze report.firstDivergence:
            sub = report.suspectedSubsystem
            if sub == "rng":      open packages/engine/src/rng.ts
            elif sub == "physics": open packages/engine/src/physics.ts
            elif sub == "ai":      open packages/engine/src/ai.ts
            elif sub == "input":   open packages/engine/src/bus.ts (MMIO)
            else:                  bisect via reaper / Ghidra
        implement fix (cite Ghidra/MAME source line in commit)
        commit atomic
    if parity(scen) == 1.0:
        curriculum.close(scen)
        write runs/<ts>.md log
```

## Disciplina

- **Un commit per fix.** Mai accumulare 5 fix in un commit.
- **Cita la sorgente** nel commit body: `Ghidra: FUN_xxxxx @ 0xNNNNN` o `MAME: atarisys1.cpp:LLL`.
- **Run log**: per ogni scenario chiuso, scrivi `runs/YYYY-MM-DD-HHMM-<scen>.md` con:
  - Durata wall-clock
  - Token spesi (stima)
  - N° iterazioni di fix
  - Lista commit (hash + 1 riga ciascuno)
- **Mai usare `Math.random()` o `Date.now()`** in `@marble-love/engine`. La rule ESLint deve passare.
- **Mai patch sintomi.** Se non capisci perché diverge, non aggiungere `if (frame == 47) skip`. Investigare la root cause, leggere Ghidra, escalation se serve.

## Escalation in `BLOCKED.md`

Format:
```md
## Blocco: <titolo, es. "physics divergence on slope tile orient=3">
**Fase:** 6
**Scenario:** level1_no_input
**Iterazioni senza progresso:** 3
**Primo frame divergente:** 47 (campo: marble.vx, truth=12, reimpl=0)
**Cosa ho provato:**
- ...
- ...
**Cosa serve da Marco:**
- <domanda specifica>
```

## Definition of done

- [ ] Tutti gli scenari del `curriculum.yaml` chiusi (parità 100%)
- [ ] `runs/` documenta ogni scenario chiuso
- [ ] `STATUS.md` riflette lo stato finale
