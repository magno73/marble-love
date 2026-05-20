#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

section() {
  printf '\n== %s ==\n' "$1"
}

section "repo"
printf 'root: %s\n' "$ROOT"
printf 'size: '
du -sh .
printf 'rg files: '
rg --files | wc -l | tr -d ' '
printf '\n'
printf 'git tracked files: '
git ls-files | wc -l | tr -d ' '
printf '\n'

section "top-level sizes"
du -sh ./* ./.??* 2>/dev/null | sort -h | tail -40 || true

section "largest files excluding git node_modules claude"
find . \
  -path './.git' -prune -o \
  -path './node_modules' -prune -o \
  -path './.claude' -prune -o \
  -type f -exec stat -f '%z %N' {} + |
  sort -nr |
  head -30 || true

section "markdown word count"
git ls-files '*.md' | xargs wc -w | sort -nr | head -30 || true

section "json word count"
git ls-files '*.json' | xargs wc -w | sort -nr | head -30 || true

section "ignore checks"
for path in \
  "screenshots/foo.png" \
  "packages/web/dist/foo.js" \
  "node_modules/foo" \
  ".claude/worktrees/foo" \
  ".codex/worktrees/foo" \
  "tasks/example/artifacts/foo.json"; do
  if git check-ignore -v "$path" >/tmp/context-audit-ignore.$$ 2>/dev/null; then
    printf '%s\t' "$path"
    cat /tmp/context-audit-ignore.$$
  else
    printf '%s\tnot ignored\n' "$path"
  fi
done
rm -f /tmp/context-audit-ignore.$$
