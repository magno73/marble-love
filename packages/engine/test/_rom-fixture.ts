import { existsSync } from "node:fs";
import { resolve } from "node:path";

// The MAME program ROM dump (ghidra_project/marble_program.bin) is gitignored
// (copyright) and therefore absent on a clean clone and in CI. Engine test
// suites that load it gate on ROM_AVAILABLE via `describe.skipIf`/`it.skipIf`
// so the suite stays green and honest without a ROM, and runs in full whenever
// a legal dump is provided locally.
const ROM_PATH = resolve("ghidra_project/marble_program.bin");

export const ROM_AVAILABLE = existsSync(ROM_PATH);

if (!ROM_AVAILABLE) {
  console.warn(
    `[engine tests] ROM not found at ${ROM_PATH} — ROM-dependent suites are ` +
      "skipped. Provide a legal dump there to run the full engine suite.",
  );
}
