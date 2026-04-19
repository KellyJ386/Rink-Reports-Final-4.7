import Link from 'next/link'

import { FormHistory, type FormHistoryColumn } from '@/components/form-history/FormHistory'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'

const COLUMNS: FormHistoryColumn[] = [
  { key: 'submitted_at',        label: 'Submitted',  source: 'submitted_at',                    format: 'datetime' },
  { key: 'blade_serial',        label: 'New serial', source: 'blade_serial' },
  { key: 'old_blade_condition', label: 'Old blade',  source: 'custom.old_blade_condition',      format: 'label-snapshot' },
  { key: 'new_blade_source',    label: 'Source',     source: 'custom.new_blade_source',         format: 'label-snapshot' },
]

export default async function BladeChangeHistoryPage() {
  await requireModuleEnabled('ice_maintenance')
  return (
    <main>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Blade Change history</h1>
        <Link
          href="/modules/ice-maintenance/blade-change/new"
          className="no-underline bg-accent text-white px-4 py-2 rounded-md font-medium"
        >
          + New blade change
        </Link>
      </div>
      <p className="text-muted text-sm mt-1">Zamboni blade swap log.</p>
      <div className="mt-6 overflow-x-auto">
        <FormHistory
          moduleSlug="ice_maintenance"
          formType="blade_change"
          baseUrl="/modules/ice-maintenance/blade-change"
          columns={COLUMNS}
        />
      </div>
    </main>
  )
}
