import Link from 'next/link'

import { FormHistory, type FormHistoryColumn } from '@/components/form-history/FormHistory'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'

const COLUMNS: FormHistoryColumn[] = [
  { key: 'submitted_at', label: 'Submitted', source: 'submitted_at', format: 'datetime' },
  { key: 'ice_condition', label: 'Ice', source: 'custom.ice_condition', format: 'label-snapshot' },
  { key: 'glass_condition', label: 'Glass/boards', source: 'custom.glass_condition', format: 'label-snapshot' },
  { key: 'doors_clear', label: 'Doors clear?', source: 'custom.doors_clear' },
]

export default async function CircleCheckHistoryPage() {
  await requireModuleEnabled('ice_maintenance')
  return (
    <main>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Circle Check history</h1>
        <Link
          href="/modules/ice-maintenance/circle-check/new"
          className="no-underline bg-accent text-white px-4 py-2 rounded-md font-medium"
        >
          + New circle check
        </Link>
      </div>
      <p className="text-muted text-sm mt-1">
        Pre-skate inspection log. Every circle check pins to the schema version active when it was filed.
      </p>
      <div className="mt-6 overflow-x-auto">
        <FormHistory
          moduleSlug="ice_maintenance"
          formType="circle_check"
          baseUrl="/modules/ice-maintenance/circle-check"
          columns={COLUMNS}
        />
      </div>
    </main>
  )
}
