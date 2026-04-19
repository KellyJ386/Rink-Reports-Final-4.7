import Link from 'next/link'

import { FormHistory, type FormHistoryColumn } from '@/components/form-history/FormHistory'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'

const COLUMNS: FormHistoryColumn[] = [
  { key: 'submitted_at',       label: 'Submitted',  source: 'submitted_at',                   format: 'datetime' },
  { key: 'edger_used',         label: 'Edger',      source: 'custom.edger_used',              format: 'label-snapshot' },
  { key: 'perimeter_complete', label: 'Complete?',  source: 'custom.perimeter_complete' },
]

export default async function EdgingHistoryPage() {
  await requireModuleEnabled('ice_maintenance')
  return (
    <main>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Edging history</h1>
        <Link
          href="/modules/ice-maintenance/edging/new"
          className="no-underline bg-accent text-white px-4 py-2 rounded-md font-medium"
        >
          + New edging log
        </Link>
      </div>
      <p className="text-muted text-sm mt-1">Perimeter-cut log.</p>
      <div className="mt-6 overflow-x-auto">
        <FormHistory
          moduleSlug="ice_maintenance"
          formType="edging"
          baseUrl="/modules/ice-maintenance/edging"
          columns={COLUMNS}
        />
      </div>
    </main>
  )
}
