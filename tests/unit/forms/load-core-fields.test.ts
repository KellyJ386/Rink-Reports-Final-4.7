import { describe, it, expect } from 'vitest'

import { loadCoreFields } from '@/lib/forms/load-core-fields'

/**
 * Agent 2 post-Phase-2 hardening — loadCoreFields registry-backed resolution.
 *
 * Before this pass, loadCoreFields derived its import path from the raw
 * `moduleSlug` argument (snake_case), which failed at resolve time for every
 * multi-word module and every Ice Maintenance form_type because the on-disk
 * directories are kebab-case. See the KNOWN_GAPS.md entry struck through in
 * this PR.
 *
 * Now: the registry (app/modules/_registry.ts) is the source of truth for
 * both the slug → DB identity and the slug → filesystem directory.
 *
 * Coverage:
 *   - Unregistered slug → clear error with pointer to the registry file.
 *   - Single-form registered module → module loads with the three symbols.
 *   - Multi-word single-form module (air_quality) → loads despite kebab dir.
 *   - Multi-form module (ice_maintenance, circle_check) → loads despite
 *     both levels of kebab-snake mismatch.
 *   - Missing form_type on a multi-form module → clear error.
 *
 * The registry-filesystem test already proves each committed entry has a
 * file and exports the three symbols; these tests prove the runtime lookup
 * consumes the registry and handles not-found paths cleanly.
 */

describe('loadCoreFields — registry misses', () => {
  it('unknown slug returns a clear error pointing at the registry file', async () => {
    await expect(loadCoreFields('not_a_real_module', null)).rejects.toThrow(
      /no registry entry.*not_a_real_module.*_registry\.ts/,
    )
  })

  it('missing form_type on a multi-form module errors with the pair in the message', async () => {
    await expect(loadCoreFields('ice_maintenance', null)).rejects.toThrow(
      /no registry entry.*ice_maintenance/,
    )
  })

  it('unknown form_type on a registered multi-form module errors', async () => {
    await expect(
      loadCoreFields('ice_maintenance', 'not_a_real_form_type'),
    ).rejects.toThrow(/no registry entry.*ice_maintenance.*not_a_real_form_type/)
  })

  it('providing a form_type to a single-form module errors (no match in registry)', async () => {
    // `accident` is single-form (formType: null). Passing 'anything' finds no row.
    await expect(loadCoreFields('accident', 'anything')).rejects.toThrow(
      /no registry entry.*accident/,
    )
  })
})

describe('loadCoreFields — registered modules resolve with three exports', () => {
  it('accident (single-word slug, single-form) loads', async () => {
    const mod = await loadCoreFields('accident', null)
    expect(mod.coreFieldsZodSchema).toBeDefined()
    expect(Array.isArray(mod.coreFieldsRenderSpec)).toBe(true)
    expect(Array.isArray(mod.coreFieldsDbColumns)).toBe(true)
  })

  it('air_quality (multi-word slug, kebab on-disk) loads — was broken pre-registry', async () => {
    const mod = await loadCoreFields('air_quality', null)
    expect(mod.coreFieldsZodSchema).toBeDefined()
    expect(Array.isArray(mod.coreFieldsRenderSpec)).toBe(true)
    expect(Array.isArray(mod.coreFieldsDbColumns)).toBe(true)
  })

  it('ice_maintenance/circle_check (multi-word, multi-form, both kebab) loads', async () => {
    const mod = await loadCoreFields('ice_maintenance', 'circle_check')
    expect(mod.coreFieldsZodSchema).toBeDefined()
    expect(Array.isArray(mod.coreFieldsRenderSpec)).toBe(true)
    expect(Array.isArray(mod.coreFieldsDbColumns)).toBe(true)
  })

  it('incident (single-word, single-form) loads', async () => {
    const mod = await loadCoreFields('incident', null)
    expect(mod.coreFieldsZodSchema).toBeDefined()
    expect(Array.isArray(mod.coreFieldsRenderSpec)).toBe(true)
  })

  it('refrigeration (single-word, single-form) loads', async () => {
    const mod = await loadCoreFields('refrigeration', null)
    expect(mod.coreFieldsZodSchema).toBeDefined()
    expect(Array.isArray(mod.coreFieldsRenderSpec)).toBe(true)
  })

  it('all four ice_maintenance form_types load', async () => {
    for (const formType of ['circle_check', 'ice_make', 'blade_change', 'edging']) {
      const mod = await loadCoreFields('ice_maintenance', formType)
      expect(mod.coreFieldsZodSchema, `${formType}: zod schema`).toBeDefined()
      expect(Array.isArray(mod.coreFieldsRenderSpec), `${formType}: render spec`).toBe(true)
      expect(Array.isArray(mod.coreFieldsDbColumns), `${formType}: db columns`).toBe(true)
    }
  })
})
