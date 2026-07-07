#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Krawings Portal — build-check (Stop hook)
#
# WHY: the same TypeScript / ESLint mistakes keep breaking `next build` after
#      deploy (see the "TS/build pitfalls" list in the inventory handoff:
#      Set spread, wrong imports, JSX apostrophes, bad error typing, etc.).
#      This runs the same static checks locally the moment Claude finishes a
#      turn, so those bugs get fixed BEFORE code is pushed to GitHub / deployed
#      — instead of being discovered on the server a round-trip later.
#
# WHAT: if any .ts/.tsx changed this turn, run `tsc --noEmit` + `next lint`.
#       On failure it exits 2, which feeds the errors back to Claude so it
#       keeps working and fixes them before the turn ends.
#
# SAFE: read-only checks. Never edits, commits, pushes, or deploys anything.
# ---------------------------------------------------------------------------

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-/Users/ethan/Odoo_Portal_18EE}"
cd "$PROJECT_DIR" || exit 0

# Read the hook payload from stdin.
input="$(cat)"

# Loop protection: if this turn is ALREADY a continuation triggered by this
# hook, don't block a second time — let the turn end so a human can look.
case "$input" in
  *'"stop_hook_active":true'*|*'"stop_hook_active": true'*) exit 0 ;;
esac

# Only do any work when TypeScript actually changed this turn (staged,
# unstaged, or brand-new files). Conversational turns exit instantly.
changed="$( { git diff --name-only --diff-filter=d;        \
              git diff --cached --name-only --diff-filter=d; \
              git ls-files --others --exclude-standard;       \
            } 2>/dev/null | grep -E '\.(ts|tsx)$' )"
[ -z "$changed" ] && exit 0

report=""

# 1) Type-check the whole project (baseline is clean, so any error is new).
tsc_out="$(node_modules/.bin/tsc --noEmit 2>&1)"
if [ $? -ne 0 ]; then
  report="${report}### TypeScript errors
${tsc_out}

"
fi

# 2) Lint (exits non-zero only on ESLint *errors* — e.g. JSX apostrophes —
#    not on the pre-existing unused-var warnings, so no false alarms).
lint_out="$(node_modules/.bin/next lint 2>&1)"
if [ $? -ne 0 ]; then
  report="${report}### ESLint errors
${lint_out}

"
fi

if [ -n "$report" ]; then
  {
    echo "Build-check failed. These will break \`next build\` on deploy — fix them before finishing:"
    echo
    echo "$report"
  } >&2
  exit 2
fi

exit 0
