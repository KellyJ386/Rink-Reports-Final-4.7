import { createClient } from '@/lib/supabase/server'
import { loadHistoricalFormSchema } from '@/lib/forms/load-form-schema'
import { getSubmissionTable } from '@/lib/forms/submission-tables'
import type { ResolvedFieldSpec, ResolvedSectionSpec } from '@/lib/forms/types'

type Props = {
  moduleSlug: string
  formType: string | null
  submissionId: string
}

/**
 * Render a submission against the schema version it was filed under (not the current
 * one). Labels for selected options come from the `__label_snapshot` stored in
 * custom_fields at submit time, so renames don't rewrite history.
 */
export async function FormDetail({ moduleSlug, formType, submissionId }: Props) {
  const supabase = await createClient()
  const config = getSubmissionTable(moduleSlug)

  const { data, error } = await supabase
    .from(config.tableName)
    .select('*')
    .eq('id', submissionId)
    .maybeSingle()

  if (error) return <p className="text-danger">Load error: {error.message}</p>
  if (!data) return <p className="text-muted">Submission not found.</p>

  const row = data as Record<string, unknown>
  const schema = await loadHistoricalFormSchema(
    moduleSlug,
    formType,
    row.form_schema_version as number,
  )
  if (!schema) return <p className="text-danger">Could not load schema version {String(row.form_schema_version)}.</p>

  const custom = (row.custom_fields as Record<string, unknown> | null) ?? {}
  const labelSnapshot = (custom.__label_snapshot as Record<string, unknown> | null) ?? {}

  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm text-muted">
        Filed {new Date(String(row.submitted_at)).toLocaleString()} · schema v{String(row.form_schema_version)}
      </div>
      {schema.sections.map((section) => (
        <section key={section.key} className="border border-hairline rounded-md p-4">
          <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-2">{section.label}</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            {section.fields.map((field) => {
              const raw = resolveRaw(field, row, custom)
              const display = formatDisplay(field, raw, labelSnapshot)
              return (
                <div key={field.key} className="contents">
                  <dt className="font-medium text-muted">{field.label}</dt>
                  <dd className="text-ink">{display}</dd>
                </div>
              )
            })}
          </dl>
        </section>
      ))}
    </div>
  )
}

function resolveRaw(
  field: ResolvedFieldSpec,
  row: Record<string, unknown>,
  custom: Record<string, unknown>,
): unknown {
  // Core fields live on the row; custom in custom_fields.
  if (field.key in row) return row[field.key]
  return custom[field.key]
}

function formatDisplay(
  field: ResolvedFieldSpec,
  raw: unknown,
  labelSnapshot: Record<string, unknown>,
): string {
  if (raw === null || raw === undefined || raw === '') return '—'

  switch (field.type) {
    case 'select':
    case 'radio': {
      const snap = labelSnapshot[field.key]
      if (typeof snap === 'string') return snap
      // Fallback to current options
      const match = field.options.find((o) => o.key === String(raw))
      return match?.label ?? String(raw)
    }
    case 'multiselect': {
      const snap = labelSnapshot[field.key]
      if (Array.isArray(snap)) return snap.join(', ')
      if (Array.isArray(raw)) {
        return raw
          .map((k) => field.options.find((o) => o.key === k)?.label ?? String(k))
          .join(', ')
      }
      return String(raw)
    }
    case 'boolean':
      return raw ? 'Yes' : 'No'
    case 'datetime':
      try {
        return new Date(String(raw)).toLocaleString()
      } catch {
        return String(raw)
      }
    case 'date':
    case 'time':
      return String(raw)
    case 'number':
    case 'slider':
      return field.unit ? `${raw} ${field.unit}` : String(raw)
    default:
      return String(raw)
  }
}

/**
 * Expose to callers outside components (used by Ice Maintenance shell for linking).
 */
export type { ResolvedSectionSpec }
