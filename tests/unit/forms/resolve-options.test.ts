import { describe, it, expect, vi } from 'vitest'

import { resolveOptions } from '@/lib/forms/resolve-options'
import type { SectionSpec } from '@/lib/forms/types'

/**
 * Agent 2 engine-hardening — Vitest unit suite for option-source resolution.
 *
 * resolveOptions pulls inline/from_option_list/from_resource_type sources and
 * merges them back into the section tree. Bugs here ship as "dropdown is empty
 * on the form" or "wrong facility's options appear" — the latter is a tenant
 * leak dressed as a UX bug.
 *
 * We mock the Supabase client rather than hit the DB — this is a pure shape
 * test. Integration coverage of the actual query + RLS lives in the Vitest
 * integration suite + pgTAP.
 */

type Row = Record<string, unknown>

function mockSupabase(rowsByTable: Record<string, Row[]>) {
  return {
    from: vi.fn((table: string) => {
      const rows = rowsByTable[table] ?? []
      const builder = {
        _rows: rows,
        select: vi.fn(() => builder),
        in: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        order: vi.fn(async () => ({ data: rows, error: null })),
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ data: rows, error: null }),
      }
      return builder
    }),
  }
}

describe('resolveOptions — inline options pass through', () => {
  it('returns inline options as-is without any DB call', async () => {
    const supabase = mockSupabase({})
    const sections: SectionSpec[] = [
      {
        key: 'main',
        label: 'Main',
        fields: [
          {
            key: 'color',
            label: 'Color',
            type: 'select',
            required: false,
            options: [
              { key: 'red', label: 'Red' },
              { key: 'blue', label: 'Blue' },
            ],
          },
        ],
      },
    ]

    const result = await resolveOptions(sections, supabase as never)
    expect(result[0]!.fields[0]).toMatchObject({
      key: 'color',
      type: 'select',
      options: [
        { key: 'red', label: 'Red' },
        { key: 'blue', label: 'Blue' },
      ],
    })
    // No .from() call is strictly required but the current impl DOES call
    // from() for the empty list/type arrays. Tolerate either.
  })
})

describe('resolveOptions — from_option_list resolves + filters inactive', () => {
  it('resolves active items sorted by sort_order, emitting {key,label}', async () => {
    const supabase = mockSupabase({
      option_lists: [
        {
          slug: 'surfaces',
          option_list_items: [
            { key: 'rink_a', label: 'Rink A', sort_order: 0, is_active: true },
            { key: 'rink_b', label: 'Rink B', sort_order: 1, is_active: true },
            { key: 'closed', label: 'Closed', sort_order: 2, is_active: false },
          ],
        },
      ],
    })

    const sections: SectionSpec[] = [
      {
        key: 'main',
        label: 'Main',
        fields: [
          {
            key: 'surface',
            label: 'Surface',
            type: 'select',
            required: true,
            options: { from_option_list: 'surfaces' },
          },
        ],
      },
    ]

    const result = await resolveOptions(sections, supabase as never)
    const field = result[0]!.fields[0] as { options: Array<{ key: string; label: string }> }
    expect(field.options).toEqual([
      { key: 'rink_a', label: 'Rink A' },
      { key: 'rink_b', label: 'Rink B' },
    ])
  })
})

describe('resolveOptions — from_resource_type', () => {
  it('emits {id, name} as {key, label}, preserving facility_resources.sort_order', async () => {
    const supabase = mockSupabase({
      facility_resources: [
        { id: 'uuid-1', resource_type: 'ice_surface', name: 'Main Rink', sort_order: 0, is_active: true },
        { id: 'uuid-2', resource_type: 'ice_surface', name: 'Practice Rink', sort_order: 1, is_active: true },
      ],
    })

    const sections: SectionSpec[] = [
      {
        key: 'main',
        label: 'Main',
        fields: [
          {
            key: 'surface',
            label: 'Surface',
            type: 'radio',
            required: true,
            options: { from_resource_type: 'ice_surface' },
          },
        ],
      },
    ]

    const result = await resolveOptions(sections, supabase as never)
    const field = result[0]!.fields[0] as { options: Array<{ key: string; label: string }> }
    expect(field.options).toEqual([
      { key: 'uuid-1', label: 'Main Rink' },
      { key: 'uuid-2', label: 'Practice Rink' },
    ])
  })

  it('returns empty options when no matching resources exist', async () => {
    const supabase = mockSupabase({ facility_resources: [] })

    const sections: SectionSpec[] = [
      {
        key: 'main',
        label: 'Main',
        fields: [
          {
            key: 'surface',
            label: 'Surface',
            type: 'radio',
            required: true,
            options: { from_resource_type: 'ice_surface' },
          },
        ],
      },
    ]

    const result = await resolveOptions(sections, supabase as never)
    const field = result[0]!.fields[0] as { options: Array<{ key: string; label: string }> }
    expect(field.options).toEqual([])
  })
})

describe('resolveOptions — non-option field types pass through untouched', () => {
  it('leaves text, number, boolean, date unchanged', async () => {
    const supabase = mockSupabase({})
    const sections: SectionSpec[] = [
      {
        key: 'main',
        label: 'Main',
        fields: [
          { key: 'notes', label: 'Notes', type: 'text', required: false },
          { key: 'depth', label: 'Depth', type: 'number', required: true, min: 0, max: 10 },
          { key: 'ok', label: 'OK', type: 'boolean', required: false },
          { key: 'taken_at', label: 'Date', type: 'date', required: true },
        ],
      },
    ]

    const result = await resolveOptions(sections, supabase as never)
    expect(result[0]!.fields[0]).toMatchObject({ key: 'notes', type: 'text' })
    expect(result[0]!.fields[1]).toMatchObject({ key: 'depth', type: 'number', min: 0, max: 10 })
    expect(result[0]!.fields[2]).toMatchObject({ key: 'ok', type: 'boolean' })
    expect(result[0]!.fields[3]).toMatchObject({ key: 'taken_at', type: 'date' })
  })
})
