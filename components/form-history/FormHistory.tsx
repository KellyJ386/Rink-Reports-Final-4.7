import Link from 'next/link'

import { createClient } from '@/lib/supabase/server'
import { getSubmissionTable } from '@/lib/forms/submission-tables'

export type FormHistoryColumn = {
  key: string
  label: string
  /** Either a submission table column name, or a `custom.<key>` path into custom_fields. */
  source: string
  format?: 'datetime' | 'text' | 'number' | 'label-snapshot'
}

type Props = {
  moduleSlug: string
  formType: string | null
  baseUrl: string // e.g. /modules/ice-maintenance/circle-check — detail route prefix
  columns?: FormHistoryColumn[]
  limit?: number
}

const DEFAULT_COLUMNS: FormHistoryColumn[] = [
  { key: 'submitted_at', label: 'Submitted', source: 'submitted_at', format: 'datetime' },
  { key: 'submitted_by', label: 'By', source: 'submitted_by' },
]

export async function FormHistory({ moduleSlug, formType, baseUrl, columns = DEFAULT_COLUMNS, limit = 50 }: Props) {
  const supabase = await createClient()
  const config = getSubmissionTable(moduleSlug)

  const columnsToSelect = uniqueColumnSources(columns)
  const selectClause = ['id', 'submitted_at', 'submitted_by', 'form_schema_version', 'custom_fields', ...columnsToSelect].join(',')

  let query = supabase
    .from(config.tableName)
    .select(selectClause)
    .order('submitted_at', { ascending: false })
    .limit(limit)

  if (config.hasFormTypeColumn && formType) {
    query = query.eq('form_type', formType)
  }

  const { data, error } = await query
  if (error) {
    return <p className="text-danger text-sm">Could not load history: {error.message}</p>
  }
  if (!data || data.length === 0) {
    return <p className="text-muted text-sm">No submissions yet.</p>
  }

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-hairline text-left text-muted">
          {columns.map((col) => (
            <th key={col.key} className="py-2 pr-3 font-medium">
              {col.label}
            </th>
          ))}
          <th className="py-2 pr-3" aria-label="actions" />
        </tr>
      </thead>
      <tbody>
        {(data as unknown as Record<string, unknown>[]).map((row) => (
          <tr key={row.id as string} className="border-b border-hairline">
            {columns.map((col) => (
              <td key={col.key} className="py-2 pr-3 align-top">
                {formatCell(row, col)}
              </td>
            ))}
            <td className="py-2 pr-3 align-top">
              <Link href={`${baseUrl}/${row.id as string}`}>View</Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function uniqueColumnSources(cols: FormHistoryColumn[]): string[] {
  const set = new Set<string>()
  for (const c of cols) {
    if (c.source.startsWith('custom.')) continue
    set.add(c.source)
  }
  return [...set]
}

function formatCell(row: Record<string, unknown>, col: FormHistoryColumn): string {
  const value = resolveValue(row, col)
  if (value === null || value === undefined) return '—'
  switch (col.format) {
    case 'datetime':
      try {
        return new Date(String(value)).toLocaleString()
      } catch {
        return String(value)
      }
    case 'label-snapshot':
      return String(value)
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value)
  }
}

function resolveValue(row: Record<string, unknown>, col: FormHistoryColumn): unknown {
  if (col.source.startsWith('custom.')) {
    const key = col.source.slice('custom.'.length)
    const custom = row.custom_fields as Record<string, unknown> | null
    if (!custom) return null
    // Prefer the label snapshot for display-oriented columns
    const snapshot = (custom.__label_snapshot ?? {}) as Record<string, unknown>
    if (col.format === 'label-snapshot' && key in snapshot) return snapshot[key]
    return custom[key] ?? null
  }
  return row[col.source] ?? null
}
