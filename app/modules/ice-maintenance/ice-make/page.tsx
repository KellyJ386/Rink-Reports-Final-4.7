import Link from 'next/link'

import { FormHistory, type FormHistoryColumn } from '@/components/form-history/FormHistory'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'

const COLUMNS: FormHistoryColumn[] = [
  { key: 'submitted_at',       label: 'Submitted',     source: 'submitted_at',                format: 'datetime' },
  { key: 'resurface_start_at', label: 'Start',          source: 'resurface_start_at',          format: 'datetime' },
  { key: 'resurface_end_at',   label: 'End',            source: 'resurface_end_at',            format: 'datetime' },
  { key: 'observed_condition', label: 'Condition',      source: 'custom.observed_condition',   format: 'label-snapshot' },
  { key: 'water_temp_f',       label: 'Water °F',       source: 'water_temp_f' },
]

export default async function IceMakeHistoryPage() {
  await requireModuleEnabled('ice_maintenance')
  return (
    <main>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Ice Make history</h1>
        <Link
          href="/modules/ice-maintenance/ice-make/new"
          className="no-underline bg-accent text-white px-4 py-2 rounded-md font-medium"
        >
          + New ice make
        </Link>
      </div>
      <p className="text-muted text-sm mt-1">Ice resurface operation log.</p>
      <div className="mt-6 overflow-x-auto">
        <FormHistory
          moduleSlug="ice_maintenance"
          formType="ice_make"
          baseUrl="/modules/ice-maintenance/ice-make"
          columns={COLUMNS}
        />
      </div>
    </main>
  )
}
