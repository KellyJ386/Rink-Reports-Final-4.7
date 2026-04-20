#!/usr/bin/env node
/**
 * Opens GitHub issues for flaky candidates identified by flaky-detect.mjs.
 *
 * Dedup: before opening, queries open issues tagged `flaky` and skips any
 * whose title already matches the candidate key. Prevents weekly issue spam.
 */

import { readFileSync } from 'node:fs'

const reportPath = process.argv[2]
if (!reportPath) {
  console.error('usage: flaky-open-issues.mjs <report.json>')
  process.exit(1)
}

const token = process.env.GITHUB_TOKEN
const repo = process.env.GITHUB_REPOSITORY
if (!token || !repo) {
  console.error('GITHUB_TOKEN and GITHUB_REPOSITORY required')
  process.exit(1)
}

async function gh(path, init = {}) {
  const r = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!r.ok) throw new Error(`GitHub API ${path}: ${r.status} ${r.statusText} — ${await r.text()}`)
  return r.json()
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'))

const existing = await gh(
  `/repos/${repo}/issues?state=open&labels=flaky&per_page=100`,
)
const existingTitles = new Set((existing ?? []).map((i) => i.title))

let opened = 0
for (const entry of report.flaky) {
  const title = `flaky: ${entry.key}`
  if (existingTitles.has(title)) continue

  const body = [
    `Flaky candidate detected by weekly scan.`,
    ``,
    `- Job::step: \`${entry.key}\``,
    `- Failures in last ${report.window_days} days: **${entry.count}**`,
    `- Threshold: ${report.min_failures}`,
    ``,
    `**Next steps:**`,
    `1. Investigate the failure. Screenshot + trace are on the failed run's artifacts.`,
    `2. If it's a real bug — fix it and close this issue.`,
    `3. If it's genuinely flaky and un-fixable in this pass — open a PR moving the test into \`tests/quarantine/\` with \`TODO(flake-${'{this issue number}'}): <what would fix it>\` as a header comment.`,
    `4. Quarantined tests run in a separate CI cell that does NOT gate merge.`,
    `5. Weekly review closes quarantine issues after 14 consecutive green runs.`,
    ``,
    `_Opened automatically by .github/workflows/flaky-detect.yml. Do not close without either fixing the root cause or explicitly quarantining._`,
  ].join('\n')

  await gh(`/repos/${repo}/issues`, {
    method: 'POST',
    body: JSON.stringify({
      title,
      body,
      labels: ['flaky', 'agent-9'],
    }),
  })
  opened++
}

console.log(`Opened ${opened} new flaky issues (${report.flaky.length - opened} already tracked).`)
