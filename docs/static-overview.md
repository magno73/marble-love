# Static Analysis — Overview iniziale del binario

> **Status:** Parzialmente compilato in Phase 1 (SSP, reset PC, vector table verificati). Il resto è Phase 2 deliverable (post-Ghidra setup).
>
> Questo documento è la "1-pagina" che il PRD §6 chiede.

## Pre-Phase-2 (verificato dal blob ROM dopo `tools/rom_prep.py`)

Il file `ghidra_project/marble_program.bin` (557056 byte = 0x88000) contiene:
- 0x00000-0x07FFF: Motherboard BIOS interleaved (`136032.205.l13`/`.206.l12`, 32 KB)
- 0x10000-0x2FFFF: Cartridge program (`136033.623`-`.630`, 4 × 32 KB = 128 KB)
- 0x80000-0x87FFF: Slapstic-protected ROM (`136033.107`/`.108`, 32 KB)

### Vector table (offset 0x000000)

| Vector | Offset | Valore (big-endian) | Significato |
|--------|--------|--------------------|-------------|
| 0      | 0x000  | `00 40 1F 00`      | SSP iniziale = `0x00401F00` (top di Program RAM `0x400000-0x401FFF`) ✓ |
| 1      | 0x004  | `00 00 04 66`      | Reset PC = `0x00000466` (subito dopo vector table 0x400) ✓ |
| 2      | 0x008  | `00 00 03 00`      | Bus error handler @ `0x300` (probabilmente RTS/default) |
| 3..    | 0x00C+ | `00 00 03 00` ...  | Tutti puntano a 0x300, default handler |

Il fatto che SSP e reset PC siano valori sensati conferma che l'interleave even/odd è corretto e che il blob è leggibile.

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
