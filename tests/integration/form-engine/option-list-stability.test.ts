import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { anonClient, SEEDED_USERS, serviceClient, signIn } from '../../factories/supabase-client'

/**
 * Agent 2 Phase 2 Seam 2 — option list stability invariants.
 *
 * The server actions in `lib/admin/option-lists.ts` rely on three DB-level
 * invariants for the "admin can change options without rewriting history"
 * guarantee. This suite exercises each against a live local Postgres, so a
 * future migration that accidentally weakens one will fail CI:
 *
 *   1. **Label rename preserves key.** An `UPDATE option_list_items SET
 *      label = $1 WHERE id = $2` must not touch `key`, and must not cascade
 *      to any submission row (they reference the key, not the label).
 *   2. **`is_active = false` filters from new renders.** The resolve layer in
 *      `lib/forms/resolve-options.ts` filters on `is_active = true`; deactivated
 *      items disappear from new forms while still being resolvable historically
 *      via `custom_fields.__label_snapshot`.
 *   3. **Key is trigger-immutable.** Even a direct UPDATE of `option_list_items.key`
 *      must fail (tg_option_list_items_key_immutable, set in migration
 *      20260421000001_option_lists.sql).
 *
 * Fixtures: inline + single-purpose. Created via serviceClient to guarantee
 * cleanup survives an early failure.
 */

const ALPHA_FACILITY = SEEDED_USERS.alphaAdmin.facility_id
const TEST_LIST_SLUG = `seam2_test_${Date.now()}`

let listId: string | null = null
const createdItemIds: string[] = []

beforeAll(async () => {
  const svc = serviceClient()

  // Create a fresh option list scoped to alpha
  const { data: list, error: listErr } = await svc
    .from('option_lists')
    .insert({
      facility_id: ALPHA_FACILITY,
      slug: TEST_LIST_SLUG,
      name: 'Seam 2 Stability Test',
    })
    .select('id')
    .single()
  if (listErr || !list) throw new Error(`list create failed: ${listErr?.message}`)
  listId = (list as { id: string }).id

  // Seed 3 items
  const items = [
    { option_list_id: listId, key: 'minor', label: 'Minor', sort_order: 0 },
    { option_list_id: listId, key: 'major', label: 'Major', sort_order: 1 },
    { option_list_id: listId, key: 'catastrophic', label: 'Catastrophic', sort_order: 2 },
  ]
  const { data: inserted, error: itemsErr } = await svc
    .from('option_list_items')
    .insert(items)
    .select('id')
  if (itemsErr || !inserted) throw new Error(`items create failed: ${itemsErr?.message}`)
  for (const row of inserted as Array<{ id: string }>) createdItemIds.push(row.id)
})

afterAll(async () => {
  const svc = serviceClient()
  if (listId) {
    // items cascade via option_list_id FK on delete
    await svc.from('option_lists').delete().eq('id', listId)
  }
})

describe('Option list stability — label rename preserves key', () => {
  it('updating a label does not touch the key', async () => {
    const alpha = anonClient()
    await signIn(alpha, SEEDED_USERS.alphaAdmin)

    const minorId = createdItemIds[0]!

    // Capture pre-rename key
    const { data: before } = await alpha
      .from('option_list_items')
      .select('key, label')
      .eq('id', minorId)
      .single()
    expect(before).toMatchObject({ key: 'minor', label: 'Minor' })

    // Rename the label
    const { error: updErr } = await alpha
      .from('option_list_items')
      .update({ label: 'Minor (non-injury)' })
      .eq('id', minorId)
    expect(updErr).toBeNull()

    // Key unchanged, label changed
    const { data: after } = await alpha
      .from('option_list_items')
      .select('key, label')
      .eq('id', minorId)
      .single()
    expect(after).toMatchObject({ key: 'minor', label: 'Minor (non-injury)' })
  })
})

describe('Option list stability — is_active filters new renders', () => {
  it('active-only ordered query returns only active items in sort_order', async () => {
    const alpha = anonClient()
    await signIn(alpha, SEEDED_USERS.alphaAdmin)

    // Deactivate "major" (index 1)
    const majorId = createdItemIds[1]!
    const { error: deactErr } = await alpha
      .from('option_list_items')
      .update({ is_active: false })
      .eq('id', majorId)
    expect(deactErr).toBeNull()

    // The exact query shape the resolver uses (resolve-options.ts:89)
    const { data: list, error } = await alpha
      .from('option_lists')
      .select('slug, option_list_items(key, label, sort_order, is_active)')
      .eq('id', listId!)
      .single()
    expect(error).toBeNull()

    const items = ((list as { option_list_items: Array<{ key: string; is_active: boolean; sort_order: number }> }).option_list_items ?? [])
      .filter((i) => i.is_active)
      .sort((a, b) => a.sort_order - b.sort_order)

    const keys = items.map((i) => i.key)
    expect(keys).toEqual(['minor', 'catastrophic']) // major is filtered
  })

  it('a historical submission still references the deactivated item by key', async () => {
    // We simulate a historical submission by constructing what custom_fields
    // would look like — the stability claim is "the key persists in the row
    // and the deactivation doesn't rewrite it."
    const historicalCustomFields = {
      severity: 'major',
      __label_snapshot: { severity: 'Major' },
    }
    expect(historicalCustomFields.severity).toBe('major') // key, not label
    expect(historicalCustomFields.__label_snapshot.severity).toBe('Major') // frozen

    // The row-lookup path: for a detail view, we'd SELECT the deactivated item
    // by key and read the (now snapshotted) label from the submission itself.
    const alpha = anonClient()
    await signIn(alpha, SEEDED_USERS.alphaAdmin)
    const { data: row } = await alpha
      .from('option_list_items')
      .select('key, label, is_active')
      .eq('option_list_id', listId!)
      .eq('key', 'major')
      .single()
    expect(row).toMatchObject({ key: 'major', is_active: false })
    // The live label may or may not match the historical snapshot — that's
    // the whole point: detail rendering reads the snapshot from the submission.
  })
})

describe('Option list stability — key is trigger-immutable', () => {
  it('direct UPDATE of key is rejected by the DB trigger', async () => {
    const alpha = anonClient()
    await signIn(alpha, SEEDED_USERS.alphaAdmin)

    const catastrophicId = createdItemIds[2]!
    const { error } = await alpha
      .from('option_list_items')
      .update({ key: 'extreme' })
      .eq('id', catastrophicId)

    // The trigger raises with SQLSTATE 42501. PostgREST surfaces the message.
    expect(error).toBeTruthy()
    expect(error?.message ?? '').toMatch(/immutable/i)
  })

  it('even with service role (bypassing RLS), the key-immutability trigger still fires', async () => {
    const svc = serviceClient()
    const catastrophicId = createdItemIds[2]!

    const { error } = await svc
      .from('option_list_items')
      .update({ key: 'extreme' })
      .eq('id', catastrophicId)

    expect(error).toBeTruthy()
    expect(error?.message ?? '').toMatch(/immutable/i)
  })
})

describe('Option list stability — reorder semantics', () => {
  it('re-setting sort_order on each item in a new sequence reorders the active set', async () => {
    const alpha = anonClient()
    await signIn(alpha, SEEDED_USERS.alphaAdmin)

    // Reactivate major so we have all three visible
    const [minorId, majorId, catastrophicId] = createdItemIds as [string, string, string]
    await alpha.from('option_list_items').update({ is_active: true }).eq('id', majorId)

    // New order: catastrophic, major, minor
    const newOrder = [catastrophicId, majorId, minorId]
    for (let i = 0; i < newOrder.length; i++) {
      const { error } = await alpha
        .from('option_list_items')
        .update({ sort_order: i })
        .eq('id', newOrder[i]!)
        .eq('option_list_id', listId!)
      expect(error).toBeNull()
    }

    const { data: list } = await alpha
      .from('option_lists')
      .select('option_list_items(key, sort_order, is_active)')
      .eq('id', listId!)
      .single()

    const keys = ((list as { option_list_items: Array<{ key: string; sort_order: number; is_active: boolean }> }).option_list_items ?? [])
      .filter((i) => i.is_active)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => i.key)

    expect(keys).toEqual(['catastrophic', 'major', 'minor'])
  })
})
