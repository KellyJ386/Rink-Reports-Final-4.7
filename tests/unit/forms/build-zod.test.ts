import { describe, it, expect } from 'vitest'

import { buildZodFromSchema, evaluateShowIf } from '@/lib/forms/build-zod'
import type { ResolvedSectionSpec } from '@/lib/forms/types'

/**
 * Agent 2 engine-hardening — Vitest unit suite for Zod builder.
 *
 * Covers the interaction between `required`, `show_if` visibility, and field
 * type-specific validation (number bounds, slider bounds, enum keys). A bug
 * here ships as either a required field silently accepted empty, or a
 * hidden-field validation that blocks a legitimate submit.
 */

function section(fields: ResolvedSectionSpec['fields']): ResolvedSectionSpec[] {
  return [{ key: 'main', label: 'Main', fields }]
}

describe('buildZodFromSchema — required field enforcement', () => {
  it('required text rejects empty string', () => {
    const schema = buildZodFromSchema(
      section([{ key: 'notes', label: 'Notes', type: 'text', required: true }]),
    )
    const r = schema.safeParse({ notes: '' })
    expect(r.success).toBe(false)
  })

  it('optional text accepts empty string', () => {
    const schema = buildZodFromSchema(
      section([{ key: 'notes', label: 'Notes', type: 'text', required: false }]),
    )
    const r = schema.safeParse({ notes: '' })
    expect(r.success).toBe(true)
  })

  it('required number rejects missing value', () => {
    const schema = buildZodFromSchema(
      section([{ key: 'depth', label: 'Depth', type: 'number', required: true }]),
    )
    const r = schema.safeParse({})
    expect(r.success).toBe(false)
  })

  it('number enforces min / max bounds', () => {
    const schema = buildZodFromSchema(
      section([
        { key: 'depth', label: 'Depth', type: 'number', required: true, min: 0, max: 10 },
      ]),
    )
    expect(schema.safeParse({ depth: -1 }).success).toBe(false)
    expect(schema.safeParse({ depth: 5 }).success).toBe(true)
    expect(schema.safeParse({ depth: 11 }).success).toBe(false)
  })

  it('slider enforces min / max like number', () => {
    const schema = buildZodFromSchema(
      section([
        { key: 'r', label: 'R', type: 'slider', required: true, min: 1, max: 5 },
      ]),
    )
    expect(schema.safeParse({ r: 0 }).success).toBe(false)
    expect(schema.safeParse({ r: 3 }).success).toBe(true)
    expect(schema.safeParse({ r: 6 }).success).toBe(false)
  })

  it('select with inline options rejects unknown key', () => {
    const schema = buildZodFromSchema(
      section([
        {
          key: 'color',
          label: 'Color',
          type: 'select',
          required: true,
          options: [
            { key: 'red', label: 'Red' },
            { key: 'blue', label: 'Blue' },
          ],
        },
      ]),
    )
    expect(schema.safeParse({ color: 'green' }).success).toBe(false)
    expect(schema.safeParse({ color: 'red' }).success).toBe(true)
  })

  it('multiselect accepts array of known keys, rejects unknowns', () => {
    const schema = buildZodFromSchema(
      section([
        {
          key: 'flags',
          label: 'Flags',
          type: 'multiselect',
          required: false,
          options: [
            { key: 'a', label: 'A' },
            { key: 'b', label: 'B' },
          ],
        },
      ]),
    )
    expect(schema.safeParse({ flags: ['a', 'b'] }).success).toBe(true)
    expect(schema.safeParse({ flags: ['a', 'x'] }).success).toBe(false)
  })

  it('required multiselect needs at least one selection', () => {
    const schema = buildZodFromSchema(
      section([
        {
          key: 'flags',
          label: 'Flags',
          type: 'multiselect',
          required: true,
          options: [{ key: 'a', label: 'A' }],
        },
      ]),
    )
    expect(schema.safeParse({ flags: [] }).success).toBe(false)
    expect(schema.safeParse({ flags: ['a'] }).success).toBe(true)
  })
})

describe('buildZodFromSchema — show_if visibility hides required-check', () => {
  it('hidden required field is not required when show_if is false', () => {
    const schema = buildZodFromSchema(
      section([
        { key: 'triggered', label: 'Triggered', type: 'boolean', required: false },
        {
          key: 'why',
          label: 'Why',
          type: 'text',
          required: true,
          show_if: { field: 'triggered', equals: true },
        },
      ]),
    )
    expect(schema.safeParse({ triggered: false }).success).toBe(true)
  })

  it('visible required field still required when show_if is true', () => {
    const schema = buildZodFromSchema(
      section([
        { key: 'triggered', label: 'Triggered', type: 'boolean', required: false },
        {
          key: 'why',
          label: 'Why',
          type: 'text',
          required: true,
          show_if: { field: 'triggered', equals: true },
        },
      ]),
    )
    expect(schema.safeParse({ triggered: true, why: '' }).success).toBe(false)
    expect(schema.safeParse({ triggered: true, why: 'reason' }).success).toBe(true)
  })
})

describe('evaluateShowIf — predicate correctness', () => {
  it('equals: matches exactly', () => {
    expect(evaluateShowIf({ field: 'x', equals: 'a' }, { x: 'a' })).toBe(true)
    expect(evaluateShowIf({ field: 'x', equals: 'a' }, { x: 'b' })).toBe(false)
  })

  it('not_equals: true when value differs or missing', () => {
    expect(evaluateShowIf({ field: 'x', not_equals: 'a' }, { x: 'b' })).toBe(true)
    expect(evaluateShowIf({ field: 'x', not_equals: 'a' }, { x: 'a' })).toBe(false)
  })

  it('in: matches membership', () => {
    expect(evaluateShowIf({ field: 'x', in: ['a', 'b'] }, { x: 'a' })).toBe(true)
    expect(evaluateShowIf({ field: 'x', in: ['a', 'b'] }, { x: 'c' })).toBe(false)
  })

  it('not_equals takes precedence over undefined equals (regression)', () => {
    // Regression test for a bug where `'equals' in cond` was always true for
    // Zod-parsed optional fields — causing not_equals conditions to evaluate
    // as "v === undefined" and fire only when the dep field was unset.
    //
    // The fix uses cond.equals !== undefined checks, not `in` operator checks.
    const cond = { field: 'x', not_equals: 'skip' }
    expect(evaluateShowIf(cond, { x: 'anything' })).toBe(true)
    expect(evaluateShowIf(cond, { x: 'skip' })).toBe(false)
  })
})

describe('buildZodFromSchema — date / time / datetime', () => {
  it('accepts well-formed strings', () => {
    const schema = buildZodFromSchema(
      section([
        { key: 'd', label: 'D', type: 'date', required: true },
        { key: 't', label: 'T', type: 'time', required: true },
        { key: 'dt', label: 'DT', type: 'datetime', required: true },
      ]),
    )
    const r = schema.safeParse({ d: '2026-04-20', t: '09:00', dt: '2026-04-20T09:00:00Z' })
    expect(r.success).toBe(true)
  })

  it('required date rejects empty string', () => {
    const schema = buildZodFromSchema(
      section([{ key: 'd', label: 'D', type: 'date', required: true }]),
    )
    expect(schema.safeParse({ d: '' }).success).toBe(false)
  })
})
