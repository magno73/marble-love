#!/usr/bin/env bash
# run_compare.sh — pipeline differential testing end-to-end.
#
# Usage: ./harness/run_compare.sh <scenario>
#
# Step:
#   1. Run MAME oracle -> traces/oracle_<scen>.jsonl
#   2. Run reimpl CLI  -> traces/reimpl_<scen>.jsonl
#   3. Diff            -> traces/divergence_<scen>.json
#   4. Report markdown    → stdout
set -euo pipefail

SCEN="${1:-}"
if [[ -z "$SCEN" ]]; then
  echo "usage: $0 <scenario>" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RUN="${RUN:-npx tsx}"

mkdir -p traces

echo "[compare] (1/4) oracle MAME..."
$RUN oracle/run_oracle.ts \
    --scenario "$SCEN" \
    --out "traces/oracle_${SCEN}.jsonl"

echo "[compare] (2/4) reimpl TS..."
$RUN packages/cli/src/marble-runner.ts \
    --scenario "$SCEN" \
    --out "traces/reimpl_${SCEN}.jsonl"

echo "[compare] (3/4) diff..."
$RUN harness/diff.ts \
    --truth "traces/oracle_${SCEN}.jsonl" \
    --reimpl "traces/reimpl_${SCEN}.jsonl" \
    --out "traces/divergence_${SCEN}.json"

echo "[compare] (4/4) report:"
echo
$RUN harness/report.ts "traces/divergence_${SCEN}.json"
