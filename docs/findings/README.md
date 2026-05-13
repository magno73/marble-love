# Findings

Documenti dei finding tecnici significativi durante il porting bit-perfect.
Ognuno descrive un comportamento hardware/software non ovvio scoperto via
differential debugging, con riferimenti a commit e test di regressione.

Questi documenti sono pensati anche come **asset pubblicabili** (blog post,
HN, technical writeup post-launch).

## Findings index

- [Slapstic FSM observes 68010 CPU prefetch outside protected window](slapstic-prefetch-side-channel.md)
  — *2026-05-13*. Hardware quirk del chip slapstic 137412-103. Prefetch CPU
  fuori dal range protetto può armare la FSM se matcha pattern `alt1`.
  Impact: chiuso 126B PF diff a f12950.

## Aggiungere nuovi finding

Quando scopri qualcosa di non ovvio (bug subtle, quirk hardware non
documentato, side effect emergente):

1. Crea `docs/findings/<topic>-<short-desc>.md`
2. Struttura: TL;DR + Background + Anomaly + Discovery + Fix + Verification + Reflections + References + Commits
3. Aggiungi voce a questo README
4. Linka dal STATUS.md se rilevante per il flusso del progetto
