# Sound System — comunicazione 68010 ↔ 6502

> **Status:** SoundChip replay path active. The corrected Coin 1 oracle captured
> on 2026-05-22 now has full ordered YM2151/POKEY event parity after fixing the
> LS259 `write_d0` map: `$1820-$1827` are bit-addressed latch outputs, and only
> `$1820` bit 0 drives YM reset. The promoted corrected run matches all
> `375161` YM writes and all `257739` POKEY writes over `14000` frames with
> reset-delay `25`, embedded reply acks, `frameTolerance=1`, and the corrected
> full MAME logs. The matched corrected Coin 1 WAV is decision-quality. Full
> replay `source=ym` and `source=mix` PCM now pass the 14000-frame corrected
> Coin 1 gate without the old key-on selector after the absolute-origin
> `mame-stream` drain was fixed to use the same `floor((origin+cycles)*rate)`
> sample target as YM writes. Current default replay uses absolute YM stream
> origin, MAME-LoFi YM/POKEY resamplers, Timer/LFO reg `0x18:+1`, and lag-tie
> epsilon `0.01`; the selected corrected-WAV windows are still YM-dominant.
> The short forced `inject0005`
> oracle now has current POKEY-audible mixed gates both with the older POKEY
> linear `resampleOffset=-0.75`/output `+3` diagnostic and with the newer
> absolute-origin YM settings plus full-clock POKEY/MAME-LoFi/output `-1`.
> The CLI PCM probe streams SoundChip POKEY resampling when channel diagnostics
> are off, so full-clock POKEY no longer requires keeping hundreds of millions of
> native samples in memory for long replays. The current same-run `inject001f`
> POKEY-audible oracle is now green through the SoundChip path for all
> MAME writes after two timing fixes: YM timer status latches only when the
> enable bit is set at overflow, and deterministic replay applies a
> one-instruction command-NMI latency. The 1701-frame same-run oracle compares
> all `27198` TS/MAME POKEY writes with `0` mismatches; the earlier 9-write TS
> tail in the 1700-frame run was a cutoff artifact. The matching POKEY-only PCM
> gate passes all 168 selected windows at worst correlation `0.9967`, lag `2`,
> RMS `0.00502`, and maxAbs `0.06613`. The same Lua tap can now emit YM and
> POKEY logs from one non-muted MAME run; the 1701-frame mixed same-run oracle
> compares all `51163` YM and `27198` POKEY writes with `0` mismatches and
> passes all `168` POKEY-selected mixed PCM windows at worst correlation
> `0.9644`, lag `2`, RMS `0.02921`, and maxAbs `0.21487`. The all-window mixed
> gate no longer fails the later YM-only tail when the overfit Timer/LFO
> `0x18:+1` event-offset diagnostic is removed. With global YM event offset
> `+30`, the frame-860 sensitive burst compensated by `-40`, MAME-LoFi
> resampling, full-clock POKEY, and command-NMI delay `1`, the same-run mixed
> audible-window gate at threshold `0.001` passes `212` selected windows with
> worst correlation `0.9780` and worst abs lag `2`; the late YM-only tail
> windows are correlation `~1.0000`. Strict native-sample write timing is still
> open as a scheduler model, but the current diagnostics-only mixed replay
> preset no longer uses YM write-offset frame selectors. Instead it uses
> command-source/current-event rules for the three localized YM boundary classes:
> the frame-860 `0x03` burst from source PC `0x85f3` with `-40` cycles, the
> frame-1310 `0x1b` setup/key-on class with `+30` cycles, and the later
> channel-2 bursts from source PCs `0x8d5a`/`0x80f5` with `+5` cycles. With
> command-NMI delay `1`,
> MAME-LoFi YM/POKEY resampling, full-clock POKEY, POKEY output offset `+1`,
> the report-only POKEY `0x91=23` timestamp diagnostic, and mandatory cmd-tape
> command context, preset reruns
> `chip-write-diff-both-commandedge-preset-command-source-no-ymmatches.json`
> and
> `pcm-diff-inject001f-1701-runtime-mix-commandedge-preset-command-source-no-ymmatches.json`
> compare all `51163` YM writes and `27198` POKEY writes with `0` mismatches and
> pass `212` audible mixed PCM windows at worst correlation `0.9974`, lag `1`,
> RMS `0.00704`, and maxAbs `0.06602`. These offsets remain diagnostic evidence
> rather than a promoted gameplay scheduler; the causal event-boundary model is
> still the next implementation target.
> The latest focused split shows the true global peak in that gate is YM channel
> 0, not POKEY: POKEY runtime and direct-MAME agree sample-for-sample, while
> the runtime YM channel-0 feedback/phase history is one native YM sample early
> from a frame-1310 setup/key-on burst. A diagnostics-only `+30` cycle selector
> for that frame-1310 channel-0 burst improves runtime-vs-direct YM all-window
> to `corr=0.9954`, RMS `0.00395`, maxAbs `0.05842`, and improves the real
> mixed WAV gate to `corr=0.9974`, RMS `0.00704`, maxAbs `0.06602`. The probe
> now also supports a `current-event` command-edge anchor, which reproduces the
> same result without naming frame `1310`: command byte `0x1b`, rawDelta
> `20000..24100`, and current-event anchoring apply `+30` to the setup/key-on
> class (`36` writes). The latest command-PC ablation removes the older
> `soundPc=0x8126` selector and keeps both the chip diff and PCM gates green.
> Removing the separate frame `1437/1458` channel-2 selectors still fails on the
> old mixed peak (`maxAbs=0.21865`), so the `0x8126` current-event class and
> the later channel-2 burst remain two distinct diagnostic timing problems. The
> command-edge candidate replaces the frame-specific `1437/1458` selectors with
> two command-source ranges:
> `0x03:13100:14000:5:raw-before:0:18000:0x8d5a:current-event`
> and
> `0x03:16600:17500:5:raw-before:0:18000:0x80f5:current-event`.
> The intermediate write-PC and `reg=value` selector controls have both been
> removed. Artifact
> `current-preset-ym-ch2-no-regvals/pcm-diff-current-preset-ym-ch2-no-regvals.json`
> passes the same `212` audible windows at `corr=0.997409`,
> RMS `0.005375`, maxAbs `0.063317`, lag `1`, with `270` YM and `36` POKEY
> command-edge adjustments. The paired chip-write report
> `current-preset-ym-ch2-no-regvals/chip-write-diff-current-preset-ym-ch2-no-regvals.json`
> compares YM `51163/51163` and POKEY `27198/27198` with zero tolerance-1
> mismatches.
> This is still diagnostic, not a promoted gameplay scheduler; the scheduler
> rule still needs a causal explanation before promotion.
> `probe-chip-write-diff.ts` has the same anchor now. With that rule, the
> mixed `inject001f` oracle compares all `51163` YM writes with no reg/val/PC
> drift and reduces strict native-sample timing to `45956` exact writes,
> `51035` within `±1`, and `128` outside `±1`. POKEY order on the same oracle
> is already exact: `27198/27198` writes, `0` mismatches. The chip-write diff
> now records `nativeSampleMismatchByCommandSource` for those residuals. The
> current breakdown groups the `128` YM outliers into `49` command-source
> buckets; the dominant classes are three far `0x03` bursts
> (`0x83fc`: `37` writes at `+80` cycles, `0x841e`: `23` at `+62`,
> `0x8e84`: `16` at `+80`). The remaining `52` are command-edge/near or
> isolated negative-delta rows, mostly `0x03` crossings around `-143..-151`
> cycles plus long `0x07`/`0x10` cases. This continues to point at command/NMI
> sample-event placement rather than a YM register-class fix. A focused
> follow-up keeps the normal sample point plus frame `1130/1250` delay
> overrides and confirms the report remains at `128` mismatches; changing only
> that diagnostic sample point to `--command-nmi-sample-cycle Infinity` with the
> same four overrides removes the three far bursts and leaves `52` YM residuals.
> Artifact
> `chip-write-diff-currentevent1310-frameoverride-nosamplepoint-commandbreakdown.json`
> reports `{0:45983,1:2781,-1:2347,-3:1,-4:24,-5:23,-8:3,-9:1}`. Under the
> same preset, POKEY remains exact in
> `chip-write-diff-pokey-order-frameoverride-nosamplepoint-cmdnmi1.json`
> (`27198/27198`, `0` mismatches), and the mixed PCM gate
> `pcm-diff-inject001f-1701-runtime-mix-commandedge1310-currentevent30-frameoverride-nosamplepoint-pokeyout1-cmdnmi-aud001.json`
> stays green at correlation `0.997409`, lag `1`, RMS `0.007037`, maxAbs
> `0.066018`. This is a localization proof, not a promoted rule, because the
> frame-specific overrides still need a causal event-boundary model.
> A fresh diagnostic rule pack closes the remaining YM event gate for this
> oracle: `chip-write-diff-currentevent1310-frameoverride-nosamplepoint-ymzero-commandedge.json`
> compares all `51163` ordered YM writes with `0` native-sample mismatches at
> tolerance `±1`, histogram `{0:46011,1:2782,-1:2370}`. It applies `88`
> command-edge adjustments: the prior `36` current-event writes for command
> `0x1b`, plus `52` residual boundary writes (`0x03=47`, `0x07=4`,
> `0x10=1`) with target delays `138/144/155/176/296` cycles. The matching PCM
> report
> `pcm-diff-inject001f-1701-runtime-mix-currentevent-frameoverride-nosamplepoint-ymzero-commandedge-pokeyout1-cmdnmi-aud001.json`
> remains green with the same worst metrics: correlation `0.997409`, lag `1`,
> RMS `0.007037`, maxAbs `0.066018`. Keep this as diagnostic evidence only:
> the rule pack still names command PCs/raw-delta buckets instead of modeling
> the underlying bus/NMI event boundary.
> The refreshed command-source breakdown adds TS/MAME deltas from the nearest
> command and target delay windows for the accepted MAME native-sample
> interval. With those fields, the compact YM byte-boundary rerun
> `chip-write-diff-currentevent-frameoverride-nosamplepoint-byteboundary-general2-commandedge.json`
> compares all `51163` YM writes with `0` tolerance-1 native-sample
> mismatches (`{-1:2372,0:46009,1:2782}`). The companion POKEY diagnostic uses
> report-only opcode offset `0x91=23` plus compact command-edge rules for
> command bytes `0x03` and `0x07`; artifact
> `chip-write-diff-pokey-op91p23-commandedge-general2.json` compares all
> `27198` POKEY writes with `0` tolerance-1 native-sample mismatches
> (`{-1:6126,0:20752,1:320}`). Combined artifact
> `chip-write-diff-both-sampletiming-ymgeneral2-pokeyop91p23-commandedge.json`
> keeps both chips green in one run. This remains diagnostic, not promoted
> runtime behavior: YM still includes command-source/current-event diagnostic
> matchers, while POKEY still uses a report-only `0x91` timestamp offset plus
> command-edge rules.
> The matching mixed PCM gate
> `pcm-diff-inject001f-1701-runtime-mix-ymgeneral2-pokeyop91p23-commandedge-pokeyout1-cmdnmi-aud001.json`
> passes all `212` audible MAME-selected windows with correlation `0.997409`,
> lag `1`, RMS `0.007037`, maxAbs `0.066018`, and source split
> `{ym:49,pokey:88,mixed:75,silent:0}`. The paired `first-read` localization
> artifact
> `pcm-diff-inject001f-1701-runtime-mix-cmdedge-both-firstread-prepass-pokeyop91p23-cmdnmi-aud001.json`
> still fails (`corr=0.977963`, lag `2`, RMS `0.023118`, maxAbs `0.218646`),
> so the promotion target remains a current-event/command-boundary model, not
> first-read timestamp replay.
> The diagnostic pack is now also available as
> `--audio-bitperfect-preset inject001f-1701-commandedge` in
> `packages/cli/src/audio-bitperfect-presets.ts`. Preset reruns
> `chip-write-diff-both-commandedge-preset-command-source-no-ymmatches.json` and
> `pcm-diff-inject001f-1701-runtime-mix-commandedge-preset-command-source-no-ymmatches.json`
> reproduce the same green write and PCM gates without hand-written rule
> strings. The CLI and web presets now use current-event YM rules for `0x85f3`,
> `0x8d5a`, and `0x80f5`, and the `0x1b` current-event class no longer needs a
> command-source PC; the preset no longer emits `ymWriteEventCycleOffsetMatches`.
> The CLI preset now also sets
> `--require-command-context`, matching browser
> `soundReplayRequireCommandContext=1`; old public replay tapes without timing
> or `soundPc` fail explicitly instead of silently missing command-PC rules.
> Fresh guarded reruns
> `chip-write-diff-both-commandedge-preset-require-context.json` and
> `pcm-diff-inject001f-1701-runtime-mix-commandedge-preset-require-context.json`
> keep the same zero-mismatch write gate and `212`-window PCM gate green. The
> current preset PCM gate is guarded with
> tighter zero-lag thresholds (`corr>=0.995`, `absLag=0`, `RMS<=0.006`,
> `maxAbs<=0.045`) after promoting POKEY `--pokey-resample-offset 23.25`.
> The local sweep first found `16.5` as the best lag-search RMS point, then
> zero-lag controls selected `20`, `22.6`, and later `23.25`: artifact
> `pcm-diff-inject001f-1701-commandedge-preset-pokeyresample2000-zero-lag.json`
> passes all `212`
> audible windows at `corr=0.995850`, lag `0`, RMS `0.005375`, and maxAbs
> `0.063239`; the latest sample-before-step `23.25` zero-lag artifact
> `pcm-diff-inject001f-1701-commandedge-preset-pokey2325-zero-lag.json`
> improves maxAbs to `0.041395`; this zero-lag path is now the serialized
> current-preset gate, while the old lag-search run stays diagnostic around
> `corr=0.997409`, lag `1`, RMS `0.005535`, and maxAbs `0.063317`. The paired write artifact
> `chip-write-diff-both-commandedge-preset-pokeyresample2000.json` keeps
> `51163` YM and `27198` POKEY writes at `0` mismatches. The sample `723135`
> trace now lands at TS
> `0.11056` vs MAME `0.10925`, so the old POKEY edge is no longer the peak
> residual. Reruns under `current-validation/` keep YM/POKEY at zero
> tolerance-1 mismatches and the `212` audible-window PCM gate green.
> The latest POKEY fidelity patch models MAME's hidden startup `AUDC=0xb0`
> until each channel receives its first AUDC write, while preserving the
> external `writeRegs` shadow as zero. `resetSoundChip` now uses `pokeyReset`
> so the hidden AUDC mask and raw latch reset with the POKEY core. The refreshed
> current-validation rerun keeps YM `51163/51163` and POKEY `27198/27198` at
> `0` mismatches, and the old lag-search mixed PCM gate remains green at
> correlation `0.997409`, lag `1`, RMS `0.005535`, and maxAbs `0.063317`; the
> promoted zero-lag report stays green at correlation `0.996571`, lag `0`, RMS
> `0.005535`, and maxAbs `0.041395`. A focused post-clock POKEY sampling
> diagnostic (`--pokey-sample-after-clock`) was tested and rejected as a
> default: it only improves the `567780` runtime-vs-direct edge from
> `0.048362` to `0.047644` and slightly worsens the full WAV gate RMS. The
> rejected controls are also documented: fractional
> POKEY clocking regressed to correlation `0.9550`, output offsets `0`/`-1`
> regressed, and resample offsets `22`/`24.5` did not beat the current `23.25`
> compromise. A temporary absolute-phase LoFi resampler control improved
> zero-lag RMS to `0.00481` but worsened maxAbs to `0.04403`, then failed the
> lag-search gate at maxAbs `0.06680`; it was reverted. The residual peak is
> still a localized POKEY edge near sample `569319`, not chip-write
> order/content.
> The current preset's command-NMI delay matches have been generalized from the
> four frame-specific `1130/1250` rows to byte+cycle selectors
> `*:0x15:0:0,*:0x19:0:0,*:0x03:538:0,*:0x03:623:0` in both the CLI and web
> preset tables. Current-preset artifacts
> `generalize-nmi-boundary/chip-write-diff-current-preset-wildcard-delaymatches.json`
> and
> `generalize-nmi-boundary/pcm-diff-current-preset-wildcard-delaymatches.json`
> keep `51163` YM and `27198` POKEY writes at `0` tolerance-1 mismatches and
> pass all `212` audible windows (`corr=0.997409`, lag `1`, RMS `0.005549`,
> maxAbs `0.063317`, split `{ym:49,pokey:88,mixed:75}`). This fires on `10`
> commands and is a cleaner diagnostic than the frame-specific override, but it
> is not a causal scheduler model. The broader boundary control
> `--command-nmi-delay-chip-write-boundary 0` is rejected because it fires on
> `25` commands and reintroduces `76` YM plus `15` POKEY tolerance-1
> mismatches.
> `probe-chip-write-diff.ts` now emits
> `commandSubmitDiagnostics.overrideBySelector` for those matches. Current
> artifact
> `command-nmi-selector-diagnostics/chip-write-diff-current-preset-selector-diagnostics.json`
> keeps the write gate green and reports selector hits as `0x03@538` on frames
> `800/1010/1130`, `0x03@623` on `1250/1280/1310/1340/1400`, plus single
> frame-start commands `0x15@0` at `1130` and `0x19@0` at `1250`; all have
> `pendingBefore=false` and actual-submit deltas of `0..2` cycles. The paired
> PCM rerun
> `command-nmi-selector-diagnostics/pcm-diff-current-preset-selector-diagnostics.json`
> uses the current POKEY `23.25` resample offset and passes `212` audible
> windows (`corr=0.997409`, lag `1`, RMS `0.005535`, maxAbs `0.063317`,
> split `{ym:49,pokey:88,mixed:75}`). This turns the wildcard override from an
> opaque table entry into an auditable target for the next causal
> command/NMI-boundary model.
> `tickFrameWithTape` now emits diagnostic last-step context on command submit,
> and `probe-chip-write-diff.ts` records it per
> `commandSubmitDiagnostics.overrideBySelector`. Artifact
> `command-nmi-step-context/chip-write-diff-current-preset-step-context.json`
> keeps YM `51163/51163` and POKEY `27198/27198` green with zero tolerance-1
> mismatches, while showing all `10` wildcard delay-0 overrides outside
> interrupt service and with `pendingBefore=false`. The frame-start `0x15@0`
> and `0x19@0` hits both cross frame start in `0x8120:0xae`; the `0x03@538`
> and `0x03@623` hits have varied last-step PCs/opcodes but target offsets
> inside the just-completed normal instruction of `1..5` cycles and end deltas
> of `0..2`. The paired PCM rerun
> `command-nmi-step-context/pcm-diff-current-preset-step-context.json` passes
> all `212` audible windows (`corr=0.997409`, lag `1`, RMS `0.005535`,
> maxAbs `0.063317`). This points the promotion work at a sub-instruction
> command/NMI sampling model, not at a simple PC selector or interrupt-service
> special case.
> `probe-chip-write-diff.ts` now also records
> `commandSubmitDiagnostics.byDelay` for every command submit. Artifact
> `command-nmi-all-submit-diagnostics/chip-write-diff-current-preset-all-submit-diagnostics.json`
> keeps the same green write gate and rejects a simple last-step-context
> promotion: the `10` delay-0 commands have target offsets `1..5` and end
> deltas `0..2`, but the `1569` delay-1 commands heavily overlap that range
> (`targetOffset 1=487, 2=483, 3=325, 4=221, 5=39`; end delta
> `0=483, 1=476, 2=346`). Almost all delay-1 commands are also normal
> non-interrupt steps (`1566/1569`). The next useful probe is therefore a
> direct MAME-vs-TS command-write sample/bus-phase comparison, not another
> rule based only on the just-completed PC/opcode/offset.
> A current worktree rerun under `current-rerun-20260523-223959/` confirms the
> serialized `inject001f-1701-commandedge` preset is still green on the
> same-run mixed oracle. `chip-write-diff-current-preset-rerun.json` keeps
> `51163/51163` YM and `27198/27198` POKEY writes at `0` mismatches with native
> tolerance `±1`; `pcm-diff-current-preset-rerun.json` passes all `212` audible
> windows at `corr=0.997409`, lag `1`, RMS `0.005535`, and maxAbs `0.063317`.
> The paired strict diagnostic
> `chip-write-diff-current-preset-sampletol0-rerun.json` leaves `5118` YM and
> `6446` POKEY exact native-sample bucket mismatches, all within `±1` sample and
> with no reg/val/order drift. Treat that as the current bit-perfect gap:
> sample-exact scheduler/event placement, not audible PCM failure.
> The write-diff probe now emits `nativeSampleNonExactContext` separately from
> `nativeSampleMismatchContext`, so the green tolerance-1 run still exposes
> exactness debt. Artifact
> `current-exact-context-20260523-224533/chip-write-diff-current-preset-nonexact-context.json`
> keeps `mismatchCount=0` for both chips but records YM `5118` non-exact writes
> (`far=5091`, top PCs `0x8eaf/0x8e9c/0x81bb/0x81c3`) and POKEY `6446`
> (`far=6435`, top PCs `0x8e54/0x8e2f/0x8e68/0x8e3c`). Use this field as the
> compact metric for future sample-exact reductions.
> `--pc-delta-report` now also emits
> `nativeSampleMismatchTargetCycleOffset`, the minimal TS cycle shift needed to
> land a strict exact mismatch in MAME's native-sample bucket. The strict report
> `current-exact-bucket-analysis/chip-write-diff-current-preset-sampletol0-pcdelta-targetoffset.json`
> keeps the expected `5118` YM / `6446` POKEY failures and rejects a single
> phase fix. YM's hot PCs are sign-mixed (`0x8eaf`: `1723` mismatches,
> offsets `-32..+32`, top `+1=263`, `-1=214`; `0x8e9c`: `1660`, top
> `+1=229`, `-1=196`). POKEY's hot `0x8e28..0x8e6f` loop is more directional:
> mostly native delta `-1`, with target offsets usually `+1..+8` cycles
> (`0x8e54`: `788`, top `+2=110`, `+3=96`, `+5=92`). Next POKEY experiments
> should target stream/update-boundary timing in that loop; next YM work still
> needs the broader scheduler/bus-phase model.
> The write-diff probe now has diagnostics-only
> `--ts-event-cycle-adjust-matches`
> (`kind:frame:pc:reg:val:delta[:cycleMin:cycleMax]`) for isolated event-layer
> timing experiments. The POKEY opcode sweep in
> `current-pokey-exact-091-sweep/` rejects a blind global change but gives a
> sharper target: `0x91=25` reduces strict POKEY exact mismatches from `6446`
> to `5058` with only three tolerance-1 failures; `0x91=30` reaches `2836`
> exact mismatches but creates `19` tolerance-1 failures and large catch-up
> outliers. With `0x91=25` plus three narrow frame/cycle matches, the combined
> tolerance-1 gate passes (`chip-write-diff-op91-25-threeoutlier-targeted-sampletol1.json`:
> `51163/51163` YM, `27198/27198` POKEY, `0` mismatches), and POKEY non-exact
> debt drops to `5055` (`{-1:4574,0:22143,1:481}`). Keep this as evidence, not
> a promoted preset: the frame-specific matches are scheduler/catch-up
> fingerprints, while the broad POKEY loop wants a small later visible write
> edge.
> `pcDeltaReport.mismatchSamples` now includes `previousIndex`,
> `intervalDelta`, `tsInterval`, and `mameInterval`, tying each shown mismatch
> to the previous same-PC write. The `0x91=25` failure rerun
> `pokey-sampletol1-op91-25-pcdelta-intervalsamples.json` proves the three
> outliers are not ordinary phase drift: frame `1616` at `0x8e62` is an
> interval pair `-138/+142`, frame `1306` at `0x8e5b` is `-266/+266`, and the
> frame `860` `0x8e62` case is a smaller `+46` interval expansion. The updated
> green report
> `chip-write-diff-op91-25-threeoutlier-targeted-sampletol1-intervalsamples.json`
> preserves YM/POKEY `0` mismatches at tolerance `±1` and POKEY non-exact
> `5055`. Treat this as a scheduler/replay boundary target, not an event-table
> fix.
> Source review of current MAME `atarisy1.cpp` confirms the command latch is
> the right oracle: `m_soundlatch->data_pending_callback()` drives the 6502 NMI
> line directly and requests `perfect_quantum(100us)`, while the same machine
> config declares the YM2151 and POKEY clocks and speaker gains. To test whether
> TS only needed a simple post-edge NMI service latency,
> `SoundChipConfig.commandNmiServiceDelayCycles` and
> `probe-chip-write-diff.ts --command-nmi-service-delay` now provide an opt-in
> diagnostic stall where YM/POKEY continue ticking before the 6502 services the
> command NMI. Focused base0 sweeps reject it as a promotion model:
> `service=1/2/3/4` produce `56/51/70/9832` YM native-sample mismatches against
> the 1410-frame command-read oracle, compared with the prior base0 `35`.
> The default current preset remains green in
> `chip-write-diff-current-preset-public-scenario-regression-servicedelay.json`
> (`0/51163` YM mismatches, `0/27198` POKEY). Keep the knob as diagnostics only;
> the next causal target is still scheduler catch-up/sub-instruction
> command-NMI placement.
> `probe-chip-write-diff.ts --command-submit-out` now writes a compact
> per-command table for offline scheduler classification. The focused
> `command-submit-rows-current-preset-1410.json` artifact has `1277` rows with
> source index, command byte/cycle, effective delay, pending state, TS last
> step, MAME command instruction context, and MAME `$1810` read context. The
> paired
> `command-submit-classifier-analysis-current-preset-1410.json` rejects the
> captured fetch/read context as a standalone promotion rule: the current
> byte/cycle selectors separate the `10` delay-0 cases exactly, but
> `nextChronoInstDeltaCycles 0..4` produces `641` false positives while
> catching all `10`, `abs(nextChronoInstDelta - ts endDelta) <= 3` produces
> `638` false positives, and `abs(instDelta - targetOffset) <= 20` catches only
> `5/10` with `30` false positives. Keep the table output for auditing future
> models; the next useful capture needs scheduler/latch timing, not more
> PC/opcode/read-delta predicates.
> Focused window traces can now expose interrupt service directly:
> `oracle/mame_sound_window_trace.lua` accepts
> `MARBLE_SOUND_TRACE_VECTORS=1`, the TS counterpart accepts
> `--trace-vectors`, and `probe-sound-window-trace-diff.ts` reports a
> `vectorReads` summary plus a `commandNmi` command-to-interrupt window
> summary. The smoke artifacts
> `window-vector-smoke/mame-window-244-248-vectors.json` and
> `window-vector-smoke/ts-window-244-248-vectors.json` both include reset,
> NMI, and IRQ vector reads. This is a diagnostic aid for the remaining
> command/NMI boundary model; it does not change replay behavior.
> The real same-run vector capture has been refreshed with bus-cycle-aware
> vector/MMIO read timestamps:
> `current-mixed-samerun-1701/window-vector-traces/window-diff-260-273-pc-vectors-eventoffset30-busreadcycles-commandnmi.json`
> pairs all `14` frame-start commands in window `260..273`. Command cycles
> align, `nmiFromCommandDelta` is bounded to `-3..+3`, and
> `cmdReadFromNmiDelta` is `0` for all `14` commands. The previous stable
> `$1810` read skew was a trace artifact: TS logged `LDX $1810` at opcode start
> rather than at the absolute-read bus cycle. The first paired command is MAME
> `nmi=8/pc=0x8138`, `$1810` read at `76`, first YM `$81bb/$14=$11` at `1225`;
> TS is `nmi=8/pc=0x8101`, read at `76`, same YM write at `1226`. This
> localizes the frame-start residual to pre-NMI PC/catch-up and the first
> post-NMI chip-write boundary, not command payload visibility or YM/POKEY DSP.
> The remaining `firstChipWriteFromNmiDelta` range is `-145..+11` cycles, with
> the large negative cases coming from frame-boundary crossings where TS emits
> the same YM write just after the next frame's command in absolute time. The
> report now exposes that directly as `firstChipWriteCrossFrame: MAME=0, TS=3,
> mismatch=3`.
> Boundary-preemption diagnostics now carry the deferred context into the next
> `cmdSubmit`. In the same window,
> `window-diff-260-273-pc-vectors-eventoffset30-busreadcycles-preempt15-pc81b8-commandnmi.json`
> uses `--command-preempt-chip-write-lookahead 15 --command-preempt-chip-write-pcs
> 0x81b8` and removes the three cross-frame cases
> (`firstChipWriteCrossFrame: MAME=0, TS=0, mismatch=0`), tightening
> `firstChipWriteFromNmiDelta` to `-12..+24`. The serialized preemptions are all
> `PC 0x81b8` (`STA $1800`, YM address select) with command target deltas `+3`,
> `+10`, and `+15` cycles after the estimated address-port write. This is useful
> evidence for a bus-cycle CPU model: MAME appears to complete the `$1800`
> address select, sample the frame-start command/NMI, then resume before the
> `$81bb` data write. Do not promote the preemption knob: the current 1701-frame
> preset is still green without it
> (`preempt-boundary/chip-write-diff-current-preset-baseline-after-boundary-diagnostics.json`,
> `0` YM / `0` POKEY mismatches), but generic preempt15 creates `71` YM / `15`
> POKEY mismatches and the filtered `0x81b8` preempt still creates `72` YM /
> `11` POKEY mismatches.
> The more literal complete-before-target diagnostic reaches the same local
> conclusion but is also rejected. With
> `--command-preempt-chip-write-complete-before-target` and delay `0` for
> completed preemptions, the focused `260..273` window has no cross-frame
> first-write cases and improves `firstChipWriteFromNmiDelta` to `-9..+24`;
> the serialized preemptions are marked
> `completedInstructionBeforeTarget=true`. The broad 1701-frame run fails
> badly (`17837` YM / `9363` POKEY mismatches), while the no-preemption baseline
> rerun after these diagnostics remains green in
> `preempt-boundary/chip-write-diff-current-preset-baseline-after-complete-preempt-diagnostics.json`
> (`51163/51163` YM and `27198/27198` POKEY writes, `0` mismatches). This keeps
> the promotion target on resumable bus-cycle 6502 execution: finish the `$1800`
> bus write, sample command/NMI, then resume before `$1801`, without globally
> completing whole instructions across the boundary.
> The filtered complete-before-target control was rerun after fixing
> `probe-sound-sample-diff.ts` to actually honor
> `--command-preempt-chip-write-pcs` and
> `--command-preempt-chip-write-complete-before-target`. Artifact
> `current-preempt-complete-before-target/chip-write-diff-preempt-pc81b8-complete-before-target.json`
> is nearly green at the chip-write layer: four completed preemptions, all at
> `PC 0x81b8`, POKEY `0` mismatches, and a single YM native-sample mismatch
> (`#34411`, frame `1221`, `PC 0x8e9c`, `$23=$d7`, native delta `+5`). The
> matching PCM artifact
> `current-preempt-complete-before-target/pcm-diff-preempt-pc81b8-complete-before-target-pcfiltered.json`
> rejects it anyway: `worstCorrelation=0.6634505`, `worstRms=0.0835583`,
> `worstMaxAbs=0.2860247`, worst lag `4`, with a POKEY-heavy miss near sample
> `929693` (`TS POKEY=0.1015717`, MAME near silence at `-0.0025024`). Treat this
> as proof that ordered native chip writes are necessary but not sufficient when
> a timing workaround changes actual chip state. Do not promote the filtered
> preemption path; implement resumable sub-instruction/catch-up instead.
> `probe-sound-sample-diff.ts` now also supports
> `--command-nmi-delay-completed-chip-write-preemptions`, matching the
> chip-write diff tool. The paired filtered PCM rerun with completed-preemption
> delay forced to `0`,
> `current-preempt-complete-before-target/pcm-diff-preempt-pc81b8-complete-before-target-delay0.json`,
> regresses further (`worstCorrelation=-0.637592`, worst lag `12`, RMS
> `0.229396`, maxAbs `0.788019`). This rejects the alternate delay selector as
> a PCM fix and keeps the next promotion target on scheduler/cpu resume
> semantics.
> `oracle/mame_pokey_write_tap.lua` can now attach the last MAME sound-CPU
> opcode fetch to cmd-tape entries when `MARBLE_SOUND_TRACE_FETCH=1`, and the
> write-diff probe folds those command-side `instPc`/`instOpcode`/
> `instDeltaCycles` fields into `commandSubmitDiagnostics`. Focused artifacts in
> `current-mixed-samerun-1701/command-fetch-context/` capture `1277` commands
> through frame `1410`; all carry `soundPc`, and `676` carry fetch context. The
> YM-only report
> `chip-write-diff-current-preset-command-fetch-context-1410-ymonly.json`
> remains green (`43051/43051`, `0` mismatches), but it rejects fetch phase as
> the missing broad rule: the `10` delay-0 overrides span command
> `instDeltaCycles` from `2` through `390`, while delay-1 commands still
> populate the small same-instruction range (`1..6`, with
> `instDeltaCycles - targetOffset` around `-4..5`). The combined YM+POKEY
> 1410 report carries the same command diagnostics but has one separate POKEY
> native-sample outlier at frame `1306`, so treat the YM-only report as the
> command-fetch decision artifact.
> The tap also records the first post-command sound-CPU fetch in callback order
> (`nextInst*`) and in chronological non-negative sound time
> (`nextChronoInst*`). The green YM report
> `chip-write-diff-current-preset-command-chronofetch-1410-ymonly.json`
> captures `nextChronoInst*` for the same `676` traced commands and rejects
> another broad promotion: all `10` delay-0 overrides resume chronologically
> within `0..4` sound cycles, but delay-1 commands also heavily populate that
> band (`0=235, 1=187, 2=128, 3=81, 4=10, 5=25`). The `nextChronoInstPc` to
> TS-step relation is likewise broad (`8/10` delay-0 are `other`, and `599`
> delay-1 traced commands are also `other`). The open model is therefore MAME's
> cross-CPU scheduler catch-up around the injected command bursts, not a simple
> previous-fetch, next-fetch, or TS-next-PC rule.
> Browser `soundReplay` also parses the preset's command/NMI sample controls,
> legacy YM write-offset matches, and the YM/POKEY command-edge rule format.
> It applies those rules through diagnostics-only SoundChip providers in the
> isolated replay path. `soundReplayPreset=inject001f-1701-commandedge` expands
> the current rule pack, and explicit query values override preset defaults. It
> now sets `soundReplayRequireCommandContext=1` and
> `soundReplayPokeyResampleOffset=23.25`, so context-free tapes fail fast
> instead of silently skipping command-PC rules while the browser replay uses
> the promoted POKEY PCM phase. Browser status reports
> `commandEvents`, `cycleInFrame`, and `soundPc` counts. The new public scenario
> `packages/web/public/scenarios/sound/cmd-tape-inject001f-1701-commandedge.json`
> mirrors the current 1701-frame same-run oracle tape (`1579` commands,
> `soundPc` and cycle timing on all commands, `1528` reply-ack events). A focused
> TS check reports `commandEvents=1579 cycleInFrame=1579 soundPc=1579
> replyAcks=1528`, and HTTP smoke returns `200 OK` for both that JSON and the
> strict replay URL with `soundReplayPreset=inject001f-1701-commandedge`.
> The older public cycle-precise tape still proves replay wiring only because it
> lacks `soundPc`/reply-ack context.
> Follow-up artifact
> `chip-write-diff-commandedge8126-ch2-paired-commandcontext-current.json`
> adds a global `nativeSampleMismatchContext` to the strict sample-tolerance-0
> YM gate. The remaining `5360` exact-boundary misses are not a YM register
> class: `5359/5360` have first command read PC `0x95c6`, write opcodes are
> mostly `0x8d`/`0x8e` (`4155`/`1187`), nearest command side is mixed
> previous/next (`2919`/`2441`), and submit actual deltas span `0..7` cycles.
> That keeps the promotion target on a causal command/NMI/read-loop boundary
> model rather than a uniform opcode/register/DSP offset.
> `oracle/mame_pokey_write_tap.lua` now has opt-in same-run sound fetch
> tracing via `MARBLE_SOUND_TRACE_FETCH=1` and frame bounds. Short validation
> artifact `current-mixed-samerun-1701/fetch-trace-test/` ran to frame `260`
> with fetch tracing on frames `254..255`; the cmd tape still matches the
> baseline command PCs (`0x8100` then `0x80f5`), YM writes attach
> `instPc`/`instOpcode` with `instDeltaCycles=3` for the `0x8e` stores, and
> POKEY writes attach `instDeltaCycles=5` for the `0x91` copy-loop stores.
> The companion short diff `fetch-trace-test/chip-write-diff-fetch-260.json`
> passes the traced files against TS (`137/137` YM and `300/300` POKEY writes,
> `0` order/payload mismatches).
> `probe-chip-write-diff.ts` now parses these `inst*` fields and reports
> `instructionFetchDelta`. Rerun
> `fetch-trace-test/chip-write-diff-fetch-260-instcontext.json` shows TS and
> MAME agree on instruction fetch-to-write offset for the traced stores:
> YM `mameInstDelta={3:18}`, `tsWriteMinusMameFetchDelta={0:18}`;
> POKEY `mameInstDelta={5:41}`, `tsWriteMinusMameFetchDelta={0:41}`. This
> rejects a generic opcode bus-store offset as the current promotion path.
> This replaces the earlier incoherent standalone window trace with
> same-run instruction-fetch context for the next command/NMI boundary model.
> Extended fetch artifact
> `current-mixed-samerun-1701/fetch-trace-1308-1459-oracleflags/` confirms the
> same store-bus result over the later music-update window when MAME is run with
> the full oracle flags. All traced YM stores have MAME `instDeltaCycles=3`
> (`0x8d`/`0x8e`), and all traced POKEY copy-loop stores have
> `instDeltaCycles=5` (`0x91`). The 1460-frame diff remains red only as a
> diagnostic cutoff: TS has tail writes after the truncated MAME log plus one
> earlier POKEY timing residual, while `commandSubmitDiagnostics` now restores
> the four expected delay overrides. `cmdTapeCycleInFrame` and replay helpers
> therefore treat explicit `cycleInFrame` as fallback when `secs/attos` are
> present; the frame `1130` keepalive command carries rounded
> `cycleInFrame=539`, but the rational timestamp target is `538` and is the
> value used by the replay/diff path.
> `probe-sound-sample-diff.ts` now reports
> `ymStreamWriteDiagnostics`; the focused same-run diagnostic shows
> `alreadyGeneratedWriteCount=0`, ruling out writes arriving after their target
> sample as the runtime/direct discrepancy. The latest write-diff report now
> includes the global native-sample delta histogram: the baseline is dominated
> by one-sample-early YM writes, while `--reset-release-delay 30` improves that
> distribution but is rejected because mixed PCM still fails the late YM tail
> and POKEY-selected mixed windows regress. A narrower direct
> `inject0005` POKEY residual pass
> now needs `resampleOffset=-1` plus output offset `+3`, but the broader
> YM-muted `inject001f` POKEY oracle rejects that phase as a default, and a
> current rerun also makes the older direct `--pokey-write-cycle-offset -1`
> strict pass stale. Current direct POKEY write offsets are tap/update-boundary
> diagnostics only. The broad YM-muted direct POKEY gate now passes when the
> POKEY-only MAME-write render uses MAME's integer POKEY device clock
> (`1789772`) for timestamp-to-cycle conversion, full-clock output
> (`soundReplayPokeySampleCycles=1` / `--pokey-sample-cycles 1`), and
> MAME-LoFi resampling. Direct mixed MAME-write rendering now uses the same
> POKEY clock when YM is in `mame-stream`, and the short `inject0005` direct
> mixed gate passes more tightly with full-clock POKEY/MAME-LoFi and no POKEY
> output offset. This explains the previous `-8` write-cycle offset as a
> clock-rate compensation, not a POKEY hardware rule. Full
> `$1820` status-value replay and a simple replay sample-unit key-on offset
> have both been tested and rejected as current PCM fixes.
> **MAME ref:** `atarisy1.cpp` mailbox setup `:816-821`, sound map `:443-453`, port definitions `:481-499`.
> 2026-05-23 online source audit: current MAME uses Aaron Giles' `ymfm` OPM
> core, and the standalone `ymfm` repository is the cleanest import/reference
> candidate for YM2151 parity because it is the same family as the oracle. Nuked
> OPM is useful as an independent YM2151 comparison core, but it is not the MAME
> mixer oracle and has different licensing/integration tradeoffs. For POKEY, the
> MAME `pokey.cpp` path remains the primary source for this goal; Atari800-style
> cores are useful cross-checks but should not replace the MAME oracle.
> `ymfm_device_base` updates the sound stream before YM reads/writes, and
> YM2151 data writes set BUSY for `32 * clock_prescale`, matching the TS
> 64-YM-cycle busy model. MAME POKEY writes are different: `pokey_device::write`
> schedules `sync_write` through the machine scheduler before `write_internal`,
> so current POKEY write delays are evidence about tap/application timing, not a
> POKEY DSP offset to promote blindly. The PCM probe now has
> `--ym-stream-write-trace-radius/--ym-stream-write-trace-limit`; the focused
> red same-run mixed window report
> `current-mixed-samerun-1701/pcm-trace-window1163264-firstread-both-with-ymwrites.json`
> embeds the YM writes around peak sample `1168416`, showing the frame-1458
> channel-2 burst (`0x22/0x32/0x2a`, `0x7a/0x72/0x6a/0x62`, key-on
> `0x08=0x7a`) immediately before the bad YM-only peak. The bounded diagnostic
> candidate report
> `pcm-trace-window1163264-ymevent30-ch2series-pokeydelay56-with-ymwrites.json`
> passes the same focused window at correlation `0.9997`, RMS `0.00349`, and
> maxAbs `0.02419`, but remains diagnostic because it still uses frame-specific
> YM offsets plus a POKEY apply delay.
> Follow-up trace reports can now attach the matching MAME YM write sample to
> each retained TS stream write with
> `--ym-stream-write-trace-mame-ym-writes`. The corrected red report
> `pcm-trace-window1163264-firstread-both-with-ymwrites-mamedelta.json` shows
> the frame-1458 channel-2 burst is already at `0` native-sample delta except
> the `0x7a`/`0x72` operator writes, which are one sample early. The current
> no-POKEY-apply-delay candidate,
> `pcm-trace-window1163264-ymevent30-frame860-ch2series-pokeyout1-with-ymwrites-mamedelta.json`,
> moves those two writes onto the MAME native sample and passes the focused
> window at correlation `0.9992`, RMS `0.00600`, and maxAbs `0.04589`; this is
> still a localization proof, not a promoted scheduler rule.
> The PCM probe can now compare normal SoundChip replay against a direct
> MAME-write render in one report via `--reference-mame-ym-writes` and
> `--reference-mame-pokey-writes`; `mameCompare.source` becomes
> `direct-chip-writes` unless `--reference-mame-components-only` leaves the WAV
> as the comparison signal, and `maxAbsSample`/trace rows include `refYm` and
> `refPokey` for the compared reference sample. On focused window `1163264`,
> frame-860 selectors alone leave runtime YM versus direct YM at maxAbs
> `0.21625` (`tsYm=0.04045`, `refYm=-0.17579` at sample `1168416`), while
> adding the frame `1437/1458` channel-2 series drops that same comparison to
> correlation `0.9999638`, RMS `0.00102`, and maxAbs `0.00794`. The focused
> mixed runtime-vs-direct report with the channel-2 series and POKEY output
> offset `+1` reaches correlation `0.9993`, RMS `0.00583`, and maxAbs
> `0.04579`; its peak is now POKEY-dominant (`tsPokey=0.02323`,
> `refPokey=0.06708`) while the YM delta is only about `0.00194`. That keeps
> the next blocker on POKEY phase/application timing, not the channel-2 YM
> burst itself.
> Follow-up POKEY reference diagnostics add direct-reference channel
> attribution and `--sample-trace-center-sample`. In the isolated
> `source=pokey` runtime-vs-direct focused window, the default candidate wants
> lag `-1` and peaks at sample `1164301` with maxAbs `0.03913`; both active
> POKEY channels are in transition (`ts ch0/ch1=0.08614/0.02531`, direct
> `0.07077/0.00155`). A sweep of runtime-only
> `--pokey-write-apply-delay` shows `14` cycles is the best local
> runtime-vs-direct discriminator: it changes the same focused POKEY window to
> lag `0`, correlation `0.999976`, RMS `0.00069`, and maxAbs `0.00600`, and
> the focused mixed runtime-vs-direct window improves to correlation
> `0.999968`, RMS `0.00123`, and maxAbs `0.00931`. The broader 212-window
> runtime-vs-direct mixed gate also passes with `apply14` (worst correlation
> `0.9851`, RMS `0.01847`, maxAbs `0.10487`). This is not a promotion: the
> same `apply14` candidate against the real MAME WAV fails the RMS threshold
> (`0.02085 > 0.02`) and is worse than the no-apply WAV gate (`0.01901`).
> Treat `apply14` as proof that runtime POKEY phase differs from direct-MAME
> POKEY by a small application/stream-boundary class, while the remaining
> WAV gap still includes direct-vs-MAME mixer/POKEY behavior.
> The probe also accepts `--ym-stream-write-trace-center-sample` so a candidate
> can be inspected around the old failure even after its maxAbs moves. Centered
> artifact
> `pcm-trace-window1163264-ymevent30-frame860-ch2series-pokeyout1-center1168416-ymwrites-mamedelta.json`
> confirms the old peak sample `1168416` is repaired directly (`diff=0.00240`
> versus `0.21865` in the red control). The remaining candidate maxAbs is later
> at sample `1170027` and includes POKEY, so the next investigation should not
> keep treating frame-1458 channel-2 write placement as the active blocker.
> A full-window rerun rejects promoting the local POKEY-output `0` phase:
> it is better only around sample `1170027`, while the broad all-window gate is
> slightly worse than the current POKEY output `+1` candidate. Direct reference
> component traces on the true global worst window (`1048576`, max sample
> `1056072`) show the active residual is YM channel `0`, not POKEY:
> `tsPokey=refPokey=0.163636`, but `tsYm=0.088417` versus direct-MAME
> `refYm=-0.016452`; per-channel attribution puts about `0.105` of that delta
> on YM channel `0`, with other YM channels near zero. The direct POKEY
> residual control against `WAV - direct YM` is clean across the same windows:
> `pcm-diff-directpokey-vs-mixminusdirectym-pokeywindows-outm1.json` reports
> worst correlation `0.99927`, RMS `0.00384`, and maxAbs `0.02419`.
> `--sample-trace-center-sample` was added so this peak can be inspected even
> when candidate maxAbs moves.
>
> YM state tracing then localizes the runtime/direct channel-0 split. Before
> the frame-1317 key-on, runtime channel 0 is exactly one native YM sample ahead
> of the direct-MAME reference (`phase` differs by one `phaseInc` on all four
> operators). The frame-1317 key-on realigns operator phase, but `fbHistory`
> remains different and creates the audible transient. A wider state trace finds
> the first cause in frame `1310`: runtime applies the new channel-0 setup/key-on
> at native sample `1223464`, while direct-MAME applies it at `1223465`.
> Applying a diagnostics-only `+30` cycle selector to the frame-1310 channel-0
> setup/key-on burst (`0x93a4`, `0x93c6`, `0x8e9c`, `0x8eaf`, `0x8eeb`,
> `0x8fac`, `0x8fcc`) improves the focused runtime-vs-direct YM window from
> correlation `0.8995`, RMS `0.01846`, maxAbs `0.10487` to correlation
> `0.9954`, RMS `0.00395`, maxAbs `0.03127`. The all-window runtime-vs-direct
> YM gate with the same selector passes at worst correlation `0.9954`, RMS
> `0.00395`, maxAbs `0.05842`, and the real mixed WAV gate improves to
> `0.9974` / `0.00704` / `0.06602`. The follow-up
> `current-event` command-edge rule reaches the same gates without a frame
> selector: `0x1b:20000:24100:30:raw-before:0:25000:0x8126:current-event`
> applies `36` writes with final event delta `60` and produces
> `pcm-diff-runtime-vs-directym-allwindows-commandedge1310-currentevent30.json`
> plus
> `pcm-diff-inject001f-1701-runtime-mix-commandedge1310-currentevent30-pokeyout1-cmdnmi-aud001.json`.
> A broader byte-wildcard control
> `pcm-diff-inject001f-1701-runtime-mix-commandedge8126-anybyte-currentevent30-buckets-current.json`
> applies `212` writes and keeps the same mixed gate green (`0.997409`,
> `0.007037`, `0.066018`). The new PCM command-edge summary buckets show those
> writes are all `STA abs` from command-source PC `0x8126`, split across
> write PCs `0x8e9c` (`86`), `0x8eaf` (`89`), `0x93a4` (`7`), `0x93c6` (`24`),
> plus small counts on `0x8eeb/0x8fac/0x8fcc`. The no-`1437/1458` control
> `pcm-diff-inject001f-1701-runtime-mix-commandedge8126-anybyte-currentevent30-no1437-1458-current.json`
> still fails only the peak bound (`maxAbs=0.21865` at sample `1168416`), so
> the current-event class does not subsume the later channel-2 burst.
> A later same-run ablation removed the write-PC allow-list from the promoted
> `0x8126:current-event` rule itself. It kept ordered YM/POKEY writes green
> (`chip-write-diff-ym-8126-no-writepc.json`) and kept the mixed PCM gate green
> (`pcm-diff-ym-8126-no-writepc.json`, worst correlation `0.9974`, lag `1`,
> RMS `0.00538`, maxAbs `0.06332`), so the preset now keys that class only on
> command byte/source PC/timing. A follow-up ablation removed the command-source
> PC too: `generalize-ym-commandpc-ablation/chip-write-diff-ym-8126-no-commandpc.json`
> compares YM `51163/51163` and POKEY `27198/27198` with zero tolerance-1
> mismatches, and
> `generalize-ym-commandpc-ablation/pcm-diff-ym-8126-no-commandpc.json` keeps
> the same `212` audible windows green (`corr=0.997409`, lag `1`,
> RMS `0.005375`, maxAbs `0.063317`). The preset now keys that class only on
> command byte and timing. The adjacent broader controls are rejected:
> removing command-source PC from `0x85f3` causes `4936` YM native-sample
> mismatches, and removing it from `0x81bb` leaves `33` YM mismatches.
> This keeps the next promotion target on a causal YM stream/event-boundary
> model for one-native-sample setup/key-on placement, not on YM operator math or
> POKEY DSP.
> The latest YM channel-state trace narrows that further. `probe-sound-sample-diff.ts`
> now has `--ym-state-trace-channel`, `--ym-state-trace-native-start`, and
> `--ym-state-trace-native-end`; the direct-reference comparison stores the
> SoundChip trace in `ts.ymStateTrace` and the MAME-write direct render in
> `mameCompare.referenceYmStateTrace`. At the true global worst sample window,
> `pcm-trace-window1048576-ch0statetrace-native1230415-1230672.json` shows
> channel 0 has matching register state, key mask, operator phases, phase
> increments, envelope states/counters, and operator params between runtime and
> direct-MAME render. The material mismatch is only `fbHistory`; at native
> sample `1230415`, TS has `[-589,1046]` while direct-MAME has
> `[-2664,2888]`. The key-on-region trace
> `pcm-trace-window1048576-ch0statetrace-keyon-native1230000-1230120.json`
> shows the key-on resets phase alignment by native `1230079` and envelope
> state remains matched, but feedback history remains divergent. An external
> source audit of Aaron Giles' `ymfm` confirms `fm_channel::keyonoff` only
> forwards key state to operators; channel feedback is initialized/reset by
> channel reset and then shifted by `clock_feedback`, not cleared on key-on.
> Therefore a feedback reset on key-on is rejected. The active blocker is the
> pre-key-on channel-0 output/feedback history or its event boundary, not POKEY
> and not a broad YM operator DSP error.
> The next state-trace pass found the concrete predecessor: the channel-0
> key-on at frame `1310`, PC `0x8fcc`, reg `0x08=0x78` is one native YM sample
> early in the runtime path (`nativeSampleDelta=-1`). In
> `pcm-trace-window1048576-ch0statetrace-prevkey-native1223380-1223620.json`,
> TS asserts the key at native `1223464` while the direct-MAME render asserts it
> at `1223465`, immediately seeding nonzero `fbHistory` deltas. A
> diagnostics-only selector `1310:0x8fcc:0x08:0x78:+5` moves that key-on onto
> the direct-MAME sample. Artifact
> `pcm-trace-window1048576-ch0statetrace-frame1310keyonp5-native1223380-1223620.json`
> shows key-on, phase, envelope, and `fbHistory` aligned from native `1223465`
> onward, and
> `pcm-trace-window1048576-ch0statetrace-frame1310keyonp5-native1230415-1230672.json`
> shows zero channel-0 differences at the old global worst region. The full
> same-run mixed audible-window gate with that selector,
> `pcm-diff-inject001f-1701-runtime-mix-ymevent30-frame860-ch2series1310-1437-1458-keyon-pokeyout1-cmdnmi-aud001-allwindows.json`,
> passes all `212` windows with worst correlation `0.997225`, worst RMS
> `0.008004`, worst maxAbs `0.066018`, and worst abs lag `1`. This is a strong
> localization proof for YM key-on event-boundary timing, not a promoted
> frame-specific rule; the next implementation target is a causal scheduler
> rule for the `0x8fcc` key-on/sample-boundary class.

## Current implementation status

- `packages/engine/src/m6502/sound-chip.ts` runs the 6502 sound CPU, mailbox,
  YM2151, and POKEY models. It exposes cmd-tape replay, YM/POKEY sample drains,
  and ordered chip-write diagnostics for oracle diffing.
- Cmd-tapes can carry `coinFrame`/`coinPulseFrames`. Replay converts that
  MAME input pulse into a per-frame `$1820` status-base override, clearing Coin
  1 bit 0 for the same sound-frame window observed in MAME. This is required
  for the frame-1215 `$27` increment and the frame-5735 `$31`/reply `$01`
  handshake; probes must load the full tape object instead of reducing it to
  `{cmds}`.
- `packages/web/src/sound-replay.ts` is the deterministic bit-perfect workbench:
  `?soundReplay=...` replays a MAME cmd-tape through the isolated SoundChip
  path. Its default remains the normal cycle-scheduled YM drain, but it can now
  opt into the verified replay scheduler with
  `soundReplayYmScheduler=mame-stream` and optional
  `soundReplayYmNativeSampleRate=<hz>`. It also exposes replay-only PCM parity
  controls mirroring the CLI probe:
  `soundReplayYmResampler=mame-lofi`, `soundReplayPokeyResampler=mame-lofi`,
  `soundReplayYmResampleOffset=<n>`, `soundReplayPokeyResampleOffset=<n>`,
  `soundReplayYmOutputSampleOffset=<n>`, and
  `soundReplayPokeyOutputSampleOffset=<n>`. It also exposes the replay-only
  POKEY write timing diagnostic `soundReplayPokeyWriteApplyDelay=<cycles>` and
  POKEY native cadence diagnostic `soundReplayPokeySampleCycles=<n>`. When that
  cadence changes, the renderer receives the effective `getPokeySampleRate`
  instead of the old fixed `/28` rate.
  `soundReplayCommandNmiDelay=<n>` controls replay command-NMI latency; the
  browser replay default is now `1` instruction boundary, matching the
  same-run POKEY event/PCM evidence. Use `soundReplayCommandNmiDelay=0` only as
  a diagnostic to restore the older immediate-edge replay.
  The browser replay path can mirror the current same-run PCM candidate without
  touching `main.ts`: `soundReplayYmScheduler=mame-stream`,
  `soundReplayYmStreamAbsoluteOrigin=1`,
  `soundReplayYmWriteEventCycleOffset=30`, the focused frame-860
  `soundReplayYmWriteEventCycleOffsetMatches=...:-40` selectors,
  `soundReplayYmResampler=mame-lofi`, `soundReplayPokeyResampler=mame-lofi`,
  `soundReplayPokeySampleCycles=1`, and
  `soundReplayPokeyOutputSampleOffset=-1`. Do not include the older
  `soundReplayYmWriteEventCycleOffsetRegs=0x18:1` in this candidate; it
  improves strict native-sample write timing but breaks the same-run late
  YM-tail PCM phase. The older
  `soundReplayYmWriteEventCycleOffsetMatches=*:0x8fcc:0x08:0x78:48` and
  `soundReplayYmWriteEventSampleOffsetMatches=*:0x8fcc:0x08:0x78:1` controls
  remain diagnostics only; the current corrected Coin 1 gate does not need
  them. A headless Chrome smoke on
  `?autoLoad=1&soundReplay=scenarios/sound/cmd-tape-attract-music.json&soundReplayFastForward=11900`
  plus those promoted flags loaded the ROMs, started the AudioWorklet, and
  reached `frame=11940` without serious console errors
  (`current-browser-smoke/sound-replay-smoke.json`). This is explicit
  replay/oracle plumbing only; gameplay `?sound=1` is not changed.
- `packages/web/src/sound-renderer.ts` and `packages/web/public/sound-worklet.js`
  now keep YM2151 and POKEY PCM streams in separate worklet queues and mix them
  sample-aligned at output time. This fixes the old browser-only behavior where
  POKEY PCM posted after YM PCM would be appended to the same FIFO instead of
  mixed with the same replay frame. The worklet also keeps pure chip-PCM output
  linear when no synthetic fallback voices are active, so `soundReplay` is no
  longer passed through a `tanh` soft clip. The renderer can now apply the
  shared MAME LoFi resampler and integer post-resample output offsets per PCM
  stream; those options are only wired from the isolated replay path. The web
  renderer keeps streaming resampler state across frame-sized PCM pushes, so
  browser `soundReplay` does not reset interpolation phase or reapply output
  offsets on every frame. `soundReplay` resets those PCM streams when the tape
  loops or a fast-forward wraps, matching the SoundChip reset instead of
  carrying stale resampler phase into the next pass. Unit tests compare chunked
  linear and MAME-LoFi resampling against whole-stream output and cover the
  one-shot output-offset/reset behavior.
- `packages/cli/src/probe-chip-write-diff.ts` compares ordered YM2151/POKEY
  writes against MAME logs. Older 14000-frame green reports were produced
  before the corrected Coin 1 polarity capture and are historical only. The
  current corrected baseline uses
  `/tmp/marble-love/audio-bitperfect/mame_cmds_14000_coinpolarity_replyack-embedded.json`,
  `mame_ym_writes_14000_coinpolarity_full.json`, and
  `mame_pokey_writes_14000_coinpolarity.json`. After the LS259 `write_d0` fix,
  the Coin 1 status-base replay fix, and embedded reply ack replay, the full
  corrected run passes ordered payload/PC parity for `375161` YM2151 writes
  and `257739` POKEY writes. Current promoted reports:
  `chip-write-diff-14000-ym-resetdelay25-embeddedreplyack-coinbase-fullmame-order375161.json`
  and
  `chip-write-diff-14000-pokey-resetdelay25-embeddedreplyack-coinbase-fullmame-order257739.json`.
  Do not use the stale `/tmp/.../mame_ym_writes.json` for the current full
  gate; it lacks the refreshed frame-1217 `PC 0x9385/0x93c6` burst. Residual
  strict timing is still open: the full run is green with `frameTolerance=1`
  and loose cycle tolerance, while zero-tolerance first-prefix probes still fail
  on timing offsets rather than reg/value/order mismatches. The diagnostic
  report also separates `frameDelta` from `sameFrameCycleDelta`, and uses
  timestamp-derived `replayCycleDelta` when available so MAME events with
  negative `cycleInFrame` are not counted as false frame-boundary mismatches.
  It also has a diagnostics-only
  `--status-base` override for `$1820` input-bit experiments and
  `--status-tape` for MAME status-read replay; default replay remains `$87`.
  Status replay has two independent controls: `--status-tape-mode
  readIndex|frame` selects which captured read to use, and
  `--status-value-mode base|full` selects whether replay forces only the
  stable base bits (`base`, default) or the complete MAME `$1820` byte
  (`full`, diagnostic only). The corrected 2000-frame full-status capture
  (`mame_status_reads_2000_coinpolarity_full.json`, `753424` reads) rejects
  full-value replay as the frame-1570 fix: both read-index and frame modes
  worsen exact native-sample write timing, while the focused source-YM PCM
  window stays at correlation `0.5743`, lag `1352`.
  Main reply-ack replay can be supplied explicitly with `--reply-ack-tape`.
  When no explicit tape is passed, the CLI probes now try the cmd tape itself
  for an embedded ack timeline (`mainReplyReads`, `replyAcks`, or trace
  `events`) unless `--no-embedded-reply-ack` is present. This mirrors browser
  `soundReplay`, which already consumes embedded acks or
  `?soundReplayReplyAck=<json>`. `oracle/mame_sound_cmd_capture.lua` keeps the
  legacy count field, and can opt into embedding the real ack events as
  `replyAcks` with `MARBLE_SOUND_CMD_EMBED_REPLY=1`.
  `--command-nmi-delay-instructions 1` is the current replay preset for the
  same-run POKEY-audible oracle: after YM timer status latching was gated on
  the enable bit, artifact
  `current-pokey-long-replay/chip-write-diff-inject001f-1701-pokey-gated-cmdnmi1-wavrun.json`
  compares all `27198` MAME POKEY writes with `0` payload/order mismatches.
  The corresponding no-delay control still diverges at the frame-1220/1221
  command/NMI interleave. The earlier TS `27180` vs MAME `27171` result at
  target frame `1700` was a MAME cutoff artifact; target frame `1701` contains
  the tail writes and matches TS exactly.
  TS chip-write events are timestamped at the estimated 6502 bus write cycle,
  derived from the active store opcode, so strict timing reports compare
  against MAME memory taps instead of TS opcode-fetch cycles.
  Strict reports also classify command-target crossings when a scheduled
  cmd-tape edge falls inside the TS instruction before the estimated chip I/O
  bus write, and now aggregate top mismatch clusters by PC with field counts
  and replay-cycle deltas. When `--sample-rate` is present, the top-level
  report now also includes `nativeSampleDeltaHistogram`, so global
  sample-boundary shifts can be judged without enabling per-PC diagnostics.
  This is the current proof path for deciding whether the next fix needs a
  replay preemption shim or a broader sub-instruction 6502 model. The opt-in
  `--pc-delta-report` diagnostic, optionally scoped with
  `--pc-delta-report-pcs`, reports per-PC replay/native-sample deltas,
  native-sample histograms, and interval deltas between consecutive occurrences
  of the same PC without needing a full execution-trace pair. Add
  `--pc-delta-report-samples <n>` to include first mismatch samples and the
  largest same-PC interval outliers with neighboring TS/MAME writes.
  Native-sample gate diagnostics can also pass `--sample-phase-cycles <n>` to
  test a global sample-index origin shift, or `--sample-phase-sweep <a:b:s>`
  / comma lists to record per-phase mismatch counts without changing replay
  timing.
  A diagnostics-only `--command-preempt-chip-write-lookahead` probe option can
  hold the whole-instruction TS CPU before an imminent chip store at a scheduled
  command boundary; default replay leaves it at `0`. On the current same-run
  mixed oracle, lookahead `6` reduces the tolerance-1 YM native-sample residual
  from `141` to `109` mismatches and still passes the audible PCM gate, but it
  slightly worsens PCM metrics; lookahead `3` breaks ordered write count. Keep
  this as a command-crossing diagnostic, not a promoted replay rule. The same
  probe now exposes
  diagnostics-only `--command-cycle-offset` plus
  `--command-cycle-offset-start-frame` and `--command-cycle-offset-bytes` so
  command-target phase hypotheses can be swept globally or for selected cmd
  bytes without editing the cmd tape or moving the reset-frame command. A
  report-only `--ts-event-cycle-adjust-opcodes` diagnostic can shift TS event
  timestamps by store opcode for hypothesis testing; it does not change replay
  or chip state. The probe also has a diagnostics-only
  `--fixed-frame-cycles` control that clears timestamp-derived frame budgets
  while keeping the original cmd tape available for MAME timestamp
  normalization. Current corrected Coin 1 results reject that as a fix:
  `chip-write-diff-2000-ym-native-sample-resetdelay22-embeddedreplyack-fixedframe-probe.json`
  drops TS YM output to `13796` writes and reports `45010/45942` mismatches,
  while
  `chip-write-diff-2000-pokey-native-sample-resetdelay21-embeddedreplyack-fixedframe-probe.json`
  drops TS POKEY output to `11274` writes and reports `29571/31458`
  mismatches. The timestamp-derived frame budgets remain required oracle
  plumbing; the residual is not a simple fixed-cadence frame issue. A separate
  diagnostics-only `--defer-ym-timer-control-write-timing` control applies only
  YM timer/control data writes (`0x10/0x11/0x12/0x14`) at the estimated 6502
  bus-write cycle, without moving normal audio parameter writes. The same
  proof path now has two more diagnostics-only timing controls:
  `--irq-service-delay <cycles>` delays only visible unmasked IRQ service in
  the SoundChip replay loop, and `--ym-write-event-cycle-offset <cycles>`
  offsets YM data-write event timestamps used by diagnostics and the
  `mame-stream` PCM scheduler without moving CPU/register state. The write
  diff also has `--event-delta-report-matches frame:pc:reg:val`, which reports
  selected ordered-write replay-cycle and native-sample deltas with histograms;
  this is the current way to prove focused sample-boundary hypotheses before
  running the heavier PCM gate.
- `packages/cli/src/probe-audioram-diff.ts` now uses the same cycle-precise
  `tickFrameWithTape` path as the chip-write gate and can apply the MAME
  `$1820` status tape in read-index or frame-run mode. The stale corrected
  `1216..1276` RAM/window drill originally pointed at a missing frame-1217
  Timer A service burst, but the focused latch trace proved the branch was
  caused by TS resetting YM on `$1824=0x02`. With the fixed LS259 map, frame
  `1217` now reaches the MAME Timer A writes (`PC 0x81bb`, `YM reg 0x14`) and
  logs `64` YM writes plus `18` POKEY writes in the focused TS trace.
- `packages/cli/src/probe-sound-sample-diff.ts` is the PCM gate. It aligns the
  reset-silent prefix, can isolate `--source mix|ym|pokey`, reports per-window
  lag/correlation/RMS/maxAbs, supports an explicit `--max-abs-lag` threshold,
  can select audible windows from `--window-source mame|ts|ym|pokey`, reports
  global source/component RMS and peaks, can subtract a second MAME WAV with
  `--mame-subtract-wav` / `--mame-subtract-wav-gain`, can capture per-channel
  YM contribution with `--ym-channel-diagnostics`, can capture per-channel
  POKEY contribution with `--pokey-channel-diagnostics`, records each window's
  `maxAbsSample` with TS/MAME/component/channel values, can attach a small
  neighborhood around that sample with `--sample-trace-radius`, can force that
  trace around a chosen output sample with `--sample-trace-center-sample`, and
  can use `--lag-tie-correlation-epsilon` to prefer the nearest-zero lag when a
  periodic signal has multiple near-equivalent correlation peaks. The default
  epsilon is `0`, so existing reports keep the pure best-correlation choice.
  New reports include a top-level `probe` block with argv, cwd, windowing,
  lag-search, padding, and audible-threshold metadata, so strict reruns can be
  reproduced from the artifact instead of inferred from surrounding notes.
  The probe accepts the same `--command-nmi-delay-instructions` replay control
  as the write-diff probe and records it in the report. Current same-run
  POKEY-only SoundChip PCM proof:
  `current-pokey-long-replay/pcm-diff-inject001f-1701-runtime-pokey-samerun-ymstatus-gated-cmdnmi1-wavrun.json`
  uses `--command-nmi-delay-instructions 1`, full-clock POKEY
  (`--pokey-sample-cycles 1`), MAME-LoFi resamplers, and POKEY output offset
  `-1`; it passes all `168` selected YM-muted/POKEY-dominant windows with worst
  correlation `0.9967`, lag `2`, RMS `0.00502`, and maxAbs `0.06613`.
  The newer non-muted same-run mixed oracle under
  `current-mixed-samerun-1701/` proves that the same tape/WAV/write-log capture
  can cover both chips: `chip-write-diff-inject001f-1701-mixed-both-gated-cmdnmi1.json`
  compares `51163/51163` YM and `27198/27198` POKEY writes with zero
  mismatches, and
  `pcm-diff-inject001f-1701-runtime-mix-samerun-pokeywindows-cmdnmi1-gate.json`
  passes all `168` POKEY-selected mixed windows with worst correlation
  `0.9644`, lag `2`, RMS `0.02921`, and maxAbs `0.21487`. The companion
  all-MAME-window mixed report remains red in YM-only tail windows; direct
  MAME-YM rendering of the same log at sample `1265664` passes at correlation
  `1.0000`, which keeps the remaining work focused on SoundChip replay/sample
  timing rather than YM DSP. A reset-origin diagnostic
  (`--reset-release-delay 30`) improves exact YM native-sample write placement
  from `46454` to `4107` mismatches on this oracle, but does not close PCM:
  the all-window mixed gate still fails in the late YM tail and the
  POKEY-selected mixed gate regresses below threshold. Keep that as evidence
  for the replay-origin investigation, not a default.
  Current corrected Coin 1 replay no longer needs the old `0x8fcc/0x78`
  key-on selector: the promoted fix is that absolute-origin `mame-stream`
  drains now use the same target sample computation as write servicing. The
  default 14000-frame `source=ym` and `source=mix` reports are
  `current-ym-absolute-drain-sanity/replay14000-default-sourceym-hop4096-gate.json`
  and `current-ym-absolute-drain-sanity/replay14000-default-sourcemix-hop4096-gate.json`;
  both pass `849` selected YM-dominant windows with worst correlation
  `0.97668`, worst lag `0`, worst RMS `0.00318`, and worst maxAbs `0.01620`.
  The probe can also accept the same diagnostics-only `--status-tape`,
  `--status-tape-mode readIndex|frame`, reply-ack replay, embedded ack default,
  and command preemption flags as the write diff. It can bypass the 6502 replay entirely with
  `--mame-ym-writes` and/or `--mame-pokey-writes`, applying MAME-timestamped
  chip writes directly to the TS chip models; this is a DSP/mixer isolation
  diagnostic, not the default oracle replay path. The direct MAME-stream path
  also has `--direct-ym-write-sample-offset`,
  `--direct-ym-write-sample-offset-regs`, and
  `--direct-ym-write-sample-offset-matches frame:pc:reg:val:delta` for
  timestamp-boundary experiments on MAME-write sample indices only; these flags
  are rejected outside direct chip-write `mame-stream` mode and do not move
  SoundChip replay CPU/register state. It can also keep SoundChip replay as the
  TS side and use direct MAME-write rendering only as the comparison signal via
  `--reference-mame-ym-writes` and `--reference-mame-pokey-writes`. That mode
  is for runtime-vs-direct PCM isolation: it rejects subtraction/direct-render
  combinations, records `mameCompare.source="direct-chip-writes"`, includes
  reference render metadata, and annotates `maxAbsSample`/trace rows with
  `refYm`/`refPokey` at the compared reference sample. When channel diagnostics
  are enabled, the same rows also include `refYmChannels`/`refPokeyChannels`,
  so runtime-vs-direct residuals can be assigned to individual chip channels.
  With
  `--reference-mame-components-only`, the comparison signal stays on the WAV
  or subtract path while those direct reference components remain attached for
  sample attribution. Historical
  pre-drain-fix key-on
  diagnostics are still useful controls but are no longer the current green
  path. A narrow key-on diagnostic
  (`*:0x8fcc:0x08:0x78:1,5737:0x8fcc:0x08:0x78:1`) currently makes the full
  14000-frame direct MAME YM and direct MAME YM+POKEY mix gates pass. The first
  analogous live-replay cycle offset (`+32,+32`) remains red, but the event
  delta report shows why: it lands the 38 matching key-ons at
  `{0:15,1:22,2:1}` native-sample deltas rather than the direct target
  `{1:37,2:1}`. A diagnostics-only targeted replay list reaches `{1:37,2:1}`
  and passes the full 849-window source-YM replay gate when paired with
  `--lag-tie-correlation-epsilon 0.01`
  (`pcm-diff-replay-14000-resetdelay25-embeddedreplyack-ymstreamabsolute-rationalclock-ymreg18offset1-keyon78p48-targeted-lagtie001-sourceym-hop4096-gate.json`).
  With the corrected full MAME write log and Coin 1 status-base replay, the
  simpler broad `*:0x8fcc:0x08:0x78:+48` diagnostic now passes the full
  `source=ym` gate:
  `pcm-diff-replay-14000-resetdelay25-embeddedreplyack-coinbase-default-mamestream-ymreg18offset1-keyon78p48-lagtie001-sourceym-hop4096-gate.json`
  reports `849` selected windows, worst correlation `0.9889`, worst lag `1`,
  worst RMS `0.00318`, and worst maxAbs `0.01610`. This is not promoted
  runtime behavior yet; the direct MAME-write render proves the same bad
  window needs a matching `0x8fcc/0x78:+1 sample` boundary shift, so the open
  question is YM sample-boundary semantics rather than 6502 event order.
  The same probe can now compare `source=mix` with YM stream absolute origin:
  it pads YM and POKEY independently so YM stays on the MAME sound-stream
  timeline while replay-relative POKEY receives the reset-prefix padding.
  The corrected full-mix replay artifact
  `pcm-diff-replay-14000-resetdelay25-embeddedreplyack-coinbase-default-mamestream-ymreg18offset1-keyon78p48-lagtie001-sourcemix-hop4096-gate.json`
  also passes `849` windows with worst correlation `0.9889`, worst lag `1`,
  worst RMS `0.00318`, and worst maxAbs `0.01610`; those windows are all
  YM-dominant, so POKEY-audible mixed parity still needs a separate oracle.
  `probe-chip-write-diff.ts` now has
  `--event-delta-target-native-sample-delta <n>` for event reports. It computes
  the TS cycle offset needed for selected writes to land on a requested
  MAME-relative native sample. On the corrected full run,
  `chip-write-diff-14000-ym-resetdelay25-embeddedreplyack-coinbase-fullmame-keyon78-targetsample1-eventreport.json`
  shows the 38 `PC 0x8fcc reg 0x08 val 0x78` key-ons need variable offsets
  `11..56` cycles to land at `MAME+1` sample. That is why the broad `+48`
  replay PCM diagnostic works, and also why it must stay diagnostic until the
  remaining event-cycle skew or MAME stream-update boundary is modeled directly.
  The exact target-offset experiment also rules out a key-on-only fix: full
  replay with all 38 key-ons forced to `MAME+1` sample still fails at worst lag
  `52` / maxAbs `0.03913`, while `MAME+2` sample still fails at worst lag
  `53` / maxAbs `0.02898`. The focused
  `pcm-keyon-target-sweep-window4546560.tsv` shows the same local window passes
  with targets `0` and `3` but fails with targets `1` and `2`, so the remaining
  YM residual is tied to the surrounding register burst and sample-prepare
  ordering, not the `reg 0x08` timestamp alone.
  Re-running the exact `MAME+1` key-on list with the same lag tie-breaker as
  the current green gate (`--lag-tie-correlation-epsilon 0.01`) still fails the
  full `849`-window replay gate:
  `pcm-diff-replay-14000-resetdelay25-embeddedreplyack-coinbase-default-mamestream-ymreg18offset1-keyon78-targetsample1-lagtie001-sourceym-hop4096-gate.json`
  reports worst correlation `0.9715`, worst lag `51`, worst RMS `0.00318`,
  and worst maxAbs `0.01877`. Under that tie-breaker the rejection is lag-only,
  not amplitude-only.
  The SoundChip replay side now also has
  `--ym-write-event-sample-offset-matches frame:pc:reg:val:delta`, backed by
  `SoundChipConfig.ymWriteEventSampleOffsetMatches`. This offsets only the
  `mame-stream` sample target used before a selected YM data write is applied;
  it does not move the CPU, register write, or drained chip-write timestamp.
  It is intentionally separate from direct
  `--direct-ym-write-sample-offset-matches`: direct `+1` and replay `+1` are
  not equivalent because SoundChip replay already services the stream through
  `targetSample + 1` before applying the YM write. A focused sweep on window
  `4546560` with `*:0x8fcc:0x08:0x78` found replay sample offset `-1` to be
  the best local sample-unit experiment (`corr=0.9868`, lag `1`, RMS
  `0.00160`, maxAbs `0.00457`), ahead of offset `0` (`corr=0.9810`) and the
  rejected `+1/+2` shapes. Full 14000-frame replay with the broad `-1` sample
  offset still fails the strict gate at worst lag `51` despite improved
  amplitude (`worstCorr=0.9777`, worst maxAbs `0.01846`), so it remains
  evidence for YM boundary semantics and does not replace the current `+48`
  cycle diagnostic. Layering sample offsets on top of the current broad `+48`
  cycle diagnostic gives the opposite local polarity: focused window `4546560`
  improves from offset `0` (`corr=0.9903`, lag `1`, maxAbs `0.00573`) to
  offset `+1` (`corr=0.9974`, lag `2`, maxAbs `0.00254`). The full
  source-YM gate with `+48` cycles plus `+1` sample also passes and improves
  worst correlation:
  `pcm-diff-replay-14000-resetdelay25-embeddedreplyack-coinbase-default-mamestream-ymreg18offset1-keyon78p48-sampleoffset1-lagtie001-sourceym-hop4096-gate.json`
  reports `849` windows, worst correlation `0.9958`, worst lag `2`, worst RMS
  `0.00319`, and worst maxAbs `0.01609`. This is now the strongest replay PCM
  diagnostic for the selected source-YM windows. The matching `source=mix`
  artifact
  `pcm-diff-replay-14000-resetdelay25-embeddedreplyack-coinbase-default-mamestream-ymreg18offset1-keyon78p48-sampleoffset1-lagtie001-sourcemix-hop4096-gate.json`
  passes with the same summary; the selected windows are still all
  YM-dominant (`pokey=0`). This remains unpromoted hardware behavior because
  it layers two compensations on the same key-on selector and still does not
  prove a POKEY-audible mixed oracle.
  Fresh controls reject simpler promotions. Adding a global YM output-sample
  offset on top of the `+48/+1` diagnostic fails the full source-YM gate:
  `current-ym-output-offset-sanity/replay14000-keyon78p48-sample1-ymoutm2-sourceym.json`
  fails at RMS `0.01641` and maxAbs `0.07569`, `ymoutm1` fails at RMS
  `0.00932` and maxAbs `0.04079`, and `ymoutp1` fails at RMS `0.00661` and
  maxAbs `0.03143`. Broadening the selector to every `PC 0x8fcc reg 0x08`
  write is also rejected:
  `current-ym-output-offset-sanity/replay14000-pc8fcc-reg08-anyval-p48-sample1-sourceym.json`
  fails with worst correlation `0.7783`, RMS `0.01570`, and maxAbs `0.12426`.
  The current diagnostic is therefore tied to the repeated `val 0x78` key-on
  class, not a global stream alignment issue or every write to YM register
  `0x08` at that PC.
  A source audit against MAME/ymfm (`ymfm_fm.ipp`, `ymfm_opm.*`) confirms the
  expected generation order: the OPM stream clocks/updates the FM state before
  producing output. The TS YM order is already broadly aligned with that model,
  and the diagnostics-only `--ym-phase-advance-after-output` switch does not
  explain the current replay residual.
  Focused burst reports sharpen the cause. Frame `5661`
  (`chip-write-diff-5664-ym-resetdelay25-embeddedreplyack-coinbase-burst-frame5661-eventreport.json`)
  has the `0x8eeb/0x8fac/0x8fcc` write burst `24` cycles early and one native
  YM sample early; shifting the whole burst to targets `0..3` is PCM-neutral
  for window `4546560` because that window's peak is later. Frame `5691`
  (`chip-write-diff-5694-ym-resetdelay25-embeddedreplyack-coinbase-burst-frame5691-eventreport.json`)
  has parameter writes one native sample early while the `0x8fcc/0x78` key-on
  is already at native sample delta `0`. Single-frame PCM probes find frame
  `5671` as the first sensitive local key-on (`corr=0.9530`, still passing),
  and the `5671+5681` cluster reproduces the lower `corr=0.9715` shape while
  still passing locally. That points at accumulated YM phase/envelope state
  across the repeated key-on cluster, not a missing ordered write or a local
  parameter-burst timestamp fix.
  In both the direct-write path
  and the SoundChip replay
  render it can run YM with
  `--ym-scheduler mame-stream`, using MAME stream sample indices instead of
  cycle-stepped native output, and it can use `--resampler mame-lofi`, a shared
  TypeScript port of MAME's default LoFi audio resampler. The probe also has
  per-chip `--ym-resampler` and `--pokey-resampler` controls, plus integer
  or fractional native `--ym-resample-offset` and `--pokey-resample-offset`
  controls for both linear and MAME-LoFi resamplers, plus integer
  post-resample `--ym-output-sample-offset` and
  `--pokey-output-sample-offset` controls, all diagnostics only. The default
  promoted replay still uses cycle-scheduled YM audio plus linear resampling
  unless a probe opts into these flags. It can also run
  the rejected-control `--defer-ym-audio-write-timing` experiment, which delays
  non-timer YM data writes to the estimated bus-write cycle while leaving
  timer/control timing alone, the even narrower
  `--defer-ym-parameter-write-timing` experiment, which leaves key-on writes at
  the default timing while delaying YM parameter writes, and the broader
  rejected-control `--defer-chip-write-timing` experiment, which applies chip
  writes at estimated bus-write offsets while leaving the default replay path
  unchanged. For YM DSP isolation it also has a rejected-control
  `--ym-phase-advance-after-output` switch, which moves the operator phase
  increment after the sine lookup without changing the default path. It also
  has diagnostics-only `--ym-resample-offset` and `--pokey-resample-offset`
  switches for testing native-chip sample phase before the final 44.1 kHz
  linear resample, `--pokey-write-cycle-offset` for direct MAME-write POKEY
  tap/update-order experiments, `--pokey-write-apply-delay` for SoundChip
  replay POKEY state-application timing experiments, plus
  `--pokey-sample-cycles` for non-default POKEY native cadence experiments.
  That resampler is now shared with the browser
  `SoundRenderer` PCM push path through `packages/engine/src/audio/resample.ts`;
  no chip offset is promoted by default. The historical attract WAV/tape pair
  remains the current PCM anti-regression: with `--ym-scheduler mame-stream`,
  all `76` selected audible windows pass `minCorrelation=0.95` and
  `maxAbsLag=12` in
  `pcm-diff-attract-ymstream-ls259fix-allwindows-hop4096.json` with worst
  correlation `0.9966`, worst absolute lag `3`, worst RMS `0.00219`, and worst
  maxAbs `0.01954`. The corrected Coin 1 WAV pairing is now fixed:
  `/tmp/marble-love/audio-bitperfect/mame-capture-ls259fix/mame_coinpolarity_14000.wav`
  was captured in the same `mame_sound_cmd_capture.lua` run, and its emitted
  cmd/status tapes compare byte-identical to the corrected `coinpolarity`
  oracle files. That turns the PCM gate into a real DSP/model gate rather than
  an oracle-pairing problem. The matched full-window run
  `pcm-diff-coinpolarity-ls259fix-matchedwav-statusframe-ymstream-allwindows-hop4096.json`
  initially failed over `849` MAME-audible windows with worst correlation
  `0.3783`, worst lag reaching the `2000` search limit, worst RMS `0.09440`,
  and worst maxAbs `0.23930`. The localized residual was YM channel `2` during
  the frame-1570 key-on sequence (`reg 0x08 val 0x7a` after `reg 0x22 = 0xc5`,
  algorithm `5`) while LFO waveform `3` was driving pitch modulation. The TS
  YM2151 now matches ymfm/MAME's LFO-noise order by shifting the LFSR before
  computing feedback. That closes the direct YM isolation for the formerly bad
  window: both
  `pcm-diff-coinpolarity-ls259fix-pokeymuted-directym-window1265664-noiselfsraftershift.json`
  and
  `pcm-diff-coinpolarity-ls259fix-directym-window1265664-noiselfsraftershift.json`
  pass at correlation `0.9999876`, lag `-5`, RMS `0.0004218`, and maxAbs
  `0.001068`. A standalone ymfm stream render of the same MAME YM log agrees
  with MAME at correlation `0.9999876` (lag `5`). The post-fix full SoundChip
  replay report
  `pcm-diff-coinpolarity-ls259fix-matchedwav-statusframe-ymstream-allwindows-hop4096-noiselfsraftershift.json`
  still fails with worst correlation `0.3156`, worst absolute lag `1972`, worst
  RMS `0.09895`, and worst maxAbs `0.23945`; the same `start=1265664` window
  fails in replay at correlation `0.5484`, lag `1896`. That moves the open
  blocker back to replay timing/phase around frame `1570`, not YM operator DSP
  or ordered write payload parity. A native replay/direct comparison first
  diverges around relative YM sample `908102` (frame `1217`), where corrected
  Coin 1 causes a dense YM rewrite burst. Payload/order still matches, but most
  TS YM write sample indices in the first `2000` frames are one native YM
  sample early versus MAME under the corrected origin phase. Preclocking the YM
  state through reset silence and fixed write-cycle offsets did not close the
  frame-1570 PCM window, so the remaining path is exact sub-instruction write
  timing rather than a global DSP, reset-preclock, or output-offset promotion.
  `probe-chip-write-diff.ts` now exposes that as a first-class gate with
  `--sample-rate` and `--sample-tolerance`. The current 2000-frame report
  `chip-write-diff-2000-ym-native-sample-coinpolarity-ls259fix-after-defaultpreemptfix.json`
  compares `45942` ordered YM writes and fails only the native-sample timing
  class: `30187` writes land outside exact sample parity, with
  `nativeSampleDelta` min `-9`, max `1`, meanAbs `0.67`. Command-cycle offsets
  of `+20` and `-20` cycles from frame `1199` do not materially improve that
  count. The CLI probes also stop passing an implicit zero preemption lookahead;
  explicit `0` now means disabled, while the before-only diagnostic remains
  opt-in. Reset-release timing is still useful evidence, not a default: on the
  corrected Coin 1 baseline, `--reset-release-delay 26` reduced YM
  native-sample mismatches to `8728` and meanAbs to `0.19`, but
  `pcm-diff-replay-window1265664-resetdelay26.json` still failed at correlation
  `0.5743`, lag `1347`. A refined real replay sweep over delays `18..26` now
  finds `--reset-release-delay 22` as the native-sample minimum for both chips:
  YM `6689/45942`, meanAbs `0.1499`, and POKEY `5123/31458`, meanAbs `0.1651`.
  The phase sweep at delay `22` only nudges the counts to `6608` YM and `4986`
  POKEY, so a global sample-index origin is not the missing fix. The same local
  PCM window with delay `22` (`pcm-diff-replay-window1265664-resetdelay22.json`)
  is effectively unchanged: correlation `0.5743`, lag `1352`. Combining
  `--timer-a-start-delay 8` with the older delay-26 run improves the same local
  lag to `274` but worsens native-sample mismatches to `18466`, so the
  remaining work is still the Timer A / music-update timing clusters rather
  than a single reset-delay promotion. The delay-22 clusters remain the same
  shared path: YM `0x8eaf`, `0x8e9c`, `0x81c3`, and `0x81bb`; POKEY remains in
  the `0x8e2x-0x8e6f` music-update stores. Follow-up
  reply-ack replay using a cmd tape with embedded `replyAcks` matches the
  sidecar-ack baseline but does not close PCM: at reset delay `22`, YM remains
  `6339/45942` native-sample mismatches
  (`chip-write-diff-2000-ym-native-sample-resetdelay22-embeddedreplyack.json`);
  at reset delay `21`, POKEY remains `4941/31458`
  (`chip-write-diff-2000-pokey-native-sample-resetdelay21-embeddedreplyack.json`);
  the local replay PCM window remains correlation `0.5743`, lag `1352`
  (`pcm-diff-replay-window1265664-resetdelay22-embeddedreplyack.json`). Treat
  embedded reply-ack as baseline oracle plumbing, not as the timing fix.
  Other controls on the corrected baseline reject the remaining easy timing knobs:
  `--defer-chip-write-timing` destroys the native-sample gate
  (`38065/45942` YM mismatches, meanAbs `138` samples), the narrower
  `--defer-ym-audio-write-timing` and `--defer-ym-parameter-write-timing`
  worsen the local replay PCM window to correlation `0.4272`, and the newer
  `--defer-ym-timer-control-write-timing` is also not promotable: its best
  reset-delay sweep is YM `6350/45942` at delay `19`, still worse than the
  embedded-reply-ack baseline `6339/45942` at delay `22`; POKEY improves only
  trivially to `4933/31458` at delay `18` while YM worsens
  (`chip-write-diff-2000-ym-native-sample-embeddedreplyack-defertimercontrol-resetdelay19.json`,
  `chip-write-diff-2000-pokey-native-sample-embeddedreplyack-defertimercontrol-resetdelay18.json`).
  A global IRQ service delay is rejected the same way: at the embedded
  reply-ack baseline, `--irq-service-delay 1` worsens YM to `6824/45942` and
  POKEY to `5159/31458`, and the local PCM window is unchanged
  (`pcm-diff-replay-window1265664-resetdelay22-embeddedreplyack-irqdelay1.json`
  remains correlation `0.5743`, lag `1352`). A global YM event timestamp
  offset is also rejected: `--ym-write-event-cycle-offset -4` worsens the YM
  native-sample gate to `7484/45942`, larger offsets get much worse, and the
  local PCM window only changes at `-16`, where it regresses to correlation
  `0.4513` and lag `-1956`
  (`pcm-diff-replay-window1265664-resetdelay22-embeddedreplyack-ymwriteoffset_neg16.json`).
  `--command-nmi-sample-cycle 0/1/3` only moves the YM mismatch count within
  `8727..8731`. Removing frame-mode status replay is not a PCM fix either:
  the local window is equivalent at summary precision
  (`pcm-diff-replay-window1265664-resetdelay22-embeddedreplyack-no-status-tape.json`),
  while the full 14000-frame cycle300/frame1 gate without status tape still
  has payload counts matched but fails `27` YM and `51` POKEY timing rows
  (`chip-write-diff-14000-cycle300-frame1-embeddedreplyack-no-status-tape.json`).
  Keep status replay in promoted full timing gates, but do not treat it as the
  local PCM blocker. The latest stream-origin and reset controls also reject
  the simple PCM explanations. `--ym-stream-absolute-origin` preclocks the
  SoundChip YM `mame-stream` by the reset-frame command's absolute MAME sample
  index (`228311` native samples in the corrected Coin 1 tape) and removes
  output padding for source-YM comparisons; it worsens the local window to
  correlation `0.5177`, lag `-1958`
  (`pcm-diff-replay-window1265664-resetdelay22-embeddedreplyack-ymstream-absolute-origin-sourceym.json`)
  versus the source-YM baseline correlation `0.5743`, lag `1352`
  (`pcm-diff-replay-window1265664-resetdelay22-embeddedreplyack-sourceym-baseline.json`).
  `--ym-keyon-write-event-cycle-offset` shifts only YM key-on (`reg 0x08`)
  event timestamps and is flat over `-16..+16` cycles (`0.5741..0.5743`
  correlation). `--disable-ym-reset` ignores LS259 bit-0 YM reset writes and
  only nudges the window to correlation `0.5767`, lag `-437`
  (`pcm-diff-replay-window1265664-resetdelay22-embeddedreplyack-disableymreset-sourceym.json`).
  The stronger isolation is `probe-chip-write-diff.ts --ts-ym-write-out`:
  rendering the exported TS YM event stream through the direct MAME-write path
  still fails the same window at correlation `0.4366`, lag `241`
  (`pcm-diff-direct-tsymwrites-window1265664-resetdelay22-embeddedreplyack.json`),
  while direct MAME YM writes pass at correlation `0.9999977`. The current
  blocker is therefore the TS event timing/sample placement itself, not the
  PCM DSP, reset handling, stream-origin padding, or browser bridge. Rendering
  the exported TS writes with replay-relative origin plus the SoundChip output
  pad reproduces the live SoundChip failure (`0.5743`, lag `1351` in
  `pcm-diff-direct-tsymwrites-replayorigin-offset195941-window1265664-resetdelay22-embeddedreplyack.json`).
  The matching MAME control with replay-relative origin also fails (`0.6285`,
  lag `-1981`), while MAME absolute-origin writes still pass even when sample
  indices are computed from integer cycles. Absolute YM preclocking is likely
  required for the final path, but it cannot compensate for the current TS
  event-timing history by itself. A frame-1217 full-PC control also shows TS
  and MAME taking a different command-boundary NMI phase at the Coin 1 command,
  but forcing no sampled NMI delay (`--command-nmi-sample-cycle Infinity`)
  worsens the native-sample gates to `6398/45942` YM and `5120/31458` POKEY,
  and leaves the local source-YM PCM window unchanged at correlation `0.5743`.
  `probe-sound-window-trace.ts` and `probe-pc-cycles.ts` now
  support `--status-tape-mode frame`; the current frame-mode trace artifacts
  `ts_sound_window_trace_372_377_resetdelay26_statusframe.json` and
  `ts_pc_cycles_372_377_resetdelay26_statusframe.json` keep
  `baseMismatches=0` for the focused first music-update window, so future PC
  drills should use those instead of read-index status trace variants. The
  current per-PC delta artifacts
  `chip-write-diff-2000-ym-pcdelta-resetdelay26.json` and
  `chip-write-diff-2000-pokey-pcdelta-resetdelay26.json` show small net drift
  but noisy recurring intervals: YM `0x8eaf/0x8e9c` compare `14594` writes
  each with drift `13` cycles and interval-delta meanAbs `1.29`; YM
  `0x81bb/0x81c3` compare `7312` writes each with drift `18` and interval
  meanAbs about `4`; POKEY music-update stores around `0x8e3c..0x8e6f` compare
  roughly `3492` writes per PC with drift `3..13` and interval meanAbs about
  `4.5..4.8`. That points to recurring instruction/device phase jitter rather
  than monotonic long-run clock drift. The sample-bearing reruns
  `chip-write-diff-2000-ym-pcdelta-samples-resetdelay26.json` and
  `chip-write-diff-2000-pokey-pcdelta-samples-resetdelay26.json` show paired
  local slips that usually resynchronize on the next same-PC write. YM outliers
  include command-adjacent frame `641` and `1963` cases, both frames with an
  extra `0x07` command in the corrected tape; POKEY outliers include paired
  `-80/+80` cycle slips across frames `529/530` and `593/594`. A small
  corrected Coin 1 preemption check keeps the command-boundary shim rejected:
  lookahead `3` only moves the YM native-sample mismatch count from `8728` to
  `8677`, while lookahead `6` and `24` worsen it to `8777` and `8811`. A
  native sample phase sweep now rejects a global origin shift as the missing
  fix: on the same reset-delay baseline,
  `chip-write-diff-2000-ym-native-sample-phase-sweep-resetdelay26.json` only
  improves YM from `8728` to `8670` mismatches at phase `+2` cycles, and
  `chip-write-diff-2000-pokey-native-sample-phase-sweep-resetdelay26.json`
  only improves POKEY from `6673` to `6559` mismatches at phase `-11` cycles;
  min/max sample deltas remain YM `-8..7` and POKEY `-5..6`. Focused
  command-byte offset probes also reject the obvious non-heartbeat-command
  hypothesis. Offsetting only byte `0x07` by `+40/+80/+120` cycles leaves YM
  at `8727/8726/8727` mismatches and POKEY at `6668/6658/6666` versus the
  reset-delay baseline `8728`/`6673`; `-80` is neutral or worse. Offsetting
  all observed non-heartbeat bytes by `+80` breaks ordered alignment
  (`16716` YM mismatches, `11778` POKEY mismatches, and TS YM write count
  drops to `45079`). Use the byte filter as a diagnostic only; do not promote
  a command-byte phase rule from this evidence. Focused
  MAME/TS traces for frame `529..530` were generated for context, but their
  direct trace diff is not proof-quality because the window origins pair
  different local PC/write sequences; keep using the ordered write-delta report
  for this residual class.
  The prior component diagnostic confirmed all 38 selected audible windows are
  YM-dominant (`ymShare=1.0`, POKEY RMS `0`) and showed a stable TS->MAME gain
  near `0.957`. That matched the MAME route table: Atari System 1 routes each
  YM2151 output at gain `0.48`, while the old TS `/65536` normalization was
  equivalent to route gain `0.50`. The TS YM output now applies the MAME route
  gain, moving the attract best global gain to `0.9971` while leaving POKEY
  scaling unchanged. The latest route-gain attract run still reports POKEY
  `rms=0` and `maxAbs=0` while YM reaches `maxAbs=0.14867`; the earlier
  full-attract `--window-source pokey` scan proved the same no-POKEY-audio
  condition across the render, not just in selected MAME-audible windows.
  `oracle/mame_playable_input_capture.lua` can now optionally emit sound cmd
  and main-reply ack tapes via `MARBLE_PLAYABLE_SOUND_CMD_OUT` and
  `MARBLE_PLAYABLE_SOUND_REPLY_OUT`, separating real-playable MAME capture from
  web/gameplay wiring. The first 14000-frame default playable capture produced
  a `{frame, byte, secs, attos}` command stream identical to the attract tape
  and still has POKEY `maxAbs=0`; keep it as negative evidence, not as a
  POKEY-audible gate. A focused forced-command oracle now covers that missing
  axis: `oracle/mame_sound_cmd_inject_scan.lua` injects sound commands after
  normal boot and records whether AUDC voice registers get non-zero volume.
  The full `0x00..0xff` scan found `5064` POKEY AUDC-volume writes, first after
  command `0x05`, and the reduced `0x00..0x05` injection tape
  (`mame_cmds_inject0005_760.json`) keeps ordered chip-write parity green
  (`POKEY 9672 / 9672`; `YM 12448 / 12448` prefix, with only tail-cut extras
  past the MAME stop). Earlier POKEY PCM probes were still mixed with YM. The
  first clock/28 and muted-counter fix reached
  `pcm-diff-inject0005-760-pokey-windows-after-muted-counters.json` with worst
  correlation `0.4652` and worst lag `789`; a MAME capture forced to `63920`
  Hz (`pcm-diff-inject0005-760-pokey-windows-mame64k.json`) still bottomed out
  at correlation `0.4628`, so the miss is not just output resampling. The
  current TS POKEY now follows the MAME per-clock borrow/poly/output order for
  high-clock joined channels and averages the high-clock output into the /28
  native stream. That keeps the attract gate green
  (`pcm-diff-50w-lag12-after-pokey-mame-step.json`, worst correlation
  `0.9972`, POKEY `maxAbs=0`) and preserves forced ordered write timing within
  a practical `frameTolerance=1`, `cycleTolerance=180`
  (`chip-write-diff-inject0005-760-pokey-cycle180-after-avg28.json`, max
  replay-cycle delta `172`, mean abs `26.47`). Fixed-gain residual subtraction
  is rejected as a POKEY gate:
  `pcm-diff-inject0005-760-pokey-residual-after-mame-step-avg28.json` bottoms
  out at correlation `0.2955`, and POKEY-selected full-WAV windows remain too
  mixed/phase sensitive. A new oracle isolation flag on
  `oracle/mame_pokey_write_tap.lua`, `MARBLE_SOUND_MUTE_YM=1`, mutes only
  YM2151 key-on data writes so YM timers/control still drive the sound CPU.
  With the same reduced injection tape, that key-on-muted MAME WAV closes the
  first forced POKEY PCM gate:
  `pcm-diff-inject0005-760-pokey-ymkeymuted-mamewindows-lag12.json` and
  `pcm-diff-inject0005-760-pokey-ymkeymuted-pokeywindows-lag12.json` both pass
  40 selected windows with worst correlation `0.9976`, worst absolute lag `2`,
  worst RMS `0.00434`, and best global gain `0.9985`. The matching write diff
  is `chip-write-diff-inject0005-760-pokey-cycle180-ymkeymuted.json`
  (`9672 / 9672`, `0` mismatches under the same `frameTolerance=1`,
  `cycleTolerance=180` gate).
  The matching forced YM isolation uses full MAME WAV minus key-on-muted MAME
  WAV. The initial report
  `pcm-diff-inject0005-760-ym-from-full-minus-ymkeymuted-lag12.json` failed
  with worst correlation `0.3604`; a per-channel rerun localized the bad
  forced `cmd 0x04` band to TS YM channel 0 after MAME programmed channel 0 as
  right-only (`$20+ch0 = 0x9c`) and later keyed it on. That exposed a TS stereo
  routing bug: Atari System 1 routes YM2151/OPM output 0 (bit 6) to left and
  output 1 (bit 7) to right, while TS had the bits reversed. After fixing that
  mapping, the isolated YM report
  `pcm-diff-inject0005-760-ym-from-full-minus-ymkeymuted-channels-lag12-after-route-gain.json`
  passes 40 selected windows with worst correlation `0.9934`, worst absolute
  lag `7`, worst RMS `0.00342`, and best global gain `0.9984`. The isolated
  POKEY rerun
  `pcm-diff-inject0005-760-pokey-ymkeymuted-mamewindows-lag12-after-ym-route-gain.json`
  still passes with worst correlation `0.9976`, worst absolute lag `2`, worst
  RMS `0.00434`, and best global gain `0.9985`.
  A sample-detail rerun of the forced YM report now localizes the current
  worst exact-sample residual to sample `480848` (`mameSample 480854`) in the
  channel-6 effect band: TS is `-0.02510`, MAME is `+0.04044`, and only TS YM
  channel 6 contributes at that sample. A local `--max-lag 80` rerun on window
  `477184` still chooses lag `-6`, so this is not a simple wider-integer-lag
  alignment issue. The sample-neighborhood artifact
  `pcm-diff-inject0005-760-ym-window477184-trace24.json` shows the residual is
  a short transient during the channel-6 write burst, not a steady gain error:
  samples are close before the burst, diverge sharply while regs
  `$26/$2e/$36/$3e/$46...` are being rewritten, then settle again.
  YM register side effects now follow ymfm's sample-clock prepare model for
  the implemented TS state: reg `$08` writes only update the live key mask,
  operator key-on/key-off edges are applied on the next YM sample clock, and
  channel/operator register-derived params are latched from the reg shadow
  during the next YM sample prepare. `ym2151WriteData` now also marks every
  channel modified on each data write, matching ymfm's broad cache
  invalidation in `fm_engine_base::write` and `engine_mode_write`, instead of
  only preparing the addressed channel. This prevents a false retrigger when a
  key-off and key-on pair lands between two YM samples, and the behavior is
  covered by unit tests. It does not close the channel-6 residual by itself:
  `pcm-diff-inject0005-760-ym-after-ym-prepare-latch.json` still passes with
  worst correlation `0.9934`, worst absolute lag `7`, worst RMS `0.00342`,
  and worst maxAbs `0.06554`; the attract rerun
  `pcm-diff-50w-lag12-after-ym-prepare-latch.json` remains green with worst
  correlation `0.9972`, worst absolute lag `12`, worst RMS `0.00214`, and
  worst maxAbs `0.01276`. Ordered write parity is unaffected:
  `chip-write-diff-14000-order-after-ym-prepare-latch.json` remains green for
  YM2151 `379306 / 379306` and POKEY `257889 / 257889`.
  A narrower bus-write timing diagnostic is also rejected as a default path:
  `--defer-ym-audio-write-timing` improves the forced channel-6 window
  (`pcm-diff-inject0005-760-ym-window477184-trace12-defer-ym-audio-writes.json`,
  maxAbs `0.05342` vs `0.06554`) and keeps the forced YM gate above threshold
  (`pcm-diff-inject0005-760-ym-defer-ym-audio-writes.json`, worst correlation
  `0.9939`, worst lag `6`), but it fails the full attract gate
  (`pcm-diff-50w-lag12-defer-ym-audio-writes.json`, worst correlation
  `0.8947`, worst lag `1540`). This keeps the evidence pointed at
  sub-instruction CPU/device timing rather than a promotable global YM-audio
  write delay. The matching `--defer-ym-parameter-write-timing` run, which
  keeps key-on writes at the default timing, does not save attract: forced YM
  still passes
  (`pcm-diff-inject0005-760-ym-defer-ym-parameter-writes.json`, worst
  correlation `0.9939`, worst lag `6`), while attract fails the same way
  (`pcm-diff-50w-lag12-defer-ym-parameter-writes.json`, worst correlation
  `0.8947`, worst lag `1540`). That rules out key-on timing alone as the
  global-delay regression.
  The new direct MAME-write-timed diagnostic separates that timing class from
  residual chip DSP error. Feeding `mame_ym_writes_inject0005_760.json`
  directly into the TS YM model improves the forced channel-6 local window
  (`pcm-diff-inject0005-760-ym-window477184-mame-write-timed.json`) from
  maxAbs `0.06554` to `0.04480`, and the 35-window forced YM gate
  (`pcm-diff-inject0005-760-ym-mame-write-timed.json`) passes with worst
  correlation `0.9969`, worst lag `6`, worst RMS `0.00305`, and worst maxAbs
  `0.05215`. A follow-up standalone ymfm render matched the TS YM model under
  that old cycle/linear schedule, pointing the remaining direct YM residual at
  MAME stream scheduling/resampling rather than operator DSP. With the
  POKEY-muted oracle `mame_ym_writes_inject0005_760_pokeymuted.json`, the
  direct YM render now mirrors MAME `sound_stream::update()` sample boundaries
  via `--ym-scheduler mame-stream` and MAME's default LoFi resampler via
  `--resampler mame-lofi`: the focused channel-6 report
  `pcm-diff-inject0005-760-ym-window477184-mame-stream-lofi.json` passes at
  correlation `0.9999977`, lag `0`, RMS `0.000136`, maxAbs `0.00251`, and the
  broad `pcm-diff-inject0005-760-ym-mame-stream-lofi-35w.json` passes 35
  audible YM-only windows with worst correlation `0.999964`, lag `0`, RMS
  `0.000256`, and maxAbs `0.00349`. That closes the direct YM PCM isolation
  target for this forced window. The MAME stream scheduler is now also exposed
  in the SoundChip replay probe, but remains opt-in rather than default browser
  or gameplay audio. The matching POKEY direct
  diagnostic
  (`pcm-diff-inject0005-760-pokey-mame-write-timed.json`) passes 20 selected
  windows with worst correlation `0.9985`, worst lag `1`, worst RMS `0.00308`,
  and worst maxAbs `0.03686`, keeping the remaining POKEY work in the DSP /
  sample-phase bucket rather than ordered write parity.
  A narrower YM operator phase-control is rejected:
  `--ym-phase-advance-after-output` worsens the direct channel-6 local window
  from maxAbs `0.04480` to `0.04629`
  (`pcm-diff-inject0005-760-ym-window477184-phase-after-output.json`) and
  worsens the 35-window direct YM sweep from worst maxAbs `0.05215` to
  `0.06454`
  (`pcm-diff-inject0005-760-ym-mame-write-timed-phase-after-output.json`).
  Keep that flag as a reproducible negative control. The latest MAME
  stream/LoFi direct probe makes the next YM task promotion/integration of MAME
  stream scheduling, not another phase-order change.
  Native resample phase is also split by chip now. YM direct MAME-write-timed
  sweeps reject a global resample offset as the channel-6 fix: the baseline
  `--ym-resample-offset 0` remains the best worst-peak case, while
  `--ym-resample-offset -0.25` slightly improves RMS but worsens the 35-window
  worst maxAbs from `0.05215` to `0.05428`
  (`pcm-diff-inject0005-760-ym-mame-write-timed-resample-neg025.json`), and the
  local channel-6 window also keeps offset `0` as the best peak case
  (`pcm-diff-inject0005-760-ym-window477184-resample-neg025.json` worsens
  maxAbs to `0.04791`). POKEY's earlier local `--pokey-resample-offset -0.2`
  improvement turned out to be masking a rounded-rate error: TS used `63920`
  Hz for the `/28` POKEY stream, while the MAME `marble -listxml` device clock
  gives `1_789_772 / 28 = 63920.428571...` Hz. Promoting the MAME-listed
  `POKEY_NATIVE_SAMPLE_RATE` keeps the default offset at `0` and improves the
  broad YM-key-muted `0x00..0x0f` direct POKEY sweep from worst maxAbs
  `0.06274` to `0.02711`, worst RMS `0.00158`, worst correlation `0.99973`,
  and max lag `3` over the same 91 windows
  (`pcm-diff-inject0015-1120-pokey-mame-write-timed-wide-hop4096-exact-rate.json`).
  A wider YM-key-muted forced-command capture covers `0x00..0x1f` through frame
  `1700` with `27105` POKEY writes. The older all-audible-window direct POKEY
  gate
  (`pcm-diff-inject001f-1700-pokey-mame-write-timed-allwindows-hop4096-exact-rate-lag12search.json`)
  passed `205 / 205` POKEY-dominant windows with worst correlation `0.99973`,
  worst lag `3`, worst RMS `0.00158`, and worst maxAbs `0.02711`; that pass is
  now stale on the live code. The metadata-bearing current offset-0 rerun
  (`pcm-diff-inject001f-1700-pokey-mame-write-timed-current-baseline-lag12.json`)
  fails a looser gate with worst correlation `0.99738`, lag `4`, RMS `0.00417`,
  and maxAbs `0.06182`. The peak residual remains transition/phase shaped
  around CH0/CH1 attacks rather than steady gain. An older control run with
  `--max-lag 2000` failed only the lag threshold because four highly periodic
  windows picked equivalent far-away correlations up to `1652` samples, while
  the bounded-lag run kept the same RMS/maxAbs residuals. The explicit tie-break
  report
  `pcm-diff-inject001f-1700-pokey-mame-write-timed-allwindows-hop4096-exact-rate-lagtie3e-5.json`
  keeps the wide `--max-lag 2000` search but passes with
  `--lag-tie-correlation-epsilon 0.00003`: it reports the same worst RMS
  `0.00158` and maxAbs `0.02711`, chooses lag `3`, and records the four
  absolute far-lag candidates separately.
  With the exact rate, `--pokey-resample-offset -0.2` worsens worst maxAbs to
  `0.04307`, and `+0.05` worsens it to `0.02855`; keep offsets as diagnostics,
  not defaults. A broader `0x00..0x1f` offset sweep confirms this globally:
  offset `0` keeps the best 205-window envelope (`worstRms=0.00158`,
  `worstMaxAbs=0.02711`), while `-0.25` worsens maxAbs to `0.05012`, `+0.25`
  to `0.04337`, and `+1.5` to `0.03418`. The `+1.5` phase helps the local
  sample-`726888` attack transient but worsens the aggregate bound, so no
  POKEY resample offset is promoted. A LoFi-only POKEY direct render is also rejected:
  `pcm-diff-inject0015-1120-pokey-mame-write-timed-wide-hop4096-exact-rate-mame-lofi.json`
  still passes correlation but worsens worst maxAbs to `0.06202`, RMS to
  `0.00525`, and lag to `7`, so MAME LoFi should not be promoted for POKEY
  without a separate MAME stream-scheduler model. The wider `0x00..0x1f`
  LoFi control confirms the rejection
  (`pcm-diff-inject001f-1700-pokey-mame-write-timed-allwindows-hop4096-exact-rate-mame-lofi.json`):
  worst maxAbs rises to `0.06774`, RMS to `0.00519`, and lag to `10`.
  A focused
  `--pokey-channel-diagnostics` rerun of the old worst
  window now passes correlation `0.9999`, RMS `0.00149`, and maxAbs `0.01969`
  (`pcm-diff-inject0015-1120-pokey-worst786432-channeltrace-exact-rate.json`).
  The current wider-capture worst window at `720896` is the same class:
  `pcm-diff-inject001f-1700-pokey-worst720896-channeltrace.json` shows the
  peak exact-sample residual on a CH0+CH1 attack (`TS 0.04793`, MAME
  `0.07504`) followed by a near-matching plateau, so the remaining POKEY
  exactness gap is transition/phase shaped rather than a steady gain or
  channel-routing error.
  A separate direct-write timing diagnostic tests the MAME write-tap/update
  boundary explicitly with `--pokey-write-cycle-offset`. Older artifacts made
  `-1` look promotable: the broad
  `pcm-diff-inject001f-1700-pokey-write-offset-m1-allwindows-lagtie3e-5.json`
  and strict
  `pcm-diff-inject001f-1700-pokey-write-offset-m1-strict-pcm-gate.json`
  previously reported all `205` windows passing near worst correlation
  `0.99978`, RMS `0.00146`, and maxAbs `0.02633`. A current rerun of the
  strict artifact on the live code rejects that result: worst correlation
  `0.99769`, far periodic lag `1314`, RMS `0.00381`, and maxAbs `0.05604`.
  The current bounded-lag baseline at offset `0`
  (`pcm-diff-inject001f-1700-pokey-mame-write-timed-current-baseline-lag12.json`)
  also fails the loose gate at worst correlation `0.99738`, lag `4`, RMS
  `0.00417`, and maxAbs `0.06182`. A fresh loose sweep in
  `/tmp/marble-love/audio-bitperfect/current-pokey-offset-sweep/` ranks `-3`
  best over `-3..+3` (`corr=0.99825`, lag `4`, RMS `0.00341`,
  maxAbs `0.04447`), with `-2`, `-1`, and `0` following monotonically. MAME
  source explains why this should stay diagnostic: write taps run before the
  real handler, while `pokey_device::write` schedules `sync_write` before
  `write_internal` mutates state. Keep these offsets as tap-vs-application
  evidence until the POKEY stream/update boundary is proven well enough to
  promote.
  MAME POKEY source also shows `m_stream = stream_alloc(0, 1, clock())`, so a
  separate direct render now tests the full-clock stream shape instead of the
  `/28` averaged TS drain. With `--pokey-sample-cycles 1` and
  `--pokey-resampler mame-lofi`, the current broad `inject001f` run
  (`current-pokey-samplecycle-sanity/inject001f-pokey-samplecycles1-mamelofi-allwindows-gate.json`)
  improves materially over the current `/28` baseline but still fails the
  strict gate: worst correlation `0.99836`, lag `1`, RMS `0.00330`, maxAbs
  `0.03539`, and global gain RMS `0.00161`. Adding
  `--pokey-write-cycle-offset -8`
  (`current-pokey-samplecycle-sanity/inject001f-pokey-samplecycles1-mamelofi-writeoffsetm8-allwindows-gate.json`)
  tightens the broad envelope to worst correlation `0.99952`, lag `1`, RMS
  `0.00146`, maxAbs `0.03764`, and global gain RMS `0.00093`; one transition
  spike at sample `569380` keeps maxAbs red. That spike is now explained by the
  direct POKEY-only renderer using the fractional cmd-tape CPU rate
  (`1789772.625`) while the POKEY device and MAME listxml use integer
  `1789772`: by sample `569380`, the drift is about `7.4` POKEY cycles. The
  current POKEY-clock rerun
  (`current-pokey-clockrate-sanity/inject001f-pokey-samplecycles1-mamelofi-pokeyclock-allwindows-gate.json`)
  uses `directChipWriteCycleRate=1789772`, `--pokey-sample-cycles 1`,
  `--pokey-resampler mame-lofi`, and no write-cycle offset. It passes all `205`
  POKEY-dominant windows with worst correlation `0.999975`, lag `0`, RMS
  `0.000462`, and maxAbs `0.006613`; the formerly red `569344` window is now
  correlation `0.999975`, lag `0`, RMS `0.000233`, maxAbs `0.003522`. An
  earlier source-order control that sampled TS POKEY before `stepOneClock` was
  rejected in this older direct-isolation gate, before the current same-run
  command-edge preset and phase offsets. Keep explicit write-cycle offsets
  diagnostic-only; the promoted direct POKEY isolation is the device-clock
  timebase plus full-clock/MAME-LoFi render. The same device-clock rule now
  applies to direct mixed MAME-write renders when YM is scheduled by
  `mame-stream`, because YM write application is sample-indexed and the cycle
  loop only advances POKEY. The short forced `inject0005` direct mixed artifact
  `current-pokey-clockrate-sanity/inject0005-direct-mix-ymlofi-pokeyfullclock-lofi-pokeyclock.json`
  uses YM MAME-stream/MAME-LoFi plus POKEY full-clock/MAME-LoFi with no POKEY
  output offset and passes all `37` audible windows at worst correlation
  `0.999966`, lag `0`, RMS `0.000456`, and maxAbs `0.003888`. The older
  POKEY-linear `+3` direct mixed diagnostic still passes, but is now weaker
  evidence than the device-clock/full-clock render. A control that tried to
  promote the same integer POKEY clock into live SoundChip replay was rejected:
  the temporary clock-domain accumulator in `tickSoundDevicesRaw` made
  `current-runtime-pokey-clockdomain-sanity/inject0005-runtime-mix-linear-phase-after-pokeyclockdomain.json`
  fail badly (worst correlation `0.8806`, lag `1145`, RMS `0.03575`, maxAbs
  `0.21510`) and the YM-muted POKEY full-clock replay fell to correlation
  `0.2262`. After reverting that experiment, the restored replay baseline
  `current-runtime-pokey-clockdomain-sanity/inject0005-runtime-mix-linear-phase-after-pokeyclockdomain-rejected-rerun-restored.json`
  passes again at worst correlation `0.9936`, lag `3`, RMS `0.00526`, and
  maxAbs `0.08300`. Do not change SoundChip replay's CPU/POKEY tick ratio from
  this direct-render evidence.
  The SoundChip replay version of `--ym-scheduler mame-stream` was then checked
  on the 14000-frame attract cmd-tape. The CLI now treats the omitted
  `--ym-native-sample-rate` in MAME-stream mode the same way as browser replay:
  generate and resample YM at MAME's integer stream rate `55930`, while the
  cycle scheduler keeps the native `55930.375` rate. With linear resampling,
  the widened all-audible run
  `pcm-diff-attract-runtime-ym-mame-stream-rate55930-default-allwindows-hop4096.json`
  passes all `76` selected windows with worst lag `3`, worst correlation
  `0.99664`, worst RMS `0.00219`, and worst maxAbs `0.01954`. The older
  50-window report
  `pcm-diff-50w-lag12-ym-mame-stream-linear-runtime.json` remains a narrower
  checkpoint at worst correlation `0.99666`, RMS `0.00246`, and maxAbs
  `0.01425`. Combining that scheduler with MAME LoFi still passes but worsens peak/RMS
  (`pcm-diff-50w-lag12-ym-mame-stream-lofi-runtime.json`, maxAbs `0.01740`,
  RMS `0.00358`, lag `5`). Applying MAME LoFi without the stream scheduler is
  rejected for SoundChip replay: `pcm-diff-50w-lag12-ym-cycle-mame-lofi-runtime.json`
  fails the lag bound with worst lag `70`. Keep runtime LoFi opt-in until the
  remaining TS-vs-MAME write timing and mixed chip scheduling are tighter.
  A focused stream/linear sweep also rejects a promoted YM resample offset or
  fractional stream rate for this path. Offset `-0.25`
  (`pcm-diff-50w-lag12-ym-mame-stream-linear-offset-neg025-runtime.json`)
  improves worst RMS to `0.00228` but worsens peak maxAbs to `0.01436` versus
  the offset-0 `0.01425`; `-0.125` and `-0.5` worsen peak further, while `+0.25`
  worsens maxAbs to `0.02027`. Explicitly forcing `55930.375` as the
  stream/native rate fails the all-window lag bound with worst lag `70`
  (`pcm-diff-attract-runtime-ym-mame-stream-rate55930375-allwindows-hop4096.json`);
  MAME stream mode should keep the integer `55930` scheduler/rate unless a
  stronger mixed-path proof supersedes it.
  The forced full-mix `cmd 0x00..0x05` scenario now also passes the initial
  SoundChip runtime gate with MAME-stream YM and linear per-chip resampling:
  `pcm-diff-inject0005-760-runtime-mix-ym-mame-stream-linear-resamplerflags-allwindows.json`
  selects `37` audible windows with worst correlation `0.99403`, worst lag `5`,
  RMS `0.00836`, and maxAbs `0.12329`. The direct MAME-write mixed control
  `pcm-diff-inject0005-760-direct-mix-ym-mame-stream-linear-resamplerflags-allwindows.json`
  improves the same gate to worst correlation `0.99671`, lag `5`, RMS
  `0.00681`, and maxAbs `0.09810`, so part of the runtime residual is still
  6502/device scheduling rather than steady DSP gain. The focused trace
  `pcm-diff-inject0005-760-runtime-mix-worst561152-channeltrace.json` puts the
  peak residual at sample `566589`: TS `0.02207` versus MAME `-0.10123`, with
  POKEY silent and YM channel 1 dominant. The later component-isolation pass
  shows why the first hybrid LoFi control was misleading: YM MAME-stream/LoFi
  wants output lag `0`, while direct POKEY wants a `-3` comparison lag. With
  TS YM subtracted from the full MAME WAV,
  `pcm-diff-inject0005-760-direct-fullminusym-pokey-ymlofi-allwindows.json`
  passes the POKEY residual at worst correlation `0.99973`, worstAbsLag `3`, RMS
  `0.00140`, and maxAbs `0.01616`. Historical direct-render evidence added the diagnostics-only
  `--pokey-output-sample-offset 3` to the direct full mix
  (`pcm-diff-inject0005-760-direct-mix-ym-lofi-pokey-linear-pokeyout3-strict-allwindows.json`)
  and closed the forced direct mixed gate tightly at the time: `37` windows,
  all selected lag `0`, worst correlation above `0.9998`, RMS `0.00140`, and
  maxAbs `0.01616`. A current rerun after the POKEY clock correction no longer
  reproduces that strict bound (`corr=0.9975`, lag `1`, RMS `0.00504`, maxAbs
  `0.05193`), so the old report is historical until the current direct
  POKEY/mixed residual is explained.
  The current direct POKEY residual isolation against full MAME minus direct TS
  YM passes only with another local phase diagnostic:
  `pcm-diff-inject0005-760-direct-pokey-fullminusym-resample-neg1-out3-current.json`
  uses `--pokey-resample-offset -1 --pokey-output-sample-offset 3` and passes
  `21` selected windows at worst correlation `0.99907`, lag `1`, RMS
  `0.00241`, and maxAbs `0.03350`. The same POKEY phase does not close the
  full direct mix:
  `pcm-diff-inject0005-760-direct-mix-ym-lofi-pokey-linear-pokeyresample-neg1-out3-current.json`
  still fails at worst correlation `0.99892`, lag `1`, RMS `0.00452`, and
  maxAbs `0.07407`. A broader YM-muted direct POKEY control also rejects this
  phase:
  `pcm-diff-inject001f-1700-pokey-mame-write-timed-resample-neg1-out3-strict-current.json`
  fails the 205-window strict gate with worst correlation `0.9991`, far
  periodic lag `616`, RMS `0.00235`, and maxAbs `0.04392`. Keep `-1/+3` as a
  local full-minus-YM diagnostic, not a promoted resampler default.
  A follow-up direct-render sweep shows this is not an arbitrary renderer
  output hack: delaying MAME POKEY register writes by `112` sound cycles
  (`--pokey-write-cycle-offset 112`) without any POKEY output-sample offset
  reaches the same class
  (`pcm-diff-inject0005-760-direct-mix-pokey-writecycle112-refined-out0-with-sampleequiv.json`):
  worst correlation `0.99978`, lag `0`, RMS `0.00142`, maxAbs `0.01645`.
  The probe reports `112` sound cycles as `3.0037` output samples at the MAME
  `48 kHz` WAV rate. The refined sweep `96..128` cycles has its best RMS near
  `108` cycles and best maxAbs near `112` cycles; combining `112` cycles with
  `--pokey-output-sample-offset 3` worsens maxAbs to `0.09734`, confirming the
  two controls represent the same delay class rather than independent fixes.
  The opposite offset `-3` worsens maxAbs to `0.13897`. SoundChip replay now
  has the matching runtime diagnostic:
  `--pokey-write-apply-delay 112` delays POKEY register state mutation from
  the estimated bus-write cycle while leaving ordered diagnostic events at their
  original `{frame, cycle, pc, reg, val}` timestamp. The forced runtime mixed
  report
  `pcm-diff-inject0005-760-runtime-mix-pokey-applydelay112.json` uses
  YM MAME-stream/LoFi, POKEY linear, no POKEY output-sample offset, and passes
  `19` audible windows with worst correlation `0.9982`, worst lag `2`, RMS
  `0.00593`, and maxAbs `0.06465`. The matching order/payload write diff
  `chip-write-diff-inject0005-760-order-pokey-applydelay112.json` still passes
  YM prefix `12448 / 12448` and POKEY `9672 / 9672` when timing is ignored.
  Strict timing remains open:
  `chip-write-diff-inject0005-760-strict-pokey-applydelay112-fail.json`
  still reports YM maxAbs replay-cycle delta `299` and POKEY `172`, so the
  runtime POKEY delay is a PCM phase diagnostic, not a fix for the remaining
  6502/event timestamp parity. Runtime SoundChip replay with the earlier
  YM-LoFi/POKEY-linear/POKEY+3 diagnostic
  (`pcm-diff-inject0005-760-runtime-mix-ym-lofi-pokey-linear-pokeyout3-gated-allwindows.json`)
  is now historical: a current rerun misses the tight RMS gate at `0.00707`
  even though maxAbs improves to `0.07805`. Adding the current fractional
  POKEY resampler phase, `--pokey-resample-offset -0.75`, closes the live
  all-window forced runtime mixed gate
  (`pcm-diff-inject0005-760-runtime-mix-pokey-resample-neg075-out3-allwindows-current.json`):
  `37` windows, worst correlation `0.9936`, lag `3`, RMS `0.00526`, maxAbs
  `0.08300`, with dominant sources `{ym:21,pokey:5,mixed:11}`. A newer
  absolute-origin candidate also closes the same hop-4096 forced mixed gate:
  `current-runtime-pokey-streaming-probe/inject0005-fullclockabs-out-1-hop4096.json`
  uses `--ym-stream-absolute-origin`, `0x18:+1`, YM MAME-LoFi, full-clock
  POKEY (`--pokey-sample-cycles 1`), POKEY MAME-LoFi, and
  `--pokey-output-sample-offset -1`; it passes all `37` windows at worst
  correlation `0.99501`, lag `2`, RMS `0.00595`, maxAbs `0.08271`. The
  runtime POKEY-only YM-muted replay also passes once the probe is bounded to
  the physically relevant `+/-12` sample lag band:
  `current-runtime-pokey-streaming-probe/inject0005-runtime-pokey-ymmuted-fullclockabs-out-1-maxlag12.json`
  reports `21` windows at worst correlation `0.99682`, lag `2`, RMS `0.00549`,
  and maxAbs `0.07605`; the previous far lag `1647` was a periodic correlation
  selection artifact. The matching broad direct POKEY-only cross-check
  `current-pokey-fullclock-outminus1-crosscheck/inject001f-direct-pokey-out-1.json`
  keeps `205` YM-muted windows green at worst correlation `0.999975`, lag `1`,
  RMS `0.000462`, and maxAbs `0.00661`.

  The broader POKEY-audible oracle now has a same-run capture path instead of
  mixing artifacts from different Lua scripts. `oracle/mame_pokey_write_tap.lua`
  can emit the cmd tape with `MARBLE_SOUND_CMD_OUT`, embed main reply reads with
  `MARBLE_SOUND_CMD_EMBED_REPLY=1`, mute only YM key-on writes with
  `MARBLE_SOUND_MUTE_YM=1`, emit same-run YM writes with `MARBLE_YM_OUT`, and
  parameterize coin/start plus injected sound commands. New captures also write
  `soundCpuHz` and explicit per-command `cycleInFrame` using the rational
  System 1 sound clock (`14.318181 MHz / 8`), so TS replay does not need to
  re-derive sub-frame command offsets from attoseconds. The original 1700-frame
  same-run YM-muted `inject001f` capture
  under `current-pokey-long-replay/` produced `27171` POKEY writes, `1578`
  sound commands, and `1527` embedded reply acks. Direct rendering of that exact
  MAME POKEY write log against the same WAV
  (`pcm-diff-inject001f-1700-direct-pokey-samerun.json`) passes all `168`
  POKEY-dominant windows with worst correlation `0.99997575`, lag `0`, RMS
  `0.000451`, and maxAbs `0.00658`.

  The corresponding live SoundChip replay is now green after two fixes. First,
  YM2151 timer status only latches on overflow while the timer enable bit is
  set; this removes the frame-861 false early IRQ and makes the 900-frame
  `payload-pokey-900-ymstatus-gated.json` payload gate pass `12282/12282`
  writes with `0` mismatches. Second, deterministic replay uses a
  one-instruction command-NMI latency. The full 1701-frame same-run artifact
  `chip-write-diff-inject001f-1701-pokey-gated-cmdnmi1-wavrun.json` compares
  TS `27198` POKEY writes against MAME `27198` with `0` mismatches; the
  previous TS `27180` vs MAME `27171` result at target frame `1700` was a MAME
  cutoff artifact. The matching SoundChip PCM gate
  `pcm-diff-inject001f-1701-runtime-pokey-samerun-ymstatus-gated-cmdnmi1-wavrun.json`
  passes all `168` selected windows with worst correlation `0.9967`, lag `2`,
  RMS `0.00502`, and maxAbs `0.06613`.

  The same tap now captures a non-muted mixed oracle in one run. Under
  `current-mixed-samerun-1701/`, MAME produced one WAV, one embedded-reply cmd
  tape, `51163` YM writes, and `27198` POKEY writes. The combined event report
  `chip-write-diff-inject001f-1701-mixed-both-gated-cmdnmi1.json` passes both
  chips with zero ordered payload/PC mismatches. The POKEY-selected mixed PCM
  report
  `pcm-diff-inject001f-1701-runtime-mix-samerun-pokeywindows-cmdnmi1-gate.json`
  passes `168` windows with worst correlation `0.9644`, worst lag `2`, worst
  RMS `0.02921`, and worst maxAbs `0.21487`; the dominant window split is
  `{ym:5,pokey:88,mixed:75}`. The companion all-window mixed report
  `pcm-diff-inject001f-1701-runtime-mix-samerun-both-cmdnmi1-gate.json` fails
  only after the POKEY-selected region, in YM-only tail windows. A direct
  MAME-YM control
  `pcm-diff-inject001f-1701-direct-mameym-window1265664.json` passes the worst
  YM tail window at correlation `1.0000`, RMS `0.00019`, and maxAbs `0.00041`;
  treat the remaining tail gap as SoundChip replay/sample-timing alignment. The
  strict sample-timing report
  `chip-write-diff-inject001f-1701-mixed-ym-sampletiming-cmdnmi1.json` measures
  that residual directly: payload/PC parity remains ordered, but `46454` of
  `51163` YM writes miss native-sample exactness at `55930` Hz, with deltas
  `-10..+2` samples and the largest clusters at `0x8e9c`, `0x8eaf`,
  `0x81c3`, `0x81bb`, and `0x8fac`. A global phase sweep
  (`chip-write-diff-inject001f-1701-mixed-ym-samplephase-sweep-cmdnmi1.json`)
  improves the mismatch count only from `46454` to `46372`, with the same
  `0.94` sample meanAbs, so this is not a one-knob resampler offset. A global
  YM event-cycle offset sweep has a sharp diagnostic minimum at `+30` cycles
  (`5210` sample mismatches, meanAbs `0.108`), but
  `pcm-diff-inject001f-1701-runtime-mix-samerun-allwindows-ymoffset30-cmdnmi1-gate.json`
  still fails the all-window mixed gate in the later YM-only tail. Keep that
  offset as evidence for the next timing fix, not as a promoted replay rule.
  `probe-chip-write-diff.ts` now emits native-sample timing breakdowns by chip
  register category and by individual register whenever `--sample-rate` is set,
  so this classification is part of the repeatable report instead of a one-off
  Node analysis. On the PCM-green same-run candidate
  (`+30` YM event offset, frame-860 burst `-40`, no `0x18:+1`), the strict
  sample report
  `current-mixed-samerun-1701/chip-write-diff-globalp30-frame860burst-m40-noreg18p1-sampletol0-breakdown.json`
  keeps `5200/51163` YM sample-boundary mismatches and attributes them mostly
  to `channel-freq-algo=3515`, `timer=1188`, `operator=398`, and `key-on=93`.
  With `--sample-tolerance 1`, the companion
  `chip-write-diff-globalp30-frame860burst-m40-noreg18p1-sampletol1-breakdown.json`
  leaves `141` residuals: `channel-freq-algo=88`, `operator=27`, `timer=21`,
  and `key-on=5`, led by register `0x14` with `21` strict residuals. That rules
  out another broad key-on/Timer/LFO-only offset as the next promotion path;
  the remaining useful target is command-edge/sub-instruction replay timing.
  The full residual capture
  `chip-write-diff-globalp30-frame860burst-m40-noreg18p1-sampletol1-breakdown-allmismatches.json`
  records all `141` samples: `46` are direct command-crossings, `1` is a
  near-miss, and `94` are currently unclassified by that detector but cluster
  around frame-start command bursts. Frame `1130` contributes `53` writes after
  command `0x15` at cycle `0` and command `0x03` at cycle `538`, with a uniform
  `+80` cycle TS-MAME delta; frame `1250` contributes `23` writes after command
  `0x19` at cycle `0` and command `0x03` at cycle `623`, with a uniform `+62`
  cycle delta. The simple knobs are rejected: `--command-nmi-delay-instructions 0`
  and `--command-nmi-delay-instructions 2` both break ordered YM write count
  (`51161` TS writes vs `51163` MAME writes, about `17.9k` mismatches), while
  `--command-nmi-sample-cycle 0` and `--command-nmi-sample-cycle 4` leave the
  same `141` residuals as the default `2`.
  A narrower opt-in diagnostic can now override command-NMI delay for selected
  scheduled commands without changing default replay:
  `--command-nmi-delay-matches frame:byte:cycleInFrame:delay`. Using
  `--command-nmi-sample-cycle Infinity` plus overrides for only the two
  frame-start bursts and their following keepalive commands
  (`1130:0x15:0:0,1130:0x03:538:0,1250:0x19:0:0,1250:0x03:623:0`) improves the
  same tolerance-1 YM write report from `141` to `65` mismatches in
  `chip-write-diff-globalp30-frame860burst-m40-noreg18p1-sampletol1-delayoverride-frame1130-1250-bothcmds0-nosamplepoint.json`.
  The command-submit diagnostic shows `1579` commands, no pending-before
  command writes, delay histogram `{0:4,1:1575}`, and all four matched commands
  with effective delay `0`. The strict tolerance-0 report improves only
  slightly (`5200` to `5173`), so this is not the whole timing fix. The PCM gate
  remains green and metric-identical to the current audible baseline in
  `pcm-diff-inject001f-1701-runtime-mix-samerun-audible001-globalp30-frame860burst-m40-noreg18p1-cmdnmi1-delayoverride-1130-1250-nosamplepoint-gate.json`
  (`worstCorrelation=0.9779626`, lag `2`, RMS `0.023118`, maxAbs `0.218646`).
  Keep the override diagnostic-only until the remaining `65` residuals are
  explained and the rule is derived from command/NMI sampling state rather than
  hand-selected frames.
  The follow-up report
  `chip-write-diff-globalp30-frame860burst-m40-noreg18p1-sampletol1-delayoverride-frame1130-1250-bothcmds0-nosamplepoint-commandcontext.json`
  now records previous/next cmd-tape context for every mismatch sample. The
  remaining `65` split as `46` direct command crossings, `1` near-miss, and
  `18` neither. Of the crossings, `43` follow keepalive command `0x03`, `2`
  follow command `0x07`, and `1` follows command `0x10`, with the previous
  command only `7..33` TS cycles before the chip write. The neither bucket is
  mostly the known frame-860 timestamp burst (`13` rows with `+40` cycle
  delta), plus four frame-start keepalive aftermath rows
  (`653/712/1228/1497`, previous `0x03` at cycle `0`, delta `35..36`) and one
  frame-1354 row after command `0x07` at cycle `6189`. Layering the current
  preemption shim on top of the delay override is rejected: lookahead `6`,
  lookahead `24`, and before-only variants worsen the tolerance-1 count from
  `65` to `109`, `111`, and `133` respectively. The next target is therefore
  a real bus-cycle/NMI sampling rule for command edges near chip stores, not
  the existing broad preemption shim.
  The command-context report now also embeds command submit diagnostics by
  cmd-tape source index in
  `chip-write-diff-globalp30-frame860burst-m40-noreg18p1-sampletol1-delayoverride-frame1130-1250-bothcmds0-nosamplepoint-commandcontext-submit.json`.
  All `46` crossing residuals still use effective command-NMI delay `1`;
  actual submit overrun is small for the frame-start keepalives (`0..5`
  cycles), while the frame-860 neither bucket follows command `0x03` at
  `cycleInFrame=779`. Two tempting simplifications are now rejected. Forcing
  delay `0` on all residual crossing commands worsens the report to `118`
  mismatches in
  `chip-write-diff-globalp30-frame860burst-m40-noreg18p1-sampletol1-crossing-delay0-nopreempt-submit.json`;
  forcing delay `2` breaks ordered count (`51161/51163`) and jumps to `17905`
  mismatches in
  `chip-write-diff-globalp30-frame860burst-m40-noreg18p1-sampletol1-crossing-delay2-submit.json`.
  Moving only command byte `0x03` earlier is also rejected by
  `command-cycle-offset-03-sweep.tsv`: offset `0` remains best at `65`,
  `-4` gives `66`, `-8..-16` give `77`, and offsets `<= -20` break count or
  explode mismatch volume. A temporary whole-instruction frame-boundary hold
  diagnostic was tested and removed: it was neutral by itself (`65`) and
  worsened to `118` when paired with crossing delay `0`. The remaining fix
  needs more state than command byte, constant delay, command phase, or the
  current whole-instruction preemption model.

  Focused same-run window traces must be captured with the full oracle launch
  flags (`-nothrottle`, `-seconds_to_run`, isolated nvram/cfg dirs,
  `-nonvram_save`, and WAV enabled). Without those flags, the window tap
  follows a different early sound schedule and does not line up with the
  same-run write logs. The corrected window
  `current-mixed-samerun-1701/window-traces/mame-window-260-273-pc-oracleflags-rational.json`
  matches the same-run frame-261 command and YM timestamps. It confirms the
  first residual shape: TS reaches the `$81bb` YM timer write before the
  command edge, while MAME defers it until after the NMI handler returns. A
  manual focused diagnostic (`command-preempt-chip-write-before-only` plus
  `261:0x03:0:0`) moves the TS event to cycle `177` versus MAME `174`, but the
  generalized chip-store-boundary rule is rejected:
  `chip-write-diff-globalp30-frame860burst-m40-noreg18p1-sampletol1-delayoverride-1130-1250-beforeonly-chipboundary0-correctmatches.json`
  worsens the tolerance-1 report to `120` mismatches. Keep that flag as a
  diagnostic only; it is not a promotion path.
  The raw-timing report
  `chip-write-diff-globalp30-frame860burst-m40-noreg18p1-sampletol1-rawtiming-samples80.json`
  now records both the adjusted diagnostic YM event cycle and the raw 6502
  bus-store cycle for each TS write. It keeps the `65` residual mismatches, but
  only `8` of the apparent `46` command crossings remain crossings in raw bus
  time. The new `rawCommandNearMisses` report accounts for `39` additional
  residuals where the command arrives within `64` cycles after the raw bus
  store. The first residual is the same command edge at cycle `490051`:
  adjusted TS delta is `31` cycles because the YM event has
  `chipEventCycleOffset=30`, while raw TS delta is `1` cycle
  (`rawTsWriteOffset=3`) and MAME delta is `174`. Most remaining crossing
  labels are therefore event/sample-boundary artifacts introduced by the `+30`
  YM timing diagnostic, not evidence for a broad CPU preemption rule. The
  focused preempt-lookahead sweep rejects that rule too: lookahead `1..5`
  worsens the tolerance-1 report to `43879`, `46805`, `46924`, `46472`, and
  `44194` mismatches in the `...lookahead{1..5}-rawtiming.json` controls.
  `probe-chip-write-diff.ts` now also has a report-path-only command-edge
  placement diagnostic:
  `--ym-command-edge-event-delay`, `--ym-command-edge-event-after`,
  `--ym-command-edge-event-relation`, `--ym-command-edge-event-bytes`,
  `--ym-command-edge-event-pcs`, and multi-rule
  `--ym-command-edge-event-rules`. The relation selector includes the
  report-only `raw-before` class for commands just before the raw store
  instruction. It adjusts normalized TS YM event timestamps for the diff
  without moving CPU/chip state. The first sweep
  rejects the broad raw-after model: command `0x03`, raw-after `<=64`, delay
  `144` applies `91` events and worsens to `86` mismatches
  (`chip-write-diff-commandedge03-after-delay144-summary.json`). Raw-crossing
  only is useful: command `0x03`, delay `144` applies `8` events and improves
  the residual from `65` to `57` in
  `chip-write-diff-commandedge03-rawcross-delay144-samples80.json`; delay
  `144..188` plateaus at `57`.
  The current comparable command-edge reports require the PCM-green NMI
  diagnostic baseline: `--command-nmi-sample-cycle none` plus the frame
  `1130/1250` delay overrides. Without that, the same `0x03:-22..3` rerun
  returns `101` mismatches because the default sampled NMI delay is active.
  With the nosamplepoint baseline,
  `chip-write-diff-commandedge-nosample-03_-22_3_144.json` reports `25`
  mismatches. Adding byte-specific rules for commands `0x03`, `0x07`, and
  `0x10` reaches `21`
  (`chip-write-diff-commandedge-rules-03-07-10-nosample.json`). Adding a
  report-only `raw-before` relation for command edges landing just before the
  raw store instruction reaches `16`
  (`chip-write-diff-commandedge-rules-rawbefore03d176-nosample.json`).
  Extending the frame-860 `-40` event-offset burst over the remaining matching
  writes reaches `6`
  (`chip-write-diff-commandedge-rules-rawbefore-frame860wide-nosample.json`),
  but it is still non-promoted: the report has two known `0x03` raw-after
  false positives and three frame-860 duplicate-register overmatches. Keep
  this as a localization result, not a replay rule, until the NMI/event
  boundary is explained without oracle-specific filters.
  The follow-up diagnostic records the MAME cmd-tape `soundPc` in command
  contexts and lets `ymWriteEventCycleOffsetMatches` include optional raw
  `cycleInFrame` bounds. The `soundPc` split explains the two false positives:
  command sources `0x8b80` and `0x8bb5` have MAME YM writes at `+2/+5` cycles,
  so they should not use the `+144` placement, while useful `-19/-16` cases
  come from `0x86ce`, `0x8672`, and `0x9009`.
  `chip-write-diff-commandedge-rules-soundpcsplit-base-nosample.json` leaves
  only the `13` frame-860 rows. A wide frame-860 burst leaves only three
  duplicate-register overmatches, all later in the same frame; bounding the
  burst to raw `cycleInFrame 0..12000` closes the tolerance-1 write gate in
  `chip-write-diff-commandedge-rules-soundpcsplit-frame860bounded-nosample.json`
  (`0` mismatches out of `51163`, histogram `{0:46033,1:2754,-1:2376}`).
  Strict sample exactness is still open:
  `chip-write-diff-commandedge-rules-soundpcsplit-frame860bounded-sampletol0-nosample.json`
  reports `5130` mismatches, all within `±1` native sample. This is strong
  localization, not a promoted replay rule, because it still uses MAME
  `soundPc` filters and frame-specific cycle bounds.
  The paired strict phase sweep
  `chip-write-diff-commandedge-rules-soundpcsplit-frame860bounded-samplephase-nosample.json`
  tests `-64..64` cycle phases and only improves the exact mismatch count to
  `5072` at phases `-3` and `+30`; the remaining residual is not a single
  global native-sample origin error. The detailed `-3` phase report
  `chip-write-diff-commandedge-rules-soundpcsplit-frame860bounded-samplephase-bestm3-nosample.json`
  has histogram `{-2:1,-1:2330,0:46091,1:2737,2:4}` and keeps the same dominant
  PC clusters, so this remains diagnostics-only.
  `oracle/mame_sound_window_trace.lua` now records the last sound-CPU opcode
  fetch on YM/POKEY writes (`instPc`, `instOpcode`,
  `instFetchVideoCycleInFrame`, `instDeltaCycles`) when
  `MARBLE_SOUND_TRACE_PC=1`, and `probe-chip-write-diff.ts` includes the first
  TS `$1810` command read after each command context as `firstTsCommandRead`.
  The proof summary in
  `window-traces/command-edge-instfetch-summary.json` is the current causal
  discriminator: frame 273 reads command `0x03` before the target YM
  instruction fetch, while frames 797 and 975 write YM before the command is
  read. The multi-rule command-edge grammar now accepts `!pc+pc` in the
  `commandPcs` field, so the false `0x8b80/0x8bb5` command PCs can be excluded
  without a long include list. It also accepts optional trailing `writeRegs`,
  `writeVals`, and paired `writeRegVals` fields for diagnostic rule shaping:
  `bytes:minRawDelta:maxRawDelta:delay[:relation[:after[:before[:commandPcs[:anchor[:writePcs[:writeRegs[:writeVals[:writeRegVals]]]]]]]]]`.
  The compact rerun
  `chip-write-diff-commandedge-rules-ym-zero-diagnostic-exclude.json` keeps
  the YM tolerance-1 write gate at `0` mismatches; the combined check
  `chip-write-diff-commandedge-rules-combined-zero-diagnostic.json` leaves YM
  green but still has `742` POKEY native-sample timing mismatches.
  A first POKEY sweep with the existing report-only opcode adjuster localizes
  the broad timing class to opcode `0x91` (`STA (zp),Y`): `0x91=37` drops the
  POKEY tolerance-1 count to `78`, while the tighter sweep reaches `36`
  mismatches at `0x91=21/23`
  (`chip-write-diff-pokey-op91p23-samples80.json`). `0x91=30` has the best
  meanAbs in that sweep (`0.110`) but still reports `42` mismatches. The
  `0x91=23` residual is dominated by command crossings (`28/36`) on POKEY
  write PCs `0x8e28..0x8e6f`, with TS near command `-14..28` cycles and MAME
  near `+150..190`. The report-only `--pokey-command-edge-event-rules` path
  now closes that residual in
  `chip-write-diff-pokey-commandedge-op91p23-zero-candidate.json`: YM remains
  `51163/51163` with `0` tolerance-1 mismatches and POKEY reaches
  `27198/27198` with `0` tolerance-1 mismatches. The strict companion
  `chip-write-diff-pokey-commandedge-op91p23-zero-candidate-sampletol0.json`
  still reports `5130` YM and `6434` POKEY exact native-sample mismatches, all
  within `±1` sample, so this remains a localization diagnostic rather than a
  promoted replay rule. The current CLI implementation has been rerun from the
  serialized POKEY rules in
  `chip-write-diff-pokey-commandedge-op91p23-zero-candidate-rerun-current.json`
  and reproduces the same tolerance-1 result (`0/51163` YM, `0/27198` POKEY);
  for POKEY, the rule matcher falls back to adjusted
  `replayCycle/writeCycleOffset` when separate raw timing fields are absent.
  A newer diagnostic rerun,
  `chip-write-diff-pokey-commandedge-op91p23-zero-candidate-causal-context-current.json`,
  preserves that green tolerance-1 result and adds causal context to each
  command-edge adjustment: raw step start, raw write offset, write
  PC/opcode/reg/value, first TS command read, and command-submit timing. The
  added buckets show YM first-read deltas clustered at `74..82` cycles with
  target-from-read mostly `62..70` cycles (long `0x07` path at `218/219`), and
  POKEY first-read deltas at `74..81` cycles with target-from-read `68..112`
  plus the long `0x07` path at `205/217`. Grouping the adjusted samples by
  write PC/reg still leaves multiple target-from-read offsets on several POKEY
  copy-loop PCs, so command source/read-path context remains required. Use this
  as the next scheduler discriminator; the table remains report-only.
  `probe-chip-write-diff.ts` also has a first-read anchored diagnostic form for
  these rules (`anchor=first-read`) and an optional write-PC filter. The
  generated `ym-commandedge-firstread-rules.txt` and
  `pokey-commandedge-firstread-rules.txt` reproduce the same green tolerance-1
  result in `chip-write-diff-commandedge-firstread-current.json` (`0/51163`
  YM, `0/27198` POKEY). This is evidence for a command-read anchored scheduler,
  not a runtime rule to promote directly.
  The refreshed report
  `chip-write-diff-commandedge-firstread-current-contextgroups.json` keeps that
  zero-mismatch tolerance-1 result and adds context grouping to the adjustment
  summary. For YM, the top timer write group (`pc 0x81bb`, reg `0x14`) still
  needs target-from-first-read offsets `64/65/68/69/70`; for POKEY, copy-loop
  write PCs `0x8e3c`, `0x8e5b`, and `0x8e62` each have six adjusted writes but
  multiple target-from-first-read buckets. This rejects a simple per-write-PC or
  per-register delay promotion and keeps command source plus first-read path as
  the next causal scheduler discriminator.
  The combined strict phase sweep
  `chip-write-diff-pokey-commandedge-op91p23-zero-candidate-samplephase-current.json`
  keeps YM at `5130` exact mismatches (best `5072` at phases `-3/+30`) and
  POKEY at `6434` exact mismatches (best `6329` at phases `-10/+22/+54`), all
  within `±1` native sample. This rejects a global sample-origin fix for the
  zero-candidate residual. `probe-sound-sample-diff.ts` now matches the
  write-diff command-edge grammar (`anchor=first-read`, optional write-PC
  filters) and runs a probe-only prepass when those rules need future command
  submissions or `$1810` reads. The YM first-read PCM rerun
  `pcm-diff-inject001f-1701-runtime-mix-boundedym23-cmdedgeym-firstread-prepass-cmdnmi-aud001.json`
  applies all `52` YM adjustments, but leaves the same red metrics:
  `worstCorr=0.97796`, `worstRms=0.02312`, `worstMaxAbs=0.21865`, max lag
  `2`. The POKEY replay side now has a diagnostics-only
  `pokeyWriteApplyDelayProvider` and `--pokey-command-edge-event-rules`; with
  the write-diff raw basis supplied as
  `--pokey-command-edge-raw-cycle-offset-opcodes 0x91:23`, artifact
  `pcm-diff-inject001f-1701-runtime-mix-cmdedge-both-firstread-prepass-pokeyop91p23-cmdnmi-aud001.json`
  applies `52` YM and `36` POKEY adjustments. It still leaves the PCM gate red
  with unchanged worst metrics, so copying the localized event table into PCM
  replay is not enough. The remaining blocker is the mixed-window audio
  behavior around the worst windows, not missing command-edge context in the
  PCM probe.
  The PCM probe now accepts the same bounded YM write-offset selector syntax as
  `probe-chip-write-diff.ts` (`frame:pc:reg:val:delta[:cycleMin:cycleMax]`).
  With those bounded frame-860 YM rules and command-NMI overrides, the same
  1701-frame run splits cleanly between direct chip rendering and SoundChip
  replay. Direct MAME YM+POKEY writes pass the audible-window PCM gate in
  `pcm-diff-inject001f-1701-direct-mamechipwrites-mix-aud001.json` (`212`
  windows at threshold `0.001`, worst correlation `0.99498`, worst RMS
  `0.01095`, worst maxAbs `0.14196`, max lag `1`). The equivalent runtime
  replay report,
  `pcm-diff-inject001f-1701-runtime-mix-boundedym23-cmdnmi-aud001.json`, still
  fails (`worstCorr=0.97796`, `worstRms=0.02312`, `worstMaxAbs=0.21865`, max
  lag `2`), with worst windows in POKEY-heavy and mixed sections. The current
  PCM blocker is therefore replay event-application timing, not direct
  YM/POKEY DSP or mixer parity.
  A focused `--pokey-write-apply-delay` sweep narrows the first runtime PCM
  failure but does not solve the gate. On the POKEY-heavy window
  `start=1048576`, delays around `24..80` cycles pass the local thresholds
  (best local RMS near `56` cycles). On the mixed worst window `start=1163264`,
  RMS improves but the peak diff stays fixed at `0.21865`. The channel trace in
  `pcm-trace-runtime-window1163264-channels.json` shows that peak is YM-only in
  TS at output sample `1168416` (`tsYm=0.04045`, `tsPokey=0`) versus MAME
  `-0.17819`, with YM channel 2 dominating. The corresponding event-diff
  residuals are YM command-edge crossings in the frame `1441..1497` band, so a
  global POKEY delay is not enough. The next diagnostic render needs the causal
  YM command-edge timing model already proven by write-diff, kept separate from
  gameplay promotion.
  The focused follow-up added YM match-fire diagnostics to the PCM report:
  each mame-stream write now carries `eventCycleOffset` histograms, selector hit
  counts, frame buckets, and first-write samples. This proved that bounded
  `cycleInFrame` selectors were firing correctly; the earlier target-only
  frame-1458 rule failed because the audible phase depends on the preceding
  channel-2 burst, not because the selector parser missed the write. A broad
  PC-only `+5` rule for `0x8fac` channel-2 frequency/operator writes and
  `0x8fcc` key-on fixed the focused `1163264` window but regressed earlier
  windows. The minimal non-regressing localization is two channel-2 bursts:
  frames `1437` and `1458`, regs `0x7a/0x72/0x6a/0x62`, plus key-on
  `0x8fcc:0x08=0x7a`, all at `+5` cycles. With those YM selectors, global
  YM event offset `+30`, the bounded frame-860 `-40` burst, full-clock
  POKEY/MAME-LoFi, POKEY output offset `+1`, and command-NMI delay `1`, the
  full same-run mixed gate passes without a diagnostic POKEY apply delay:
  `pcm-diff-inject001f-1701-runtime-mix-ymevent30-frame860-ch2series1437-1458-keyon-pokeyout1-cmdnmi-aud001.json`
  selects `212` windows and reports worst correlation `0.9842`, worst RMS
  `0.01901`, worst maxAbs `0.10682`, and max lag `1`. The no-delay POKEY
  output sweep keeps offsets `0` and `+1` green, while the older output `-1`
  candidate is red (`worstRms=0.02246`, `worstMaxAbs=0.16239`). The
  diagnostic POKEY apply delay `56` with output `-1` also passes, but the
  no-delay output-phase candidate is the current proof target and is still not
  a runtime/web promotion.
  The current command-edge follow-up is less frame-bound: the chip-write event
  delta report now stores nearest command context in retained samples, and the
  command-edge summary retains up to `256` samples. That report shows the
  frame-1437 burst follows command `0x03` from sound PC `0x8d5a` at raw deltas
  `13156..13909`, while frame-1458 follows command `0x03` from sound PC
  `0x80f5` at raw deltas `16650..17403`. Replacing the hardcoded frame
  selectors with command-source raw ranges first proved that the channel-2
  filters no longer require a write-PC selector, and follow-up ablations remove
  the paired `reg=value` filters as well. The no-filter current-preset gate
  `current-preset-ym-ch2-no-regvals/pcm-diff-current-preset-ym-ch2-no-regvals.json`
  keeps the full mixed WAV gate green (`0.997409` / `0.005375` / `0.063317`,
  lag `1`). The paired chip-write report
  `current-preset-ym-ch2-no-regvals/chip-write-diff-current-preset-ym-ch2-no-regvals.json`
  applies `270` total YM command-edge adjustments and keeps both chips at zero
  tolerance-1 mismatches (`51163/51163` YM, `27198/27198` POKEY). It is still a
  diagnostic candidate: promotion still requires a causal scheduler model
  rather than a matcher rule shaped from one oracle.
  The current `inject001f-1701-commandedge` preset has adopted that less
  frame-bound form and removed YM write-match selectors entirely. The refreshed
  gate
  `current-preset-ym-no-writepc/chip-write-diff-current-preset-ym-no-writepc.json`
  applies `125` YM command-edge adjustments, including the frame-860
  command-source burst through `0x85f3` and the ten channel-2 writes through
  command-source PCs `0x8d5a` and `0x80f5`, and keeps YM `51163/51163` and
  POKEY `27198/27198` at zero tolerance-1 mismatches. The matching PCM artifact
  `current-preset-ym-no-writepc/pcm-diff-current-preset-ym-no-writepc.json`
  keeps all `212` audible windows green at worst correlation `0.9974`, lag
  `1`, RMS `0.00529`, and maxAbs `0.06332`.
  A later 85f3 ablation removed that rule's paired `reg=value` signature:
  `generalize-ym-85f3-regvals/chip-write-diff-ym-85f3-no-regvals.json` keeps
  YM/POKEY at zero tolerance-1 mismatches while applying `158` YM command-edge
  adjustments, and `generalize-ym-85f3-regvals/pcm-diff-ym-85f3-no-regvals.json`
  keeps the same `212` audible windows green (`corr=0.9974`, lag `1`,
  RMS `0.00538`, maxAbs `0.06332`). The preset now keys 85f3 only by command
  source and timing window. The same simplification now holds for the channel-2
  `0x8d5a`/`0x80f5` current-event rules; the preset keys them only by command
  source and timing window.
  A follow-up zero-lag trace at sample `1145754` isolated the current peak to
  replay YM channel 1 timing: direct MAME-write components matched TS POKEY
  (`0.08181818`) while direct reference YM channel 1 was about `0.052` lower
  than TS. The promoted `0x81bb` command-edge rule
  (`0x03:8000:11200:-26:raw-before:0:12000:0x81bb:current-event`) generalizes
  the fix without frame selectors. Preset artifacts now pass chip parity in
  `current-validation/chip-write-diff-both-commandedge-preset-81bb.json`
  (`51163/51163` YM and `27198/27198` POKEY, both `0` mismatches), keep the
  lag-search gate green in
  `current-validation/pcm-diff-inject001f-1701-commandedge-preset-81bb-tight.json`
  (`corr=0.997409`, lag `1`, RMS `0.005375`, maxAbs `0.063317`), and improve
  strict zero-lag maxAbs in
  `current-validation/pcm-diff-inject001f-1701-commandedge-preset-81bb-zero-lag.json`
  from `0.063239` to `0.047445` while staying at lag `0`.
  The follow-up zero-lag trace at sample `558051`
  (`current-validation/pcm-diff-inject001f-1701-commandedge-preset-81bb-reftrace-558051.json`)
  shows the new residual is POKEY channel 2 falling-edge shape, not YM: TS and
  direct reference YM match at the peak, while TS POKEY is `0.048917` and
  direct reference POKEY is `0.034835`. A narrow phase sweep first promoted
  `--pokey-resample-offset 22.6`; a follow-up MAME-source check then moved
  POKEY native output sampling before `stepOneClock`, matching MAME's
  `m_stream->update()`-before-raw-change behavior, and promoted
  `--pokey-resample-offset 23.25`. Zero-lag artifact
  `current-validation/pcm-diff-inject001f-1701-commandedge-preset-pokey2325-zero-lag.json`
  now passes with `corr=0.996571`, lag `0`, RMS `0.005535`, and maxAbs
  `0.041395`, while lag-search artifact
  `current-validation/pcm-diff-inject001f-1701-commandedge-preset-pokey2325-tight.json`
  remains green at `corr=0.997409`, lag `1`, RMS `0.005535`, and maxAbs
  `0.063317`. The remaining zero-lag peak is sample `569319`; reference-component
  trace
  `current-validation/pcm-diff-inject001f-1701-commandedge-preset-pokey226-reftrace-569319.json`
  shows TS YM and direct-reference YM matching exactly while POKEY channel 2 is
  on a one-sample rising edge. Treat the remaining peak as a POKEY
  DSP/resampler edge-shape target, not another chip-write parity rule.

  Same-run `$1820` status replay was ruled out for the original frame-861
  mismatch.
  `oracle/mame_pokey_write_tap.lua` can emit the same status format as
  `mame_sound_cmd_capture.lua` via `MARBLE_SOUND_STATUS_OUT`,
  `MARBLE_SOUND_STATUS_FULL=1`, and `MARBLE_SOUND_STATUS_MAX_READS`. The
  focused 900-frame capture
  `mame_status_inject001f_900_samerun_full.json` recorded `260851` status
  reads and one compressed base run. Replaying the base bits by read index
  (`payload-pokey-900-statusbase.json`) applies `260797` reads with zero base
  mismatches, but the first POKEY payload mismatch remains index `11562`.
  Full-value replay also leaves the same first mismatch and adds `5057`
  status value mismatches, so `$1820` is not the cause of this POKEY order
  failure.

  The focused window probes can now trace arbitrary sound RAM addresses:
  `MARBLE_SOUND_TRACE_RAM` in `oracle/mame_sound_window_trace.lua` and
  `--trace-ram` in `packages/cli/src/probe-sound-window-trace.ts`. Tracing
  `$055b,$055c,$055e,$055f,$0565` in frames `860..862` shows the concrete
  divergence. MAME zeros `$055f/$055e` at `PC 0x8ccc/0x8cd2` before the
  `0x8e20` POKEY reg `4/6` copy at frame `861` cycle `28170/28184`, so it
  writes zero. TS reaches the same `0x8e20` copy much earlier, at frame `861`
  cycle `6706/6720`, before its later zeroing path at `17847/17855`, so it
  writes `$79/$51`. A wide Timer A phase sweep confirms this is IRQ/order
  phase: `--timer-a-start-delay 512` reduces the 900-frame POKEY diff from
  `4` payload mismatches to `2`, but still leaves the first pair wrong.
  The new diagnostic `--timer-a-hold-while-overflow` is rejected (`16`
  baseline mismatches, no improvement with the `512` delay). Keep it opt-in
  only; the promoted fix still needs a conditional Timer A/IRQ/NMI sampling
  rule or sub-instruction 6502/device stepping.

  The probe no longer has to buffer those full-clock native POKEY samples for
  SoundChip replay when POKEY channel diagnostics are off. It now streams the
  selected POKEY resampler during frame replay and stores only output-rate PCM.
  The long corrected Coin 1 streaming regression
  `current-runtime-pokey-streaming-probe/replay14000-fullclockpokey-source-mix-hop4096-gate.json`
  simulated `410846534` native POKEY samples under `--pokey-sample-cycles 1`
  and still passed all `849` selected windows at worst correlation `0.97668`,
  lag `0`, RMS `0.00318`, and maxAbs `0.01620`. Those corrected-WAV windows are
  all YM-dominant (`pokey=0`), so this is a long-run memory/regression proof,
  not final POKEY-audible parity or a browser default promotion. The current
  direct-write `POKEY+3` candidate is no longer as tight as the older artifact:
  after correcting POKEY to the MAME-listed `1789772` Hz clock, the direct
  rerun still fails the old strict gate at worst correlation `0.9975`, lag
  `1`, RMS `0.00504`, and maxAbs `0.05193`. The remaining gap is therefore
  current direct POKEY/mixed residual plus replay timing, not a promotable
  resampler default. Global LoFi remains rejected
  for this path: runtime LoFi worsens to correlation `0.9859`, RMS `0.01285`,
  maxAbs `0.13765`, and direct global LoFi fails the lag gate with worst lag
  `1471`. The strict combined write diff
  `chip-write-diff-inject0005-760-combined-strict-runtime-mix.json` keeps
  ordered write contents useful but shows remaining replay-cycle deltas
  (YM maxAbs `299`, POKEY maxAbs `172`) around the same update PCs, so do not
  promote a resampler workaround as a timing fix. The full mismatch report
  `chip-write-diff-inject0005-760-combined-strict-allmismatches.json` shows
  the frame `700..720` deltas are systematic: POKEY writes at
  `PC 0x8e28..0x8e6f` and YM writes at `PC 0x81bb/0x81c3` and
  `0x8e9c/0x8eaf` are typically early by about `15..36` replay cycles
  (`-24..-26` is common; frame `711` POKEY updates are about `-26` and `-33`).
  `oracle/mame_sound_window_trace.lua` can now replay the same forced command
  injection env as `mame_sound_cmd_capture.lua`; the matching MAME/TS
  `699..700` trace shows one concrete command-boundary edge. MAME writes
  `PC 0x8e9c` at frame-700 `cycleInFrame=-36`, takes the command/NMI before
  `PC 0x8eaf`, then resumes and writes `0x8eaf` at `+166`; TS had already
  written that same `0x8eaf` value in frame `699`, `2` cycles before the
  command target. `probe-chip-write-diff.ts` now reports these as
  `commandNearMiss` diagnostics. The regenerated forced strict report
  `chip-write-diff-inject0005-760-combined-strict-nearmiss.json` finds only
  `13` YM and `4` POKEY near-miss mismatches, so this explains a real boundary
  class but not the main residual. The dominant pattern remains a broader
  `25..27` cycle TS phase lead through the `0x8e8x..0x8eaf` music-update path.
  A `1..6` cycle preemption-lookahead sweep and forced `--status-base 0x86`
  did not improve the strict timing class.
  The latest constant-control sweep does not find a promotable shortcut:
  `--reset-release-delay 30`, `--reply-ack-delay 24/70`,
  `--defer-chip-write-timing`, and `--defer-ym-audio-write-timing` all worsen
  the forced runtime PCM gate, while `--command-nmi-delay-instructions 1` and
  `--command-nmi-sample-cycle 0/4` are effectively identical to the baseline.
  A follow-up command-target offset sweep rejects the simple tape-phase
  hypothesis: global `--command-cycle-offset 4..32` worsens mean replay-cycle
  deltas to about `48..49` cycles, and post-reset-only offsets
  (`--command-cycle-offset-start-frame 245`) leave the class essentially
  unchanged at about `26` cycles. A reset-release sweep is useful evidence but
  still not promotable: `--reset-release-delay 25/26` reduces strict write
  meanAbs from about `26` cycles to about `3.4` cycles on
  `mame_cmds_inject0005_760.json`, yet the corresponding forced runtime PCM
  gate collapses to correlation about `0.756` with worst lag `1910` samples.
  The focused MAME bankselect trace
  `mame_sound_window_trace_244_245_bankwrite.json` now logs `$860001` writes:
  MAME writes `$FE0001=0x00` at frame-244 `cycleInFrame=0`, then writes
  `$860001=0x80` at `cycleInFrame=19`. Adding the 6502 reset sequence cost
  (`7` cycles) explains why the strict write sweep centers around
  `--reset-release-delay 26`; with that delay the first YM write moves from
  TS `2435` vs MAME `2462` to TS `2461` vs MAME `2462`. This proves the
  initial phase source, but not a promotable runtime rule. In current TS replay
  semantics, `releaseSoundReset()` zeros the CPU cycle counter after reset, so
  the bank-write delay itself is represented by `--reset-release-delay 19`.
  That value leaves the first strict YM/POKEY writes about `8` cycles early.
  The older forced runtime PCM report with `--pokey-write-apply-delay 112`
  (`pcm-diff-inject0005-760-runtime-mix-pokey-applydelay112-resetdelay19-gated.json`)
  is historical; re-running the same recipe on the current code fails the
  mixed/POKEY windows at worst correlation about `0.756`, lag `1910`, RMS
  `0.07905`, and maxAbs `0.17837`. Keep it as stale evidence for the delay
  class, not as the current green runtime gate.
  Small post-reset command offsets combined with those reset delays do not
  close the remaining strict write residual.
  The next timing fix therefore needs a variable MAME 6502
  interrupt/status/main-ack rule, not another constant offset.
  Browser replay now exposes the scheduler with
  `?soundReplay=...&soundReplayYmScheduler=mame-stream`, and now also exposes
  the verified PCM diagnostics as replay-only URL flags:
  `soundReplayYmResampler=mame-lofi`,
  `soundReplayPokeyResampler=linear`,
  `soundReplayPokeyResampleOffset=-0.75`,
  `soundReplayPokeyOutputSampleOffset=3`,
  `soundReplayPokeyWriteApplyDelay=112`, and
  `soundReplayResetReleaseDelay=19`. HTTP smoke for that URL, the tape
  JSON, and `/sound-worklet.js` returned `200 OK` on the Vite dev server. The
  in-app Browser automation runtime was unavailable in this session, so this is
  still an HTTP load smoke rather than an interactive AudioContext proof.
  The lag-12 cases are late YM-tail windows after the timer-prescaler fix; the
  first 20 attract YM windows remain within 5 samples. Remaining work is
  byte/sample exactness, stricter cycle timing, tail-lag reduction, and broader
  scenarios rather than command ordering.
- `packages/cli/src/probe-pc-cycles.ts` is the current strict-timing drill. It
  uses the same cycle-precise cmd tape and per-frame budgets as replay, then
  logs first-hit PC checkpoints instruction-by-instruction and can compare
  directly with MAME PC-tap JSON. `oracle/mame_sound_pc_cycles.lua` filters its
  read taps through the MAME `PC` state so checkpoints are opcode-fetch hits,
  not unrelated ROM data reads. The probe can also trace PC/status-read
  sequences plus TS IRQ/NMI/timer events, run with `--status-base 0x86`,
  consume a compressed `--status-tape`, consume the same MAME main-reply ack
  timeline with `--reply-ack-tape`, and run Timer A phase experiments with
  `--timer-a-start-delay` and command NMI-latency experiments with
  `--command-nmi-delay-instructions` without source edits.
- `oracle/mame_sound_window_trace.lua` and
  `packages/cli/src/probe-sound-window-trace.ts` now both support selected
  opcode-fetch logging in the same focused window as YM/POKEY writes. The TS
  probe exposes `--trace-pc` / `--trace-pc-full`; the selected range includes
  YM IRQ writes and the main POKEY update PCs. This makes it possible to
  distinguish CPU phase drift from store-bus subcycle errors in one artifact.
- `packages/cli/src/probe-sound-window-trace-diff.ts` compares those focused
  MAME/TS traces directly. It pairs ordered YM/POKEY writes, finds the nearest
  prior opcode fetch with the same PC in each trace, and reports both global
  write-cycle deltas and local fetch-to-write deltas. With full PC traces it
  also reports the ordered `pcFetch` sequence, the first PC-flow mismatch, and
  a MAME interrupt-prefetch filtered PC sequence. MAME `pcFetch` records now
  include `curpc` / `genpc` / `ir` / `opcode`, which lets the diff drop paired
  duplicate fetches where MAME exposes the 6502 IRQ prefetch/dummy read that
  the TS whole-opcode CPU does not model. MAME and TS window traces now also
  include sound-CPU `A/X/Y/P/SP` on `pcFetch` and `statusRead` events. The same
  report includes ordered `$1820` `statusRead` pairing and a
  `firstBranchingMismatch` helper, which searches for the first status value
  mismatch that causes a filtered PC-flow divergence within a short opcode-fetch
  lookahead. The status summary now classifies dynamic-bit mismatches
  separately for `$1820` bit `0x08` (main-to-sound pending) and bit `0x10`
  (sound-to-main pending), which makes reply-window misses visible without
  manually decoding status bytes. It now also emits a `commandBoundaries`
  section that pairs MAME
  `mainCmdWrite` with TS `cmdSubmit` and records the command byte, command
  cycle, MAME video-cycle position, TS actual submit cycle, and sound CPU PC at
  the boundary. The fresh `5660..5662` and `5736..5738` rational-clock trace
  pairs show `pcToWriteDelta=0` for paired chip writes, so the late key-on
  misses are not store-offset errors. They instead show mismatched sound CPU
  PCs at command boundaries while the command byte/cycle origin matches; the
  preceding `5735..5736` trace narrows one immediate cause to a bit `0x10`
  reply-pending miss: MAME reads `$1820=0x97` at `PC 0x8103` before the main
  reply ack, while TS reaches the corresponding poll after the embedded ack and
  reads `$87`. A constant `--reply-ack-delay 112` is only diagnostic: it
  improves the next command-boundary `soundPc`, but still leaves boundary
  state wrong and does not hit the direct key-on native-sample target. The next
  replay-timing fix should align inter-command CPU state and `$1820` /
  reply-ack timing before promoting any `0x8fcc` key-on timestamp offset.
  The diff now also emits `replyHandshakes`, pairing sound `$1810` reply writes
  with MAME `mainReplyRead` / TS `mainReplyAck` events and counting `$1820`
  polls before the ack. On the focused `5735..5736` artifact
  `window-trace-diff-5735-5736-resetdelay25-embeddedreplyack-fullpc-rational-aligncmd-replyhandshake.json`,
  MAME posts reply `0x01` at cycle `125`, acks at `195`, and observes one
  sound-to-main-pending poll before the ack; TS posts reply `0x00` at cycle
  `115`, schedules the same ack at `195`, and has no poll before the ack. NMI
  boundary-delay sweeps `0..8` and a targeted command offset of `33` cycles
  remain diagnostic-only: neither fixes the reply byte, so the open problem is
  the interrupted CPU/reply path state before the `$8103` poll, not just the
  main-side ack timestamp.
- Cycle-precise cmd tapes preserve same-frame command offsets and per-frame
  sound-cycle budgets from MAME timestamps. This matters on the reset frame:
  the first sound command is not at a nominal frame boundary, so replay must
  advance only to the next timestamped frame origin instead of ticking a full
  fixed frame.
- If a command has both `secs`/`attos` and `cycleInFrame`, the timestamp wins.
  The explicit cycle offset is a fallback for tapes without absolute MAME time,
  because Lua/double rounding can differ by one sound cycle from the rational
  timestamp conversion used by TS diagnostics.
- `cmdTapeCommandCycleInFrame` is the shared replay helper for explicit
  `cycleInFrame` offsets and legacy same-frame command spreading. The SoundChip
  replay loop and PC-cycle probe use the same target-cycle rule, keeping
  diagnostic traces aligned with browser `soundReplay`.
- `tickFrameWithTape` now models a MAME-derived command-NMI sample point for
  scheduled cmd-tape edges. Default `commandNmiSampleCycle=2` delays NMI by one
  instruction when a command target lands inside the just-completed instruction
  at or after that offset; probes can pass `--command-nmi-sample-cycle
  Infinity` to reproduce the old immediate-edge model. This is not a PC-range
  patch: it is the current sampled-device approximation for the 6502
  sub-instruction behavior MAME exposes in focused traces.
- `tickFrameWithTape` keeps a tape schedule clock separate from `cpu.cycles`.
  The 6502 may overshoot a frame with a full instruction, but frame origins and
  command submit times remain on the external MAME tape clock. This fixed the
  frame `3469` `cmd 0x08` vs Timer A ordering divergence. Its diagnostic
  callback now reports both the scheduled tape cycle and the actual CPU cycle at
  submit time. It also exposes a diagnostics-only `resetReleaseDelayCycles`
  option, surfaced in the CLI probes as `--reset-release-delay` and in browser
  replay as `soundReplayResetReleaseDelay`; the default is `0`, so normal replay
  remains unchanged.
- `createSoundChip` also exposes diagnostics-only `mainReplyAckDelayCycles`,
  surfaced in the CLI probes as `--reply-ack-delay`. Default `0` preserves the
  existing immediate 68010 `$FC0001` auto-ack. Non-zero values keep `$1820` bit
  4 visible until the configured cycle delay, which is useful for proving
  mailbox timing without changing gameplay contracts.
- `oracle/mame_sound_window_trace.lua` and
  `packages/cli/src/probe-sound-window-trace.ts` provide focused IRQ/NMI
  boundary traces. MAME output includes derived `relativeCycle` and
  `cycleInFrame`; TS output includes `actualCycle` and `actualCycleInFrame` for
  command submits, and can log `$1820` `statusRead` events in the focused
  window.
- Strict cycle timing is not the active gate. With `frameTolerance=0`,
  `cycleTolerance=120`, and timestamp-derived continuous replay cycles, the
  latest 14000-frame default diagnostic
  `chip-write-diff-14000-cycle120-after-defer-option-default.json` reports
  YM2151 `541` mismatches and POKEY `325` under the default
  `commandNmiSampleCycle=2`; ordered reg/val/PC parity remains green in
  `chip-write-diff-14000-order-after-defer-option-default.json`. The old
  immediate-edge model reported YM2151 `540` mismatches and POKEY `309`.
  Replay-cycle deltas span `[-295,+287]` cycles for YM2151 and `[-180,+396]`
  for POKEY, with mean absolute deltas around `36` cycles. These numbers use
  bus-write timestamps. The forced 760-frame YM strict report
  `chip-write-diff-inject0005-760-ym-strict-after-route-gain.json` has ordered
  reg/val/PC parity but marks all compared YM writes as `replayCycle`
  mismatches under `cycleTolerance=0`; deltas span `[-299,+9]` cycles with
  mean absolute `26.07`, matching the timing class behind the current
  forced-YM sample-detail residual. The same first YM case moved from TS replay cycle
  `490049` to `490052` because `STX abs` writes on opcode start +3 cycles. The
  diagnostics-only `--defer-chip-write-timing` control applies YM2151/POKEY
  writes at the estimated bus-write cycle instead of at opcode start, but it is
  rejected as a default model: the 2000-frame strict report
  `chip-write-diff-2000-cycle120-defer-chip-write-timing-rejected.json` jumps
  to YM `27475` and POKEY `19437` replay-cycle mismatches, and
  `pcm-diff-50w-lag12-defer-chip-write-timing-rejected.json` fails the PCM gate
  with worst correlation `0.8947` and worst lag `1540`. This shows that
  bus-write timing cannot be promoted cleanly while the TS 6502 still executes
  whole opcodes; the next timing fix needs sub-instruction/restart semantics or
  a narrower proven sampling rule. The old first POKEY mismatch at frame
  `255/256` was a MAME frame-label artifact;
  the first real POKEY mismatch is now write `#5484`, `PC 0x8e28`, with TS
  `170` cycles early. The first remaining YM mismatch is still write `#145`, a
  Timer A IRQ write at `PC 0x81bb` just before a command/NMI frame boundary,
  where TS is `173` cycles early. The 264..268 window trace shows TS frame-boundary
  submits happen only `+2` cycles after their tape target, so this is not a
  gross replay scheduler delay; it is residual interrupt phase/priority timing
  evidence for future bus-cycle-level CPU/device work. The focused 260..261
  MAME/TS IRQ traces narrow the first YM case further: TS Timer A overflows at
  replay cycle `489980`, services IRQ, and fetches `0x81a6` at frame-261
  `cycleInFrame=-64`; MAME fetches `0x81a6` at `cycleInFrame=-35`, then the
  frame-boundary command/NMI preempts before the YM write. The new
  diagnostics-only `--timer-a-start-delay 29` knob aligns that local window
  (`0x81a6` at about `-34`) but is rejected as a default fix because the
  14000-frame ordered diff fails YM with `2807` value mismatches, first at
  `PC 0x9385` (`0x07` vs `0x06`). Status-only-on-enable and a one-tick initial
  Timer A phase delay are rejected by the same long-run evidence. A second
  diagnostics-only `--command-nmi-delay-instructions 1` knob proves a separate
  command-boundary NMI sampling clue: with `--timer-a-start-delay 29`, frame
  `533` reaches MAME's `PC 0x8e9c` write only if NMI is delayed by one
  instruction, but that combination introduces an earlier strict mismatch at
  write `#295` and still fails the 14000-frame ordered YM gate at `PC 0x9385`.
  The frame-279 trace explains why a global NMI delay is wrong: in the Timer A
  IRQ handler path (`0x81b6/0x81bb`), MAME preempts with NMI before the YM
  write; in the frame-533 music-update path (`0x8e99/0x8e9c`), it lets one YM
  write complete before taking NMI. Treat this as a sampling-rule problem, not
  a PC-range behavior patch. The latest TS step-context traces add the likely
  axis: frame `261` has the command edge exactly at the end of TS step
  `0x8ff1` and immediate NMI matches MAME; frame `279` has the edge inside
  `0x81b8` at offset `1/4` cycles and MAME still takes NMI before `0x81bb`;
  frame `533` has the edge inside `0x8e96` at offset `2/4` cycles and MAME
  delays NMI long enough to complete the next YM write.
  The promoted sample-point rule preserves 14000-frame ordered YM/POKEY parity
  and keeps the 50-window PCM gate green; it also improves the 2000-frame
  strict diagnostic to YM `36` / POKEY `30` mismatches. The first remaining YM
  strict mismatch is still write `#145`. The latest crossing report shows the
  frame-261 command target at replay cycle `490051` lands inside the TS
  `PC 0x81bb` instruction after opcode start `490049` but before the estimated
  YM bus write `490052`; MAME defers the same write until `490225` after the
  command/NMI handler. The 14000-frame strict run classifies `12` YM mismatches
  and `10` POKEY mismatches as this command-target-before-I/O-write pattern.
  The latest PC-summary report
  `chip-write-diff-14000-cycle120-default-nmisample2-pcsummary.json` shows the
  residuals are clustered in the IRQ/music write paths: YM top PCs are
  `0x8eaf` (`185`, `6` crossings), `0x8e9c` (`172`, `4` crossings), `0x81bb`
  (`77`, `2` crossings), and `0x81c3` (`70`); POKEY top PCs are `0x8e68`
  (`44`, `2` crossings), `0x8e6f` (`42`, `1` crossing), `0x8e28` (`35`, `1`
  crossing), and `0x8e62` (`34`, `3` crossings). The next timing work is
  therefore a bus-cycle/preemption rule for these crossings, or a real
  sub-instruction 6502 stepper, not another command-NMI constant.
  A reset-window Timer A sweep adds one useful rejected control: with
  `--reset-release-delay 19`, `--pokey-write-apply-delay 112`, and
  `--cycle-tolerance 12`, a small `--timer-a-start-delay 8` reduces the forced
  760-frame strict write mismatches to YM `203` / POKEY `103`, but
  `pcm-diff-inject0005-760-runtime-mix-pokey-applydelay112-resetdelay19-ta8.json`
  fails the audible PCM gate with worst correlation `0.7554`, lag `1910`, RMS
  `0.0791`, and maxAbs `0.1784`. This means Timer A phase is definitely part
  of the first IRQ residual, but a global Timer A start delay is not the
  bit-perfect fix. `probe-sound-sample-diff.ts` now exposes the same
  diagnostics-only `--timer-a-start-delay` flag as the write diff so future
  Timer A hypotheses can be checked against PCM before promotion.
  The first preemption-shim experiment is diagnostic only and is not promoted:
  `--command-preempt-chip-write-lookahead 24` improves the 2000-frame strict
  probe from YM `36` / POKEY `30` to YM `11` / POKEY `16`, but the same rule
  worsens the 14000-frame strict run to YM `813` / POKEY `506` after only `36`
  preemptions. A narrower `--command-preempt-chip-write-before-only` variant is
  also rejected: the 14000-frame strict run worsens to YM `540` / POKEY `334`
  after `6` preemptions. The default rerun stays at YM `517` / POKEY `302`, so
  the code path remains unchanged unless the diagnostic flag is explicitly used.
  The PCM probe now exposes the same flags: with opt-in
  `--ym-scheduler mame-stream` and linear resampling,
  `pcm-diff-50w-lag12-ym-mame-stream-linear-preempt24-runtime.json` passes with
  worst correlation `0.99668`, lag `3`, RMS `0.001998`, and maxAbs `0.01417`;
  the before-only variant
  `pcm-diff-50w-lag12-ym-mame-stream-linear-preempt24-beforeonly-runtime.json`
  passes with worst correlation `0.99742`, lag `3`, RMS `0.001993`, and maxAbs
  `0.01417`. That is useful timing evidence and a small PCM improvement, but
  the 14000-frame strict write regression keeps both flags diagnostic-only.
  This matches MAME's local 6502 tech note
  `/opt/homebrew/Cellar/mame/0.286/share/doc/mame/techspecs/m6502.txt`: MAME
  timestamps every bus access at sub-instruction precision and can restart an
  interrupted instruction midstream. The current TS CPU steps whole opcodes, so
  strict-cycle parity needs bus-cycle stepping or an equivalent sampled-device
  rule before these residual deltas can be closed cleanly.
  The remaining fix needs a conditional timer/IRQ/NMI sampling rule, not a
  constant timer phase or NMI latency offset. The forced mixed runtime sweep
  reinforces that: fixed reset release, reply-ack delay, chip-write defer, and
  YM-audio-write defer controls all worsen the POKEY+3 PCM gate, while simple
  command-NMI delay/sample-cycle changes have no useful effect. The new
  `commandNearMiss` report narrows one command-boundary class, but its small
  count means the next investigation should target why TS reaches the boundary
  about `25..27` cycles early before the command is even sampled.
- A focused `$1820` input-bit diagnostic found a real but non-promotable clue:
  `--status-base 0x86` makes the first Timer-A IRQ subroutine path match MAME
  through `$e4e5/$e502`, but the same global override breaks 14000-frame ordered
  YM value parity with `2807` mismatches, first at `PC 0x9385` (`reg 0x08`,
  TS `0x07` vs MAME `0x06`). Keep `$87` as the replay default; a future input
  fix needs a scenario/time-aware `$1820` timeline captured from the same MAME
  oracle path.
- That scenario-aware proof path now exists. `oracle/mame_sound_cmd_capture.lua`
  can emit compressed `$1820` `statusBaseRuns`, and
  `packages/cli/src/sound-status-replay.ts` can replay those base bits while
  preserving TS mailbox pending bits. The default mode replays by ordered read
  index; `probe-chip-write-diff.ts` also has `--status-tape-mode frame` to
  apply compressed base runs by replay frame, avoiding read-count drift as a
  separate variable. The 14000-frame capture produced a cmd tape identical to
  the current cycle-precise oracle and three base runs: `$86`, then `$87` for
  the coin-pulse window, then `$86`. Replaying only the first 500-frame run
  keeps ordered write parity green and confirms the first IRQ subroutine clue;
  replaying all 14000-frame runs by read index fails YM at the same write
  `#275037` as global `$86`. Frame-based replay is also rejected:
  `chip-write-diff-14000-cycle120-status-runs-framebased.json` still reports
  YM `3683` and POKEY `342` mismatches under `cycleTolerance=120`, worse than
  the default status path. This makes `$1820` a diagnostic axis, not a default
  replay fix, until the status value is tied to the interrupt/phase rule that
  causes the read-count drift.
- `packages/cli/src/probe-sound-status-diff.ts` now does the ordered `$1820`
  read diff. With the 500-frame full MAME status log applied back into TS and
  frame labels ignored, the first PC/value mismatch is read `#72`: TS still
  polls `$1820` from `PC 0x8103` at frame-244 `cycleInFrame 12122`, while MAME
  has crossed the frame-245 command boundary and reads from `PC 0x9569` at
  `cycleInFrame 17`. The command write/submit itself is aligned; the remaining
  issue is the pre-boundary polling phase, roughly 30 cycles early in TS.
- The reset-release experiment is now repeatable but not promoted.
  `oracle/mame_sound_window_trace.lua` now records main `$860001` bankselect /
  sound-reset writes as `bankWrite` events. The focused artifact
  `mame_sound_window_trace_244_245_bankwrite.json` shows the boot command
  `$FE0001=0x00` at frame-244 `cycleInFrame=0`, followed by the release write
  `$860001=0x80` at `cycleInFrame=19`. Adding the modeled 6502 reset sequence
  (`7` cycles) matches the strict-write sweet spot at `--reset-release-delay 26`.
  Under the current TS reset semantics, `--reset-release-delay 19` is the
  hardware-evidenced bank-write delay and now has a gated PCM artifact, but it
  remains opt-in because strict writes are still not closed and the zero-delay
  POKEY apply-delay PCM run is cleaner.
  The paired PC/write artifact
  `window-trace-diff-244-245-resetdelay19.json` compares MAME
  `mame_sound_window_trace_244_245_pcwrite.json` with TS
  `ts_sound_window_trace_244_245_resetdelay19_pcwrite.json`. Across `52`
  comparable YM/POKEY writes, `pcToWriteDelta` is `0`: TS and MAME agree on
  the internal store bus offset (`+3` for YM absolute stores, `+5` for the
  POKEY indirect stores). The strict write deltas equal the PC-fetch deltas, so
  the next fix is PC/reset/interrupt phase, not `diagnosticWriteCycleOffset`.
  The same diff on
  `ts_sound_window_trace_244_245_resetdelay26_pcwrite.json` still has
  `pcToWriteDelta=0`; reset-delay `26` merely shifts global PC/write phase
  closer in this boot window and remains rejected by the forced PCM gate.
  Full-PC follow-up artifacts now split MAME prefetch noise from the first real
  executed-path divergence. The original
  `window-trace-diff-244-245-resetdelay19-pcfull.json` mismatch at ordinal
  `3200` (`MAME 244:9752 PC 0x8123`, `TS 244:9751 PC 0x81a6`) is an IRQ
  boundary artifact: the stateful MAME trace
  `mame_sound_window_trace_244_245_pcfull_state.json` shows duplicate
  `pcFetch` events where the second entry has `genpc == pc` and `ir == 0`.
  After `probe-sound-window-trace-diff.ts` drops those MAME interrupt-prefetch
  pairs, `window-trace-diff-244-245-resetdelay19-pcfull-state.json` moves the
  first real mismatch to the IRQ handler: MAME executes `PC 0xe514` at
  frame-244 `cycleInFrame=10536`, while TS takes `PC 0xe52b` at
  `cycleInFrame=10529`. The branch is `e512: BCS e52b`; it depends on the carry
  from the preceding `$1820` status value shifted by the IRQ subroutine. MAME
  reads `$1820=$86` at `$e4e5/$e502`, while TS reset-delay `19` reads `$87`,
  so TS takes the carry branch and MAME does not. Forcing TS `$1820` base to
  `$86` moves this filtered mismatch much later, but it still fails strict
  forced write parity and is the same non-promotable global status-base control.
  The reproducible status-branch artifact
  `window-trace-diff-244-245-resetdelay19-pcfull-regs-statusbranch.json`
  reports the same chain directly: first branching status mismatch `#43` is
  MAME `244:10508 PC 0xe4e5 = 0x86` versus TS
  `244:10497 PC 0xe4e5 = 0x87`, followed by `nextPcMismatch +10` at MAME
  `PC 0xe514` versus TS `PC 0xe52b`. The register-rich sample proves this is
  the expected `BCS` flag outcome, not a 6502 branch implementation bug: at
  `PC 0xe512`, MAME has `A=0x00 P=0x36` (carry clear) after shifting `$86`,
  while TS has `A=0x00 P=0x27` (carry set) after shifting `$87`.
  The target is now a scenario/time-aware `$1820` and interrupt-phase rule, not
  a constant status base, Timer A start delay, or store-bus write offset.
  `--reset-release-delay 30` aligns the initial `$1820` status reads against
  the focused MAME 244..245 window through read `#62`, proving the early
  poll-loop phase is real. It still leaves a mailbox/status-value mismatch at
  read `#73` in the 500-frame status diff, and over the 14000-frame oracle it
  breaks ordered YM parity with the same `2807` value mismatches seen in the
  global/status-tape `$86` experiments (`PC 0x9385`, key-on `0x07` vs `0x06`).
  Keep it as a diagnostic axis for reset/NMI phase work, not as a default
  replay timing fix.
- The focused MAME 244..245 trace now logs both sides of the reply latch. MAME
  writes the sound->main reply at `PC 0xe59d`, frame-245 `cycleInFrame=120`,
  the audio poll at `PC 0x8103`, `cycleInFrame=153` sees `$1820=$96`, then the
  main CPU reads `$FC0001` at `PC 0x4d62`, `cycleInFrame=190`, and the next
  audio poll sees `$86`. A TS diagnostic `--reply-ack-delay 70` reproduces this
  local pending lifetime; combined with `--reset-release-delay 30`, the first
  ordered status mismatch moves from read `#73` to `#1066`. It is still not
  promotable: `--reply-ack-delay 70` alone breaks the 14000-frame YM ordered
  gate with the same `2807` value mismatches at `PC 0x9385`. The next useful
  proof is a scheduled/main-CPU-derived ack model, not a constant delay.
- That scheduled ack model is now available for the oracle replay path. A
  14000-frame same-script capture produced a cmd tape identical to
  `sound-cmd-tape-attract-cycle-precise.json` plus `14562` main `$FC0001`
  reads. Replaying those reads with `--reply-ack-tape` consumes every ack,
  keeps 14000-frame YM/POKEY ordered parity green, and keeps the PCM lag-12
  gate green. The browser `soundReplay` path can consume the same timeline
  either embedded in the tape JSON or through `?soundReplayReplyAck=<json>`.
  It also accepts diagnostics-only `?soundReplayYmResampleOffset=<n>` and
  `?soundReplayPokeyResampleOffset=<n>` flags, passed through the same shared
  resampler used by the CLI PCM probe. Defaults are zero, and this is still
  oracle replay wiring, not gameplay timing.

## Topologia

```
   ┌──────────────────────┐                    ┌──────────────────────┐
   │       68010          │                    │        6502          │
   │   (main, 7.16 MHz)   │                    │   (sound, 1.79 MHz)  │
   └──────────────────────┘                    └──────────────────────┘
              │                                            │
              │ W: $FE0001 (sound command, 8-bit)          │
              │  → m_soundlatch                            │
              │  → assert NMI sul 6502                     │
              ├────────────────────────────────────────────┤
              │                                            │ R: $1810
              │                                            │  ← m_soundlatch
              │                                            │
              │ R: $FC0001 (sound response, 8-bit)         │
              │  ← m_mainlatch                             │
              │  ← assert IRQ6 sul 68010                   │
              ├────────────────────────────────────────────┤
              │                                            │ W: $1810
              │                                            │  → m_mainlatch
```

## Mailbox 68010 → 6502 (sound command)

- 68010 scrive 1 byte a **`$FE0001`** (`main_map_noslapstic` `atarisy1.cpp:428`).
- Il `generic_latch_8` `m_soundlatch` segna pending.
- Il pending generato genera **NMI sul 6502** (`atarisy1.cpp:817 m_soundlatch->data_pending_callback().set_inputline(m_audiocpu, m6502_device::NMI_LINE)`).
- Il 6502 legge a **`$1810`** (`atarisy1.cpp:447`), il che fa `acknowledge` automatico (clear pending). NMI si rilascia.
- Side effect: `atarisy1.cpp:818` triggera anche `perfect_quantum(100us)` per garantire che il 6502 vede l'NMI nei 100us successivi (sincronizzazione master CPU).
- Diagnostics: `oracle/mame_pokey_write_tap.lua` can now emit both the main
  `$FE0001` command writes (`cmds[]`) and the sound-CPU `$1810` reads
  (`soundCmdReads[]`) in the same cmd tape. In the focused
  `inject001f` 1410-frame command-read oracle, MAME associated `1277/1277`
  reads with their source command. The current delay-0 command override cases
  all read at `0x95c6:0xae` with command-to-read deltas `71..77` cycles, but
  normal delay-1 commands have the same read PC and overlapping `70..80`
  cycle deltas. That rejects latch read PC/delta as a unique rule for the
  remaining command-NMI timing exceptions; the next target is the MAME
  scheduler synchronize/perfect-quantum catch-up behavior.
- The CLI diff also reports `commandReadComparison`, a source-indexed
  TS-vs-MAME comparison of the first `$1810` read after each command. Current
  green evidence shows MAME sits between TS's whole-instruction extremes:
  base delay `0` makes TS read early and leaves `35` YM native-sample
  mismatches, base delay `1` without the four current overrides leaves `76`,
  and a `sampleCycle=2` NMI model or 64-cycle chip-write preemption both
  explode to thousands of mismatches. This points at sub-instruction NMI/latch
  timing rather than a broader command-edge or chip-write preemption selector.
- A later opt-in `--command-nmi-service-delay` diagnostic stalls only CPU NMI
  service while YM/POKEY continue ticking. It does not explain the gap:
  delays `1/2/3/4` leave `56/51/70/9832` YM native-sample mismatches on the
  same 1410-frame oracle, worse than the base0 `35`. Default replay remains
  unchanged and green.

Stato pending visibile da entrambi i CPU:
- 68010: read di `$F60000` bit 7 = `m_soundlatch.pending_r()` (`atarisy1.cpp:489`)
- 6502: read di `$1820` bit 3 = `m_soundlatch.pending_r()` (`atarisy1.cpp:496`)

## Mailbox 6502 → 68010 (sound response)

- 6502 scrive 1 byte a **`$1810`** (`atarisy1.cpp:448 m_mainlatch->write`).
- Il `generic_latch_8` `m_mainlatch` segna pending.
- Asserta **IRQ6 sul 68010** (`atarisy1.cpp:821 m_mainlatch->data_pending_callback().set_inputline(m_maincpu, M68K_IRQ_6)`).
- Il 68010 legge a **`$FC0001`** (`atarisy1.cpp:427`), che acknowledgea (clear pending + clear IRQ).

Stato pending visibile da entrambi:
- 6502: read di `$1820` bit 4 = `m_mainlatch.pending_r()` (`atarisy1.cpp:497`)
- 68010: solo via `$FC0001` (la lettura è destructive)

## Soundlatch reset

Quando il main CPU mette il sound CPU in reset (bit 7 di `$860001` = 0), oltre al reset:
- `m_outlatch->clear_w()` chiamato (`atarisy1.cpp:201`)
- `m_mainlatch->acknowledge_w()` chiamato (`atarisy1.cpp:205`) → forza clear della pending response anche se non letta
- VIA reset (per giochi con speech)

Vedi `bankselect_w` `atarisy1_v.cpp:189-228`.

## Comandi sound (catalog da fare in Phase 4-5)

I valori di sound command per Marble Madness sono codificati nel ROM del 6502 (`136033.421` + `136033.422`, 16 KB). Vanno catalogati osservando le scritture del 68010 a `$FE0001` durante gli scenari del curriculum (`level1_no_input`, `level1_basic_movement`).

Tracking a runtime:
- `oracle/mame_dumper.lua` può registrare ogni write a `$FE0001` come parte di `audioEvents[]` nel trace
- `packages/engine/src/audio.ts` espone `AudioEvent` astratti che il pacchetto `web` traduce a Web Audio API

| Comando (hex) | Effetto inferito | Note |
|---------------|------------------|------|
| TBD | TBD | Da catalogare in Phase 4-5 leggendo il 6502 ROM in Ghidra |

## Historical V1 implementation strategy (PRD §10)

In `packages/engine/src/audio.ts`:
- Tracciare ogni write alla mailbox $FE0001 (per il diff vs MAME)
- Mappare i comandi noti a `AudioEvent` astratti (`marble_roll`, `marble_jump`, `enemy_hit`, ...)
- `packages/web/src/` traduce `AudioEvent` in Web Audio API basic synth (sample synthesis)

V2: emulazione chip-perfect POKEY/YM2151. Per Marble Madness niente TMS5220 (no speech).

## YM2151 specifico

- Clock 3.579545 MHz (`atarisy1.cpp:823`).
- IRQ output del YM2151 → IRQ del 6502 (`atarisy1.cpp:824`). Quando il YM2151 ha bisogno di servizio (timer interno), il 6502 lo gestisce.
- Reset del YM2151 controllato dal LS259 bit 0 (`atarisy1.cpp:781 m_outlatch->q_out_cb<0>().set("ymsnd", FUNC(ym2151_device::reset_w))`). Il 6502 scrive `$1820` bit 0 per fare reset al YM2151.
- Current TS YM model includes OPM KC+KF phase, DT1/DT2/MUL, operator register
  block mapping, per-operator key-on state, KSR-aware envelope rates, OPM LFO
  PM/AM including OPM waveform-3 noise, log-domain operator output,
  ymfm-style envelope attack/rate stepping,
  key-on retrigger attenuation preservation, exact log-sine/power tables,
  integer OPM feedback/modulator shifts, YM3012 roundtrip output quantization,
  the ymfm quiet-envelope output cutoff,
  the exact replay native rate (`55930.375 Hz`), and 64-master-cycle busy status
  after data-port writes. The busy model is required by the Marble sound ROM
  `$8FED` poll loop: filtered PC taps show TS and MAME reach the first YM write
  PC `0x8188` at the same cycle, and busy closes the subsequent 28-cycle boot
  drift through the init checkpoints. Timer A also has a separate prescaler
  reset on timer load, which closes the first IRQ-entry checkpoints
  `0x81a6..0x81c3` against MAME. These are sufficient for the current
  attract-oracle `0.95` PCM correlation gate; strict byte/sample exactness
  remains a separate target. YM stereo routing now follows MAME/Atari speaker
  order: OPM output 0 / bit 6 routes left and output 1 / bit 7 routes right.
  The final PCM scale applies MAME's `0.48` YM route gain rather than the old
  implicit `0.50` normalization. Together those close the forced-command
  `cmd 0x04` subtraction failure; the next YM work should focus on byte/sample
  exactness, tail lag, and broader forced-effect coverage.

## POKEY specifico

- Clock 1.789773 MHz (`atarisy1.cpp:828`).
- Indirizzato a `$1870-$187F` sul 6502 (mirror `$2780`).
- Genera effetti sonori (rumble della biglia su Marble Madness, splash dei nemici, ecc.).
- The current bit-perfect replay preset uses full-clock POKEY sampling
  (`sampleCycles=1`), MAME-LoFi output resampling, `pokeyOutputSampleOffset=1`,
  and `pokeyResampleOffset=23.25`. This is a measured global compromise for
  the same-run `inject001f-1701-commandedge` oracle, not a hardware constant.
- The active zero-lag residual is a one-sample POKEY edge around output sample
  `569319`. Global output/resample phase changes improve that single edge but
  move larger errors into later POKEY windows, so they are rejected as replay
  defaults. Direct MAME-write POKEY rendered against `WAV - direct YM` improves
  with negative tap offsets, especially around `-16` cycles, but that is
  currently diagnostic evidence for MAME tap/update-boundary timing rather than
  a safe SoundChip replay rule.
- Exact POKEY event timing is still open. The current preset has ordered
  `27198/27198` POKEY writes with no payload/order drift under the tolerance-1
  native-sample gate, but strict cycle comparison
  `current-exact-pokey-timing/pokey-exact-cycle-diff-current-preset.json`
  reports `26848` exact cycle mismatches, same-frame cycle deltas up to `33`,
  and `6446` native-sample bucket mismatches. In the local frame-710 window
  around sample `569319`, TS is `6..12` cycles early for all `18` writes and
  has `5` native-sample mismatches. Global phase and positive POKEY apply-delay
  sweeps were rejected.
- The CLI preset `inject001f-1701-direct-mamechip-pokeytap` captures that
  direct-tap diagnostic separately from the runtime `soundReplay` preset. It
  is valid for direct MAME-chip oracle rendering with explicit MAME YM/POKEY
  write logs, `--pokey-write-cycle-offset -16`, and
  `--pokey-resample-offset 22.50`; it passes the same `212` audible windows at
  worst correlation `0.999177`, lag `0`, RMS `0.004346`, and maxAbs
  `0.030640`. It is not a gameplay or browser replay default.
- `probe-sound-sample-diff.ts` also supports reference-only POKEY tap offsets
  (`--reference-pokey-write-cycle-offset`,
  `--reference-pokey-resample-offset`) so runtime replay can be compared to the
  refined direct oracle without changing the runtime render. Focused report
  `current-runtime-vs-direct-pokeytap/runtime-current-vs-directref-pokeytap-window565248.json`
  shows the direct reference hits sample `569319` (`refPokey=0.044516`) while
  runtime still has `tsPokey=0.002958`; the same window's true max-abs residual
  is an earlier POKEY onset at sample `567780`. The all-window companion
  `current-runtime-vs-direct-pokeytap/runtime-current-vs-directref-pokeytap-allwindows.json`
  still fails the current `maxAbs` gate (`0.066807 > 0.065`), so the direct
  tap is evidence for a POKEY stream/update-boundary mismatch rather than a
  replay default.
- `POKEY` raw-latch transitions can be traced without changing audio output.
  `probe-sound-sample-diff.ts --pokey-raw-trace-radius ...` records nearby raw
  transitions as estimated output samples. Focused report
  `current-pokey-raw-trace/runtime-vs-directref-pokeyraw-window565248.json`
  shows the runtime and direct reference both execute the same channel-2 raw
  pattern (`0x0000 -> 0x0f00 -> 0x0000`) around sample `569319`; runtime
  estimates the rising edge at output sample `569317`, while the direct
  reference estimates it at `569316`. The paired raw-trace comparison reports
  `outputDelta={0:1,1:2}` across the three local transitions. The residual is
  therefore an update-boundary/resampler edge-shape problem for the same raw
  transition, not a missing POKEY write or wrong channel volume.

## TMS5220C (speech)

- **NON usato in Marble Madness** (non viene chiamato `add_speech` nel `marble()` machine config).
- Quindi: niente VIA 6522, niente TMS5220, niente speech. Le voci "Marble Madness" iconiche sono **digitalizzate via POKEY/YM2151 sample**, NON via TMS5220.
- Per Indy Temple/Roadrunner/RoadBlasters/Reliefs sì.
