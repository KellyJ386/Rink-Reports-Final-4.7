import Link from 'next/link'

import { FormHistory, type FormHistoryColumn } from '@/components/form-history/FormHistory'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'

const COLUMNS: FormHistoryColumn[] = [
  { key: 'date_of_incident',     label: 'Date',      source: 'date_of_incident' },
  { key: 'time_of_incident',     label: 'Time',      source: 'time_of_incident' },
  { key: 'incident_type',        label: 'Type',      source: 'custom.incident_type', format: 'label-snapshot' },
  { key: 'location_in_facility', label: 'Location',  source: 'location_in_facility' },
]

export default async function IncidentHistoryPage() {
  await requireModuleEnabled('incident')
  return (
    <main>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Incident reports</h1>
        <Link
          href="/modules/incident/new"
          className="no-underline bg-accent text-white px-4 py-2 rounded-md font-medium"
        >
          + New incident report
        </Link>
      </div>
      <p className="text-muted text-sm mt-1">Property damage, near-miss, non-injury events.</p>
      <div className="mt-6 overflow-x-auto">
        <FormHistory
          moduleSlug="incident"
          formType={null}
          baseUrl="/modules/incident"
          columns={COLUMNS}
        />
      </div>
    </main>
  )
}
