/**
 * audio/index.ts — namespace barrel per chip audio (YM2151, POKEY in Phase 6).
 *
 * Pattern coerente con `m6502/index.ts`: tutte le API pubbliche del sound
 * subsystem accessibili come `import { createYM2151, ... } from "audio/index"`.
 */

export {
  type YM2151,
  createYM2151,
  ym2151WriteAddr,
  ym2151WriteData,
  ym2151ReadStatus,
  ym2151Reset,
} from "./ym2151.js";

export {
  type POKEY,
  createPOKEY,
  pokeyWrite,
  pokeyRead,
  pokeyReset,
} from "./pokey.js";
