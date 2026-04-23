'use client'

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { EditorAnnotations } from '@/lib/forms/editor-types'
import { validateFormSchema } from '@/lib/forms/meta-schema'
import { FORM_SCHEMA_FORMAT_VERSION } from '@/lib/forms/types'

import {
  discardDraftAction,
  publishAction,
  saveDraftAction,
  validateDraftAction,
} from './actions'

type Draft = {
  $schema?: string
  sections: Section[]
}
type Section = {
  key: string
  label: string
  fields: Field[]
}
type Field = {
  key: string
  type: string
  label: string
  help_text?: string
  required?: boolean
  show_if?: Record<string, unknown>
  // type-specific
  min?: number
  max?: number
  step?: number
  unit?: string
  rows?: number
  options?: unknown
}

const FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'boolean',
  'select',
  'multiselect',
  'radio',
  'date',
  'time',
  'datetime',
  'slider',
] as const

type Props = {
  formSchemaId: string
  currentVersion: number
  currentDefinition: Record<string, unknown>
  draftDefinition: Record<string, unknown> | null
  /**
   * EditorAnnotations from Phase 2 Seam 1's `loadFormSchemaForEditor`.
   * Drives lock badges (core-field keys), rename-block UX (protected keys),
   * and autocomplete for option-source pickers.
   */
  annotations: EditorAnnotations
}

type KeyImmutabilityError = { key: string; message: string }

function cloneDraft(d: unknown): Draft {
  const base = JSON.parse(JSON.stringify(d ?? { sections: [] })) as Draft
  if (!base.sections) base.sections = []
  base.$schema = FORM_SCHEMA_FORMAT_VERSION
  return base
}

export function FormSchemaEditor({
  formSchemaId,
  currentVersion,
  currentDefinition,
  draftDefinition,
  annotations,
}: Props) {
  const [draft, setDraft] = useState<Draft>(() =>
    cloneDraft(draftDefinition ?? currentDefinition),
  )
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<
    Array<{ path: string; message: string }>
  >([])
  const [keyImmutabilityErrors, setKeyImmutabilityErrors] = useState<
    KeyImmutabilityError[]
  >([])
  // Live-validation errors, surfaced as the admin types (debounced). Distinct
  // from the save/publish errors above so the user can tell "the last save
  // failed" apart from "what I'm typing right now wouldn't publish."
  const [liveValidationErrors, setLiveValidationErrors] = useState<
    Array<{ path: string; message: string }>
  >([])
  const [liveKeyImmutabilityErrors, setLiveKeyImmutabilityErrors] = useState<
    KeyImmutabilityError[]
  >([])
  const [busy, setBusy] = useState<'saving' | 'publishing' | 'discarding' | null>(null)

  const coreFieldKeySet = useMemo(
    () => new Set(annotations.coreFieldKeys),
    [annotations.coreFieldKeys],
  )
  const protectedKeySet = useMemo(
    () => new Set(annotations.protectedKeys),
    [annotations.protectedKeys],
  )

  // Debounced live validation. Fires 500ms after the admin stops editing;
  // cheap enough (one server-action round-trip) and specific enough to
  // show "this draft won't publish" errors inline instead of only at save.
  const draftJson = JSON.stringify(draft)
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => {
    const t = setTimeout(async () => {
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      try {
        const result = await validateDraftAction(formSchemaId, draft)
        if (ac.signal.aborted) return
        if (result.ok) {
          setLiveValidationErrors([])
          setLiveKeyImmutabilityErrors([])
        } else {
          setLiveValidationErrors(result.validationErrors ?? [])
          setLiveKeyImmutabilityErrors(result.keyImmutabilityErrors ?? [])
        }
      } catch {
        // Network or abort — silent; live validation is best-effort.
      }
    }, 500)
    return () => clearTimeout(t)
    // draftJson is the stable snapshot of `draft`; including `draft` itself
    // would make the effect fire on every re-render regardless of content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftJson, formSchemaId])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const selectedField = useMemo(() => {
    if (!selectedKey) return null
    for (const s of draft.sections) for (const f of s.fields) if (f.key === selectedKey) return { section: s, field: f }
    return null
  }, [draft, selectedKey])

  // ---- mutations (all modify local draft; server write happens in Save / Publish)

  const addSection = () => {
    const nextIdx = draft.sections.length + 1
    const newSection: Section = { key: `section_${nextIdx}`, label: `Section ${nextIdx}`, fields: [] }
    setDraft({ ...draft, sections: [...draft.sections, newSection] })
  }

  const updateSection = (sectionKey: string, patch: Partial<Section>) => {
    setDraft({
      ...draft,
      sections: draft.sections.map((s) => (s.key === sectionKey ? { ...s, ...patch } : s)),
    })
  }

  const removeSection = (sectionKey: string) => {
    if (!confirm('Remove this section and all its fields from the draft?')) return
    setDraft({ ...draft, sections: draft.sections.filter((s) => s.key !== sectionKey) })
  }

  const moveSection = (sectionKey: string, dir: -1 | 1) => {
    const idx = draft.sections.findIndex((s) => s.key === sectionKey)
    if (idx < 0) return
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= draft.sections.length) return
    const copy = [...draft.sections]
    ;[copy[idx], copy[newIdx]] = [copy[newIdx]!, copy[idx]!]
    setDraft({ ...draft, sections: copy })
  }

  const addField = (sectionKey: string) => {
    const existingKeys = new Set<string>()
    for (const s of draft.sections) for (const f of s.fields) existingKeys.add(f.key)
    let n = 1
    let newKey = `field_${n}`
    while (existingKeys.has(newKey)) newKey = `field_${++n}`
    const newField: Field = { key: newKey, type: 'text', label: 'New field', required: false }
    setDraft({
      ...draft,
      sections: draft.sections.map((s) =>
        s.key === sectionKey ? { ...s, fields: [...s.fields, newField] } : s,
      ),
    })
    setSelectedKey(newKey)
  }

  const updateField = (fieldKey: string, patch: Partial<Field>) => {
    setDraft({
      ...draft,
      sections: draft.sections.map((s) => ({
        ...s,
        fields: s.fields.map((f) => (f.key === fieldKey ? { ...f, ...patch } : f)),
      })),
    })
  }

  const removeField = (fieldKey: string) => {
    if (coreFieldKeySet.has(fieldKey)) {
      alert(
        `"${fieldKey}" is a core field and cannot be removed from the draft. Core fields are declared in the module's core-fields.ts and are required by the submission table.`,
      )
      return
    }
    if (protectedKeySet.has(fieldKey)) {
      alert(
        `"${fieldKey}" has been published in a prior version and cannot be removed — existing submissions reference it by key. To retire it, mark it optional and hide it with show_if.`,
      )
      return
    }
    if (!confirm('Remove this field from the draft?')) return
    setDraft({
      ...draft,
      sections: draft.sections.map((s) => ({
        ...s,
        fields: s.fields.filter((f) => f.key !== fieldKey),
      })),
    })
    if (selectedKey === fieldKey) setSelectedKey(null)
  }

  const handleFieldReorder = (sectionKey: string) => (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setDraft((d) => {
      const sections = d.sections.map((s) => {
        if (s.key !== sectionKey) return s
        const oldIndex = s.fields.findIndex((f) => f.key === active.id)
        const newIndex = s.fields.findIndex((f) => f.key === over.id)
        if (oldIndex < 0 || newIndex < 0) return s
        return { ...s, fields: arrayMove(s.fields, oldIndex, newIndex) }
      })
      return { ...d, sections }
    })
  }

  // ---- persistence

  const handleSaveDraft = async () => {
    setError(null)
    setValidationErrors([])
    setKeyImmutabilityErrors([])
    const validation = validateFormSchema(draft)
    if (!validation.ok) {
      setValidationErrors(validation.errors)
      return
    }
    setBusy('saving')
    const result = await saveDraftAction(formSchemaId, draft)
    setBusy(null)
    if (!('ok' in result) || !result.ok) {
      setError('error' in result ? result.error : 'Save failed')
      if ('validationErrors' in result && result.validationErrors) {
        setValidationErrors(result.validationErrors)
      }
      if ('keyImmutabilityErrors' in result && result.keyImmutabilityErrors) {
        setKeyImmutabilityErrors(result.keyImmutabilityErrors)
      }
      return
    }
  }

  const handlePublish = async () => {
    setError(null)
    setValidationErrors([])
    setKeyImmutabilityErrors([])
    const validation = validateFormSchema(draft)
    if (!validation.ok) {
      setValidationErrors(validation.errors)
      return
    }
    setBusy('publishing')
    // Save current draft first, then publish
    const save = await saveDraftAction(formSchemaId, draft)
    if (!('ok' in save) || !save.ok) {
      setBusy(null)
      setError('error' in save ? save.error : 'Save failed')
      if ('validationErrors' in save && save.validationErrors) setValidationErrors(save.validationErrors)
      if ('keyImmutabilityErrors' in save && save.keyImmutabilityErrors) {
        setKeyImmutabilityErrors(save.keyImmutabilityErrors)
      }
      return
    }
    const pub = await publishAction(formSchemaId)
    setBusy(null)
    if (!('ok' in pub) || !pub.ok) {
      setError('error' in pub ? pub.error : 'Publish failed')
      if ('validationErrors' in pub && pub.validationErrors) setValidationErrors(pub.validationErrors)
      if ('keyImmutabilityErrors' in pub && pub.keyImmutabilityErrors) {
        setKeyImmutabilityErrors(pub.keyImmutabilityErrors)
      }
      return
    }
    window.location.reload()
  }

  const handleDiscard = async () => {
    if (!confirm('Discard current draft and reset to the last published version?')) return
    setError(null)
    setBusy('discarding')
    const result = await discardDraftAction(formSchemaId)
    setBusy(null)
    if (!('ok' in result) || !result.ok) {
      setError('error' in result ? result.error : 'Discard failed')
      return
    }
    window.location.reload()
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[2fr_3fr] gap-6">
      <div>
        <div className="flex gap-2 flex-wrap mb-4">
          <button type="button" onClick={handleSaveDraft} disabled={busy != null}>
            {busy === 'saving' ? 'Saving…' : 'Save draft'}
          </button>
          <button
            type="button"
            onClick={handlePublish}
            disabled={busy != null}
            className="bg-ok text-white px-4 rounded-md font-medium min-h-tap"
          >
            {busy === 'publishing' ? 'Publishing…' : `Publish v${currentVersion + 1}`}
          </button>
          <button
            type="button"
            onClick={handleDiscard}
            disabled={busy != null || !draftDefinition}
            className="bg-transparent border border-hairline text-ink px-4 rounded-md font-medium min-h-tap"
          >
            Discard draft
          </button>
        </div>

        {error && (
          <p role="alert" className="text-danger text-sm mb-3">
            {error}
          </p>
        )}
        {validationErrors.length > 0 && (
          <div className="border border-danger bg-red-50 rounded-md p-3 text-sm mb-3">
            <strong>Cannot publish:</strong>
            <ul className="list-disc pl-5 mt-1">
              {validationErrors.map((e, i) => (
                <li key={i}>
                  <code className="text-xs">{e.path}</code> {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {keyImmutabilityErrors.length > 0 && (
          <div className="border border-danger bg-red-50 rounded-md p-3 text-sm mb-3">
            <strong>Published fields cannot be removed or renamed:</strong>
            <ul className="list-disc pl-5 mt-1">
              {keyImmutabilityErrors.map((e, i) => (
                <li key={i}>
                  <code className="text-xs">{e.key}</code> — {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* Live validation — shows as the admin types. Suppressed when an
            explicit save/publish error is showing, to avoid duplicate noise. */}
        {error === null &&
          validationErrors.length === 0 &&
          keyImmutabilityErrors.length === 0 &&
          (liveValidationErrors.length > 0 || liveKeyImmutabilityErrors.length > 0) && (
            <div className="border border-warn bg-amber-50 rounded-md p-3 text-sm mb-3">
              <strong>Draft has issues — these will block publish:</strong>
              <ul className="list-disc pl-5 mt-1">
                {liveValidationErrors.map((e, i) => (
                  <li key={`v-${i}`}>
                    <code className="text-xs">{e.path}</code> {e.message}
                  </li>
                ))}
                {liveKeyImmutabilityErrors.map((e, i) => (
                  <li key={`k-${i}`}>
                    <code className="text-xs">{e.key}</code> (published before) — cannot remove or rename
                  </li>
                ))}
              </ul>
            </div>
          )}

        <div className="flex flex-col gap-4">
          {draft.sections.map((section, sIdx) => (
            <fieldset key={section.key} className="border border-hairline rounded-md p-3">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <label className="flex-row items-center gap-2 text-sm font-semibold min-h-0">
                  <span className="text-muted text-xs">Section</span>
                  <input
                    type="text"
                    value={section.label}
                    onChange={(e) => updateSection(section.key, { label: e.target.value })}
                    className="w-48"
                  />
                </label>
                <label className="flex-row items-center gap-2 text-xs min-h-0 font-normal text-muted">
                  key
                  <input
                    type="text"
                    value={section.key}
                    onChange={(e) => updateSection(section.key, { key: e.target.value })}
                    className="w-36 font-mono text-xs"
                  />
                </label>
                <div className="ml-auto flex gap-1">
                  <button
                    type="button"
                    onClick={() => moveSection(section.key, -1)}
                    disabled={sIdx === 0}
                    className="bg-transparent border border-hairline text-ink px-2 py-1 rounded text-xs min-h-0"
                    aria-label="Move section up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSection(section.key, 1)}
                    disabled={sIdx === draft.sections.length - 1}
                    className="bg-transparent border border-hairline text-ink px-2 py-1 rounded text-xs min-h-0"
                    aria-label="Move section down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSection(section.key)}
                    className="bg-transparent border border-danger text-danger px-2 py-1 rounded text-xs min-h-0"
                  >
                    Remove
                  </button>
                </div>
              </div>

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleFieldReorder(section.key)}
              >
                <SortableContext
                  items={section.fields.map((f) => f.key)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="flex flex-col gap-1">
                    {section.fields.map((f) => (
                      <SortableFieldRow
                        key={f.key}
                        field={f}
                        isSelected={selectedKey === f.key}
                        isCore={coreFieldKeySet.has(f.key)}
                        isProtected={protectedKeySet.has(f.key)}
                        onSelect={() => setSelectedKey(selectedKey === f.key ? null : f.key)}
                        onRemove={() => removeField(f.key)}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>

              <button
                type="button"
                onClick={() => addField(section.key)}
                className="mt-2 bg-transparent border border-hairline text-ink px-3 py-1 rounded text-sm min-h-0"
              >
                + Add field
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            onClick={addSection}
            className="bg-transparent border border-hairline text-ink px-3 py-1 rounded text-sm self-start"
          >
            + Add section
          </button>
        </div>
      </div>

      <div>
        {selectedField ? (
          <FieldEditor
            field={selectedField.field}
            onChange={(patch) => updateField(selectedField.field.key, patch)}
            onClose={() => setSelectedKey(null)}
            allPriorFieldKeys={priorKeysUpTo(draft, selectedField.field.key)}
            isCore={coreFieldKeySet.has(selectedField.field.key)}
            isProtected={protectedKeySet.has(selectedField.field.key)}
            availableOptionListSlugs={annotations.availableOptionListSlugs}
            availableResourceTypes={annotations.availableResourceTypes}
          />
        ) : (
          <section className="border border-hairline rounded-md p-4 text-sm text-muted">
            Select a field to edit its properties. Changes save only when you click
            "Save draft" or "Publish".
          </section>
        )}
      </div>
    </div>
  )
}

// ---- sub-components ----

function SortableFieldRow({
  field,
  isSelected,
  isCore,
  isProtected,
  onSelect,
  onRemove,
}: {
  field: Field
  isSelected: boolean
  isCore: boolean
  isProtected: boolean
  onSelect: () => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.key,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  const cannotRemove = isCore || isProtected
  const removeTooltip = isCore
    ? 'Core field — cannot be removed. Managed in the module\'s core-fields.ts.'
    : isProtected
      ? 'Published in a prior version — cannot be removed. Mark optional + hide with show_if to retire.'
      : 'Remove field'
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 p-2 border rounded-md text-sm ${
        isSelected ? 'border-accent bg-sky-50' : 'border-hairline bg-white'
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="bg-transparent text-muted px-2 cursor-grab touch-none min-h-0"
      >
        ⠿
      </button>
      <button
        type="button"
        onClick={onSelect}
        className="flex-1 text-left bg-transparent text-ink px-2 min-h-0"
      >
        <span className="font-mono text-xs text-muted">{field.key}</span>{' '}
        <span className="font-semibold">{field.label}</span>{' '}
        <span className="text-xs text-muted">
          · {field.type}
          {field.required ? ' · required' : ''}
          {field.show_if ? ' · conditional' : ''}
          {isCore && (
            <>
              {' · '}
              <span title="Core field" aria-label="core field">🔒 core</span>
            </>
          )}
          {!isCore && isProtected && (
            <>
              {' · '}
              <span title="Published — key is immutable" aria-label="protected key">📌 published</span>
            </>
          )}
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        disabled={cannotRemove}
        title={removeTooltip}
        aria-label={removeTooltip}
        className={
          cannotRemove
            ? 'bg-transparent border border-hairline text-muted px-2 py-1 rounded text-xs min-h-0 cursor-not-allowed'
            : 'bg-transparent border border-danger text-danger px-2 py-1 rounded text-xs min-h-0'
        }
      >
        ⓧ
      </button>
    </li>
  )
}

function FieldEditor({
  field,
  onChange,
  onClose,
  allPriorFieldKeys,
  isCore,
  isProtected,
  availableOptionListSlugs,
  availableResourceTypes,
}: {
  field: Field
  onChange: (patch: Partial<Field>) => void
  onClose: () => void
  allPriorFieldKeys: string[]
  isCore: boolean
  isProtected: boolean
  availableOptionListSlugs: string[]
  availableResourceTypes: string[]
}) {
  const hasOptions = field.type === 'select' || field.type === 'multiselect' || field.type === 'radio'
  const hasNumericBounds = field.type === 'number' || field.type === 'slider'

  // Normalize options shape
  const optionSourceKind =
    Array.isArray(field.options)
      ? 'inline'
      : field.options && typeof field.options === 'object' && 'from_option_list' in (field.options as object)
        ? 'from_option_list'
        : field.options && typeof field.options === 'object' && 'from_resource_type' in (field.options as object)
          ? 'from_resource_type'
          : 'inline'

  // Datalist id scoped per-field to avoid collisions when multiple editors render.
  const optionListDatalistId = `option-list-slugs-${field.key}`

  const keyLocked = isCore || isProtected
  const keyLockReason = isCore
    ? 'Core field — key is defined in the module\'s core-fields.ts and cannot be changed from the admin.'
    : 'This key has been published in a prior version. Renaming would strand existing submissions. To retire the field, mark it optional and hide with show_if.'

  return (
    <section className="border border-accent rounded-md p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">
          Edit field: {field.key}
          {isCore && <span className="ml-2 text-xs text-muted">🔒 core</span>}
          {!isCore && isProtected && <span className="ml-2 text-xs text-muted">📌 published</span>}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="bg-transparent text-muted px-2 min-h-0"
          aria-label="Close editor"
        >
          ✕
        </button>
      </div>

      <label>
        Key (snake_case)
        <input
          type="text"
          value={field.key}
          onChange={(e) => onChange({ key: e.target.value })}
          disabled={keyLocked}
          className="font-mono"
          title={keyLocked ? keyLockReason : undefined}
        />
        <span className="text-xs text-muted">
          {keyLocked
            ? keyLockReason
            : 'Do not change after submissions exist — existing rows won\'t rewrite.'}
        </span>
      </label>

      <label>
        Label
        <input type="text" value={field.label} onChange={(e) => onChange({ label: e.target.value })} />
      </label>

      <label>
        Help text
        <input
          type="text"
          value={field.help_text ?? ''}
          onChange={(e) => onChange({ help_text: e.target.value || undefined })}
        />
      </label>

      <label>
        Type
        <select value={field.type} onChange={(e) => onChange({ type: e.target.value })}>
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      <label className="flex-row items-center gap-2 font-normal min-h-0">
        <input
          type="checkbox"
          className="w-auto"
          checked={!!field.required}
          onChange={(e) => onChange({ required: e.target.checked })}
        />
        Required
      </label>

      {hasNumericBounds && (
        <div className="grid grid-cols-2 gap-2">
          <label>
            Min
            <input
              type="number"
              value={field.min ?? ''}
              onChange={(e) =>
                onChange({ min: e.target.value === '' ? undefined : Number(e.target.value) })
              }
            />
          </label>
          <label>
            Max
            <input
              type="number"
              value={field.max ?? ''}
              onChange={(e) =>
                onChange({ max: e.target.value === '' ? undefined : Number(e.target.value) })
              }
            />
          </label>
          <label>
            Step
            <input
              type="number"
              value={field.step ?? ''}
              onChange={(e) =>
                onChange({ step: e.target.value === '' ? undefined : Number(e.target.value) })
              }
            />
          </label>
          <label>
            Unit
            <input
              type="text"
              value={field.unit ?? ''}
              onChange={(e) => onChange({ unit: e.target.value || undefined })}
            />
          </label>
        </div>
      )}

      {field.type === 'textarea' && (
        <label>
          Rows
          <input
            type="number"
            min={1}
            max={20}
            value={field.rows ?? 4}
            onChange={(e) => onChange({ rows: Number(e.target.value) })}
          />
        </label>
      )}

      {hasOptions && (
        <div className="border border-hairline rounded-md p-3">
          <div className="font-medium mb-2 text-sm">Options source</div>
          <div className="flex gap-3 flex-wrap text-sm">
            {(['inline', 'from_option_list', 'from_resource_type'] as const).map((kind) => (
              <label key={kind} className="flex-row items-center gap-1 font-normal min-h-0">
                <input
                  type="radio"
                  className="w-auto"
                  name={`options-${field.key}`}
                  checked={optionSourceKind === kind}
                  onChange={() => {
                    if (kind === 'inline') onChange({ options: [] })
                    else if (kind === 'from_option_list') onChange({ options: { from_option_list: '' } })
                    else onChange({ options: { from_resource_type: '' } })
                  }}
                />
                <code className="text-xs">{kind}</code>
              </label>
            ))}
          </div>

          {optionSourceKind === 'inline' && Array.isArray(field.options) && (
            <InlineOptionsEditor
              options={field.options as Array<{ key: string; label: string }>}
              onChange={(opts) => onChange({ options: opts })}
            />
          )}

          {optionSourceKind === 'from_option_list' &&
            typeof field.options === 'object' &&
            field.options !== null &&
            'from_option_list' in field.options && (
              <label className="mt-2">
                option_list slug
                <input
                  type="text"
                  value={(field.options as { from_option_list: string }).from_option_list}
                  onChange={(e) => onChange({ options: { from_option_list: e.target.value } })}
                  placeholder="e.g. hazards"
                  className="font-mono"
                  list={optionListDatalistId}
                />
                <datalist id={optionListDatalistId}>
                  {availableOptionListSlugs.map((slug) => (
                    <option key={slug} value={slug} />
                  ))}
                </datalist>
                <span className="text-xs text-muted">
                  {availableOptionListSlugs.length === 0
                    ? 'No option lists exist yet. Create one at /admin/option-lists.'
                    : `${availableOptionListSlugs.length} list${
                        availableOptionListSlugs.length === 1 ? '' : 's'
                      } available. Manage at /admin/option-lists.`}
                </span>
              </label>
            )}

          {optionSourceKind === 'from_resource_type' &&
            typeof field.options === 'object' &&
            field.options !== null &&
            'from_resource_type' in field.options && (
              <label className="mt-2">
                resource_type
                <select
                  value={(field.options as { from_resource_type: string }).from_resource_type}
                  onChange={(e) => onChange({ options: { from_resource_type: e.target.value } })}
                >
                  <option value="">—</option>
                  {availableResourceTypes.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-muted">
                  Resolves at render from facility_resources filtered by current facility + is_active.
                </span>
              </label>
            )}
        </div>
      )}

      <div className="border border-hairline rounded-md p-3">
        <div className="font-medium mb-2 text-sm">Conditional visibility (show_if)</div>
        {!field.show_if ? (
          <button
            type="button"
            onClick={() =>
              onChange({
                show_if: { field: allPriorFieldKeys[0] ?? '', equals: true as unknown },
              })
            }
            disabled={allPriorFieldKeys.length === 0}
            className="bg-transparent border border-hairline text-ink px-3 py-1 rounded text-xs min-h-0"
          >
            Add show_if condition
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <label>
              Show when field
              <select
                value={(field.show_if as { field?: string }).field ?? ''}
                onChange={(e) =>
                  onChange({ show_if: { ...(field.show_if as object), field: e.target.value } })
                }
              >
                {allPriorFieldKeys.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted">
                Only fields defined earlier in the schema can be referenced.
              </span>
            </label>
            <label>
              equals (string, number, or boolean)
              <input
                type="text"
                value={String((field.show_if as { equals?: unknown }).equals ?? '')}
                onChange={(e) => {
                  const raw = e.target.value
                  let parsed: unknown = raw
                  if (raw === 'true') parsed = true
                  else if (raw === 'false') parsed = false
                  else if (/^-?\d+(\.\d+)?$/.test(raw)) parsed = Number(raw)
                  onChange({
                    show_if: { field: (field.show_if as { field: string }).field, equals: parsed },
                  })
                }}
              />
              <span className="text-xs text-muted">
                For selects, enter the option <em>key</em>, not its label.
              </span>
            </label>
            <button
              type="button"
              onClick={() => onChange({ show_if: undefined })}
              className="bg-transparent border border-danger text-danger px-3 py-1 rounded text-xs self-start min-h-0"
            >
              Remove condition
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

function InlineOptionsEditor({
  options,
  onChange,
}: {
  options: Array<{ key: string; label: string }>
  onChange: (next: Array<{ key: string; label: string }>) => void
}) {
  const add = () => onChange([...options, { key: `opt_${options.length + 1}`, label: 'New option' }])
  const update = (idx: number, patch: Partial<{ key: string; label: string }>) => {
    const next = options.map((o, i) => (i === idx ? { ...o, ...patch } : o))
    onChange(next)
  }
  const remove = (idx: number) => onChange(options.filter((_, i) => i !== idx))
  return (
    <div className="mt-2 flex flex-col gap-2">
      {options.map((o, i) => (
        <div key={i} className="flex gap-2 items-start">
          <input
            type="text"
            value={o.key}
            onChange={(e) => update(i, { key: e.target.value })}
            className="font-mono text-xs w-32"
            placeholder="key"
          />
          <input
            type="text"
            value={o.label}
            onChange={(e) => update(i, { label: e.target.value })}
            className="flex-1"
            placeholder="Label"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="bg-transparent border border-danger text-danger px-2 py-1 rounded text-xs min-h-0"
          >
            ⓧ
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="bg-transparent border border-hairline text-ink px-3 py-1 rounded text-xs self-start min-h-0"
      >
        + Add option
      </button>
    </div>
  )
}

function priorKeysUpTo(draft: Draft, fieldKey: string): string[] {
  const out: string[] = []
  for (const s of draft.sections) {
    for (const f of s.fields) {
      if (f.key === fieldKey) return out
      out.push(f.key)
    }
  }
  return out
}
