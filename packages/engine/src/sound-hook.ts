/**
 * sound-hook.ts — fallback global hook per cmd emit da TUTTE le sub sound.
 *
 * Pattern: invece di passare callback in ogni callsite, ogni sub-emit chiama
 * `notifySoundCmd(cmd)`. Se il caller (web frontend) ha registrato hook via
 * `setGlobalSoundCmdHook`, il cmd viene inoltrato. Default no-op.
 *
 * NON ha side effect sul state TS: solo emit esterno. Parity test invariato.
 *
 * Sub che chiamano:
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
