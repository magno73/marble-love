# Static Analysis — Overview iniziale del binario

> **Status:** SKELETON. Phase 2 deliverable (post-Ghidra setup).
>
> Questo documento è la "1-pagina" che il PRD §6 chiede: dopo il primo run di
> reaper su Ghidra, scrivere qui i sospetti su:
>
> - **Main loop**: indirizzo + chiamate principali
> - **ISR**: vettori IRQ, cosa fa ognuno
> - **RNG**: indirizzo della funzione, algoritmo identificato
> - **Level loader**: indirizzo, tabella pointer livelli, format header
>
> Funzioni con nome non-default ≥80% delle quelle chiamate >5 volte.

## Main loop

- Indirizzo: TBD
- Stack frame: TBD
- Chiamate principali (in ordine):
  1. TBD (probabilmente: read input)
  2. TBD (AI / enemy update)
  3. TBD (physics marble)
  4. TBD (collision check)
  5. TBD (write sprite RAM)
  6. TBD (wait vsync)

## Interrupt handlers

| Vector | Indirizzo | Cosa fa |
|--------|-----------|---------|
| Reset  | TBD | Init RAM, init video, jump main |
| Vsync  | TBD | Increment frame counter, swap sprite RAM |
| Sound IRQ | TBD | Read mailbox response da 6502 |

## RNG

- **Funzione:** TBD
- **Algoritmo:** ipotesi LFSR16 / LCG / lookup-table — da verificare
- **Stato persistente:** indirizzo RAM TBD
- **Init seed:** TBD (da ROM? da input I/O cold-boot?)

🚨 **Priorità Phase 2:** chiudere RNG il prima possibile (PRD §10).

## Level loader

- **Pointer table:** offset ROM TBD (memory dei progetti precedenti suggerisce
  0x2BE00 — verificare!)
- **Header format:** TBD bytes
- **Decode loop:** TBD

## Score / Lives / Timer

- Indirizzi RAM: TBD
- Format BCD? Binary?
- Update frequency: ogni frame? ogni N tick?

## Audio mailbox

- Write address (68010 → 6502): TBD
- Read address (68010 ← 6502 ack): TBD

---

## Sospetti aperti / Da investigare

- [ ] Esiste codice "service mode" che reagisce a DIP switch specifici?
- [ ] Il continue countdown è in BCD?
- [ ] L'animazione del titolo ha il suo state machine separato?

## Funzioni nominate (da reaper)

Aggiornare quando reaper completa la prima passata:

| Address | Default name | Renamed | Confidence |
|---------|--------------|---------|------------|
| TBD     | FUN_xxxxx    | TBD     | TBD        |
