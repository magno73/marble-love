# Marble Love

> Reimplementazione TypeScript di **Marble Madness** (Atari, 1984, hardware Atari System 1, M68010 + 6502), verificata frame-by-frame contro MAME come oracolo.

**Status:** **🎯 366+ funzioni replicate bit-perfect** via parity 100/100 o 500/500. Rendering MAME-faithful con **indirect bitmap_ind16 path** (cfr atarisy1_v.cpp screen_update): marble cromata + ombra **rotola sul livello bit-perfect** in demo gameplay warm (warmstate f12000+, `?play=1`), terreno isometric 3D, HUD score, 3 spike triangolari. **`obj0.x` bit-perfect MAME su 99/99 frame** del ground truth `/tmp/mame_100f.json`; **`obj0.z_long` ora matcha MAME f12000..12099** nel path canonico slapstic. Drift workRam @ 100 frame demo: **172 byte** (solo stack-residue escluso da invariante + **0 gameplay residuo**). **Long demo-mode ancora WIP:** il raw long-run ora supera i freeze iniziali e attraversa path di morte/HUD/reset; il rebuild playfield resta bit-perfect fino a f13200 dopo i side-effect slapstic `FUN_1AD54 -> FUN_2BC5C -> FUN_2FF40`, il fix A3/A4 di `FUN_160F6`, il wiring HUD/banner di `FUN_10504`, il ramo eaten-orbit `FUN_253EC` JT[4], il side-wall bounce `FUN_29CCE` tag `0x1f`, il ponte mode0→mode1→mode2, i checkpoint special sprite/particle e state-6 sprite cadence, il fix scroll-range spawn di `FUN_10504` che riallinea gli script slot 0..12 del secondo cycle, il packer `FUN_1A9CC` ora mappato sull'intera finestra video `0xA00000` (playfield/sprite/alpha), e `FUN_15A12` ora inizializza lo slot object-pair `0x400A20` nel secondo attract segment; f13920 resta PF exact con total diff **117** sul dump storico e il bounce f14858 allinea `obj0`/`0x400A20` fino a f14900. Ultimo checkpoint long-run: mode0 rebuild staged per segmenti 3/5, niente falso reset `3e4=0` nel dwell post-mode2, PF exact anche su f14600/f16000/f17680/f18000, `FUN_28232`/`hudFrameInit283C2` reinseriti nel path async, `FUN_286EE -> FUN_3520` + timer presentation `obj0+0x6A` cablati, scratch/phase `FUN_1A444` descriptor-backed nei segmenti 3/4/5, ultimo rotate `FUN_1C014` del bridge segment-3 allineato, chunk7 scratch-only del segmento 5, side-effect `FUN_2FFB8` ripristinati nelle phase staged (`157172 -> 150186 -> 146650 -> 145902 -> 141790` di somma campionata), rebuild segment-5 spostato a stage91 sul fresh bank-aware, clear scratch segment-5 spostato da stage83 a stage84, rebuild PF segment-5 diviso in due vblank con tail da `0x08B2` deferita a stage92, prefix chunk 3/4/5 del segmento 5 ritardati agli stage MAME, phase scratch-only segment-5 chunk2..6 allineate sui tap fresh (fresh tail `58208 -> 57365 -> 55914 -> 53820 -> 53055 -> 49288 -> 33516`), chunk2 ritardato sullo snapshot fresh (dense f17640..f17675 `16598 -> 14731`), cadence HUD/counter segment-5 allineata (fresh tail `32891 -> 32604`, step10 `16523 -> 16309`), prefix scratch mid-`FUN_1A444` preservato nel segmento 5 (dense `14659 -> 13327`, tail `32604 -> 31346`, step10 `16309 -> 16161`), latch pagina MO della scene init segment-4 allineato sui tap MAME (dense `13327 -> 12823`, tail `31346 -> 30802`, step10 `16161 -> 15960`, sprite `152 -> 140`), carry AV latch segment-5 allineato (dense `12823 -> 12751`, tail `30802 -> 30698`, step10 `15960 -> 15950`), tick `FUN_1A444` staged riallineato (dense `12751 -> 12720`, tail `30698 -> 30672`, step10 `15950 -> 15947`), timer presentation segment-4 riallineato (dense `11460 -> 11352`, tail `29193 -> 29070`, step10 `15742 -> 15727`), clear video mode2 segment-4 spezzato sui vblank MAME (fresh f16990..f17025 `18536 -> 11568`, f17004 `7213 -> 295`), banner alpha `BONUS FOR / REMAINING / TIME` renderizzato nel vblank f17004 (fresh `11568 -> 11464`, f17004 `295 -> 209`, alpha `86 -> 0`), clear alpha parziale righe 0..17 a f17005 (fresh `11464 -> 11252`, f17005 `410 -> 198`, alpha `212 -> 0`) micro-cadence mode2 segment-4 a f17009/f17010 (fresh `11252 -> 10874`, f17009 `580 -> 227`, color `344 -> 0`) e delay hi-score/PF segment-4 (fresh `10874 -> 10335`, f17010 alpha `296 -> 0`, f17011 PF `234 -> 0`); restano sprite/workRam scratch/cache (vedi STATUS.md). I dump MAME ora serializzano/inferiscono `slapsticBank`, così probe e frontend non forzano più bank errati sui warm seed intermedi; resta da chiudere il drift sprite/workRam residuo del demo completo (vedi STATUS.md). **Infrastruttura M68K**: register file TS (D0-D7/A0-A7, 8 istruzioni stack ABI, 2879/2879 Tom Harte pass) + cycle-table M68010 da Musashi MIT + 22MB validation dataset Tom Harte SingleStepTests + **slapstic 137412-103 state machine** (4 bank × 8KB con FSM bit-perfect MAME, 12/12 vitest). Sessione 2026-05-12/13/14: fix `obj0.z_long`, P2 `FUN_15E24`, warm slot-array interleaving, residual async bridge, renderer MO RAM banked, texture update Pixi v8, warm demo guardrail e checkpoint long demo; warm drift gameplay **204B → 107B → 68B → 40B → 0B**.

Apri `?autoLoad=1&mameLive=1&play=1` per vedere il marble rotolare in tempo reale dal warm bootstrap MAME. La demo warm puo' ancora ciclare il segmento stabile per uso visuale; usa `loopReset=0` per ispezionare il raw long-run incompleto mentre prosegue il lavoro sul demo mode completo.

Vedi [`STATUS.md`](./STATUS.md). **PRD:** [`marble-love-prd-v0.2.md`](./marble-love-prd-v0.2.md).
**License:** MIT (codice originale). Le ROM **non** sono incluse né distribuite — l'utente fornisce le proprie.

**Checkpoint live gameplay (2026-05-15):** il timer level 1 ora aggiorna anche
l'HUD live (`obj0+0x6A` passa dal decremento interno al render alpha via
`FUN_286EE -> FUN_3520`). Quando il countdown arriva a zero, il path timeout
ora disegna e mantiene il riepilogo ROM `OUT OF TIME` / `GAME OVER` per il
wait `0xB4` prima di pulire le righe alpha e proseguire, invece di saltare
subito alla finestra presentation/demo; il passaggio post-timeout richiama
`FUN_11452 mode 2` tramite il rebuild staged usato dal runtime, quindi pulisce
HUD/playfield prima della schermata hi-score e non mostra piu' un misto
high-score/demo sopra il vecchio level 1. Il renderer playfield ora avvolge la
tilemap 64x64 su 512 px nel path
indirect e nel fallback Pixi, evitando la fascia nera sotto il ponte levatoio
quando lo scroll verticale entra nelle finestre basse.
Per repro manuali difficili da scriptare, `oracle/mame_playable_input_capture.lua`
supporta anche `MARBLE_PLAYABLE_MANUAL=1`: registra prima una movie MAME
`.inp`, poi ripassala con `-playback` per ottenere trace JSON e tail snapshot
replayabili dal probe TS. Per capture scriptati, coin/start sono ora applicati
post-boot (`MARBLE_PLAYABLE_COIN_FRAME=1200`,
`MARBLE_PLAYABLE_START_FRAME=1500` di default); i vecchi pulse f60/f180 erano
troppo presto e producevano finestre attract/demo identiche al no-coin.
Nota MAME: i coin sono active-low nello script di capture. Per probe
browser-equivalenti puoi aggiungere
`MARBLE_PLAYABLE_FORCE_MANUAL_DISPATCHER=1` e opzionalmente
`MARBLE_PLAYABLE_FORCE_MANUAL_FRAME=N`, che cancella una volta `0x400390.w`
come fa il browser entrando in practice manuale. Questo e' solo un aiuto
diagnostico: la ladder forzata ha gia' falsificato un match L2 perfetto a
f69000 (`pfDiff=0`) perche' era `state=6`, non un practice start giocabile; i
frame stabili immediatamente dopo tornano alla famiglia PF warm lontana dal
descrittore L2. Serve comunque audit paired active-vs-neutral e confronto
descriptor prima di promuovere qualsiasi seed.
Lo script supporta anche probe service/test con `MARBLE_PLAYABLE_SERVICE_MODE=1`
e pulse multipli `MARBLE_PLAYABLE_START_PULSES=...`; il walk service mode
headless e' stato auditato e non espone un level-select o practice-start utile:
mostra solo switch/coin/game options, statistiche, istogrammi e test video/sound.
Per generare il workflow completo senza ricordare tutti i path/env, usa
`node --import tsx packages/cli/src/plan-mame-manual-level-capture.ts --name manual_levels`.
Il planner stampa: record MAME `.inp`, replay/capture manuale, summary/export
dei candidati stable-playable e audit finale. Questo e' il percorso consigliato
per scoprire i sei start level reali.
Se manca ancora una movie manuale utile, puoi generare route candidate dal seed
playable corrente con
`node --import tsx packages/cli/src/search-playable-route.ts --out-dir /private/tmp/marble-manual-route-search`.
Il finder fa beam-search deterministico nel runtime TS verso `state=6`,
`main=3`, cambio segment stable-playable o, con `--target-descriptor N`, verso
un pointer ROM L1..L6 specifico letto da `workRam[0x474]`; con
`--target-segment N` puo' anche cercare finestre stable-playable di un segmento
runtime senza trattarlo come numero livello. Per evitare falsi positivi da
ciclo death/attract, usa `--max-deaths 0`; per non far collassare la beam su
varianti tardive della stessa route, usa `--diversity-prefix-chunks N`; per
mantenere anche stati fisici distinti nella beam target usa
`--diversity-state-bucket N`; per provare input piu' lenti/veloci, usa
`--step-pixels N`. Scrive poi un manifest
per `plan-mame-candidate-captures.ts`. I manifest prodotti dal path
manual-rearmed marcano `forceManualDispatcher=true`: il planner propaga
`MARBLE_PLAYABLE_FORCE_MANUAL_DISPATCHER=1` e
`MARBLE_PLAYABLE_FORCE_MANUAL_FRAME=N` anche in MAME active/neutral. Anche qui
il risultato resta un candidato: solo una coppia MAME active-vs-neutral
distinta, giocabile e vicina/aligned ai descriptor puo' diventare seed.
Per proof MAME in cui la prima snapshot deve restare non forzata
(`main=1/mode=0`) e il dispatcher viene cancellato solo dal frame successivo,
usa `node --import tsx packages/cli/src/audit-mame-route-proof.ts --neutral neutral.json active.json`.
Questo verifica il seed iniziale, la distanza da `manual_level1_start`, la
nearest ROM descriptor e una coda active-vs-neutral. I candidati attract
`f12000`, `f36000` e `f39000` passano la divergenza MAME in questa forma, ma
restano diagnostici perche' sono ancora lontani dai descriptor ROM.
Per identificare la famiglia ROM di ogni finestra catturata, usa
`node --import tsx packages/cli/src/inspect-level-descriptors.ts`. Il tool
legge i sei descrittori reali dalla pointer table `0x2BE00`, riproduce i loro
fingerprint (`L1 0x2bee2`, `L2 0x2c54c`, `L3 0x2cd9e`, `L4 0x2d648`,
`L5 0x2de1e`, `L6 0x2e790`) e scrive un manifest in
`/private/tmp/marble-six-level-descriptors`. Su una tail MAME manuale/playback
usa ad esempio
`node --import tsx packages/cli/src/inspect-level-descriptors.ts --no-default-snapshots --all-snapshots --stable-only /private/tmp/marble-manual-level-capture/scenarios/manual_levels_tail.json`.
Per catture dense frame-by-frame, aggiungi `--timeline-only` per collassare
snapshot adiacenti con stesso stato/descriptor in range leggibili, ad esempio
`node --import tsx packages/cli/src/inspect-level-descriptors.ts --no-default-snapshots --extra-scenario-dir /private/tmp/marble-mame-l2-transition-fine-forced-manual-active/scenarios --timeline-only`.
Per auditare direttamente il gate di promozione usa anche
`--transition-summary`: stampa ogni finestra byte-exact del descrittore ROM e
il primo frame stable-playable successivo. Le ultime catture MAME autopilot
confermano L1/L2 exact solo in `state=6`; i frame stabili subito dopo tornano
a PF warm distanti (`pfDiff=1484`/`1517`), quindi restano diagnostici.
Uno sweep no-coin denso da 3046 snapshot attorno alle transizioni note ha
confermato lo stesso pattern: solo L1/L2 exact (L1 `3` snapshot, L2 `25`),
nessun exact L3-L6, e le finestre stable sparse restano lontane dai descriptor
(`pfDiff` tipicamente `1819..3502`). Anche gli oracle storici
`level2_spawn`..`level5_spawn` non contengono descriptor exact; sono materiale
diagnostico, non start level.
Per provare direttamente quali descriptor ROM vengono caricati da una route
MAME, usa `oracle/mame_level_descriptor_tap.lua`. Con
`MARBLE_DESCRIPTOR_TRACE_PLAYABLE_CAPTURE=1` il tap gira insieme a
`mame_playable_input_capture.lua` e registra `0x400474` in
`pointerWindows`; usa una `-cfg_directory` temporanea pulita per evitare DIP
service persistenti nel cfg locale. L'ultimo no-coin proof fino a f65000 in
`/private/tmp/marble-level-descriptor-nocoin-65000/trace.json` vede solo L1
`0x2bee2` e L2 `0x2c54c`; L3-L6 restano a `0` frame, quindi l'attract no-coin
non puo' produrre i sei seed reali.
Una route continua `D:7200` dal seed playable level 1 e' stata replayata in
MAME fino a f9000 (`/private/tmp/marble-d7200-mame-active/trace.json`): raggiunge
segmenti stable-playable 3/5/6, ma il pointer runtime continua ad alternare
solo L1/L2 e gli snapshot stabili restano lontani dai descriptor (`pfDiff`
1484/1819/1517). Anche una ricerca TS `--target-descriptor 3` fino a 3600 frame
non ha trovato L3. Una route ladder articolata fino a f15000
(`/private/tmp/marble-ladder-mame-descriptor/trace.json`) resta ugualmente su
L1/L2; trova L2 byte-exact solo in `state=6`. Il finder no-death
`--target-descriptor 3 --max-deaths 0` si ferma a f570 perche' tutte le
espansioni successive richiedono una morte, anche con `--step-pixels 4` e con
state diversity (`/private/tmp/marble-target-l3-nodeath-state-diverse-3600`).
Senza `--preserve-dispatcher`, il path manuale resta controllabile/no-death fino
a f2400 ma rimane `main/mode=0/0`, segment 2, descriptor L2: utile come
diagnostica browser, non come proof MAME. Il trace index no-coin
`/private/tmp/marble-index-write-trace/trace.json` mostra `levelIndex` solo 0/1
in sync con L1/L2; nessun path osservato tiene idx2..idx5. Sono proof negativi,
non seed.
Questa associazione e' diagnostica: i descrittori ROM provano le sei geometrie
distinte, ma non sono seed practice completi senza stato player/camera/dispatcher
validato.
Per filtrare i candidati prima di collegarli a `startLevel`, usa
`npx tsx packages/cli/src/audit-playable-seed.ts`. Il probe confronta input
attivo contro input neutro, sia con dispatcher MAME preservato sia col
dispatcher manuale browser riarmato. Se hai una coppia di catture MAME
active/neutral, passa gli snapshot active come argomenti e aggiungi
`--mame-neutral-dir /path/neutral/scenarios`: se MAME active e neutral sono
identici, il seed resta diagnostico anche quando il rearm manuale TS sembra
controllabile. Per una tail manuale o playback con molti snapshot usa
`--all-snapshots --target-segment N --only-candidates`, cosi' il probe estrae
solo i frame che potrebbero diventare seed. Il probe rifiuta inoltre i
candidati con `playfieldRam` byte-identica al seed level 1 di riferimento
(`--distinct-from`), cosi' non si ripete il falso positivo f6000.
Per playtest manuale di progressione livelli, `?autoLoad=1&play=1&levelTime=180`
o `levelTime=120` imposta il timer interno del livello al valore scelto una
sola volta per livello, lasciando il countdown normale. Nota: alcuni path HUD
ROM mostrano solo due cifre o clampano sopra 99, quindi il valore alto puo'
essere effettivo anche se il display non mostra subito 180/120. Per investigare
collisioni "invisibili" durante il playtest, aggiungi `&debugObjects=1`: compare
una overlay con coordinate player, timer e oggetti attivi piu' vicini.
Per partire direttamente da un livello di practice usa
`?autoLoad=1&startLevel=N&levelTime=180`. Al momento solo `startLevel=1` e'
cablato, tramite il seed verificato `manual_level1_start`; `startLevel=2..6`
restano intenzionalmente bloccati finche' non abbiamo seed distinti e
controllabili. I candidati `manual_level2_start` .. `manual_level5_start` del
primo pass sono stati falsificati dal confronto playfield/hash: formavano solo
due famiglie di terreno quasi duplicate, non i restanti cinque livelli reali. Usa
`npx tsx packages/cli/src/scan-playable-terrain-hashes.ts --pairwise-only ...`
per confrontare hash/diff di `playfieldRam`, `colorRam` e `alphaRam`. Per
cercare famiglie lungo una run TS invece di singoli file, usa ad esempio
`npx tsx packages/cli/src/scan-playable-terrain-hashes.ts --plan-preset ladder --sample-every 120 --cluster-by segment --min-cluster-samples 1 packages/web/public/scenarios/playable/manual_level1_start.seed.json`.
Il preset `ladder` segue la rotta profonda dei guardrail playable e stampa i
cluster runtime; serve a trovare finestre candidate, non a promuoverle. Per una
ricerca piu' ampia usa `--plan-suite discovery`, che aggrega piu' traiettorie
deterministiche (`ladder`, `sweep`, `lower`, `upper`, `zigzag`) nello stesso
clustering e produce una lista corta di frame/cluster da auditare. Per
materializzare candidati auditabili fuori dal repo, aggiungi
`--emit-candidates-dir /private/tmp/marble-level-candidates --stable-only`: lo
scanner scrive seed rappresentanti e `manifest.json`, ma non li collega al
browser. Lo scanner calcola anche un fingerprint di render: con i PROM grafici
presenti usa lookup bank/colore/bpp, mentre senza PROM dichiara
`raw-playfield-fallback` e usa una firma grezza dei comandi playfield/alpha/sprite.
Il manifest esportato include `renderHash` e `renderCoarseHash`, utili per
evitare di fondere finestre che sembrano uguali nel solo PF; include anche
`routeSpec`, `routeFrame`, `absoluteFrame` e `mameTrackballStart` per
riprodurre il candidato in MAME. Dopo un cluster distinto,
`audit-playable-seed.ts` resta obbligatorio per la prova active-vs-neutral e
ora scarta anche near-duplicate con `--min-playfield-diff` (default 512 byte PF)
prima di cablare un nuovo `startLevel`. Per generare i comandi MAME active,
neutral e audit da un manifest usa
`npx tsx packages/cli/src/plan-mame-candidate-captures.ts manifest.json`.
Se il manifest non contiene gia' il flag forced-manual, puoi passare
`--force-manual-dispatcher` e opzionalmente `--force-manual-frame N` al planner
per generare le stesse env MAME.
Per catture MAME/playback con molti snapshot, prima di fare confronti pairwise
usa `scan-playable-terrain-hashes.ts --summary-only --all-snapshots ...`: stampa
conteggi compatti di mode/segment/state, finestre stable-playable e hash
coarse/render, cosi' si vede subito se una tail contiene davvero terreno
giocabile o solo presentation/high-score/demo. Se la tail contiene finestre
interessanti, aggiungi `--emit-loaded-candidates-dir /private/tmp/...` per
scrivere rappresentanti stable-playable direttamente dalle snapshot caricate,
sempre come input di audit e mai come wiring automatico.
Attenzione: quando un candidato nasce da un seed warm/browser-rearmed, il frame
assoluto MAME generato dal planner e' un proof/falsification check, non una
garanzia di equivalenza; se l'audit torna in `mode=2`, timer `0` o state non
giocabile, serve una route MAME-live/manuale vera. I vecchi `levelN_spawn`
restano scenari oracle/demo e non vanno usati come practice start.

**Checkpoint recente (2026-05-14):** pivot completato da long-demo byte drill a
gameplay-ready warm seeds. Nuovi oracle in `oracle/scenarios/gameplay/`: 15
scenari MAME deterministici da 101 snapshot ciascuno (`f0` seed + 100 frame
oracle), catturati con `oracle/mame_gameplay_scenarios.lua` usando NVRAM/CFG
pulite e `-nonvram_save`. Nuovo probe
`packages/cli/src/probe-scenario-diff.ts` valida PF/sprite/HUD/alpha/color da
seed warm TS; tutti i 15 scenari raggiungono il criterio `>=60` frame
consecutivi con PF=0, sprite<=50 e HUD<=30, e ora anche i primi 60 frame dal
seed passano su tutti gli scenari. Estensione level3/4/5: `level3_spawn` f18200,
`level3_early` f18700, `level3_end` f19050, `level4_spawn` f19600,
`level4_early` f20150, `level5_spawn` f21250, `level5_early` f21800.
`level2_early` usa il seed stabile f17010
per evitare lo snapshot MAME intra-`FUN_26F3E` del vecchio f17000; anche
`level1_obstacle` usa il seed stabile f15084 e passa 100/100 frame; anche
`level1_early` ora usa il seed stabile f14120 e chiude il vecchio picco
intra-frame f+79. Quattordici scenari passano 100/100 sotto soglia; il solo
`level3_spawn` ha un boundary tardo f+78 (`sprite=53`) ma resta PASS con una
streak da 77 frame e initial-60 puliti.
Il replay warm legacy f12000 (`slotArrayReplayTick`/`warmResidualReplayTick`) e'
ora confinato al seed attract storico che lo richiede, quindi i seed gameplay
non ereditano piu' rumore HUD/workRam del long-demo bridge. Lo step10 fresh
long demo resta sotto guardrail (`14501 <= 16000` con il checker no-stack corrente).

**Checkpoint input replay (2026-05-14):** aggiunto il replay MMIO input del demo
attract. `docs/input-mmio-map.md` documenta `F20001/03/05/07` trackball
ruotato, `F60001` switch low byte, ADC `F400xx` non usato e coin sul 6502.
`oracle/mame_demo_input_tap.lua` cattura `oracle/scenarios/input/demo_attract.json`
su `f9700..f21900` (`12201` frame, SHA-256
`5570b1d5bbf9628760d44f2888cc8e5878fc96d200ee5da5d8ddfe236eea87a6`).
Finding: nelle warm windows attract MAME non legge i MMIO input esterni
tap-ati; la trace quindi mantiene default stabili trackball `0xff`, switch
`0x6f`, buttons `0`. Nuovo engine `packages/engine/src/input-replay.ts`, smoke
`packages/engine/test/input-replay-smoke.test.ts` e probe
`packages/cli/src/probe-demo-replay.ts`: replay PASS sui 5 scenari minimi
richiesti (`intro_overlay`, `level1_spawn`, `level1_midmap`,
`level1_obstacle`, `level2_early`) e su tutta la suite 15/15.

**Checkpoint coin/play input reale (2026-05-14):**
`oracle/mame_playable_input_capture.lua` cattura una sessione MAME deterministica
coin pulse + START1 + trackball P1 scriptato. Trace
`oracle/scenarios/input/playable_coin_start.json` (`2500` frame, SHA-256
`d92e4b2d7476fec451824efc734c1aac59c0a8613305964c5267e6a5588463ee`) contiene
letture reali `F200xx` (`2256` per asse P1/P2), `F60001` (`9306`) e coin sound
CPU `0x1820`. Nuovi scenari in `oracle/scenarios/playable/`:
`coin_start_to_level1` f2045 PASS @80, `level1_trackball_short` f2240 PASS
@100, `level1_trackball_obstacle` f2320 PASS @82 con input injected via
`packages/cli/src/probe-playable-replay.ts`. Warm-seed gameplay 15/15 resta
PASS e lo step10 fresh long demo resta sotto guardrail (`14501 <= 16000`).

**Checkpoint live input web (2026-05-14):** `?autoLoad=1&play=1` ora segue un
flusso coin/start manuale: non pre-carica piu' il livello, resta nel gate
attract/start finche' `5`/`C` aggiunge credito e `Enter`/spazio passa START1.
START consuma il credito e carica il seed gameplay warm manuale
`manual_level1_start`: stessa entrata level1 f2045, ma catturata con trackball
P1 neutro per non ereditare il movimento dello script replay. Il seed replay
`coin_start_to_level1` resta fallback/oracle. Il play manuale esce dal
dispatcher attract/demo dopo START per evitare overlay tutorial/demo e
movimento autonomo. La preservazione del dispatcher MAME del seed (`state=1`)
resta opt-in con `?preserveDispatcher=1` per drill oracle. Il runtime browser mantiene separati
il helper replay MAME
(`rawX+rawY`, `rawX-rawY`) e i controlli live screen-space:
frecce/WASD, mouse, touch e gamepad scrivono un solo asse MMIO per volta, con
X invertito rispetto al DOM e Y DOM invertito, cosi' una singola freccia non
produce piu' una diagonale e destra/sinistra seguono la biglia a schermo. In
`?play=1` le frecce non pilotano piu' anche lo scroll-debug della viewport;
coin e START sono entrambi pulse frame-safe, quindi una pressione rapida di
`5` + `Enter` non si perde tra due tick.
I seed `?playableSeed=...`
restano utili come diagnostica/replay warm, ma non sono il percorso consigliato
per giocare manualmente. Il coin-credit completo via 6502 resta debito
sound/main CPU; il browser usa un credito locale conservativo per sbloccare la
partita live.

**Checkpoint playable shape records (2026-05-15):** QA notturno sulla rotta
manual-like profonda `route_3600` ha chiuso il residuo sprite attivo della
biglia: `FUN_264AA` ora emette anche i record shape mode0/mode1 a `obj+0x38`
come MAME, e `FUN_177F8` legge la string table dalla finestra ROM slapstic
`0x80000..0x87fff`. La rotta `route_3600` passa 100/100, con `obj0+0x38` e
`D7` exact a f3653/f3655/f3657; playable replay 3/3, warm-seed gameplay 15/15,
typecheck, targeted vitest, web build e long-demo guardrail restano verdi.

**Checkpoint type-5 playable emit (2026-05-15):** il residuo sprite nel drill
`case6_4400` era un vecchio caso speciale type-5 derivato dal long-demo:
TS usava `p42+4` sotto `0xc0`, ma il disasm ROM `0x27DF6..0x27E1C` emette
sempre il cel corrente `*(p42)` per il range signed `-0x40 < d4 < 0x100`.
`dispatchType5` ora segue quel bound e il replay laterale `route_4200` passa
100/100; `route_4800`, `route_5400`, playable replay 3/3, warm-seed gameplay
15/15, typecheck, targeted vitest, web build e long-demo guardrail restano
verdi.

**Checkpoint deep live route guards (2026-05-15):** follow-up QA dopo il fix
type-5 non ha trovato un nuovo bug engine live. Le divergenze rimaste sui warm
seed MAME presi a meta' transizione sono artifact di snapshot senza lo stage
async TS-only, mentre il percorso live continuo dal seed manuale attraversa
lower bridge, timeout/rebuild fino a `0x3e4>=7` e fall/death ripetuti senza PF
vuoto persistente, scroll runaway o state-1 stuck. Una swarm browser-space
successiva ha trovato una rotta sana ma sensibile che entra in `state 1` per
decine di frame e poi recupera; `playable-live-routes.test.ts` ora codifica
anche questo caso bounded insieme alle rotte profonde.

**Checkpoint playable route ladder guard (2026-05-15):** il nuovo goal e'
spostato su progressione giocabile oltre il level 1, ma il bound precedente
`>120` frame e' solo entry/stability guard, non prova di livello completato. La
rotta profonda live dal seed manuale `manual_level1_start` ora copre una ladder
piu' severa: baseline level 1 con oltre 1500 frame stabili, movimento X/Y e
death/recovery; poi finestre mapped level 2 (`0x3e4=4`, mapping MAME
`level2_spawn`) e level 3 (`0x3e4=5`, mapping MAME `level3_spawn`) con oltre
700 frame stabili ciascuna, movimento object X/Y, death/recovery, PF pieno,
player `state 0`, PF-empty bound, `state 1/2` non-stuck, `state 6` bounded e
scroll bound invariati. Follow-up probe: una route tutta neutra raggiunge le
stesse finestre e input trackball attivo in `0x400390==1` viene campionato ma
non cambia il path object; quindi questa e' una guardia timeout/rebuild, non
completion/controllabilita' level 2/3. Follow-up checkpoint: i seed caldi
`level2_spawn` e `level3_spawn` restano non controllabili con dispatcher MAME
preservato (active == neutral), ma diventano controllabili se riarmati al
dispatcher manuale (`0x400390=0`) come il browser fa al primo START. Questo
fissa il prossimo confine: provare una transizione live che entra nel path
manuale, non solo la stabilita' presentation/timeout. Follow-up ulteriore:
`level1_end` riarmato manualmente prova che il detector TS di fine level 1
funziona (`L:180,DL:900` attraversa `state 6`, poi `0x400390=3` e ritorna a
dispatcher manuale con `0x400394=2`), mentre lo stesso seed con dispatcher MAME
preservato resta active == neutral. Follow-up: una route MAME coin/start reale
ha prodotto un candidato f6000 dopo completion level 1, ma il browser test
manuale ha rivelato la falla: la `playfieldRam` era identica a
`manual_level1_start`, quindi il candidato e' stato ritirato e `startLevel=2`
rimane bloccato finche' non catturiamo un seed con terreno/dispatcher/timer
coerenti col vero level 2.

**Checkpoint playable segment-3 cadence (2026-05-14):** il percorso live
arbitrario screen-space down/right/diagonal ora segue il micro-ordine MAME
della transizione mode0 `3e4=2/gamemode=1 -> 3e4=3/gamemode=0`: mode switch
visibile prima del clear, PF clear al vblank successivo, prefix PF `2555` a
f3460, prefix `3119` a f3465 e full PF `4039` + obj reset a f3466. Il fix e'
ristretto al playable `gameMode=0` del segmento 3; il segmento 3 attract e i
segmenti long-demo 4/5 restano sulla cadence esistente. Playable replay 3/3,
warm-seed 15/15, web build e long demo fresh step10 no-stack (`15275 <= 16000`)
restano PASS.

**Checkpoint lower-platform respawn (2026-05-14):** il runaway dopo morte sulla
piattaforma bassa con i due vermi era il path mancante `FUN_253EC` `JT[1]`
(`obj0+0x1A=1`). TS cadeva nel fallback e congelava la biglia in state 1 con
target stale `284,196`; ora esegue il path reale
`FUN_25FC2 -> FUN_253BC -> FUN_17F66 -> FUN_121B8` piu' il tail
`+0x56/+0x57`, ricalcola il target a `444,380`, torna `state 4 -> 0` e ferma
lo scroll con PF popolato. Aggiunto regression test
`packages/engine/test/playable-respawn-state1.test.ts`; playable replay 3/3,
warm-seed 15/15, web build e long demo fresh step10 no-stack (`15275 <= 16000`)
restano PASS.

**Checkpoint FUN_253EC state-7 settle (2026-05-14):** il drill bridge/lower
platform ha chiuso un altro jump-table reale del dispatcher oggetti: `JT[7]`
(`obj+0x1A=7`) ora segue il disasm `0x25812`, cioe' solo `FUN_253BC` e clear
`obj+0x1C`, senza il vecchio fallback che chiamava anche `FUN_17F66`.
Aggiunto regression test in `refresh-frame-10fce.test.ts`; playable replay 3/3,
warm-seed 15/15, web build e long demo fresh step10 no-stack (`15275 <= 16000`)
restano PASS.

**Checkpoint FUN_1B5C2 signed gates (2026-05-15):** il falso contatto sul ponte
della piattaforma bassa era nel controller steering `FUN_1B5C2`, non in
renderer/camera: i byte cardinali `0x40066c..672` sono confrontati signed dal
binario e il path diagonal `btst #3` deve saltare quando `word@D2 >= 4`.
TS trattava i byte come unsigned e aveva quel gate invertito, quindi poteva
ribaltare `vx/vy` dello slot mobile `0x400A20` mentre MAME lo lasciava passare.
La sub ora torna bit-perfect col binario (`test-state-sub-1b5c2-parity.ts
2000/2000`, harness stack corretto); playable replay 3/3 e warm-seed 15/15
restano PASS, web build PASS, e long demo fresh step10 no-stack resta sotto
guardrail (`14501 <= 16000`).

**Checkpoint playable QA guard refresh (2026-05-15):** dopo il fix del ponte,
il vecchio repro del test `playable-respawn-state1` non attraversava piu' lo
stato `obj0+0x1A=1`. Il test ora usa una rotta deterministica aggiornata che
entra nello state-1 tumble, rientra in `state 0`, ferma lo scroll a `<=90` e
mantiene PF popolato. QA extra con MAME temporaneo su f2440/f2600/f3000/f3400/
f4200 conferma che i warm seed stabili restano sani e che i seed presi a meta'
transizione sono fragili solo come warm-start autonomi, non come percorso live
continuo.

**Checkpoint playable route smoke (2026-05-15):** aggiunta una guardia live
multi-rotta in `packages/engine/test/playable-live-routes.test.ts`: prima
rampa, lower bridge, lower worm loops e input misto pseudo-random partono dal
seed manuale `manual_level1_start` e verificano a ogni tick che lo scroll non
scappi, il PF resti popolato e la biglia non finisca bloccata nello state-1
tumble. La rotta lower-bridge misura ora il campo posizione reale `obj0.x`
(`obj0+0x0C`) come delta rispetto al seed iniziale, per evitare falsi positivi
sul progresso oltre il ponte. Questo copre in automatico i sintomi gameplay
residui segnalati durante la prova manuale.

**Checkpoint FUN_160F6 ROM speed table (2026-05-15):** il default path di
`helper121B8` chiamava `stateDispatch160F6` senza reader ROM, quindi la speed
table a `0x2398c` veniva letta come zero nel replay live profondo. Ora il
dispatcher riceve `rom.program` anche senza override di test; aggiunta
regression in `helper-121b8.test.ts`. Nel drill temporaneo
`/tmp/marble_route_deep_scenarios/route_3600.json`, `obj0.z/vz/state36/state58`
sono exact contro MAME a f3627..f3657 e il primo fail resta solo
sprite/HUD/cache (`Sprite/HUD/WORK 68/11/50 -> 60/1/30`, PF=0). `route_3000`
resta PASS @100, mentre `route_2440` resta il vecchio rumore su pagina MO
inattiva. Targeted vitest bundle, typecheck, playable replay 3/3, warm-seed
15/15, web build e long demo fresh step10 no-stack (`15267 <= 16000`,
`14493 <= 16000` con la mask storica) restano PASS.

**Checkpoint playable timeout rebuild (2026-05-15):** il percorso no-input
tardo e' stato confrontato con MAME in finestre temporanee f4100/f4250:
`late_4100` PASS @91 e `late_4250` PASS @100 con trace reale. La breve finestra
PF vuota e' il rebuild MAME-consistente, non lo scroll runaway precedente.
`playable-live-routes.test.ts` ora protegge questo caso fino al PF pieno e allo
scroll basso.

**Checkpoint scripted playable routes (2026-05-15):**
`oracle/mame_playable_input_capture.lua` accetta `MARBLE_PLAYABLE_ROUTE` per
catturare in MAME le stesse rotte screen-space usate nei test live TS. Smoke
lower-bridge temporaneo: `route_2045` replay PASS @80; le finestre piu' tarde
restano un drill separato sul dispatcher full-MAME, non sul path manuale web.

**Checkpoint state-2 respawn recovery (2026-05-15):** fuzz pre-timeout sul
browser manuale ha trovato rotte che restavano in `obj0+0x1A=2` con PF pieno e
`main=0`. Il disasm ROM di `FUN_253EC` mostra che JT[2] deve eseguire
`25FC2 -> 1B9CC(obj,1) -> 1281C` condizionale; quel ramo ora e' cablato in
`refresh-frame-10fce.ts`. Il nuovo route smoke `state-2 respawn recovery`
attraversa state 2 -> 4 -> 0, e il fuzz TS non mostra piu' gli stuck state-2.
Playable replay 3/3, warm-seed 15/15, web build e long demo fresh step10 tail
no-stack (`14465 <= 16000`, invariato senza/con JT[2]) restano PASS.

**Checkpoint FUN_253EC state-8 countdown (2026-05-15):** il prossimo buco reale
del dispatcher biglia era JT[8], non una correzione di camera/collisione. Il
disasm ROM `0x258A8` mostra il countdown `obj+0x56/+0x57`, l'avanzamento
`obj+0x6A/+0xCC`, il terminal `FUN_285B0(obj, 0x10)` e il tail
`1B9CC -> 1C014 -> 1281C`; `refresh-frame-10fce.ts` ora replica quel path.
Aggiunte regression mirate in `refresh-frame-10fce.test.ts`; refresh-frame,
playable-live-routes, targeted vitest bundle, typecheck, playable replay 3/3,
warm-seed 15/15, web build e long demo fresh step10 no-stack (`15275 <= 16000`,
`14501 <= 16000` con la mask storica) restano PASS.

**Checkpoint segment-4 live PF scroll (2026-05-15):** una rotta manual-like
post-lower-bridge confrontata con MAME (`route_3600`, f5645, `0x3e4=4`) ha
mostrato che TS applicava `FUN_26D8A` una vblank troppo presto anche nel
segmento live successivo: `videoScrollY` era `189` mentre MAME era ancora
`188` a f+1. `main-tick.ts` ora usa lo stesso defer gia' validato per
`0x3e4=2` anche su `0x3e4=4`, solo con `runMainLoopBody:true` e input P1
attivo; fuori da quei casi il path resta immediato. Aggiunte regression in
`main-tick.test.ts` per segmento 4 deferred e segmento 0 immediate. Il replay
temporaneo `route_3600` sposta il primo fail da f+1 a f+3 con PF/scroll e
coordinate marble agganciate; il residuo resta sprite/HUD/cache. Targeted
vitest bundle, typecheck, playable replay 3/3, warm-seed 15/15, web build e
long demo fresh step10 no-stack (`15275 <= 16000`, `14501 <= 16000`) restano
PASS.

**Checkpoint live scroll override (2026-05-14):** le frecce non pilotano piu'
simultaneamente trackball e scroll-debug viewport durante coin/start live o seed
playable warm. Lo scroll override resta disponibile per diagnostica con
`?scrollOverride=1` (o senza warm-state). Questo evita un falso offset
marble-vs-muri causato dalla camera debug mentre i replay oracle level1 restano
PF exact: `level1_trackball_short` ha active MO-bank sprite `0` e coordinate
`obj0` identiche 100/100, `level1_trackball_obstacle` ha coordinate `obj0`
identiche 100/100 e worst active MO-bank sprite `9`.

**Checkpoint playable scroll/MO cadence (2026-05-14):** il residuo visuale
marble-vs-rampa non era un offset renderer ma il micro-ordine di `FUN_26D8A`:
con trackball reale TS applicava la line update una vblank prima di MAME,
spostando word0 delle entry MO attive di `+0x20` nei frame dispari tardi.
`main-tick.ts` ora differisce quel side effect solo nel segmento gameplay live
con input P1 attivo; attract/warm static restano sulla cadence long-demo.
Risultato: `level1_trackball_obstacle` passa da `82/100` a `100/100`,
`level1_trackball_short` resta `100/100`, `coin_start_to_level1` resta
`80/100`, warm-seed 15/15 resta PASS e il long demo fresh step10 no-stack resta
sotto guardrail (`15275 <= 16000`).

**Checkpoint live playable phase (2026-05-14):** dopo START il browser arma ora
`mainLoopBodyTicks=1`, cioe' la phase auto-selezionata dai replay MAME playable.
Il bug del respawn basso non era terreno/collisione: phase `0` anticipava
`FUN_13EE6` di una vblank e portava lo scroll a `40/40`, scrivendo una riga PF
extra; phase `1` termina allineata a MAME a `38/38` con target respawn
`0x9c/0x124`.

**Checkpoint live downhill respawn (2026-05-14):** il runaway sulla prima rampa
in discesa diagonale era una sub-JSR mancante nel wrapper: `FUN_121B8` chiamava
`FUN_25C74` senza cablare `FUN_25BAE`/sound/`FUN_15BD0`, quindi TS rimaneva in
`obj0+0x1A=1` con target stale `0x011c/0x00c4` mentre MAME entrava in
`state=4` e ricalcolava il respawn `0x00d4/0x005c`. Ora `helper25C74` riceve
le callback reali/iniettate; il repro browser-like down-left da f2045 e' exact
vs MAME fino a f2450 (`state=4`, scroll `0/0`, PF `4174` al frame critico).

**Checkpoint live respawn (2026-05-14):** il post-morte non era un problema di
input o renderer: `FUN_2591A` mancava del callee reale `FUN_262B2`, quindi il
respawn leggeva target globals stale e poteva scrollare via il playfield.
`object-target-init-262b2.ts` ora replica init sentinel, dispatch target-table,
`FUN_2637A` e fallback backward scan; il runtime gameplay lo cabla quando il
dispatcher e' in play live (`0x400390/0x400391 == 0`). Il caso live riprodotto
riporta il target a `0x74/0x74`, torna `state 4 -> 0` senza scroll impazzito,
mentre playable replay 3/3 e warm-seed 15/15 restano PASS.

**Checkpoint playable tutorial overlay (2026-05-14):** il waypoint walker
`FUN_1815A` ora cabla il trampoline `0x12A` a `FUN_2B50`/state=1 usando la
tabella ROM `0x242AA`, quindi overlay MAME come `FINISH RACE / IN THIS / TIME`
e `WARNING: / CLIFFS!` vengono renderizzati e schedulati dal path reale.
`FUN_2678` ora chiama anche `FUN_2ABC(dataPtr)`, cancellando le celle alpha
della chain precedente. I tre replay playable restano PASS (`80/100`,
`100/100`, `82/100`), warm-seed 15/15 resta PASS, e il long demo fresh step10
no-stack migliora `15727 -> 14501`.

## Metriche progetto

| Metrica | Valore |
|---|---|
| Funzioni Ghidra coperte | **350 / 350** (100%, ~358 con parity 500/500) |
| Differential test cases | >100.000 random cases tutti 100% match vs musashi-wasm |
| Vitest | Full suite con fail preesistenti in `slapstic-lookup` e `level-helper-2ffb8`; typecheck e test/probe mirati usati come checkpoint |
| **Drift workRam @ f+99** | **172B = 172B stack (escluso) + 0B gameplay** dopo warm slot-array replay + residual async bridge (era 376B / 204B gameplay) |
| **Register file M68K TS** | ✅ 8 istruzioni stack ABI bit-perfect vs Tom Harte SingleStepTests (2879/2879 considerati pass al 100%, 22MB dataset MIT) |
| **Cycle-table M68010** | ✅ Estratta da Musashi MIT (21/21 vitest, CYCLES_PER_VBLANK=119316, sanity FUN_158CC +3.7%) |
| Frame 0 (post-bootInit) ↔ MAME | **bit-perfect** su tutte le 32 regioni workRam |
| **`obj0.x` evolution vs MAME** | **bit-perfect su 99/99 frame** del ground truth (warm f12000 + tick 99×) |
| **Demo gameplay marble visivo** | 🟡 warm demo stabile e animato con `?mameLive=1&play=1`; raw long-run `loopReset=0` avanza oltre i primi secondi ma resta WIP |
| **Long demo oracle f12000..18000** | 🟡 checkpoint 2026-05-14: `npx tsc -b` PASS; playfield exact fino a f18000 nelle finestre chiave storiche dopo `FUN_1AD54 -> FUN_2BC5C -> FUN_2FF40` slapstic prefetch side-effect, fix A3/A4 `FUN_160F6`, wiring HUD/banner di `FUN_10504`, `FUN_253EC` JT[4] eaten-orbit e `FUN_29CCE` tag `0x1f` side-wall bounce; rebuild chunk cadence staged e mode0 `FUN_10504` ritardato per segmenti 3/5 (f14600/f17680 PF/alpha/color non piu' anticipati); mode0→mode1→mode2 handoff riallineato anche nel secondo cycle f15367..f15379; dwell `390=1/392=2/3e4=3` protegge `gameTickTimers` dal falso reset; il refresh body del segmento 5 ora parte a stage 91, mantenendo fermo l'oggetto presentation pre-handoff; `FUN_15A12` object-pair spawn + `FUN_1BC88 -> FUN_160D4` allineano il bounce f14858 (`obj0` e `0x400A20` exact fino a f14900); `FUN_286EE -> FUN_3520` e timer presentation riducono alpha HUD a 0 nei campioni f12950/f13200/f13400/f13920/f14620; scratch/phase `FUN_1A444` descriptor-backed migliora la somma campionata `157172 -> 150186`, l'ultimo rotate `FUN_1C014` del bridge segment-3 la porta a `146650`, chunk7 scratch-only segment-5 la porta a `145902`, i side-effect `FUN_2FFB8` nelle phase staged la portano a `141790`, il rebuild segment-5 stage91 riduce il fresh bank-aware tail `58208 -> 57365 -> 55914`, lo scratch clear stage84 lo porta a `53820`, il rebuild PF segment-5 parziale lo porta a `53055` con f17701 PF `765 -> 0`, il prefix cadence segment-5 lo porta a `49288`, le phase scratch-only segment-5 chunk2..6 lo portano a `33516`, il chunk2 snapshot delay riduce il dense f17640..f17675 `16598 -> 14731`, la cadence HUD/counter segment-5 riduce tail `32891 -> 32604` e step10 `16523 -> 16309` chiudendo alpha f17700 `204 -> 0`, la preservazione scratch mid-`FUN_1A444` del segmento 5 riduce dense `14659 -> 13327`, tail `32604 -> 31346`, step10 `16309 -> 16161`, il latch pagina MO segment-4 riduce dense `13327 -> 12823`, tail `31346 -> 30802`, step10 `16161 -> 15960`, il carry AV latch segment-5 porta dense `12823 -> 12751`, tail `30802 -> 30698`, step10 `15960 -> 15950`, il tick staged `FUN_1A444` porta dense `12751 -> 12720`, tail `30698 -> 30672`, step10 `15950 -> 15947`, il timer presentation segment-4 porta dense `11460 -> 11352`, tail `29193 -> 29070`, step10 `15742 -> 15727`, il clear video mode2 segment-4 porta il fresh f16990..f17025 `18536 -> 11568` con f17004 `7213 -> 295`, il banner alpha f17004 porta la stessa finestra a `11464` con f17004 `209`, il clear alpha parziale f17005 la porta a `11252` con f17005 `198`, il micro-cadence mode2 segment-4 la porta a `10874` con f17009 `227`, il delay hi-score/PF segment-4 la porta a `10335` con f17010 `257` e f17011 PF exact, e il wiring state-machine tutorial (`FUN_1815A -> FUN_2B50`, `FUN_2678 -> FUN_2ABC`) porta lo step10 no-stack `15727 -> 14501`; PF exact da f17701/f17702 e poi da f17710 a f18000; residuo principale: workRam scratch/cache e sprite emission |
| **Gameplay warm-seed scenarios** | ✅ 15/15 oracle checked-in in `oracle/scenarios/gameplay/` (level1_spawn, level1_early@f14120, level1_midmap, level1_obstacle@f15084, level1_end, level2_spawn, level2_early@f17010, level3_spawn@f18200, level3_early@f18700, level3_end@f19050, level4_spawn@f19600, level4_early@f20150, level5_spawn@f21250, level5_early@f21800, intro_overlay), 101 snapshot ciascuno; `probe-scenario-diff.ts` PASS su tutti con criterio `>=60` frame consecutivi PF=0/sprite<=50/HUD<=30, inclusi i primi 60 frame dal seed; 14/15 scenari passano 100/100 sotto soglia, con solo `level3_spawn` PASS @77 per un boundary tardo f+78 |
| **Demo input replay warm-seed** | ✅ `mame_demo_input_tap.lua` + `input-replay.ts` + `probe-demo-replay.ts`; trace `demo_attract.json` f9700..f21900 deterministica; 5/5 scenari minimi e 15/15 suite PASS con input injected |
| **Coin/play input replay** | ✅ `mame_playable_input_capture.lua` + `playable_coin_start.json` + `probe-playable-replay.ts`; scenari `coin_start_to_level1`, `level1_trackball_short`, `level1_trackball_obstacle` PASS con input reale injected (`80/100`, `100/100`, `100/100` sotto soglia) |
| **Live browser input** | ✅ `?autoLoad=1&play=1` richiede `5`/`C` coin + `Enter`/spazio START e poi carica `manual_level1_start` in dispatcher gameplay manuale, con trackball neutro al seed; `coin_start_to_level1` resta replay/oracle fallback; `?preserveDispatcher=1` conserva invece il dispatcher MAME per drill oracle; trace/replay conserva la rotazione MAME trackball, mentre mouse/touch/WASD/frecce/gamepad live usano assi screen-space mono-asse con X invertito per il controllo visivo; frecce libere dal debug-scroll in `?play=1`; lower-platform death/respawn state-1 e route live browser coperte da regression test; seed playable web via `?playableSeed=...` solo per diagnostica |
| Chain playfield end-to-end | ✅ `bootInit({preloadLevel: 0..5})` → state.playfieldRam popolato (1500-2900 byte/livello) |
| State machine evolution | ✅ `tick({runMainLoopBody})` → spriteRam ~110 byte, workRam attivo |
| HUD attivato | ✅ alphaRam popolato — "SCORE _____" decoded ASCII via renderString286EE |
| **Frame Level 1 reale** | ✅ 1375/4096 tile, 1 sprite, 10 alpha chars (rampa diagonale visibile in ASCII map) |
| **Web frontend real rendering** | ✅ default con ROM caricata; `?demo=1`/`?engine=1`/`?real=1` per modalità debug |
| Multi-agent workflow | Claude Code (~150 funzioni / 35+ batch) + Codex (chain playfield 1A9CC/1A444/16EC6 + helpers 2FFB8/1AA38/18FD0/26B66/28C7E/28580/100E0/16F6C/259B4/11B18/1344C + batch grosso F6A/52DA/40D8/1B9CC/17CB8/28E3C + state-machine subs) |

## Track A — Phase 4d (replication bit-perfect)

| Categoria | Status |
|---|---|
| **Root game-logic CORE** | ✅ 4/4 (`trackballInputTick`, `gameTickTimers`, `gameMainGate`, `gameStateMachineTick`) |
| **State machine schedulers** | ✅ Stati 1, 2, 3, 4, 5/6, 7 + state-sub 2572/2766/2818/295A/2CD4/2BDA/2C60/2DA0/2ABC/2678/520E/525C/5334/535E/540A/5608/1EAA |
| **Boot init** | ✅ `bootInit` orchestrator + slot-array bulk init + boot screen + spurious handler |
| **Sound subsystem** | ✅ Wrapper FUN_4CA0 + sub FUN_3E1A/4C3E/4D1A/158AC/15884/4420 (chip writer FUN_4DCC ancora minimal-stub: richiede YM2151) |
| **Palette / video** | ✅ paletteAnim 1/2/3, paletteQueue, paletteRngFill, palette init, pfScroll, tilemap blit, clear-pf, tilemap entry pack 1A9CC, row build 1A444, span builder 1AA38, level dispatcher 16EC6, helpers 2FFB8/18FD0 |
| **String / HUD render** | ✅ render-string-entry-286B0/28F62/28FA0/28FDE, format-and-render, render-glyph-loop, dispatch-strings |
| **EEPROM / pacing** | ✅ eepromCommit, eepromCommitRequest |
| **Slapstic** | ✅ lookup + table store |
| **Boot/main loop init chain** | ✅ FUN_117B2 + FUN_11452 + FUN_1101E + FUN_10504 (Codex) replicati bit-perfect |
| **Funzioni totali** | 314 (escludendo 29 thunks) |
| **Replicate bit-perfect** | **~270+** via parity 500/500 (resto metadata thunks) |
| **Differential test cases** | >100.000 random cases tutti 100% match |

## Track B — Classic Renderer (MAME-faithful pipeline)

| Componente | Status |
|---|---|
| **Engine `Frame` model** | ✅ `packages/engine/src/render.ts` — neutral data model (palette, scroll, 3 layer: playfield/MO/alpha) |
| **PixiJS pipeline** | ✅ `packages/web/src/renderer.ts` — translate Frame → containers, integer scaling, no AA |
| **ROM graphics decode** | ✅ `packages/web/src/rom-graphics.ts` — alpha glyphs + object tiles MSB-first MAME-compliant |
| **ROM ZIP loader** | ✅ `packages/web/src/rom-loader.ts` con fflate + ROMREGION_INVERT |
| **Demo fixtures** | ✅ classic-demo-frame, engine-diagnostic-frame |
| **MAME oracle dump** | ✅ `oracle/mame_state_dump.lua` — full state RAM + screenshot @ frame target |
| **MAME state fixture** | ✅ `packages/web/public/mame_state.json` — frame 2400 Beginner level |
| **`?mameDump=1` query param** | ✅ bypass bootInit+tick, popola state TS dal MAME dump |
| **`?autoLoad=1` query param** | ✅ DEV-only auto-fetch ROMs dal symlink `public/roms/` |
| **Bit-perfect tile decode** | ✅ planes[0]=MSB pen, MSB-first readbit, ROMREGION_INVERT, set_granularity(8) |
| **Palette regions MAME** | ✅ Alpha 0x000-0x0FF / MO 0x100-0x1FF / Playfield **0x200-0x2FF** / Translucency 0x300-0x3FF |
| **Pixel match vs MAME oracle** | Marble/PF alignment uses MAME motion-object transform; terrain and HUD/footer ✅ |
| **Indirect renderer (`?indirect=1`)** | ✅ bitmap_ind16 PF + MO scratch + screen merge MAME-correct |
| **MO coordinate transform/bank** | ✅ MAME-faithful in indirect and direct real-MO paths: active AV-control bank only, `x=xRaw`, `y=-yRaw-256-heightPx` (no empirical +15/243 offset, no all-bank stale sprites) |
| **Pen cap 7** (3-bit effective MOB) | ✅ sphere blu shading visivo |
| **Docs** | 📋 [`docs/classic-renderer.md`](./docs/classic-renderer.md), [`docs/classic-renderer-prd.md`](./docs/classic-renderer-prd.md), [`docs/classic-renderer-plan.md`](./docs/classic-renderer-plan.md) |

## Bridge Track A ↔ Track B

| Componente | Stato |
|---|---|
| `mainTick(state, {rom})` | ✅ `packages/engine/src/main-tick.ts` orchestra le root sub replicate nell'ordine esatto di FUN_28788 |
| `bootInit(state, rom)` | ✅ porta lo state al primo frame "post-boot pre-tick" |
| Frontend integrato | ✅ `packages/web/src/main.ts` chiama bootInit + tick reale |
| Visual smoke test | ✅ `packages/cli/src/visual-smoke-test.ts` — palette evolve, sprite/HUD richiedono altre sub |

## Tecniche differential testing

- ROM-blob caricato in **musashi-wasm** (M68k emulator) come oracolo per-funzione
- Random input setup → `callFunction(addr)` sul binario + chiamata TS reimpl in parallelo
- Compare bit-perfect su workRam / colorRam / spriteRam / alphaRam regions
- Patch ROM (es. `rts` immediate = 0x4E75) per stubbare sub-functions non ancora replicate
- Spin-loop patching (`bne` → `bra`) per evitare hang in test deterministici
- MMIO-source patching (es. 0xFC0001 → 0x00400440) per controllare letture MMIO via `pokeMem`
- RTE → RTS patching per testare IRQ handlers via callFunction sentinel-based

## End-to-end vs MAME (schema v2)

- `oracle/run_oracle.ts` lancia MAME con dumper Lua → `traces/oracle_<scenario>.jsonl`
- `packages/cli/src/marble-runner.ts` esegue il reimpl → `traces/reimpl_<scenario>.jsonl`
- `harness/diff.ts` confronta con `--truth-offset N` (allinea boot transient) e `--from-frame N`
- **Trace localization v2**: 32 CRC32 regionali (regioni 0x100 byte) → diff annota "workRam[0x300..0x3ff]" invece del generico "workRamHash mismatch"
- `tools/watch_write.lua` (write-tap MAME): logga `(frame, PC, addr, data, mask)` per identificare writer di una zona specifica
- `MARBLE_DUMP_REGIONS=0x100,0x300` env var: dump hex byte-per-byte di regioni specifiche per debug

```bash
# Pipeline completa: reimpl trace + diff vs oracle
harness/parity-check.sh attract_mode 45 600 1
```

## Workflow multi-agent

Due flussi paralleli operativi:

**1. Claude Code in-process** (5 agent paralleli con `isolation: "worktree"`, best practice Claude Code documentata):
- Ogni agent lavora in worktree git temporaneo isolato
- Prompt focalizzato (~150 parole) con template + pattern noto
- Tutti i risultati 500/500 bit-perfect vs binary
- ~5 min wall time per batch da 5 funzioni

**2. Codex (OpenAI) in clone separato** via [`docs/codex-prd.md`](./docs/codex-prd.md):
- Branch `codex/<task>` su GitHub, PR-based merge su main
- Regole non-interferenza: branch/PR dedicati, niente write su aree possedute da altri agent
- Task completati: main loop init chain, 5 state-machine subs, tilemap entry pack FUN_1A9CC, row build FUN_1A444, level dispatcher FUN_16EC6, playfield helper batch FUN_2FFB8/FUN_1AA38/FUN_18FD0 + ROM pointer fix
- Marco fa review + integration finale al merge

Vedi `STATUS.md` per il diario dei batch e `docs/codex-task-a-main-loop-init.md` per il progress Codex.

## Architettura

```
ORACOLO (MAME + Lua) ──▶ trace_truth.jsonl
                                            │
                                            ▼
                            DIFFERENTIAL HARNESS ──▶ divergence_report.json
                                            ▲                    │
                                            │                    ▼
REIMPLEMENTAZIONE TS  ──▶ trace_reimpl.jsonl     Claude Code (hill-climbing)
```

## Packages (monorepo)

| Pacchetto | Ruolo |
|---|---|
| `@marble-love/engine` | Core logic puro: bus, physics, AI, RNG, level, render-adapter, audio-stub, state. No DOM. Moduli replicati bit-perfect in crescita continua via parity. |
| `@marble-love/cli`    | Bun/Node runner (`marble-runner`) per produrre trace JSONL + ~95 parity test vs binary. |
| `@marble-love/web`    | Vite + PixiJS shell. ROM file picker locale. PWA installabile. |
| `@marble-love/mobile` | Capacitor wrapper (V2). |

## Warm-seed gameplay scenari (web) — `?scenario=NAME`

15 scenari MAME warm-seed bit-perfect (101 snapshot ciascuno: `f0` seed + 100
frame oracle) catturati in `oracle/scenarios/gameplay/` e wirati nel web app
via `?scenario=NAME` (cherry-pick da `feature/render-fix-bg`). Coabita con
`?playableSeed=NAME` (3 file `scenarios/playable/`) di Codex.

Scenari disponibili:
- **Practice Race**: `level1_spawn`, `level1_midmap`, `level2_spawn`, `level4_spawn`
- **Aerial Race**: `level2_early`, `level4_early`, `level1_obstacle`,
  `level3_spawn`, `level5_spawn`
- **Intro overlay**: `intro_overlay` (Practice + "FINISH RACE IN THIS TIME")
- **Title screen** (post-reseed conservativo): `level1_early`, `level1_end`,
  `level3_early`, `level3_end`, `level5_early`

Loop reset 100 frame = oracle window. Visivamente bit-perfect vs MAME (verifica
10/10 side-by-side, vedi `~/Desktop/d4-mame-vs-ts/` per shot comparison).

Usage:
```
http://localhost:5173/?autoLoad=1&scenario=level1_spawn        # Practice gameplay
http://localhost:5173/?autoLoad=1&scenario=level2_early        # Aerial Race
http://localhost:5173/?autoLoad=1&scenario=intro_overlay       # con overlay HUD
http://localhost:5173/?autoLoad=1&scenario=level1_spawn&sound=1  # + audio
```

## Sound chip end-to-end (cherry-pick da `feature/sound-chip`)

Audio subsystem in 11 file engine + 3 test + 1 CLI + 2 web + 1 worklet,
default-on nel browser (`sound=0` opt-out). 6502 sound CPU + YM2151 + POKEY +
mailbox 68K↔6502 + Web Audio renderer.

| Phase | File | Test |
|---|---|---|
| **C2 M6502 core** | `src/m6502/{addressing,bus,cpu,cycle-table,opcodes,regfile}.ts` | 65x02 Tom Harte SingleStepTests PASS |
| **C4 mailbox + MMU + ROM** | `src/m6502/{mailbox,sound-mmu,sound-rom}.ts` | 19/19 PASS (incl. smoke con ROM reale 136033.421/.422) |
| **C5 YM2151** | `src/audio/ym2151.ts` (Phase 5 V2 register-state parity) | 10/10 PASS |
| **C6 POKEY** | `src/audio/pokey.ts` (Phase 6 V2 register-state parity) | 11/11 PASS |
| **C7 SoundChip facade** | `src/m6502/{sound-chip,sound-clock}.ts` | 9/10 PASS smoke (NMI/IRQ edge-triggered) |
| **C8 probe-sound-diff** | `packages/cli/src/probe-sound-diff.ts` | 387B audioRam + 2 YM + 1 POKEY divergent @ f600 (V2 Timer A/B stub) |
| **C9 Web Audio renderer** | `packages/web/src/sound-renderer.ts` + `public/sound-worklet.js` | 17/17 PASS pure logic/fallback (ymKcToFreq, pokeyAudfToFreq, command cue fallback, no-Worklet/no-AudioContext startup, ...) |
| **C10 Wire web audio** | `packages/web/src/main.ts` | Pulsante "🔊 Enable Audio" default-on + cue hook leggero (`sound=0` opt-out, `soundChip=1` diagnostico) |

**62/64 sound test PASS** (2 skip = sentinel ROM-assenti). Build PWA 795KB.

**V1 MVP audio**: 8 YM2151 voices (sine + ADSR envelope follower) + 4 POKEY
voices (square / white noise) sintetizzate da AudioWorklet quando disponibile,
con fallback LAN/Safari-friendly via `webkitAudioContext`, `OscillatorNode`
diretto e cue WAV generato se manca `AudioContext`. Bridge
`sound-renderer.ts` polla `chip.ym2151.regs` + `chip.pokey.writeRegs` ogni
frame e posta eventi `ym_voice` / `pokey_voice` quando il worklet esiste.
In piu', ogni `soundCmdSend158AC` emesso dal gameplay invia un breve cue
deterministico al worklet: il comando continua ad andare al SoundChip reale,
ma il browser resta udibile anche finche' il driver 6502/YM/POKEY non produce
ancora register writes gameplay completi. Il click su "Enable Audio" emette
anche un breve cue di conferma e non richiede piu' che `AudioWorklet` sia
disponibile sull'origine LAN.

La musica di fondo e gli effetti chip-completi non sono ancora chiusi: il
browser default tiene spento il tick diagnostico 6502/YM/POKEY per non
rallentare il gameplay. Usa `&soundChip=1` solo per debug del driver sound
parziale; i cue gameplay sono rate-limited e restano il feedback audio V1.

**V3 sample-level chip-perfect deferito** (PRD Phase 7 V1 explicit "POKEY/
YM2151 chip-perfect rimandato a V2"): envelope DR/AR/SR/RR per 32 operatori
FM + 8 algoritmi FM + LFSR poly 17-bit + Timer A/B counter con IRQ wire al
6502. Closure 0-byte register-state richiede V3.

```
http://localhost:5173/?autoLoad=1&play=1
# 1. Click 🔊 Enable Audio (top-right, richiesto da AudioContext user gesture)
# 2. Premi 5 (coin) + Enter (START1) → biglia spawn
# 3. Muovi con mouse / WASD / frecce. I comandi sound gameplay producono cue udibili.
# Usa &sound=0 solo se vuoi nascondere/disabilitare il bottone audio.
# Usa &soundChip=1 solo per debug: puo' rallentare e non produce ancora musica completa.
```

## Quickstart sviluppo

```bash
# 1. Install (preferito Bun, ma npm funziona)
npm install        # oppure: bun install

# 2. Typecheck tutto il monorepo
npm run typecheck

# 3. Test
npm run test

# 4. Lint (custom rule per branded numeric types)
npm run lint

# 5. Web dev server
npm run dev --workspace @marble-love/web
```

## Differential testing per-funzione

Per ogni sub-system replicato, `packages/cli/src/test-*-parity.ts` esegue:
1. Setup random workRam state in entrambi (musashi-wasm + TS state)
2. Chiama la funzione binaria + la TS reimpl
3. Confronta byte-by-byte le regioni di memoria modificate

```bash
# Esempi (200/500/1000+ casi random per ogni test)
npx tsx packages/cli/src/test-game-tick-timers-parity.ts 2000
npx tsx packages/cli/src/test-game-state-machine-parity.ts 3000
npx tsx packages/cli/src/test-trackball-input-parity.ts 2000
npx tsx packages/cli/src/test-sound-tick-parity.ts 2000
# ...e ~85 altri test parity
```

## ROM

Le ROM **non sono fornite**. L'utente deve possederle legalmente (PCB di proprietà, dump personale ecc.) e metterle in `roms/` (gitignored). Vedi [`docs/rom-layout.md`](./docs/rom-layout.md).

## Riferimenti

1. https://phulin.me/blog/simtower
2. https://github.com/phulin/reaper
3. https://garryslist.org/posts/ai-just-ported-simcity-in-4-days-without-reading-the-code
4. https://banteg.xyz/posts/crimsonland/
5. MAME source `src/mame/atari/atarisy1.cpp`
