import Link from 'next/link'

/**
 * Ice Maintenance shell. In Phase 2, Circle Check is the only form type shipped —
 * Agent 3 adds Ice Make, Edging, Blade Change later. The UI here is a minimal router
 * to each form-type's history. When Agent 3 lands the remaining form types, the
 * multi-form-type tabbed history view replaces this page (see FORM_ENGINE.md).
 */
export default function IceMaintenanceShellPage() {
  return (
    <main>
      <h1 className="text-xl font-semibold">Ice Maintenance</h1>
      <p className="text-muted text-sm mt-1">
        Pick a form type. Agent 3 adds Ice Make, Edging, and Blade Change on top of this shell.
      </p>
      <ul className="mt-4 flex flex-col gap-2">
        <li>
          <Link href="/modules/ice-maintenance/circle-check">Circle Check</Link>
        </li>
        <li className="text-muted">Ice Make — ships with Agent 3</li>
        <li className="text-muted">Edging — ships with Agent 3</li>
        <li className="text-muted">Blade Change — ships with Agent 3</li>
      </ul>
    </main>
  )
}
