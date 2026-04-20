#!/usr/bin/env node
/**
 * Flaky test detector (surfaces, does not auto-quarantine).
 *
 * Scans the last N days of GitHub Actions runs for this repo and identifies
 * tests that failed >= `--min-failures` times across runs that either
 * eventually passed (flaky) or failed inconsistently. Emits
 * `flaky-report.json` that the sibling `flaky-open-issues.mjs` consumes.
 *
 * We deliberately do NOT auto-move tests into `tests/quarantine/`. Automatic
 * quarantine is how you end up with an always-green CI that tests nothing.
 *
 * Env:
 *   GITHUB_TOKEN  — required; provided by Actions
 *   GITHUB_REPOSITORY  — auto-provided by Actions (e.g. kellyj386/rink-reports-final-4.7)
 *
 * CLI:
 *   --window-days N     (default 7)
 *   --min-failures N    (default 2)
 */

import { writeFileSync } from 'node:fs'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])
}
const WINDOW_DAYS = parseInt(args.get('window-days') ?? '7', 10)
const MIN_FAILURES = parseInt(args.get('min-failures') ?? '2', 10)

const token = process.env.GITHUB_TOKEN
const repo = process.env.GITHUB_REPOSITORY
if (!token) {
  console.error('GITHUB_TOKEN missing')
  process.exit(1)
}
if (!repo) {
  console.error('GITHUB_REPOSITORY missing')
  process.exit(1)
}

async function gh(path) {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!r.ok) throw new Error(`GitHub API ${path}: ${r.status} ${r.statusText}`)
  return r.json()
}

const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

// Collect workflow runs
const runs = await gh(
  `/repos/${repo}/actions/runs?per_page=100&created=>${since}`,
)

// For each run, pull the jobs and collect failed steps that reference a test file.
const testFailures = new Map() // key: "file:name" → count

for (const run of runs.workflow_runs ?? []) {
  if (!['completed', 'success', 'failure'].includes(run.status) && run.status !== 'completed')
    continue
  const jobs = await gh(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`)
  for (const job of jobs.jobs ?? []) {
    if (job.conclusion !== 'failure') continue
    for (const step of job.steps ?? []) {
      if (step.conclusion !== 'failure') continue
      // Best-effort: Playwright and Vitest step names include test file paths
      // as part of the failure output. For phase-1 we just record the job+step.
      const key = `${job.name}::${step.name}`
      testFailures.set(key, (testFailures.get(key) ?? 0) + 1)
    }
  }
}

const flaky = [...testFailures.entries()]
  .filter(([, count]) => count >= MIN_FAILURES)
  .map(([key, count]) => ({ key, count }))
  .sort((a, b) => b.count - a.count)

if (flaky.length === 0) {
  console.log('No flaky candidates found.')
  process.exit(0)
}

writeFileSync(
  'flaky-report.json',
  JSON.stringify({ window_days: WINDOW_DAYS, min_failures: MIN_FAILURES, flaky }, null, 2),
)
console.log(`Wrote flaky-report.json with ${flaky.length} candidates.`)
