#!/usr/bin/env bash
# ghidra_headless.sh - Ghidra `analyzeHeadless` wrapper that sets JAVA_HOME
#
#   ./tools/ghidra_headless.sh ./ghidra_project marble \
#       -import ./ghidra_project/marble_program.bin \
#       -processor 68000:BE:32:default
#
set -euo pipefail

JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
GHIDRA_HOME="${GHIDRA_HOME:-/opt/homebrew/Cellar/ghidra/12.0.4/libexec}"

if [[ ! -x "$GHIDRA_HOME/support/analyzeHeadless" ]]; then
    echo "Ghidra not found at $GHIDRA_HOME"                   >&2
    echo "Set GHIDRA_HOME or run: brew install ghidra"        >&2
    exit 2
fi
if [[ ! -d "$JAVA_HOME" ]]; then
    echo "JDK 21 not found at $JAVA_HOME"                      >&2
    echo "Set JAVA_HOME or run: brew install openjdk@21"        >&2
    exit 2
fi

export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"

exec "$GHIDRA_HOME/support/analyzeHeadless" "$@"
