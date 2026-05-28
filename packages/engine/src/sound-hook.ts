/**
 * sound-hook.ts - fallback global hook for command emits from all sound subs.
 *
 * Pattern: instead of threading callbacks through every call site, each
 * sub-emitter calls `notifySoundCmd(cmd)`. If the caller (web frontend)
 * registered a hook via `setGlobalSoundCmdHook`, the command is forwarded.
 * Default no-op.
 *
 * No side effects on TS state: external emit only. Parity tests are unchanged.
 *
 * Calling subs:
 *   - soundCmdSend158AC (FUN_000158AC)
 *   - soundCmdSend       (FUN_???)
 *   - soundPair15884     (FUN_00015884)
 *   - soundDispatchSend  (FUN_???)
 *   - soundMaybe11AC2    (FUN_00011AC2)
 */

let globalHook: ((cmd: number) => void) | undefined = undefined;

export function setGlobalSoundCmdHook(hook: ((cmd: number) => void) | undefined): void {
  globalHook = hook;
}

export function notifySoundCmd(cmd: number): void {
  if (globalHook !== undefined) globalHook(cmd & 0xff);
}
