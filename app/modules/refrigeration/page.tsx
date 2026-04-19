import Link from 'next/link'

import { FormHistory, type FormHistoryColumn } from '@/components/form-history/FormHistory'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'

const COLUMNS: FormHistoryColumn[] = [
  { key: 'reading_taken_at', label: 'Reading',   source: 'reading_taken_at', format: 'datetime' },
  { key: 'submitted_at',     label: 'Filed',     source: 'submitted_at',     format: 'datetime' },
]

export default async function RefrigerationHistoryPage() {
  await requireModuleEnabled('refrigeration')
  return (
    <main>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Refrigeration history</h1>
        <Link
          href="/modules/refrigeration/new"
          className="no-underline bg-accent text-white px-4 py-2 rounded-md font-medium"
        >
          + New reading
        </Link>
      </div>
      <p className="text-muted text-sm mt-1">Periodic compressor and brine readings.</p>
      <div className="mt-6 overflow-x-auto">
        <FormHistory
          moduleSlug="refrigeration"
          formType={null}
          baseUrl="/modules/refrigeration"
          columns={COLUMNS}
        />
      </div>
    </main>
  )
}
