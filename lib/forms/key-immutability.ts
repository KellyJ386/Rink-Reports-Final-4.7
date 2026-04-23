/**
 * Minimal shape we actually need. Broader than FormSchemaDefinitionDoc on
 * purpose: the key-immutability checks only look at `.sections[].fields[].key`
 * and happen to need to run against both the strict hand-written
 * FormSchemaDefinitionDoc and Zod's `.safeParse()` output (whose show_if
 * optional variants don't narrow to the exclusive union). Widening here costs
 * nothing — we read `key` only.
 */
type KeyBearingDoc = {
  sections: Array<{
    fields: Array<{ key: string }>
  }>
}

/**
 * Collect every field `key` in a form schema document.
 *
 * Used by key-immutability enforcement: the union of keys across the current
 * published schema + every historical version is the "protected" set. A draft
 * may not drop or rename any of those keys.
 */
export function collectFieldKeys(doc: KeyBearingDoc): Set<string> {
  const keys = new Set<string>()
  for (const section of doc.sections) {
    for (const field of section.fields) {
      keys.add(field.key)
    }
  }
  return keys
}

export type KeyImmutabilityError = {
  key: string
  message: string
}

/**
 * Enforce the "published keys are immutable" rule.
 *
 * Rationale: submissions reference custom_fields by key. If a key disappears
 * from the published schema (removed, or renamed — renames look the same as
 * remove + add from the data's perspective), existing submissions silently
 * break their detail view at the point where the schema history also cycles
 * out. Even while history is intact, the live form loses the ability to show
 * the field on new submissions, which is almost never what the admin intended.
 *
 * Allowed mutations on a previously-published key:
 *   - change label, help_text
 *   - toggle required (though flipping required→off is cheap; required→on
 *     can strand old submissions that didn't fill it — that's a separate
 *     concern not enforced here)
 *   - add / edit show_if
 *   - reorder within or across sections
 *   - change options on select/radio/multiselect (stable via option_list_items.key)
 *
 * Disallowed:
 *   - remove the field entirely (= "rename")
 *   - rename (= remove + add with a new key)
 *
 * To retire a field, admins should mark it optional and hide it with show_if
 * that resolves to false for new submissions.
 */
export function enforceKeyImmutability(
  draft: KeyBearingDoc,
  protectedKeys: Set<string>,
): KeyImmutabilityError[] {
  const draftKeys = collectFieldKeys(draft)
  const errors: KeyImmutabilityError[] = []

  for (const pubKey of protectedKeys) {
    if (!draftKeys.has(pubKey)) {
      errors.push({
        key: pubKey,
        message: `Field key "${pubKey}" was previously published and cannot be removed or renamed. Submissions filed under earlier versions reference this key. To retire the field, mark it optional and hide it with show_if.`,
      })
    }
  }

  return errors
}

/**
 * Build the protected-keys set from a published schema and any history rows.
 * Caller is responsible for loading the history rows (this function is pure
 * so it can be unit-tested without a DB). Pass `published` and `history`
 * as already-parsed FormSchemaDefinitionDoc objects (they come from jsonb
 * columns; caller walks them through validateFormSchema or trusts them as
 * already-published).
 */
export function buildProtectedKeys(
  published: KeyBearingDoc | null,
  history: KeyBearingDoc[],
): Set<string> {
  const keys = new Set<string>()
  if (published) {
    for (const key of collectFieldKeys(published)) keys.add(key)
  }
  for (const doc of history) {
    for (const key of collectFieldKeys(doc)) keys.add(key)
  }
  return keys
}
