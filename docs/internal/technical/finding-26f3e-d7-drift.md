# Finding: FUN_26F3E (lateGameLogic) D7 emit-count drift @ f+99

> Investigazione richiesta da Codex round 4. Sessione 2026-05-12.
> Probe: `packages/cli/src/probe-26f3e-d7.ts`, `probe-26f3e-types.ts`,
> + dump obj animStates + bank latch (inline).

## Sintomo

```
D7 @ f+99: TS = 0x0007  vs  MAME = 0x001b   (Δ = -20 sprites)
Cursor cA3 (0x4003F6): TS=0xA0220E  vs  MAME=0xA02036  (bank mismatch)
Cursor cA1 (0x4003FA): TS=0xA0228E  vs  MAME=0xA020B6
Cursor cA2 (0x4003FE): TS=0xA0230E  vs  MAME=0xA02136
Cursor cA4 (0x400402): TS=0xA0238C  vs  MAME=0xA021B4
```

D7 viene resettato a 0 in Phase 3 di FUN_26F3E ogni frame (line 859). Quindi
D7@f+99 = numero sprite emessi DURANTE il body del frame 99, non cumulativo.

## Stato strutturale a f+99 (bit-perfect TS=MAME)

```
obj0: active=1 state=0 subS=3   ✓ bit-perfect
obj1: active=0 state=0 subS=0   ✓
obj2: active=4 state=3f subS=8f ✓
obj3: active=7f state=0 subS=0  ✓
obj4: active=0 state=0 subS=0   ✓

entity list @ 0x4003BC: 00 01 02 03 04 05 ff... ✓
entity types @ obj2+N*0xE:  type=2,1,4,4,4,3 ✓
```

Quindi obj struct + animState + entity dispatch are NOT divergent. Le entity
sono tutte presenti e con tipi corretti. La divergenza è in:

## Root cause #1: bank toggle latch desync

```
*0x4003AE: TS=0x0080  vs  MAME=0x0088   ← stale in TS, latched in MAME
*0x4003B0: TS=0x0088  vs  MAME=0x0080   ← next bank computato OK in TS
*0x40039A: TS=0x01    vs  MAME=0x01     ← scroll dirty flag SET in entrambi
```

In TS, FUN_26F3E Phase 3 fa:
1. `*0x4003B0 = *0x4003AE XOR 8` — computa next bank
2. `state.workRam[0x39a] = 1` — set scroll dirty flag (line 937)

Ma **manca il latch back: `*0x4003AE = *0x4003B0`** che dovrebbe avvenire nel
mainTick scroll-sync sub durante il NEXT IRQ4 vblank handler (`mainUpdateScrollSync`).
Senza questo latch, `*0x4003AE` resta stale al valore warm (0x0080) per sempre,
e Phase 3 computa SEMPRE `d3t2 = 0x200` → cursor sempre in bank 1.

Codex sta lavorando su questo in `main-tick.ts` (working tree modificato non
committed; ha aggiunto writes a r[0x39a] in branch wait + rng seed mirror).

## Root cause #2 (sospetta, non confermata): dispatch emit-count

TS emette 7 sprite per frame, MAME 27. Con 6 entity attive (type 1,2,3,4,4,4),
expected ~4-5 sprite per entity in MAME. In TS ~1.2 per entity.

Hypothesis (da verificare):
- `dispatchType1` (entity 1, player marble, state=0): expected ~3 direct emit
  + inner-loop-1 (max 4) + inner-loop-2 (max 5). Total fino a 12.
- `dispatchType2/3/4`: inner emit varia per anim state.

Possibili cause:
- innerSprites legge da `objPtr+0xa4` con stride 6: se TS workRam @ objPtr+0xa4
  ha w0=0 al primo iter, il loop esce → 0 emit dall'inner.
- Inner loop 2 a `objPtr+0x38` non è ancora modellato (`TODO` comment line 273-275).
- `orMask` dipende da `*0x4003AE` (bank toggle); diverso valore → forse trigger
  early-exit in alcune dispatchType branch?

## Drill prossimo step

1. **Codex** già su bank-toggle in main-tick.ts → fix #1 chiude cluster cursor.
2. **Da fare**: instrument dispatchType1/2/3/4 per loggare emit-count per type
   a f=99, vedere quale type emette meno del previsto. Confronto con MAME tap.
3. **Inner loop 2 at obj+0x38** non modellato — può rappresentare il grosso
   dei 20 sprite mancanti se le entity hanno animazioni con cells secondarie.

## Files NOT toccati (Codex WIP)

- `packages/engine/src/main-tick.ts`
- `packages/engine/src/boot-init.ts`
- `packages/engine/src/state.ts`

## Probe

```bash
npx tsx packages/cli/src/probe-26f3e-d7.ts        # entity list + D7 + cursor
npx tsx packages/cli/src/probe-26f3e-types.ts     # entity types breakdown
```
