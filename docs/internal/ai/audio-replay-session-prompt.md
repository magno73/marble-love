# Prompt per sessione nuova Claude — Audio originale via cmd-tape replay

Lavoro nella root `/Users/magnus-bot/Code/marble-love` (marble-love, monorepo TS bit-perfect porting di Marble Madness vs MAME oracle). Procedi in autonomia, senza chiedere conferme su azioni routine: edit, run vitest, run tsc, run MAME, commit, push opzionale solo se chiedo. Leggi `CLAUDE.md` (12-rule, italiano).

## /goal — Replicare audio originale di Marble nel browser

**Success criteria misurabili:**
1. Cmd-tape MAME-recorded replay attraverso TS SoundChip in browser produce audio
2. `probe-sound-sample-diff.ts` cross-correlation TS vs MAME WAV > 0.9 su ≥60 frame
3. `?soundReplay=oracle/scenarios/<file>.json` in web app fa partire audio chip-perfect
4. Nessun edit ai file del dominio Codex
5. `npx tsc -b` + `npx vitest run` tutti PASS
6. Commit finale + `STATUS.md` update + `docs/audio-chip-perfect-prd.md` progress log

## Strategia: bypass A0 via cmd-tape replay

Il blocker A0 (cmd flow rotto: gameplay sub TS che non popolano la byte queue $401F44, quindi sound chip non riceve cmd in runtime browser) è nel **dominio Codex** (gameplay sub) e non posso fixarlo. Bypass: cattura cmd con MAME write-tap, salva JSON, replica in TS via `submitCommand(chip, byte)` al frame esatto. L'audio bit-perfect emerge senza dipendere da gameplay events Codex.

## Dominio touchable (mio)

- `packages/engine/src/audio/` (intero — `ym2151*.ts`, `pokey.ts`, `*-tables.ts`, `*-envelope.ts`, `*-operator.ts`)
- `packages/engine/src/m6502/` (intero — `sound-chip.ts` facade, `sound-mmu.ts`, `cpu.ts`, `mailbox.ts`, `sound-clock.ts`, `sound-rom.ts`)
- `packages/web/src/sound-renderer.ts`
- `packages/web/public/sound-worklet.js`
- `packages/web/src/main.ts` — solo per aggiungere ramo `?soundReplay=`. Non toccare altri rami.
- `oracle/mame_sound_*.lua`, `oracle/scenarios/sound-*.json`
- `packages/cli/src/probe-sound-*.ts`
- `docs/audio-chip-perfect-prd.md`, `STATUS.md`

## Dominio forbidden (Codex)

NON toccare:
- `packages/engine/src/audio.ts` (M68K wrapper AudioEvent)
- `packages/engine/src/sound-cmd-send-158ac.ts`, `sound-cmd-gate.ts`, `sound-dispatch-send.ts`, `sound-irq-input.ts`, `sound-status-check.ts`, `sound-maybe-11ac2.ts`, `sound-pair-15884.ts`, `sound-tick.ts`, `sound-cmd-send.ts`
- `packages/engine/src/main-tick.ts`, `state.ts`
- Qualunque gameplay sub `sub*.ts`, `fun*.ts`, helper di gameplay

Se serve hookare un evento o cambiare contract, scrivi nuovo file nel dominio audio/m6502, non editare i file Codex.

## Stato attuale (verifica `git log -50` + `docs/audio-chip-perfect-prd.md`)

- Fasi A2-A6 DSP audio chip-perfect implementate (envelope rate MAME, attenuation dB-domain, LFO PM, POKEY AUDCTL 16-bit join, cross-correlation probe)
- Fase A0 BLOCKED (Codex domain)
- Fase A1 cycle-exact 6502: 387B residuo, drill rimandato
- Fase A7 validation: tool ok, manca vera MAME WAV + cmd tape
- 35/35 test PASS al commit `a3947b8`

## Task immediati (ordine)

### E1 — Capture cmd-tape da MAME (BLOCKER NOTO da diagnosticare)

Il tap script `oracle/mame_sound_cmd_tap.lua` esistente cattura write a $FE0000-$FE0001, ma in 600 frame attract registra **0 cmds**. Anche un tap wide $FE0000-$FEFFFF (`oracle/mame_sound_cmd_tap_wide.lua`) registra 0 write. Main 68K è attivo (PCs 0x4b0/0x852/0x596), sound 6502 esce dal reset entro f300 (PC=0x8123).

Diagnosi necessaria:

1. Verifica soundlatch address corretto nel driver MAME `atarisy1.cpp` marble (cercare `soundlatch` + `main_map` + `m_soundlatch.write`). Usa `gh api repos/mamedev/mame/contents/src/mame/atari/atarisy1.cpp` o WebFetch.
2. Variante 1: l'address effettivo non è $FE0001 — magari $F60000, $F80000, o altro. Aggiusta il tap range.
3. Variante 2: il sound CPU forse parte ma non riceve cmd in attract puro → modifica il Lua per dispatchare via `manager.machine.input` un coin pulse + start press dopo N frame, poi continuare 600 frame.
4. Output target: `oracle/scenarios/sound-cmd-tape-attract.json` (o `-gameplay.json`) con `count > 0` e cmds spalmati su frame range.

ROMs disponibili in `roms/marble.zip` (set MAME completo). Sound ROMs estratte in `/tmp/sound-roms/136033.421` + `136033.422`. MAME binario: `/opt/homebrew/bin/mame`.

Comando base (regola target):
```bash
mame marble -rompath /Users/magnus-bot/Code/marble-love/roms -nothrottle -skip_gameinfo \
  -sound none -nvram_directory /tmp/snd_nv -cfg_directory /tmp/snd_cfg -nonvram_save \
  -autoboot_script oracle/mame_sound_cmd_tap.lua -autoboot_delay 0 -video none
```

Env vars: `MARBLE_SOUND_CMD_TARGET_FRAME`, `MARBLE_SOUND_CMD_OUT`.

### E2 — Capture MAME WAV reference

```bash
mame marble -rompath roms -wavwrite /tmp/marble_attract.wav -seconds_to_run 10 \
  -skip_gameinfo -autoboot_script <stesso scenario di E1>
```

Il WAV è ground truth per cross-correlation A7. Sample rate 48000 Hz stereo presumibilmente.

### E3 — Cmd-tape player TS

Aggiungi a `packages/engine/src/m6502/sound-chip.ts`:
- `loadCmdTape(tape: {cmds: Array<{frame, byte}>})`
- `tickFrameWithTape(chip, frame)` che fa `submitCommand` per i cmd di quel frame + `tickCycles(chip, SOUND_CYCLES_PER_FRAME)`.

Wire in `packages/web/src/main.ts` ramo isolato:
```ts
const tapeFile = new URLSearchParams(location.search).get("soundReplay");
if (tapeFile) {
  // fetch JSON, instanzia chip standalone, loop @60fps, drain samples → renderer
}
```

NON toccare il ramo normale `?sound=1` (quello dipende da Codex).

### E4 — Validate

```bash
npx tsx packages/cli/src/probe-sound-sample-diff.ts \
  --mame /tmp/marble_attract.wav \
  --cmd-tape oracle/scenarios/sound-cmd-tape-attract.json \
  --frames 600
```

Target `coeff > 0.9`. Se < 0.9, drill per gap:
- envelope rate sbagliato → confronta primi sample
- attenuation curve → check `ATT_TO_LINEAR`
- POKEY routing → check AUDCTL bit decode
- LFO → check PM/AM
- detune DT1/DT2 → check phase increment

### E5 — Verify + commit

```bash
npx tsc -b --pretty false
npx vitest run
git add <files mio dominio>
git commit -m "feat(audio): cmd-tape replay path per audio bit-perfect (bypass A0)"
```

Aggiorna `docs/audio-chip-perfect-prd.md` con progress log datato 2026-05-16. Update `STATUS.md` con stato audio.

## Convenzioni

- Lingua: italiano (commenti, commit, doc, prompt user)
- Commit: conventional commits italiani (es. `feat(audio):`, `fix(sound):`, `docs(audio):`)
- File nuovi: testata con scope hardware reference + relazione MAME source
- Test: vitest + intent (Rule 9 CLAUDE.md)
- ROM-driven: niente magic number, tutto da ROM disassembly + MAME shadow
- No external emulator porting (Musashi/Moira/MAME) — solo reference reading
- Bit-perfect via differential testing vs MAME

## Pattern esistenti da riusare

- `oracle/tom_harte_m68000/` → struttura per dataset/runner
- `packages/engine/src/m68k/regfile.ts` → pattern regfile
- `packages/engine/src/m68k/slapstic-103.ts` → pattern FSM chip
- `packages/cli/src/probe-diff-bytes.ts` → pattern probe-diff
- `docs/sound-system.md` → V1 spec audio (read-only)

## Files chiave da leggere all'inizio

1. `docs/audio-chip-perfect-prd.md` — PRD strutturato 7 fasi A0-A7
2. `packages/engine/src/m6502/sound-chip.ts` — facade attuale
3. `packages/engine/src/audio/ym2151.ts` — top-level YM2151
4. `packages/cli/src/probe-sound-sample-diff.ts` — tool diff
5. `oracle/mame_sound_cmd_tap.lua` — tap script da debuggare
6. `STATUS.md` — stato globale repo

Inizia con `git log --oneline -50` per allinearti su cosa Codex ha committato di recente (gameplay/seed/route, NON audio). Poi parti da E1.
