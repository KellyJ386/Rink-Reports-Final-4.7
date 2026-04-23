import { describe, it, expect } from 'vitest'

import {
  buildProtectedKeys,
  collectFieldKeys,
  enforceKeyImmutability,
} from '@/lib/forms/key-immutability'
import type { FormSchemaDefinitionDoc } from '@/lib/forms/types'

/**
 * Agent 2 Phase 2 — key-immutability unit suite.
 *
 * The rule: any field key that has ever appeared in a published schema for a
 * given (facility, module, form_type) cannot be removed or renamed in a later
 * draft. Submissions reference custom_fields by key; dropping a key silently
 * breaks historical detail renders once the schema-history cycles out, and
 * even while intact it loses the ability to surface that field on new forms
 * (almost never what the admin intended — they meant "optional" or
 * "conditionally hidden").
 *
 * This suite covers the pure TS layer. DB-trigger enforcement is tracked as
 * hardening follow-up in KNOWN_GAPS.md.
 */

function doc(keys: string[]): FormSchemaDefinitionDoc {
  return {
    sections: [
      {
        key: 'main',
        label: 'Main',
        fields: keys.map((k) => ({ key: k, label: k, type: 'text' as const })),
      },
    ],
  }
}

function multiSectionDoc(sectionKeys: Record<string, string[]>): FormSchemaDefinitionDoc {
  return {
    sections: Object.entries(sectionKeys).map(([sectionKey, fieldKeys]) => ({
      key: sectionKey,
      label: sectionKey,
      fields: fieldKeys.map((k) => ({ key: k, label: k, type: 'text' as const })),
    })),
  }
}

describe('collectFieldKeys', () => {
  it('returns empty set for empty sections', () => {
    const d: FormSchemaDefinitionDoc = { sections: [{ key: 'main', label: 'Main', fields: [] }] }
    expect(collectFieldKeys(d).size).toBe(0)
  })

  it('collects keys from a single section', () => {
    const keys = collectFieldKeys(doc(['a', 'b', 'c']))
    expect([...keys].sort()).toEqual(['a', 'b', 'c'])
  })

  it('collects keys across multiple sections', () => {
    const keys = collectFieldKeys(
      multiSectionDoc({ first: ['a', 'b'], second: ['c', 'd'] }),
    )
    expect([...keys].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('deduplicates if the same key somehow appears twice (meta-schema forbids this, but the collector is defensive)', () => {
    const keys = collectFieldKeys(multiSectionDoc({ a: ['x'], b: ['x'] }))
    expect(keys.size).toBe(1)
  })
})

describe('buildProtectedKeys', () => {
  it('empty when no published and no history', () => {
    expect(buildProtectedKeys(null, []).size).toBe(0)
  })

  it('includes published keys when no history', () => {
    const keys = buildProtectedKeys(doc(['a', 'b']), [])
    expect([...keys].sort()).toEqual(['a', 'b'])
  })

  it('includes history keys when no current published (should not happen in practice but stays defensive)', () => {
    const keys = buildProtectedKeys(null, [doc(['old_a']), doc(['old_b'])])
    expect([...keys].sort()).toEqual(['old_a', 'old_b'])
  })

  it('unions published + history', () => {
    const keys = buildProtectedKeys(doc(['current']), [
      doc(['v1_key']),
      doc(['v2_key', 'current']),
    ])
    expect([...keys].sort()).toEqual(['current', 'v1_key', 'v2_key'])
  })

  it('a key that lived in v1, was renamed in v2, is still protected — the v1 key is in history', () => {
    // v1 had "pressure". v2 renamed it to "tank_pressure" (wrong move!). Published is v2.
    // The correct system-wide response would have rejected the v2 save/publish.
    // Here we just assert the protected set captures both, so any future draft
    // trying to drop either will be rejected.
    const keys = buildProtectedKeys(doc(['tank_pressure']), [doc(['pressure'])])
    expect([...keys].sort()).toEqual(['pressure', 'tank_pressure'])
  })
})

describe('enforceKeyImmutability', () => {
  it('empty errors when draft preserves every protected key', () => {
    const protectedKeys = new Set(['a', 'b'])
    const draft = doc(['a', 'b', 'c']) // adding new is fine
    expect(enforceKeyImmutability(draft, protectedKeys)).toEqual([])
  })

  it('reports one error when draft removes a protected key', () => {
    const protectedKeys = new Set(['a', 'b'])
    const draft = doc(['a']) // b dropped
    const errs = enforceKeyImmutability(draft, protectedKeys)
    expect(errs).toHaveLength(1)
    expect(errs[0].key).toBe('b')
    expect(errs[0].message).toMatch(/previously published/)
    expect(errs[0].message).toMatch(/show_if/) // points admin to the workaround
  })

  it('reports multiple errors when draft drops multiple protected keys', () => {
    const protectedKeys = new Set(['a', 'b', 'c'])
    const draft = doc(['a']) // b, c dropped
    const errs = enforceKeyImmutability(draft, protectedKeys)
    expect(errs.map((e) => e.key).sort()).toEqual(['b', 'c'])
  })

  it('treats a rename as a remove (the old key is gone)', () => {
    // Rename "pressure" → "tank_pressure" looks like: new draft has "tank_pressure",
    // no "pressure". The enforcer sees "pressure" missing.
    const protectedKeys = new Set(['pressure'])
    const draft = doc(['tank_pressure'])
    const errs = enforceKeyImmutability(draft, protectedKeys)
    expect(errs).toHaveLength(1)
    expect(errs[0].key).toBe('pressure')
  })

  it('allows additions alongside preservation', () => {
    const protectedKeys = new Set(['pressure', 'temperature'])
    const draft = doc(['pressure', 'temperature', 'humidity'])
    expect(enforceKeyImmutability(draft, protectedKeys)).toEqual([])
  })

  it('allows moving a key between sections (same key, different section)', () => {
    // The rule is about the key, not its section. A move should pass.
    const protectedKeys = new Set(['pressure'])
    const draft = multiSectionDoc({ section_a: [], section_b: ['pressure'] })
    expect(enforceKeyImmutability(draft, protectedKeys)).toEqual([])
  })

  it('allows reordering within a section', () => {
    const protectedKeys = new Set(['a', 'b', 'c'])
    const draft = doc(['c', 'a', 'b'])
    expect(enforceKeyImmutability(draft, protectedKeys)).toEqual([])
  })

  it('empty protected set accepts any draft (brand-new schema has no history)', () => {
    const errs = enforceKeyImmutability(doc(['anything', 'goes']), new Set())
    expect(errs).toEqual([])
  })
})

describe('realistic admin-retirement flow', () => {
  // Context: admin wants to retire "visitor_count" field. The correct path is
  // mark it optional + hide via show_if. Removing it outright should fail.
  const protectedKeys = new Set(['checklist_done', 'visitor_count', 'notes'])

  it('removing the field outright → error', () => {
    const draft = doc(['checklist_done', 'notes'])
    const errs = enforceKeyImmutability(draft, protectedKeys)
    expect(errs).toHaveLength(1)
    expect(errs[0].key).toBe('visitor_count')
  })

  it('keeping the field and toggling required off → allowed (key still present)', () => {
    const draft: FormSchemaDefinitionDoc = {
      sections: [
        {
          key: 'main',
          label: 'Main',
          fields: [
            { key: 'checklist_done', label: 'Done?', type: 'boolean' },
            // required dropped from true → false; key preserved
            { key: 'visitor_count', label: 'Visitors', type: 'number' },
            { key: 'notes', label: 'Notes', type: 'text' },
          ],
        },
      ],
    }
    expect(enforceKeyImmutability(draft, protectedKeys)).toEqual([])
  })
})
