# PRD — Marble Love Audio Chip-Perfect (Path A)

**Data**: 2026-05-15
**Owner**: Marco Magnocavallo
**Branch**: `main` (consolidato Codex + Claude)
**Goal**: audio Marble Madness originale in browser, bit-perfect MAME oracle.

---

## 1. Stato attuale (analisi onesta)

### 1.1 Cosa funziona ✅

| Componente | Stato | Note |
|---|---|---|
| M6502 CPU core | ✅ 2879/2879 Tom Harte PASS | 151 opcode documented, NMOS variant |
| Sound 6502 ROM load | ✅ | 136033.421 ($8000-BFFF) + .422 ($C000-FFFF) verificato vs MAME atarisy1.cpp |
| Mailbox 68K↔6502 | ✅ 13/13 PASS | Edge-triggered NMI/IRQ callback |
| Hold reset hardware | ✅ | TS `inReset` flag, release a f245 (verificato bisect MAME) |
| YM2151 V3 scaffolding | ✅ A1+A2 | 8 ch × 4 op, envelope ADSR, sine LUT, 8 algoritmi, LFO basic |
| POKEY V3 scaffolding | ✅ A3 | 4 tone ch, LFSR 17/9/5/4-bit, sample stream |
| Wire AudioWorklet | ✅ | PCM ring buffer, resampling lineare, stereo output |
| Cmd hook (`setSoundCmdHook`, `setGlobalSoundCmdHook`) | ✅ | soundCmdSend158AC + soundCmdSend + soundPair15884 emettono |
| Cue audible (Codex) | ✅ | Beep per ogni cmd byte (fallback) |

### 1.2 Cosa NON funziona ❌

| Gap | Severità | Sintomo osservato |
|---|---|---|
| **Cmd flow main TS → sound 6502** | 🔴 BLOCKER | Dopo coin+start+6s gameplay attivo: 0 cmd inoltrati al chip (no `[sound] cmd #` log). Main TS NON chiama soundCmdSend158AC nemmeno durante gameplay. |
| **Cycle skew 6502** | 🟡 MAJOR | 387B audioRam diff @ f600 (con hold=245). Drift ~0.6B/frame cycle skew accumulato post-release. |
| **YM2151 envelope rate table** | 🟡 MAJOR | Curva esponenziale TS approssimata, MAME ha tabelle hardware-exact (4 sub-step pattern + key scale modulator). |
| **YM2151 operator FM domain** | 🟡 MAJOR | Mio TS: linear attenuation. MAME: log2-domain operator chain → exp_lookup output. Suono FM diverso a livello timbric. |
| **YM2151 LFO PM** | 🟢 MINOR | AM applicato a output ma PM (phase modulation = vibrato) ancora TODO. |
| **POKEY LFSR taps verify** | 🟡 MAJOR | Seed (0x1ffff) e tap positions (bit 0^5) non confrontati con MAME pokey.cpp. Noise pattern diverso. |
| **POKEY channel join 16-bit** | 🟢 MINOR | AUDCTL bit 4/3 join CH1+2 e CH3+4 a 16-bit period — non implementato. |
| **POKEY clock source select** | 🟢 MINOR | AUDCTL bit 5/6 → CH1/CH3 da clock 1.79MHz (vs 64KHz default) — non implementato. |
| **Sample-level diff tool** | 🟡 INFRA | probe-sound-diff confronta register state; manca confronto sample stream PCM. |

### 1.3 Risultato netto in browser

```
http://192.168.85.200:5180/?autoLoad=1&play=1&sound=1&soundChip=1
+ Click Enable Audio → AudioContext start ✓
+ Click COIN + START → coin/start flow ✓ (live gameplay seed loaded)
+ Gameplay attivo 6s:
  - cpuCycles 15M (6502 sta girando)
  - YM2151 registers scritti: SOLO $10=$C8 + $14=$05 (Timer A + control, init di base)
  - POKEY registers scritti: SOLO $0F=$03 (SKCTL)
  - TUTTE 8 voci YM2151: envState=OFF, TL=127 (silent), AR=0
  - SAMPLE BUFFER: 0 (drainato vuoto, no audio prodotto da chip)
+ Marco sente: solo beep cues (cmd→cue fallback), NIENTE audio originale
```

**Root cause primario**: il path `main TS engine → sound 6502 → YM2151/POKEY → audio` è interrotto al primo step. Il main TS engine NON sta veramente emettendo sound cmd al chip durante il gameplay. Le sub `soundCmdSend158AC` (helper-121b8.ts:810/840/899) sono dietro guard mai true nel runtime browser corrente.

---

## 2. Hardware reference (riepilogo per facile riferimento)

### 2.1 YM2151 OPM

- **Clock**: 3.579545 MHz → output divisor 64 → 55930 Hz sample rate native
- **8 channels × 4 operators** = 32 operatori totali
- **Algoritmi FM**: 0..7 (vedi datasheet § 4.3) — TS impl OK su scaffolding
- **Envelope state machine**: 4-stage (AR / D1R / D2R / RR) per op + D1L sustain level
- **Sine LUT**: 1024 entries × 14-bit signed (-8192..+8191)
- **Output**: 14-bit signed × 8 channels mixed → DAC 14-bit
- **LFO**: 4 waveform, AMD/PMD a livello globale + PMS/AMS per channel
- **Timer A/B**: 10-bit / 8-bit counter, overflow → IRQ 6502 + status flag

**Reference autoritativi**:
- Yamaha YM2151 OPM Application Manual (1985)
- MAME `src/devices/sound/ym2151.cpp` (Jarek Burczynski + Tatsuyuki Satoh)
- Jarek Burczynski FM synthesis documentation (`http://www.musicfromouterspace.com/` archive)

### 2.2 POKEY

- **Clock**: 1.789773 MHz (= 6502 clock)
- **4 tone channels** indipendenti, periodo 8-bit (AUDFn) + 4-bit volume + 3-bit distortion
- **Polynomial counters**:
  - 17-bit LFSR (default noise): tap bit 0 XOR bit 5 (mio) — **da verificare** vs MAME `poly17_init`
  - 9-bit LFSR (modo alternativo, AUDCTL bit 7): tap bit 0 XOR bit 4
  - 5-bit LFSR (filter post-poly9/17): tap bit 0 XOR bit 2
  - 4-bit LFSR (high tones special): tap bit 0 XOR bit 1
- **Distortion modes** (AUDCn bit 7-5):
  - 1xx: pure tone (square wave, no poly)
  - 0xx + poly5 filter (bit 5=0) + poly9/17 (bit 6=0): vari noise patterns
- **Output**: 4-bit volume × 4 channel → mixer
- **AUDCTL** (reg $08): clock select + channel join + poly mode + filter routing
- **Two-tone mode** (SKCTL bit 3) — non rilevante per Marble

**Reference autoritativi**:
- Atari De Re Atari (1982) appendix POKEY
- MAME `src/devices/sound/pokey.cpp`
- Atari Hardware Manual

### 2.3 Sound code Marble (6502)

- ROM 32KB totale ($8000-$FFFF)
- Reset vector @ $FFFC = $8002
- NMI vector @ $FFFA = sound cmd ISR
- IRQ vector @ $FFFE = YM2151 Timer A overflow
- Main loop @ $8002+: init YM2151 + POKEY + Timer A + main poll loop
- ISR NMI legge $1810 → switch byte cmd → tabella jump → routine per cmd specifico
- Routine cmd: scrive YM/POKEY register per programmare voce
- Pattern BGM: loop continuo che scrive YM2151 register per playback nota corrente, key on/off in base a tabelle di tracce

---

## 3. Success criterion

**Obiettivo PRIMARIO**: dato un seed gameplay reale + sequenza cmd MAME-captured, il TS produce sample stream con waveform praticamente identico a MAME (correlation > 0.95 su 60 frame). Marco sente nel browser la BGM "Practice Race" + sound effects (marble roll, fall, OUT-OF-TIME jingle) **riconoscibili** dal cabinato originale.

**Obiettivo SECONDARIO (bonus)**: sample-byte diff vs MAME oracle = 0 byte su 60 frame consecutivi (= chip-perfect totale).

Validazione misurabile:
1. Probe-sound-sample-diff TS vs MAME PCM stream → cross-correlation
2. A/B blind test: Marco confronta audio TS vs audio MAME, fedele almeno per BGM principale
3. Frame-by-frame YM2151 register shadow diff = 0 (V2 register-state parity)

---

## 4. Plan operativo per fasi

### Phase A0 — Cmd flow fix (BLOCKER, 1-2 giorni)

**Goal**: il main TS engine emette cmd al sound 6502 durante gameplay reale.

**Diagnostic**:
1. Instrument tutte sub sound-emit (`soundCmdSend158AC`, `soundCmdSend`, `soundPair15884`, `soundDispatchSend`, `soundMaybe11AC2`) con `console.count`
2. Run browser gameplay coin+start, log quante volte ogni sub chiamata in 10s
3. Identificare quali sub vengono chiamate e quali no
4. Per quelle NON chiamate, trovare caller (`helper-121b8.ts`, etc.) e verificare il guard

**Fix possibili**:
- Se `chipPending=true` di default → cambia default a false nel caller browser-path
- Se skip flag word $4003B8 ≠ 0 → identifica chi lo setta e quando (probabilmente è "attract mode = sound off")
- Se path gameplay attivo non triggera la sub → forzare gli emit con state.workRam patch

**Success criterion**:
- Dopo coin+start+gameplay 5s, almeno 50+ cmd inoltrati al sound chip
- YM2151 register $20-$7F (channel/op params) scritti non-zero

**File touched**: `packages/engine/src/sound-cmd-send-158ac.ts`, `helper-121b8.ts` (forse), `main.ts` web

---

### Phase A1 — Cycle-exact 6502 (1 settimana)

**Goal**: closure 387B audioRam diff @ f600 → 0 byte.

**Diagnostic**:
1. Bisect frame per identificare primo frame con diff (es. f246, f250, f260...)
2. Dump audioRam delta byte-by-byte → identifica offsets specifici
3. Tracing 6502 PC per ogni frame intermedio: dove diverge TS vs MAME?
4. Hypothesis: page-cross penalty cycle, branch taken cycle, indexed addressing mode

**Approach**: usare Tom Harte 65x02 dataset esteso per multi-step run (non solo single-step). Confronto state-by-state.

**Success criterion**:
- probe-sound-diff @ f600 con hold=245: 0 byte audioRam diff

**File touched**: `packages/engine/src/m6502/cpu.ts`, `cycle-table.ts`, `opcodes.ts`

---

### Phase A2 — YM2151 envelope rate table MAME-exact (3-4 giorni)

**Goal**: envelope generator produce stesso attenuation per ogni sample, identico a MAME.

**Reference**: MAME `ym2151.cpp` ha tabelle `eg_rate_select[64]` + `eg_inc[]` con valori esatti.

**Tasks**:
1. Estrarre `eg_rate_select` (64 valori) + `eg_inc[7]` da MAME source
2. Sostituire `ENV_RATE_TABLE` mia approssimazione con tabella MAME
3. Implementare key scaling: rate effettivo = rate base + (KC >> KS) >> 1
4. Implementare curve esponenziale attack (non lineare, MAME usa formula `att -= ((att >> 4) + 1)`)
5. Test: dato (AR=31, D1R=0, D1L=0), envelope attack tempo deve essere ~17ms (sample @ 55930 Hz)

**Success criterion**:
- Test unit envelope: pattern (AR, D1R, D2R, RR) produce stessa curva di MAME ym2151 simulator

**File touched**: `packages/engine/src/audio/ym2151-envelope.ts`, `ym2151-tables.ts`

---

### Phase A3 — YM2151 operator FM log/exp domain (3-4 giorni)

**Goal**: operator chain produce sample identico a MAME.

**Reference**: MAME `ym2151.cpp:op_calc` usa log2-domain mixing.

**Tasks**:
1. Implementare `tl_table[256]` (TL → log2 attenuation 8-bit) come MAME
2. Implementare `sine_lut` come **log2-domain** (12-bit attenuation index, NON linear amplitude come mio)
3. Implementare `exp_table[256]` per conversione log2→linear @ output
4. Operator chain: `att = sin_log[(phase+mod) >> 10] + env_log + tl_log` → output = `±exp_table[att]`
5. Phase accumulator: 20-bit, `phaseInc` calcolato via `freq_table[KC][KF]` + DT1 offset + MUL
6. Modulation accumulation: bit 16-14 della phase (= 4096-step modulation)

**Success criterion**:
- Single operator output con KC=$4A AR=$1F D1L=0 TL=0 = waveform pure sine @ ~277Hz (matched a MAME)

**File touched**: `ym2151-operator.ts`, `ym2151-tables.ts`

---

### Phase A4 — YM2151 LFO PM (2 giorni)

**Goal**: vibrato (phase modulation via LFO) attivo per channel.

**Tasks**:
1. LFO output (saw/sq/tri/random) → PM offset 8-bit
2. Per channel: PM offset scalato da PMS sensitivity (0..7 → 0..1.0)
3. Apply PM al phase accumulator di ciascun op del channel
4. Channel recompute phaseInc ad ogni sample (NOT solo a key-on)

**Success criterion**:
- Channel con PMS=7 + LFRQ=128 (1Hz) + waveform=2 (triangle) → audible vibrato sinusoidale @ 1Hz

**File touched**: `ym2151.ts:ym2151Sample`, `ym2151-channel.ts:channelSample`

---

### Phase A5 — POKEY LFSR + AUDCTL routing (2-3 giorni)

**Goal**: POKEY noise + tone bit-perfect MAME.

**Tasks**:
1. Verify LFSR taps per ogni poly (4/5/9/17-bit) confrontando con MAME `pokey.cpp:poly_init`
2. Implementare AUDCTL bit 4/3: channel join 16-bit (CH1+CH2, CH3+CH4)
3. Implementare AUDCTL bit 5/6: CH1/CH3 clock source select (1.79MHz vs 64KHz)
4. Implementare AUDCTL bit 1/2: CH2/CH4 high-pass filter routing
5. Test: noise distinto su distortion 0x80 (pure) vs 0x20 (poly5 filter) vs 0x40 (poly4 filter)

**Success criterion**:
- Marble rumble sound (mappato in `5262c5e` cue mapping di Codex) = identical pattern noise

**File touched**: `packages/engine/src/audio/pokey.ts`

---

### Phase A6 — Sample-level diff tool (2-3 giorni)

**Goal**: probe-sound-sample-diff confronta sample PCM TS vs MAME.

**Tasks**:
1. Estendere `oracle/mame_sound_dump.lua` per dumpare sample stream (via `manager.machine.sound.system_buffers` o tap su DAC output)
2. Output: WAV mono/stereo @ 55930 Hz × N secondi
3. Nuovo `packages/cli/src/probe-sound-sample-diff.ts`:
   - Carica MAME WAV + run TS sound chip con stessa sequenza cmd
   - Sample-by-sample diff con tolleranza (-/+1 LSB)
   - Output: % matching samples, first divergence, RMS error
4. Cross-correlation per validation acustica (anche con cycle skew, audio "suona uguale" se correlation > 0.9)

**Success criterion**:
- Dump test cmd sequenza coin+intro+gameplay → cross-correlation TS vs MAME > 0.95

**File touched**: nuovo file, `oracle/mame_sound_dump.lua` esteso

---

### Phase A7 — End-to-end validation (2-3 giorni)

**Goal**: Marco sente BGM Marble + sound effects riconoscibili in browser.

**Tasks**:
1. Probe-sound-sample-diff su 5 scenari (intro_overlay, coin_start, level1_spawn, marble_falling, game_over)
2. A/B blind test: Marco confronta TS browser vs MAME desktop su stessi scenari
3. Frame-by-frame diff YM2151 register shadow durante gameplay → 0 byte verificato 60 frame
4. Documenta gap residuo (es. envelope timing micro-skew accettabile se audio sentibile uguale)
5. Update README + STATUS con audio-chip-perfect milestone reached

**Success criterion**:
- Marco riconosce immediatamente la BGM Marble nel browser senza supporti visivi
- Sound effects (marble roll, fall, OUT-OF-TIME) percepiti come quelli originali

**File touched**: README, STATUS, eventuali tuning final params

---

## 5. Stima tempi

| Phase | Effort | Confidence |
|---|---|---|
| A0 Cmd flow fix | 1-2g | High (diagnostic chiaro) |
| A1 Cycle-exact 6502 | 5-7g | Medium (potrebbe richiedere drill profondo) |
| A2 Envelope rate table | 3-4g | High (tabelle MAME disponibili) |
| A3 Operator FM log/exp | 3-4g | High (algoritmo MAME documentato) |
| A4 LFO PM | 2g | High (incremental su A2) |
| A5 POKEY LFSR + AUDCTL | 2-3g | High (LFSR taps verificabili) |
| A6 Sample diff tool | 2-3g | Medium (MAME audio capture potrebbe richiedere setup) |
| A7 E2E validation | 2-3g | High (validation step) |
| **Totale** | **20-28g calendario** | |

= ~3-4 settimane di lavoro effettivo (Claude + Codex paralleli ridurrebbero a 2-3 settimane reali).

---

## 6. Rischi e mitigazioni

### Rischio 1: cycle-exact 6502 richiede più di una settimana

**Mitigation**: A1 può essere completata "good enough" se diff < 50B @ f600 (= audio comunque sentibile come MAME). Closure 0-byte completo è bonus.

### Rischio 2: log/exp domain implementation rompe envelope già funzionante

**Mitigation**: keep TS implementation lineare attuale dietro flag `LEGACY_LINEAR`, log/exp è new branch. A/B test su test unit.

### Rischio 3: MAME audio capture difficile via Lua

**Mitigation**: fallback su `mame -aviwrite output.avi` per registrare audio + estrazione audio track via `ffmpeg`.

### Rischio 4: Cmd flow fix richiede touch a engine sub Codex

**Mitigation**: usa hook pattern (già introdotto), evita modifica caller. Se proprio serve, faccio surgical edit + test parity per ogni sub modificata.

---

## 7. Deliverable

1. **Audio Marble Madness riconoscibile in browser** (success primario)
2. **probe-sound-sample-diff tool** per future regression testing
3. **YM2151 + POKEY chip-perfect** documentati con riferimenti MAME
4. **Cmd flow main↔sound wirato** per future feature
5. **README + STATUS aggiornati** con milestone audio chip-perfect

---

## 8. Progress log (2026-05-15)

### Sessione 1 (commit `6288837` .. `adb2f19`)

| Phase | Status | Commit | Note |
|---|---|---|---|
| **A0** Cmd flow diagnostic | 🔴 BLOCKER aperto | `6288837` | Trace tutte sub-emit: 0 calls in 15s gameplay. Counter `__sound158ACCount` / `__soundPair15884Count` / `__soundTickDispatchCount` in globalThis. workRam byte queue $401F44 mai popolato. |
| **A1** Cycle-exact 6502 | 🟡 aperto | — | 387B audioRam @ f600 invariato. |
| **A2** Envelope rate MAME | ✅ done | `831b200` | ENV_RATE_SHIFT[64] + ENV_RATE_SELECT[64] + EG_INC[19×8]. |
| **A3** Attenuation dB | ✅ done | `831b200` | ATT_TO_LINEAR[1024] esponenziale 96dB. |
| **A4** LFO PM vibrato | ✅ done | `831b200` | pmOffset = lfoOutput × PMD × PMS × 4. |
| **A5** POKEY AUDCTL | ✅ done | `831b200` | Channel join 16-bit + poly9. |
| **A6** Sample diff tool | ✅ done | `adb2f19` | probe-sound-sample-diff.ts cross-correlation. |
| **A7** E2E validation | 🟡 pending | — | Richiede A0 fix + MAME WAV capture. |

35/35 test PASS. Build PWA 795KB.

**Blocker per "audio originale in browser"**:

1. **A0**: gameplay sub che popolano byte queue $401F44 non eseguite in runtime → no cmd al sound 6502 → no audio chip-level.
2. **A1**: 387B cycle skew → ISR sound code scrive register diversi da MAME.

**Decisione strategica**: DSP audio infrastructure completa (A2-A6). Quando A0+A1 fixed, audio chip-perfect emergerà automaticamente. Manca il "feed" di cmd reali.

## 9. Progress log (2026-05-17) — Bypass A0 via cmd-tape replay

Strategia: invece di sbloccare A0 nel dominio Codex (gameplay sub), bypassare
completamente registrando i sound cmd da MAME e replicandoli al chip TS via
`submitCommand` al frame esatto. Il cmd flow main→sound diventa una "tape"
deterministica.

### E1 — MAME cmd-tape capture ✅

- `oracle/mame_sound_cmd_capture.lua`: install write tap su `$FE0001`
  (soundlatch) sul main 68K + read taps a osservazione su `$F60001` (switches),
  `$1820` (coin port sound CPU), `$FC0001` (sound response). Inietta coin pulse
  f1200..f1214 e start pulse f1500..f1514 via `ioport_field:set_value`. Polarita'
  verificata empiricamente: Coin 1 = 0 quando pressed (IP_ACTIVE_LOW), 1 Player
  Start = 1 quando pressed.
- **Root cause "0 cmds" iniziale**: i tap handle restituiti da
  `install_*_tap` venivano GC-collected immediatamente. Senza riferimento Lua
  che li tenga in vita, il tap smette di firare. Fix: `tap_handles = {}` +
  `table.insert(tap_handles, handle)` per ogni install (stesso pattern di
  `mame_playable_input_capture.lua`). Bug critico, non documentato.
- Output: `oracle/scenarios/sound-cmd-tape-attract.json` con **2941 cmds**
  registrati su 3000 frame (50s emulati). Distribuzione: 0x03 = 94%
  (tick/keep-alive), 0x07 = 5%, + 15 byte vari (0x00..0x61) per eventi
  specifici.

### E2 — MAME WAV reference ✅

- `mame -wavwrite /tmp/marble_attract.wav -seconds_to_run 60` con stesso
  autoboot script. Output: 50.06s @ 48000 Hz stereo, 2.4M sample-frame, 9.6MB.

### E3 — TS cmd-tape player ✅

- `packages/engine/src/m6502/sound-chip.ts`: aggiunto `loadCmdTape(tape)`
  + `tickFrameWithTape(chip, tape, frame)` con cmd spread sub-frame (mailbox
  edge-triggered: cmd back-to-back nello stesso frame senza tick intermedio
  collassano).
- `packages/engine/src/index.ts`: export `CmdTape`, `LoadedCmdTape`,
  `loadCmdTape`, `tickFrameWithTape`.
- `packages/web/src/sound-replay.ts`: ramo isolato `?soundReplay=<path>` che
  fetcha la tape JSON, istanzia chip standalone, mostra "Start Replay"
  button (user gesture per AudioContext), loop @60fps via setInterval.
  Riavvolge a frame 0 quando la tape finisce (replay infinito).
- `packages/web/src/main.ts`: intercept singolo dopo ROM load — se
  `soundReplay` set, chiama `runSoundReplay(rom, url)` invece di
  `startGame(rom)`. Non tocca il ramo `?sound=1` normale (resta dipendente da
  Codex).

### E4 — Validation cross-correlation ❌ (chip silente)

`probe-sound-sample-diff --frames 3000`:

```
TS YM2151 samples: 5,593,240 (= 2,796,620 stereo @ 55930Hz)
TS POKEY samples:  699,155 mono @ 13990Hz
Cross-correlation TS vs MAME: 0.0000
RMS: 0.0000
```

**Diagnosi**: il TS SoundChip riceve i cmd correttamente (mailbox pending +
reply queue popolata) ma produce sample stream completamente nullo
(`maxAbs = 0.000e+0` su 5.6M sample YM). Inspect register shadow @ f600:

- YM2151 non-zero regs: SOLO `$10=$C8` (Timer A counter) + `$14=$05`
  (Timer A load + clear flag A, **senza bit 4 IRQ_EN_A**).
- POKEY non-zero regs: SOLO `$0F=$03` (SKCTL).
- Tutte 8 voci YM2151: TL=0, AR=0, env=OFF → silent.
- 4 voci POKEY: AUDF=0, AUDC=0 → silent.
- 6502 ha girato 17.9M cycle (esattamente 600 × 29830 = SOUND_CYCLES_PER_FRAME),
  audioRam ha 117 byte non-zero a f600 — la sound CPU **sta eseguendo codice**
  ma non raggiunge il dispatcher musica che scriverebbe i voice register.

**Root cause**: il sound 6502 TS non esegue lo stesso path della MAME 6502
per i cmd di tape. Sospetti (in ordine di probabilita'):

1. **A1 cycle skew**: 387B audioRam diff a f600 vs MAME → stack/state diverge
   nel cmd dispatcher → branch a routine "noop" invece di routine "play note".
2. **Timer A IRQ wiring**: `timerAOverflow=true` + `timerAIrqEnable=false` →
   gli overflow di Timer A non triggerano IRQ. Marble's music sequencer potrebbe
   essere IRQ-driven (non NMI-only). Se MAME's 6502 abilita IRQ in un'altra
   write a $14 (es. `$14=$15` o `$14=$11` in code path successivo), la TS chip
   potrebbe averla persa per A1 cycle skew.
3. **NMI re-entry race**: cmd back-to-back con NMI handler in corso. Mailbox
   `pending=true` blocca edge re-trigger. Spread sub-frame applicato ma non
   risolve tutto.

### E5 — Verify + commit ✅

- `npx tsc -b --pretty false`: PASS.
- `npx vitest run packages/engine/test/sound packages/engine/test/m6502
  packages/engine/test/ym2151 packages/engine/test/pokey`: **143 passed |
  3 skipped (146)** — tutti i test sound-domain passano.
- 2 fail in `packages/engine/test/playable-live-routes.test.ts` non
  correlate alle mie modifiche (Codex parallel work in helper-121b8 / state /
  sub-29cce, lasciate WIP nel working tree — non committate qui).

### Stato corrente — onesto

**Cosa funziona**:

- Infrastructure end-to-end: capture MAME → tape JSON → TS replay → AudioContext.
- 2941 cmd reali deterministici registrati e replicabili.
- Quando A1 o il chip semantics gap sara' chiuso, il path cmd-tape attiverà
  immediatamente audio chip-perfect senza tocchi al dominio Codex.

**Cosa NON funziona**:

- TS chip produce silenzio assoluto: voice register YM2151/POKEY non scritti.
- Cross-correlation 0.0 (success criterion era > 0.9 su ≥60 frame).
- Il gap **non e' nel DSP** (envelope/attenuation/LFO/AUDCTL — tutto chip-perfect
  in A2-A5). E' nel **sound 6502 execution path** che non raggiunge il
  music dispatcher. Drill A1 (cycle-exact) necessario.

**Next steps suggeriti**:

1. Drill A1: bisect frame-by-frame audioRam diff vs MAME (387B @ f600). Trovare
   primo opcode/cycle che diverge. Hypothesis: page-cross penalty, branch-taken
   cycle, indexed addressing penalty in M6502 cycle table.
2. Alternativamente, hot-patch il TS `$14` write per forzare IRQ_EN_A=1
   dopo l'init. Se Marble's dispatcher e' IRQ-driven, questo dovrebbe far
   partire il music sequencer e produrre audio (anche se non bit-perfect).
3. Estendere `probe-sound-sample-diff` per dump shadow register frame-by-frame
   → identificare a quale frame i due chip divergono.

## 9. Approval

Marco approva il plan completo o vuole modifiche / priorità diverse?
