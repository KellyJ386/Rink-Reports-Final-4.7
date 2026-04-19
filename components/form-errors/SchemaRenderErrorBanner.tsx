import type { RenderError } from '@/lib/forms/load-form-schema'

/**
 * Shared render-time error screen shown when a required form field references an
 * empty option source (list missing / no active items, or no resources of a type).
 * Keeps staff from filing a blank-required answer — admins must fix the config first.
 */
export function SchemaRenderErrorBanner({ errors }: { errors: RenderError[] }) {
  if (errors.length === 0) return null

  const byPath = new Map<string, RenderError[]>()
  for (const e of errors) {
    const key = e.adminPath
    byPath.set(key, [...(byPath.get(key) ?? []), e])
  }

  return (
    <div
      role="alert"
      className="border border-warn bg-amber-50 text-ink rounded-md p-4 flex flex-col gap-3"
    >
      <div>
        <strong>This form can't be filled yet.</strong>
        <p className="text-sm text-muted mt-1">
          One or more required fields have no options configured. A facility admin
          must resolve the issues below before staff can submit.
        </p>
      </div>
      <ul className="text-sm flex flex-col gap-2 list-disc pl-5">
        {errors.map((e) => (
          <li key={e.fieldKey}>
            <span className="font-medium">{e.fieldLabel}</span>{' '}
            <span className="text-muted">({e.reason.replaceAll('_', ' ')})</span>
            <div className="text-xs text-muted">{e.adminAction}</div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3 text-sm">
        {[...byPath.keys()].map((path) => (
          <a key={path} href={path} className="no-underline bg-accent text-white px-3 py-1 rounded-md">
            Open {path}
          </a>
        ))}
      </div>
    </div>
  )
}
