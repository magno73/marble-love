/**
 * audio/index.ts — namespace barrel for audio chips (YM2151, POKEY in Phase 6).
 *
 * Pattern consistent with `m6502/index.ts`: every public sound subsystem API
 * can be accessed as `import { createYM2151, ... } from "audio/index"`.
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
