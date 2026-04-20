import { describe, it, expect } from 'vitest'

import { validateFormSchema } from '@/lib/forms/meta-schema'

/**
 * Agent 2 engine-hardening — Vitest unit suite for the form-schema meta-schema.
 *
 * The meta-schema is load-bearing: every form_schemas.schema_definition write
 * gets validated against it at publish time. A gap here ships as corrupt data
 * that only surfaces when a staff member opens the form.
 *
 * Coverage goals:
 *   - All 11 field types accept a minimal valid definition
 *   - Each field type rejects an obviously-invalid shape
 *   - Option sources (inline / from_option_list / from_resource_type)
 *   - show_if accepted variants + forward-reference rejection
 *   - Duplicate-key detection across sections
 */

function wrap(fields: unknown[]): unknown {
  return {
    sections: [
      {
        key: 'main',
        label: 'Main',
        fields,
      },
    ],
  }
}

describe('validateFormSchema — minimal valid shapes per field type', () => {
  it('accepts text', () => {
    const r = validateFormSchema(wrap([{ key: 'notes', label: 'Notes', type: 'text' }]))
    expect(r.ok).toBe(true)
  })

  it('accepts textarea with rows', () => {
    const r = validateFormSchema(
      wrap([{ key: 'notes', label: 'Notes', type: 'textarea', rows: 4 }]),
    )
    expect(r.ok).toBe(true)
  })

  it('accepts number with bounds + unit', () => {
    const r = validateFormSchema(
      wrap([
        { key: 'depth', label: 'Depth', type: 'number', min: 0, max: 10, step: 0.1, unit: 'in' },
      ]),
    )
    expect(r.ok).toBe(true)
  })

  it('accepts boolean', () => {
    const r = validateFormSchema(wrap([{ key: 'ok', label: 'OK', type: 'boolean' }]))
    expect(r.ok).toBe(true)
  })

  it('accepts select with inline options', () => {
    const r = validateFormSchema(
      wrap([
        {
          key: 'color',
          label: 'Color',
          type: 'select',
          options: [
            { key: 'red', label: 'Red' },
            { key: 'blue', label: 'Blue' },
          ],
        },
      ]),
    )
    expect(r.ok).toBe(true)
  })

  it('accepts multiselect with from_option_list source', () => {
    const r = validateFormSchema(
      wrap([
        {
          key: 'equip',
          label: 'Equipment',
          type: 'multiselect',
          options: { from_option_list: 'equipment' },
        },
      ]),
    )
    expect(r.ok).toBe(true)
  })

  it('accepts radio with from_resource_type source', () => {
    const r = validateFormSchema(
      wrap([
        {
          key: 'surface',
          label: 'Surface',
          type: 'radio',
          options: { from_resource_type: 'ice_surface' },
        },
      ]),
    )
    expect(r.ok).toBe(true)
  })

  it('accepts date / time / datetime', () => {
    for (const type of ['date', 'time', 'datetime'] as const) {
      const r = validateFormSchema(wrap([{ key: `t_${type}`, label: `T`, type }]))
      expect(r.ok, `type ${type} should validate`).toBe(true)
    }
  })

  it('accepts slider with bounds', () => {
    const r = validateFormSchema(
      wrap([{ key: 'rating', label: 'Rating', type: 'slider', min: 0, max: 10, step: 1 }]),
    )
    expect(r.ok).toBe(true)
  })
})

describe('validateFormSchema — key + label invariants', () => {
  it('rejects non-snake_case field key', () => {
    const r = validateFormSchema(wrap([{ key: 'NotSnake', label: 'x', type: 'text' }]))
    expect(r.ok).toBe(false)
  })

  it('rejects empty label', () => {
    const r = validateFormSchema(wrap([{ key: 'k', label: '', type: 'text' }]))
    expect(r.ok).toBe(false)
  })

  it('rejects key starting with digit', () => {
    const r = validateFormSchema(wrap([{ key: '1field', label: 'x', type: 'text' }]))
    expect(r.ok).toBe(false)
  })
})

describe('validateFormSchema — option sources', () => {
  it('rejects empty inline options', () => {
    const r = validateFormSchema(
      wrap([{ key: 'c', label: 'C', type: 'select', options: [] }]),
    )
    expect(r.ok).toBe(false)
  })

  it('rejects unknown option-source key', () => {
    const r = validateFormSchema(
      wrap([{ key: 'c', label: 'C', type: 'select', options: { from_nothing: 'x' } }]),
    )
    expect(r.ok).toBe(false)
  })

  it('rejects select without options key', () => {
    const r = validateFormSchema(wrap([{ key: 'c', label: 'C', type: 'select' }]))
    expect(r.ok).toBe(false)
  })
})

describe('validateFormSchema — show_if', () => {
  it('accepts show_if with equals referencing a prior field', () => {
    const r = validateFormSchema({
      sections: [
        {
          key: 'main',
          label: 'Main',
          fields: [
            { key: 'triggered', label: 'Triggered', type: 'boolean' },
            {
              key: 'why',
              label: 'Why',
              type: 'text',
              show_if: { field: 'triggered', equals: true },
            },
          ],
        },
      ],
    })
    expect(r.ok).toBe(true)
  })

  it('accepts show_if with not_equals + in variants', () => {
    const r = validateFormSchema({
      sections: [
        {
          key: 'main',
          label: 'Main',
          fields: [
            { key: 'mode', label: 'Mode', type: 'text' },
            {
              key: 'a',
              label: 'A',
              type: 'text',
              show_if: { field: 'mode', not_equals: 'x' },
            },
            {
              key: 'b',
              label: 'B',
              type: 'text',
              show_if: { field: 'mode', in: ['x', 'y'] },
            },
          ],
        },
      ],
    })
    expect(r.ok).toBe(true)
  })

  it('rejects show_if referencing a later field (forward-ref)', () => {
    const r = validateFormSchema({
      sections: [
        {
          key: 'main',
          label: 'Main',
          fields: [
            {
              key: 'a',
              label: 'A',
              type: 'text',
              show_if: { field: 'b', equals: 'x' },
            },
            { key: 'b', label: 'B', type: 'text' },
          ],
        },
      ],
    })
    expect(r.ok).toBe(false)
  })

  it('rejects show_if with no matcher specified', () => {
    const r = validateFormSchema({
      sections: [
        {
          key: 'main',
          label: 'Main',
          fields: [
            { key: 'a', label: 'A', type: 'text' },
            {
              key: 'b',
              label: 'B',
              type: 'text',
              show_if: { field: 'a' },
            },
          ],
        },
      ],
    })
    expect(r.ok).toBe(false)
  })
})

describe('validateFormSchema — structural checks', () => {
  it('rejects duplicate field keys across sections', () => {
    const r = validateFormSchema({
      sections: [
        {
          key: 'one',
          label: 'One',
          fields: [{ key: 'dup', label: 'A', type: 'text' }],
        },
        {
          key: 'two',
          label: 'Two',
          fields: [{ key: 'dup', label: 'B', type: 'text' }],
        },
      ],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.some((e) => /duplicate/i.test(e.message))).toBe(true)
    }
  })

  it('rejects empty sections array', () => {
    const r = validateFormSchema({ sections: [] })
    expect(r.ok).toBe(false)
  })

  it('rejects section with empty fields array', () => {
    const r = validateFormSchema({
      sections: [{ key: 's', label: 'S', fields: [] }],
    })
    expect(r.ok).toBe(false)
  })

  it('surfaces errors as flat path + message pairs for admin UI', () => {
    const r = validateFormSchema(wrap([{ key: 'BAD', label: 'x', type: 'text' }]))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors).toBeInstanceOf(Array)
      expect(r.errors.length).toBeGreaterThan(0)
      expect(r.errors[0]).toHaveProperty('path')
      expect(r.errors[0]).toHaveProperty('message')
    }
  })
})
