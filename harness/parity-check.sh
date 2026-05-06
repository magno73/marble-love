#!/usr/bin/env bash
# parity-check.sh — esegue la pipeline reimpl-trace → diff vs oracle.
#
# Uso:
#   harness/parity-check.sh <scenario> [<truth-offset>] [<ticks>] [<from-frame>]
#
# Esempio:
#   harness/parity-check.sh attract_mode 45 600 0
#
# Allineamento: MAME ha una transitoria di boot di N frame prima del primo
# tick (attract_mode → ~45). reimpl[i] viene confrontato con
# oracle[i+truth-offset]. Per misurare parità "tick-by-tick".

set -euo pipefail

SCEN=${1:?scenario richiesto (es. attract_mode)}
TRUTH_OFFSET=${2:-45}
TICKS=${3:-600}
FROM=${4:-0}

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

echo "→ comparing reimpl[i] vs oracle[i+$TRUTH_OFFSET] from frame $FROM..."
node --experimental-strip-types harness/diff.ts \
    --truth "$ORACLE" --reimpl "$REIMPL" \
    --truth-offset "$TRUTH_OFFSET" --from-frame "$FROM" --out "$REPORT"

echo
echo "report: $REPORT"
echo "parity: $(jq -r '.parity' "$REPORT")"
echo "first divergence: frame $(jq -r '.firstDivergence.frame // "none"' "$REPORT") fields $(jq -r '.firstDivergence.annotated // [] | join(",")' "$REPORT")"
