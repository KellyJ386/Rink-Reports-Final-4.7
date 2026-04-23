import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  CUSTOM_UI_MODULE_SLUGS,
  DIRECTORY_TO_SLUG,
  MODULE_REGISTRY,
} from '@/app/modules/_registry'

/**
 * Agent 2 Phase 2 Seam 3 — submission registry filesystem self-test.
 *
 * Drift-prevention. Runs in the blocking `unit` job (no `continue-on-error`
 * above this file in CI). A new form-engine module ships alongside a
 * registry entry in the same PR, or this suite fails.
 *
 * Escape hatch: if a mid-flight refactor legitimately needs to land a commit
 * with drift visible to CI, include a line matching the following regex in
 * the PR body and the reviewer will interpret the failure as acknowledged:
 *
 *   ^Registry-Drift-Acknowledged: .+$
 *
 * Documented in `docs/agent-workflow.md`. Usage should be rare — if the
 * convention is wrong, fix the convention; don't keep acknowledging drift.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..')

function modulesDir(): string {
  return resolve(REPO_ROOT, 'app', 'modules')
}

function resolveFromRoot(relativePath: string): string {
  return resolve(REPO_ROOT, relativePath)
}

describe('Registry — every entry has a core-fields.ts on disk', () => {
  for (const entry of MODULE_REGISTRY) {
    for (const form of entry.forms) {
      const label = form.formType
        ? `${entry.slug}/${form.formType}`
        : entry.slug
      it(`${label}: ${form.coreFieldsPath} exists`, () => {
        const full = resolveFromRoot(form.coreFieldsPath)
        expect(existsSync(full), `expected core-fields at ${form.coreFieldsPath}`).toBe(true)
      })
    }
  }
})

describe('Registry — every core-fields.ts exports the three required symbols', () => {
  for (const entry of MODULE_REGISTRY) {
    for (const form of entry.forms) {
      const label = form.formType
        ? `${entry.slug}/${form.formType}`
        : entry.slug
      it(`${label}: declares coreFieldsZodSchema + coreFieldsRenderSpec + coreFieldsDbColumns`, () => {
        const src = readFileSync(resolveFromRoot(form.coreFieldsPath), 'utf8')
        // Grep-style check instead of importing — avoids pulling every module's
        // server-only code into the test runtime and makes failure messages
        // specific to which export is missing.
        expect(src, 'missing coreFieldsZodSchema').toMatch(/export\s+const\s+coreFieldsZodSchema\b/)
        expect(src, 'missing coreFieldsRenderSpec').toMatch(/export\s+const\s+coreFieldsRenderSpec\b/)
        expect(src, 'missing coreFieldsDbColumns').toMatch(/export\s+const\s+coreFieldsDbColumns\b/)
      })
    }
  }
})

describe('Registry — no orphan core-fields.ts files outside the registry', () => {
  it('every core-fields.ts under app/modules/ is accounted for in the registry', () => {
    const discovered = walkForCoreFields(modulesDir())
      .map((abs) => toRepoRelative(abs))
      .sort()

    const registered = new Set(
      MODULE_REGISTRY.flatMap((e) => e.forms.map((f) => f.coreFieldsPath)),
    )

    const orphans = discovered.filter((p) => !registered.has(p))
    expect(
      orphans,
      `core-fields.ts found on disk but not listed in app/modules/_registry.ts:\n  ${orphans.join('\n  ')}\n` +
        `If these are new modules, add entries to MODULE_REGISTRY. ` +
        `If the file is dead code, delete it.`,
    ).toEqual([])
  })
})

describe('Registry — slug invariants', () => {
  it('every slug is snake_case', () => {
    const invalid = MODULE_REGISTRY.filter((e) => !/^[a-z][a-z0-9_]*$/.test(e.slug))
    expect(invalid.map((e) => e.slug)).toEqual([])
  })

  it('every form_type is either null or snake_case', () => {
    const invalid: string[] = []
    for (const entry of MODULE_REGISTRY) {
      for (const form of entry.forms) {
        if (form.formType !== null && !/^[a-z][a-z0-9_]*$/.test(form.formType)) {
          invalid.push(`${entry.slug}:${form.formType}`)
        }
      }
    }
    expect(invalid).toEqual([])
  })

  it('slug set is unique', () => {
    const slugs = MODULE_REGISTRY.map((e) => e.slug)
    expect(slugs.length).toBe(new Set(slugs).size)
  })

  it('each entry has a unique (slug, formType) pair across its forms', () => {
    for (const entry of MODULE_REGISTRY) {
      const keys = entry.forms.map((f) => `${entry.slug}/${f.formType ?? 'null'}`)
      expect(
        keys.length,
        `duplicate form_types within ${entry.slug}`,
      ).toBe(new Set(keys).size)
    }
  })

  it('hasFormTypeColumn is true iff any form has a non-null formType', () => {
    for (const entry of MODULE_REGISTRY) {
      const hasAny = entry.forms.some((f) => f.formType !== null)
      expect(
        entry.hasFormTypeColumn,
        `${entry.slug}: hasFormTypeColumn=${entry.hasFormTypeColumn} but forms=${JSON.stringify(entry.forms.map((f) => f.formType))}`,
      ).toBe(hasAny)
    }
  })

  it('custom-UI slugs and registered slugs are disjoint', () => {
    const registered = new Set(MODULE_REGISTRY.map((e) => e.slug))
    const overlap = (CUSTOM_UI_MODULE_SLUGS as readonly string[]).filter((s) =>
      registered.has(s),
    )
    expect(overlap).toEqual([])
  })
})

describe('Registry — DIRECTORY_TO_SLUG mapping is consistent', () => {
  it('every top-level directory under app/modules/ that differs from its slug is mapped', () => {
    const dirs = readdirSync(modulesDir(), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)

    const allKnownSlugs = new Set<string>([
      ...MODULE_REGISTRY.map((e) => e.slug),
      ...CUSTOM_UI_MODULE_SLUGS,
    ])

    const unmapped: string[] = []
    for (const dir of dirs) {
      // Directory matches a slug directly — fine.
      if (allKnownSlugs.has(dir)) continue
      // Otherwise must be mapped
      if (!DIRECTORY_TO_SLUG[dir]) {
        unmapped.push(dir)
        continue
      }
      if (!allKnownSlugs.has(DIRECTORY_TO_SLUG[dir])) {
        unmapped.push(`${dir} → unknown slug ${DIRECTORY_TO_SLUG[dir]}`)
      }
    }

    expect(
      unmapped,
      `directories under app/modules/ with no slug mapping:\n  ${unmapped.join('\n  ')}`,
    ).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function walkForCoreFields(dir: string): string[] {
  const results: string[] = []
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const e of entries) {
    const abs = resolve(dir, e.name)
    if (e.isDirectory()) {
      results.push(...walkForCoreFields(abs))
    } else if (e.isFile() && e.name === 'core-fields.ts') {
      results.push(abs)
    }
  }
  return results
}

function toRepoRelative(absolutePath: string): string {
  // Normalize to forward slashes for cross-platform consistency in the test fixture
  return absolutePath.slice(REPO_ROOT.length + 1).replace(/\\/g, '/')
}
