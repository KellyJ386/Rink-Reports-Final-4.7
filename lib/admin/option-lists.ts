import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Admin server actions for Option Lists and Option List Items.
 *
 * Seam 2 of Agent 2 Phase 2 graduates Phase 1's basic mutators to full
 * editor-contract quality:
 *   - explicit admin gate up-front (defense in depth over RLS)
 *   - audit log entry on every mutation path
 *   - dedicated semantic wrappers (rename / deactivate / reorder) so the
 *     admin UI doesn't need to reconstruct intent from patch shapes
 *
 * Invariants this file relies on (set up in Phase 1 and outside its scope
 * to re-establish):
 *   - `option_list_items.key` is trigger-immutable at the DB layer
 *     (tg_option_list_items_key_immutable); even if a caller bypasses this
 *     layer, the DB will reject. We do not accept `key` in the update patch.
 *   - `resolve-options.ts` filters by `is_active = true` when materializing
 *     options for new form renders. Historical submissions keep their label
 *     via `custom_fields.__label_snapshot` and so are unaffected by
 *     deactivation or rename.
 *
 * Delete-safety rule (unchanged from Phase 1): scan ONLY published schemas
 * (form_schemas.schema_definition) for `from_option_list: "<slug>"` refs.
 * Drafts are discardable — don't block a delete on someone's stale draft.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

type Supabase = Awaited<ReturnType<typeof createClient>>

async function requireAdmin(
  supabase: Supabase,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('has_module_access', {
    p_module_slug: 'admin_control_center',
    p_required_level: 'admin',
  })
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'Admin access required' }
  return { ok: true }
}

async function currentFacilityId(supabase: Supabase): Promise<string | null> {
  const { data } = await supabase.rpc('current_facility_id')
  return (data as string | null) ?? null
}

async function currentUserId(supabase: Supabase): Promise<string | null> {
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

/**
 * Write an audit_log row for an option-list mutation. Failures surface to
 * the caller — we do NOT swallow audit write errors, because an untracked
 * admin mutation is exactly the class of thing this table exists for.
 */
async function writeAudit(
  supabase: Supabase,
  params: {
    action: string
    entity_type: 'option_list' | 'option_list_item'
    entity_id: string
    metadata?: Record<string, unknown>
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [facilityId, userId] = await Promise.all([
    currentFacilityId(supabase),
    currentUserId(supabase),
  ])
  const { error } = await supabase.from('audit_log').insert({
    facility_id: facilityId,
    actor_user_id: userId,
    action: params.action,
    entity_type: params.entity_type,
    entity_id: params.entity_id,
    metadata: params.metadata ?? {},
  })
  if (error) return { ok: false, error: `audit write failed: ${error.message}` }
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Option Lists
// ─────────────────────────────────────────────────────────────────────────────

export async function createOptionList(input: {
  slug: string
  name: string
  description?: string
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!/^[a-z][a-z0-9_]*$/.test(input.slug)) {
    return {
      ok: false,
      error: 'Slug must be snake_case (lowercase letters, digits, underscores).',
    }
  }
  if (input.name.trim().length === 0) {
    return { ok: false, error: 'Name is required.' }
  }

  const supabase = await createClient()
  const gate = await requireAdmin(supabase)
  if (!gate.ok) return gate

  const { data, error } = await supabase
    .from('option_lists')
    .insert({
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }

  const audit = await writeAudit(supabase, {
    action: 'option_list.created',
    entity_type: 'option_list',
    entity_id: data.id as string,
    metadata: { slug: input.slug, name: input.name },
  })
  if (!audit.ok) return { ok: false, error: audit.error }

  return { ok: true, id: data.id as string }
}

export async function updateOptionList(
  id: string,
  patch: { name?: string; description?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Slug is immutable by convention (Phase 1). We don't accept it in the patch.
  if (patch.name !== undefined && patch.name.trim().length === 0) {
    return { ok: false, error: 'Name cannot be blank.' }
  }

  const supabase = await createClient()
  const gate = await requireAdmin(supabase)
  if (!gate.ok) return gate

  const { error } = await supabase.from('option_lists').update(patch).eq('id', id)
  if (error) return { ok: false, error: error.message }

  const audit = await writeAudit(supabase, {
    action: 'option_list.updated',
    entity_type: 'option_list',
    entity_id: id,
    metadata: patch,
  })
  if (!audit.ok) return { ok: false, error: audit.error }

  return { ok: true }
}

export async function deleteOptionList(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string; references?: string[] }> {
  const supabase = await createClient()
  const gate = await requireAdmin(supabase)
  if (!gate.ok) return gate

  const { data: list } = await supabase
    .from('option_lists')
    .select('slug')
    .eq('id', id)
    .maybeSingle()
  if (!list) return { ok: false, error: 'Option list not found' }

  const refs = await scanPublishedSchemasForOptionListSlug(supabase, list.slug as string)
  if (refs.length > 0) {
    return {
      ok: false,
      error: 'Cannot delete: published form schemas reference this list.',
      references: refs,
    }
  }

  const { error } = await supabase.from('option_lists').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }

  const audit = await writeAudit(supabase, {
    action: 'option_list.deleted',
    entity_type: 'option_list',
    entity_id: id,
    metadata: { slug: list.slug },
  })
  if (!audit.ok) return { ok: false, error: audit.error }

  return { ok: true }
}

async function scanPublishedSchemasForOptionListSlug(
  supabase: Supabase,
  slug: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('form_schemas')
    .select('module_slug, form_type, schema_definition')

  const refs: string[] = []
  for (const row of (data ?? []) as Array<{
    module_slug: string
    form_type: string | null
    schema_definition: unknown
  }>) {
    if (schemaReferencesOptionList(row.schema_definition, slug)) {
      refs.push(`${row.module_slug}${row.form_type ? ':' + row.form_type : ''}`)
    }
  }
  return refs
}

function schemaReferencesOptionList(schema: unknown, slug: string): boolean {
  if (!schema || typeof schema !== 'object') return false
  const sections = (schema as { sections?: unknown }).sections
  if (!Array.isArray(sections)) return false
  for (const section of sections) {
    const fields = (section as { fields?: unknown }).fields
    if (!Array.isArray(fields)) continue
    for (const field of fields) {
      const options = (field as { options?: unknown }).options
      if (
        options &&
        typeof options === 'object' &&
        'from_option_list' in (options as object) &&
        (options as { from_option_list: string }).from_option_list === slug
      ) {
        return true
      }
    }
  }
  return false
}

// ─────────────────────────────────────────────────────────────────────────────
// Option List Items
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Primary item-creation entry point. `addOptionListItem` is the semantic name
 * used by the Seam 1 editor contract and the admin brief; `createOptionListItem`
 * remains as a backwards-compatible alias for Phase 1 callers.
 */
export async function addOptionListItem(input: {
  option_list_id: string
  key: string
  label: string
  sort_order?: number
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!/^[a-z0-9][a-z0-9_]*$/.test(input.key)) {
    return {
      ok: false,
      error:
        'Key must start with a lowercase letter or digit and contain only lowercase letters, digits, and underscores.',
    }
  }
  if (input.label.trim().length === 0) {
    return { ok: false, error: 'Label is required.' }
  }

  const supabase = await createClient()
  const gate = await requireAdmin(supabase)
  if (!gate.ok) return gate

  const { data, error } = await supabase
    .from('option_list_items')
    .insert({
      option_list_id: input.option_list_id,
      key: input.key,
      label: input.label,
      sort_order: input.sort_order ?? 0,
      is_active: true,
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }

  const audit = await writeAudit(supabase, {
    action: 'option_list_item.created',
    entity_type: 'option_list_item',
    entity_id: data.id as string,
    metadata: {
      option_list_id: input.option_list_id,
      key: input.key,
      label: input.label,
    },
  })
  if (!audit.ok) return { ok: false, error: audit.error }

  return { ok: true, id: data.id as string }
}

/** @deprecated Prefer `addOptionListItem` — kept for Phase 1 caller compatibility. */
export const createOptionListItem = addOptionListItem

/**
 * Generic item update. Kept for Phase 1 caller compatibility. New callers
 * should prefer the semantic wrappers (`renameOptionListItemLabel`,
 * `deactivateOptionListItem`, `reactivateOptionListItem`,
 * `reorderOptionListItems`) so audit entries carry clear intent.
 */
export async function updateOptionListItem(
  id: string,
  patch: { label?: string; sort_order?: number; is_active?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  // key is trigger-immutable at the DB layer; we don't accept it here.
  if (patch.label !== undefined && patch.label.trim().length === 0) {
    return { ok: false, error: 'Label cannot be blank.' }
  }

  const supabase = await createClient()
  const gate = await requireAdmin(supabase)
  if (!gate.ok) return gate

  const { error } = await supabase.from('option_list_items').update(patch).eq('id', id)
  if (error) return { ok: false, error: error.message }

  const audit = await writeAudit(supabase, {
    action: 'option_list_item.updated',
    entity_type: 'option_list_item',
    entity_id: id,
    metadata: patch,
  })
  if (!audit.ok) return { ok: false, error: audit.error }

  return { ok: true }
}

/**
 * Rename a label. The key stays stable (DB trigger enforces this regardless).
 * Submissions filed under the old label keep the old label via
 * `custom_fields.__label_snapshot`; new renders use the new label.
 */
export async function renameOptionListItemLabel(
  id: string,
  newLabel: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (newLabel.trim().length === 0) {
    return { ok: false, error: 'Label cannot be blank.' }
  }

  const supabase = await createClient()
  const gate = await requireAdmin(supabase)
  if (!gate.ok) return gate

  // Load previous label for the audit diff — helps the audit reader see what
  // changed without cross-referencing another row.
  const { data: before } = await supabase
    .from('option_list_items')
    .select('label')
    .eq('id', id)
    .maybeSingle()
  if (!before) return { ok: false, error: 'Option list item not found' }

  const { error } = await supabase
    .from('option_list_items')
    .update({ label: newLabel })
    .eq('id', id)
  if (error) return { ok: false, error: error.message }

  const audit = await writeAudit(supabase, {
    action: 'option_list_item.label_renamed',
    entity_type: 'option_list_item',
    entity_id: id,
    metadata: { from: before.label, to: newLabel },
  })
  if (!audit.ok) return { ok: false, error: audit.error }

  return { ok: true }
}

/**
 * Mark an item inactive. It disappears from new form renders (resolve-options
 * filters by is_active) but remains visible in historical submissions via
 * their label snapshots. Reactivate via `reactivateOptionListItem`.
 */
export async function deactivateOptionListItem(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const gate = await requireAdmin(supabase)
  if (!gate.ok) return gate

  const { error } = await supabase
    .from('option_list_items')
    .update({ is_active: false })
    .eq('id', id)
  if (error) return { ok: false, error: error.message }

  const audit = await writeAudit(supabase, {
    action: 'option_list_item.deactivated',
    entity_type: 'option_list_item',
    entity_id: id,
  })
  if (!audit.ok) return { ok: false, error: audit.error }

  return { ok: true }
}

export async function reactivateOptionListItem(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const gate = await requireAdmin(supabase)
  if (!gate.ok) return gate

  const { error } = await supabase
    .from('option_list_items')
    .update({ is_active: true })
    .eq('id', id)
  if (error) return { ok: false, error: error.message }

  const audit = await writeAudit(supabase, {
    action: 'option_list_item.reactivated',
    entity_type: 'option_list_item',
    entity_id: id,
  })
  if (!audit.ok) return { ok: false, error: audit.error }

  return { ok: true }
}

/**
 * Set `sort_order` on every item in the list to match the position in the
 * `orderedItemIds` array. Items not in `orderedItemIds` are left untouched
 * (caller's responsibility — the admin UI should always pass the complete
 * set it's displaying).
 *
 * Writes a single audit entry summarizing the reorder, not one per item —
 * a bulk reorder is one admin intent.
 *
 * Non-atomic across rows (no RPC today) — a mid-update failure can leave
 * the list with mixed sort_orders. The admin UI should retry on failure;
 * the visible state is recoverable by re-issuing the reorder. A SECURITY
 * DEFINER RPC that wraps the updates in a single transaction is tracked
 * as hardening follow-up.
 */
export async function reorderOptionListItems(
  optionListId: string,
  orderedItemIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (orderedItemIds.length === 0) {
    return { ok: false, error: 'Empty reorder payload; pass the full ordered id list.' }
  }
  // Dedup check — programming error if the same id appears twice.
  if (new Set(orderedItemIds).size !== orderedItemIds.length) {
    return { ok: false, error: 'Duplicate item ids in reorder payload.' }
  }

  const supabase = await createClient()
  const gate = await requireAdmin(supabase)
  if (!gate.ok) return gate

  for (let i = 0; i < orderedItemIds.length; i++) {
    const id = orderedItemIds[i]
    const { error } = await supabase
      .from('option_list_items')
      .update({ sort_order: i })
      .eq('id', id)
      .eq('option_list_id', optionListId) // defense: an id from another list is refused
    if (error) {
      return {
        ok: false,
        error: `Reorder failed at position ${i} (item ${id}): ${error.message}`,
      }
    }
  }

  const audit = await writeAudit(supabase, {
    action: 'option_list_items.reordered',
    entity_type: 'option_list',
    entity_id: optionListId,
    metadata: { ordered_item_ids: orderedItemIds, item_count: orderedItemIds.length },
  })
  if (!audit.ok) return { ok: false, error: audit.error }

  return { ok: true }
}
