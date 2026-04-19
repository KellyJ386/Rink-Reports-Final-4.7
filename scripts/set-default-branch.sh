#!/usr/bin/env bash
set -euo pipefail

OWNER="kellyj386"
REPO="rink-reports-final-4.7"
BRANCH="${1:-main}"

if command -v gh >/dev/null 2>&1; then
  gh repo edit "${OWNER}/${REPO}" --default-branch "${BRANCH}"
else
  : "${GITHUB_TOKEN:?Set GITHUB_TOKEN or install the gh CLI}"
  curl -fsSL -X PATCH \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com/repos/${OWNER}/${REPO}" \
    -d "{\"default_branch\":\"${BRANCH}\"}"
fi

echo "Default branch set to ${BRANCH} on ${OWNER}/${REPO}"
