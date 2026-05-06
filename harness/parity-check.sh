#!/usr/bin/env bash
# parity-check.sh — esegue la pipeline reimpl-trace → diff vs oracle.
#
# Uso:
#   harness/parity-check.sh <scenario> [<from-frame>] [<ticks>]
#
# Esempio:
#   harness/parity-check.sh attract_mode 6 600
#
# Skippa la transitoria di boot (default 6 frame per attract_mode) per
# misurare la parità "post-boot". Richiede:
#   - traces/oracle_<scenario>.jsonl pre-esistente (da `oracle/run_oracle.ts`)
#   - ROM in ghidra_project/marble_program.bin

set -euo pipefail

SCEN=${1:?scenario richiesto (es. attract_mode)}
FROM=${2:-6}
TICKS=${3:-600}

ORACLE=traces/oracle_${SCEN}.jsonl
REIMPL=traces/reimpl_${SCEN}.jsonl
REPORT=traces/divergence_${SCEN}.json

if [ ! -f "$ORACLE" ]; then
  echo "error: oracle trace mancante a $ORACLE" >&2
  echo "  generala con: node --experimental-strip-types oracle/run_oracle.ts -s $SCEN" >&2
  exit 1
fi

echo "→ generating reimpl trace ($TICKS frame, with-boot-init)..."
npx tsx packages/cli/src/marble-runner.ts \
    --scenario "$SCEN" --ticks "$TICKS" --with-boot-init --out "$REIMPL"

echo "→ comparing oracle vs reimpl from frame $FROM..."
node --experimental-strip-types harness/diff.ts \
    --truth "$ORACLE" --reimpl "$REIMPL" \
    --from-frame "$FROM" --out "$REPORT"

echo
echo "report: $REPORT"
echo "parity: $(jq -r '.parity' "$REPORT")"
echo "first divergence: frame $(jq -r '.firstDivergence.frame // "none"' "$REPORT") fields $(jq -r '.firstDivergence.fields // [] | join(",")' "$REPORT")"
