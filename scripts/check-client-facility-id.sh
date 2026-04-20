#!/usr/bin/env bash
#
# Blocking CI check: a server action must never accept `facility_id` from the
# client. The correct pattern is:
#   - facility_id comes from current_facility_id() in the DB (DEFAULT), OR
#   - facility_id comes from a server-side lookup (e.g. role → role.facility_id)
#
# What we're guarding against:
#   - Zod schemas that require facility_id as a top-level field
#   - Insert payloads that spread client input directly containing facility_id
#   - Server action signatures like `(input: { facility_id: string, ... })`
#
# This scan is imperfect but catches the vast majority of regressions. Any
# legitimate exception (there shouldn't be one in v1) must add an inline
# `// allow-client-facility-id: <justification>` comment; the check ignores
# lines containing that marker.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Directories to scan
SCAN_DIRS=(app/api app/modules lib)

# Patterns considered violations when appearing in scanned files.
# Each rg pattern is tried; any hit (minus allow-markers) fails CI.
PATTERNS=(
  # Zod field requiring facility_id
  'z\.object\(\s*\{[^}]*facility_id\s*:'
  # Server action signature taking facility_id
  "^(export )?async function [a-zA-Z0-9_]+\([^)]*facility_id\s*:"
  # Payload builder where facility_id is taken from a form/request body
  'facility_id\s*:\s*(body|input|formData|request\.body)\.'
)

VIOLATIONS=0
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

for pattern in "${PATTERNS[@]}"; do
  for dir in "${SCAN_DIRS[@]}"; do
    [[ -d "$dir" ]] || continue
    # ripgrep with -n + -H; strip comments handled by post-filter
    if command -v rg >/dev/null 2>&1; then
      rg --no-messages -n "$pattern" "$dir" || true
    else
      grep -rn -E "$pattern" "$dir" || true
    fi
  done | grep -v 'allow-client-facility-id' >> "$TMP" || true
done

if [[ -s "$TMP" ]]; then
  echo "::error::Client-side facility_id violations found. Server actions must source facility_id from current_facility_id() or a trusted server lookup, never from client input."
  echo ""
  echo "Violations:"
  cat "$TMP"
  echo ""
  echo "If a specific line is a legitimate exception, append a comment:"
  echo "    // allow-client-facility-id: <one-sentence justification>"
  exit 1
fi

echo "ok: no client-sourced facility_id patterns detected"
