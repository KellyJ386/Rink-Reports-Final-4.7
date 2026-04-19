import Link from 'next/link'

import { FormHistory, type FormHistoryColumn } from '@/components/form-history/FormHistory'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'

const COLUMNS: FormHistoryColumn[] = [
  { key: 'date_of_accident',     label: 'Date',      source: 'date_of_accident' },
  { key: 'time_of_accident',     label: 'Time',      source: 'time_of_accident' },
  { key: 'location_in_facility', label: 'Location',  source: 'location_in_facility' },
  { key: 'person_name',          label: 'Person',    source: 'custom.person_name' },
  { key: 'emergency_services_called', label: '911?', source: 'custom.emergency_services_called' },
]

export default async function AccidentHistoryPage() {
  await requireModuleEnabled('accident')
  return (
    <main>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Accident reports</h1>
        <Link
          href="/modules/accident/new"
          className="no-underline bg-accent text-white px-4 py-2 rounded-md font-medium"
        >
          + New accident report
        </Link>
      </div>
      <p className="text-muted text-sm mt-1">Injury to a guest or non-employee.</p>
      <div className="mt-6 overflow-x-auto">
        <FormHistory
          moduleSlug="accident"
          formType={null}
          baseUrl="/modules/accident"
          columns={COLUMNS}
        />
      </div>
    </main>
  )
}
