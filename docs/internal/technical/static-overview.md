# Static Analysis — Overview Phase 2

> **Status:** ✅ Phase 2.
> **Tools:** Ghidra 12.0.4 headless via PyGhidra. Project a `ghidra_project/marble`. 340 funzioni rilevate, dump in `ghidra_project/dump_*.txt`.
> **Source binario:** `ghidra_project/marble_program.bin` (0x88000 byte) prodotto da `tools/rom_prep.py` da `roms/{marble,atarisy1}.zip`.

## Architettura del game loop di Marble Madness

```
                  ┌──────────────────────────┐
   VBLANK (60Hz)  │     IRQ4 ISR @ 0x34A     │
   ──────────────►│  - check skip flag       │
                  │  - jmp *(0x10006)        │ ──► dispatch table @ cart 0x10006
                  │  - rte                   │      jmp 0x10116 (main game tick)
                  └──────────────────────────┘

                  ┌──────────────────────────┐
                  │  Main Game Tick @ 0x10116│
                  │  - inc frame counter     │
                  │     (0x400014, 0x400016) │
                  │  - jsr 0x28788 ◄─────────┼─── MAIN UPDATE (cart code)
                  │  - track stack low water │
                  │  - rte                   │
                  └──────────────────────────┘

                  ┌──────────────────────────────────────────┐
                  │       MainUpdate @ 0x28788               │
                  │  if (scrollDirty @ 0x40039A):            │
                  │      cycle counter @ 0x400010            │
                  │      sync xscroll/yscroll/AVcontrol      │
                  │  write 0x400002 → 0x820000 (Y scroll)    │
                  │  write 0x000000 → 0x800000 (X scroll = 0)│  ← Marble non scrolla H
                  │  write 0x4003AE → 0x860000 (AV control)  │
                  │                                          │
                  │  jsr 0x26BEE  // palette animation 1     │
                  │  jsr 0x26C78  // palette animation 2     │
                  │  jsr 0x26D4E  // palette animation 3     │
                  │  jsr 0x26B88  // palette animation 4     │
                  │  jsr 0x148   // BIOS service (?)         │
                  │  jsr 0x15A   // BIOS service (?)         │
                  │  jsr 0x28A96 // probably input/physics   │
                  │  jsr 0x1AC18 // probably AI/sprite render│
                  │  jsr 0x28972 // probably score/HUD       │
                  │                                          │
                  │  watchdog kick @ 0x880000                │
                  │  coin counter logic                      │
                  │  jsr 0x10146 (next-stage routine)        │
                  └──────────────────────────────────────────┘
```

## Vector table (estratto dal blob, byte 0x000000-0x000400)

| Vector | Offset | Valore         | Significato | Disassembly |
|--------|--------|----------------|-------------|-------------|
| 0      | 0x000  | `0x00401F00`   | SSP iniziale (top di Program RAM) | `00 40 1F 00` |
| 1      | 0x004  | `0x00000466`   | Reset PC (ResetEntry) | `00 00 04 66` |
| 2-25   | 0x008-0x064 | `0x00000300` (default) | Bus error / Address error / Illegal / Trap → handler default | tutti `00 00 03 00` |
| 26     | 0x068  | (none)         | IRQ Level 2 (joystick) — Marble non lo usa | |
| 27     | 0x06C  | (none)         | IRQ Level 3 (sprite) — Marble non lo usa | |
| **28** | 0x070  | `0x0000034A`   | **IRQ Level 4 = VBLANK** | `00 00 03 4A` |
| 29     | 0x074  | (none)         | IRQ Level 5 — non usato | |
| **30** | 0x078  | `0x0000036C`   | **IRQ Level 6 = sound CPU comms** | `00 00 03 6C` |

Il fatto che SSP (`0x00401F00`) sia esattamente al top dei 8 KB di Program RAM (`0x400000-0x401FFF`) e il reset PC (`0x466`) sia subito dopo la vector table conferma che l'interleave even/odd è corretto.

## ISR: IRQ4 VBLANK @ 0x34A (10 byte, decoded da disassembly Ghidra)

```asm
0x34A:  tst.w  (0x00401F40).l    ; check "vblank skip" flag
0x350:  bne.w  0x00000B5E        ; if set: take alternate path
0x354:  tst.w  (0x00010006).l    ; check frame handler vector @ cart 0x10006
0x35A:  beq.w  0x00000364        ; if zero: skip dispatch
0x35E:  jmp    0x00010006.l      ; dispatch frame handler (= jmp 0x10116)
0x364:  move.w D0w,(0x008A0000).l ; ack VBLANK (clear IRQ4)
0x36A:  rte
```

Pattern: il **dispatch table** @ `0x10006` è popolato dalla cartridge in fase di init. Per Marble:
- `0x10000`: jmp `0x100A8` (cart boot/init entry)
- `0x10006`: jmp `0x10116` (frame tick handler)
- `0x1001E`: jmp `0x0017E` (sound IRQ6 handler — in BIOS)

## ISR: IRQ6 sound @ 0x36C (10 byte)

```asm
0x36C:  btst.b #0x6,(0x00F60001).l ; test self-test bit (low byte di switch port)
0x374:  beq.b  0x0000038E          ; non self-test: skip
0x376:  tst.w  (0x0001001E).l       ; check sound handler vector
0x37C:  beq.w  0x00000386            ; if zero: skip
0x380:  jmp    0x0001001E.l         ; dispatch
0x386:  tst.w  (0x00FC0000).l       ; read sound response (clears IRQ6 latch)
0x38C:  rte
```

## Main Game Tick @ 0x10116 (cart, called every VBLANK)

```asm
0x10116:  movem.l {A1,A0,D1,D0},-(SP)   ; save scratch regs
0x1011A:  clr.w  (0x008A0000).l         ; ack VBLANK
0x10120:  addq.b 0x1,(0x00400016).l     ; frame counter low++
0x10126:  addq.b 0x1,(0x00400014).l     ; frame counter mid++ (probabilmente con carry il counter è 16-bit packed)
0x1012C:  jsr    0x00028788.l           ; *** MAIN UPDATE ***
0x10132:  cmpa.l (0x00400440).l,SP      ; track stack low water
0x10138:  bpl.b  0x00010140
0x1013A:  move.l SP,(0x00400440).l
0x10140:  movem.l (SP)+,{D0,D1,A0,A1}
0x10144:  rte
```

🎯 **Frame counter**: byte a `0x400014` (post-incrementato dopo `0x400016`). Da catalogare nella `state.ts` del reimpl.

🎯 **Stack low water mark**: `0x400440` (long). Debugging/diagnostic data — non rilevante per parità.

## Game state RAM map (parziale, da xrefs)

Tutto in Work RAM `0x400000-0x401FFF` (8 KB).

| Addr        | Tipo  | Note (inferito da Ghidra xref) |
|-------------|-------|--------------------------------|
| `0x400000`  | u16   | Word "Y scroll target"? (22 ref, copiato a `0x400002` poi a `0x820000`) |
| `0x400002`  | u16   | Word effettivamente scritta a `0x820000` (Y scroll) |
| `0x400008`  | u8?   | Flag "demo mode" (controlla branching in MainUpdate) |
| `0x40000A`  | u8    | Confrontato con `2` per gating logic |
| `0x400010`  | u32   | Counter incrementato in `MainUpdate` se scrollDirty |
| `0x400014`  | u8    | **Frame counter mid** (incrementato da MainTick) |
| `0x400016`  | u8    | **Frame counter low** (incrementato da MainTick) |
| `0x400018`  | array | **🎯 GAME OBJECT ARRAY**: oggetti di 0xE2 (226) byte ciascuno (vedi sotto) |
| `0x40017C`  | u16   | Stato XOR'd con 0x400000 in `FUN_00000F6A` (logica di flag/state machine) |
| `0x40039A`  | u8    | "scroll dirty" flag (controlla branch in MainUpdate) |
| `0x400390`  | u16   | Stato (= 1?) usato in MainUpdate post-objects |
| `0x400392`  | u16   | Companion di `0x400390` |
| `0x400396`  | u16   | **Numero oggetti attivi** (loop count nel ciclo a `0x26BEE`) |
| `0x4003AE`  | u16   | Cache del registro AV-control (`0x860000`) |
| `0x4003B0`  | u16   | Sorgente per AV-control update |
| `0x4003B8`  | u16   | Flag in `FUN_000158AC` (la "draw char" la usa per skip) |
| `0x4003E2`  | u8    | Flag "scroll AV control change" (alla fine di MainUpdate) |
| `0x4003EA`  | u16   | Pointer struct manipolato in MainUpdate (loop counter "highest objs"?) |
| `0x4003EE`  | u8    | Flag |
| `0x4003F0`  | u8    | Coin pulse current |
| `0x4003F2`  | u8    | Coin pulse last |
| `0x4003F4`  | u8    | Coin counter |
| `0x400440`  | u32   | Stack low water (debug) |
| `0x40075A`  | u16   | Game state flag |
| `0x401F40`  | u16   | "VBLANK skip" flag (check IRQ4) |
| `0x401F42`  | u16   | Stato per draw routine `0x2572` (offset reading mode flag) |

**Per il reimpl** (`packages/engine/src/state.ts`): la struct `GameState` deve avere campi che, una volta serializzati a `workRam[]`, replichino questo layout. Phase 4 deliverable.

## Game Object array @ 0x400018

Array di oggetti. Ogni oggetto **226 byte** (`0xE2`). Numero di oggetti attivi @ `0x400396`. Loop di iterazione: `for (i=0; i<count; i++) addr = 0x400018 + i*0xE2`.

Field offset noti (da `FUN_00026BEE`):
| Offset | Tipo | Significato (inferito) |
|--------|------|------------------------|
| `+0x19` | u8 | Tipo oggetto / palette select |
| `+0x70` | u8 | Animation counter (frame da inizio anim) |
| `+0xD8` | u8 | State flag (skip processing?) |

Il reimpl può modellare questo come `Marble | Enemy[]` ma **per parità di RAM** deve serializzare a 226 byte/oggetto nello stesso layout.

🚨 **TBD Phase 4**: catalogare tutti gli offset di campo (226 byte è grande, ci sta tanto). Identificarli leggendo i sotto-update (`0x26BEE`, `0x26C78`, `0x26D4E`, `0x26B88` per palette anim, `0x28A96` probabile fisica, `0x1AC18` probabile AI).

## RNG: ⚠️ ANCORA DA IDENTIFICARE

Le funzioni più chiamate sono utility di rendering, NON RNG:
- `FUN_000158AC` (100 xref): wrapper di `print_char_at_pos` (chiama `FUN_023C` per draw)
- `FUN_00002572` (91 xref + 33 thunk = 124 totali): draw character/tile a `0xA03000` (alpha RAM) usando lookup tables a `0x7294`/`0x72A4`
- `FUN_00013A98` (30 xref): TBD
- `FUN_00000F6A` (28 xref): state machine bit-twiddler su `0x400000`/`0x40017C` (NON è RNG, è probabilmente un debounce/clamp helper)

🚨 **Strategia per Phase 4**: identificare le chiamate al RNG osservando il binario sotto un trace MAME con scenario ad alta entropia (es. attract mode che spawna nemici): la funzione che incrementa **monotonicamente** un campo RAM piccolo a ogni jsr senza altri side effect è il RNG. Loadable dal trace ground-truth (Phase 3).

In alternativa: Phase 2 rerun con xref count specifici sui valori "ben noti" di RNG state words (un word in RAM riferito da pochi siti, dove uno legge e l'altro scrive). Da tentare.

## Funzioni nominate

Ho assegnato simboli a 24 indirizzi chiave (vedi `tools/ghidra_analyze.py` lista `labels`):
- 12 vector table entries (`VEC_*`)
- 12 MMIO addresses (`MMIO_*`)
- `ResetEntry` @ 0x466

Questo non è ancora "≥80% delle funzioni chiamate >5 volte hanno nome non-default" come richiede il PRD §6 Phase 2 acceptance. Per chiudere quell'acceptance va fatto un **secondo pass** di reaper o di nominazione manuale, focalizzandosi sulle ~30 funzioni con xref ≥ 5. Postponed a una Phase 2.5 o early Phase 4.

## Prossimo (Phase 3 / Phase 4)

1. **Phase 3** (oracle): aggiornare `oracle/mame_dumper.lua` con gli indirizzi reali del game state — frame counter `0x400014/0x400016`, work RAM hash, eventualmente un sample di obj array `0x400018` (226×N byte è troppo, dump solo header + slot 0 = marble?).
2. **Phase 4** (reimpl skeleton): popolare `state.ts` con `Marble` (slot 0 dell'object array, 226 byte) e RNG state placeholder. Aggiornare il `tick()` per imitare l'ordine `MainUpdate @ 0x28788` (4 anim, 2 BIOS, 3 game-update).
3. Trovare RNG durante il primo run di hill-climbing osservando il trace.

## Comandi utili

```bash
# Re-importa da scratch (overwrite project)
./tools/ghidra_headless.sh "$(pwd)/ghidra_project" marble \
    -import "$(pwd)/ghidra_project/marble_program.bin" \
    -loader BinaryLoader \
    -loader-baseAddr 0x000000 \
    -processor 68000:BE:32:default \
    -overwrite

# Aggiungi memory blocks RAM/MMIO + entry points + dump completo
uv run --with pyghidra python3 tools/ghidra_analyze.py

# Disassembly di un range
uv run --with pyghidra python3 tools/ghidra_dump_range.py 0x10116 0x10146 /tmp/x.txt

# Forza disassembly su indirizzo specifico (utile per ISR jmp targets)
uv run --with pyghidra python3 tools/ghidra_disasm_at.py 0x34A 0x36C
```

I dump risiedono in `ghidra_project/dump_*.txt` (gitignored).
