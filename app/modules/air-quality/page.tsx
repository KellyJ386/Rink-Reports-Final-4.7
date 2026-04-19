import Link from 'next/link'

import { FormHistory, type FormHistoryColumn } from '@/components/form-history/FormHistory'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'

const COLUMNS: FormHistoryColumn[] = [
  { key: 'reading_taken_at',    label: 'Reading',  source: 'reading_taken_at', format: 'datetime' },
  { key: 'location_of_reading', label: 'Location', source: 'location_of_reading' },
  { key: 'co_ppm',              label: 'CO ppm',   source: 'custom.co_ppm' },
  { key: 'no2_ppm',             label: 'NO₂ ppm',  source: 'custom.no2_ppm' },
]

export default async function AirQualityHistoryPage() {
  await requireModuleEnabled('air_quality')
  return (
    <main>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Air Quality history</h1>
        <Link
          href="/modules/air-quality/new"
          className="no-underline bg-accent text-white px-4 py-2 rounded-md font-medium"
        >
          + New reading
        </Link>
      </div>
      <p className="text-muted text-sm mt-1">CO, NO₂, particulate readings.</p>
      <div className="mt-6 overflow-x-auto">
        <FormHistory
          moduleSlug="air_quality"
          formType={null}
          baseUrl="/modules/air-quality"
          columns={COLUMNS}
        />
      </div>
    </main>
  )
}
