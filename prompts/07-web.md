# Prompt — Phase 7: web playable

**Per Claude Code + Marco.**

## Pre-requisito

- Phase 6 chiusa (parità su tutti gli scenari)

## Input

- Scaffold web in `packages/web/` (già pronto: Vite + PixiJS + PWA manifest)
- Engine completo da Phase 4-6

## Step

1. **Unzip ROM client-side**: in `packages/web/src/rom-loader.ts`, integrare `fflate` per leggere `marble.zip` localmente. Identificare i file della ROM (program even/odd, sound, tiles, sprites). Costruire `RomImage`.

2. **Render adapter**:
   - Estrarre tile graphics da `rom.tiles` → texture atlas PixiJS (decoded a runtime, no asset shipped)
   - Estrarre sprite graphics da `rom.sprites` → texture atlas PixiJS
   - In `renderer.ts`: per ogni `Frame.tiles` / `Frame.sprites` → PIXI.Sprite con texture corretta

3. **Audio**: V1 = stub silenzioso o sample synthesis basic via Web Audio API (vedi `audio.ts`). PRD §10: chip-perfect rimandato a V2.

4. **Input**:
   - Mouse → trackball (già abbozzato)
   - Tastiera (WASD/frecce) → trackball delta (già)
   - Gamepad (stick destro) → trackball delta (già)
   - Touch (mobile) → swipe delta (già abbozzato)

5. **PWA**:
   - Verifica installabile (manifest, service worker)
   - Test su iPhone Safari + Android Chrome

6. **Deploy**: scelta tra Vercel/Netlify/Cloudflare Pages. PRD suggerisce Cloudflare per costi e edge.

7. **Dominio**: chiedere a Marco quale (`marblelove.app`? `marblelove.io`?). Non comprare nulla senza approvazione.

## Output

- [ ] `npm run dev --workspace @marble-love/web` → app funzionante a `localhost:5173`
- [ ] Carica ROM da file picker, gioca al livello 1 con parità (visibile dal punto di vista del giocatore)
- [ ] Mobile: testato su almeno un iPhone e un Android reali
- [ ] Build di produzione (`npm run build --workspace @marble-love/web`) deploya correttamente
- [ ] PWA installabile (Add to Home Screen funziona)

## Vincoli

- ROM **mai** uploadata (nemmeno temporaneamente). Verifica con devtools network tab.
- Codice del rendering NON deve impattare la parità: l'engine è la verità, il renderer la legge.
- Performance: 60 FPS su iPhone 8+ (Marble Madness è 1984, hardware moderno lo regge).

## Side effects

- Aggiorna `STATUS.md`
- Commit serie su branch `phase-7-web`, merge dopo approvazione Marco
