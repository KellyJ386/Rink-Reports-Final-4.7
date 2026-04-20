import { createClient } from '@/lib/supabase/server'

import { ResourcesTabs } from './ResourcesTabs'

const RESOURCE_TYPES: Array<{ type: string; label: string; description: string }> = [
  { type: 'surface', label: 'Ice surfaces', description: 'Ice sheets / rinks the facility operates.' },
  { type: 'compressor', label: 'Compressors', description: 'Refrigeration compressors.' },
  { type: 'zamboni', label: 'Zambonis', description: 'Ice resurfacers.' },
  { type: 'air_quality_device', label: 'Air quality devices', description: 'CO / NO₂ / particulate sensors.' },
  { type: 'shift_position', label: 'Shift positions', description: 'Scheduling positions (e.g. "Front Desk", "Zamboni Driver").' },
]

export default async function AdminResourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>
}) {
  const sp = await searchParams
  const activeType = RESOURCE_TYPES.some((r) => r.type === sp.type) ? sp.type! : 'surface'

  const supabase = await createClient()
  const { data: resources } = await supabase
    .from('facility_resources')
    .select('id, resource_type, name, sort_order, is_active')
    .eq('resource_type', activeType)
    .order('sort_order', { ascending: true })

  return (
    <main>
      <h1 className="text-xl font-semibold">Resources</h1>
      <p className="text-muted text-sm mt-1">
        Per-facility entities referenced by form fields and modules. Resources soft-delete via
        the active toggle — historical submissions preserve references even after deactivation.
      </p>

      <div className="mt-6">
        <ResourcesTabs
          types={RESOURCE_TYPES}
          activeType={activeType}
          resources={(resources ?? []) as Array<{
            id: string
            resource_type: string
            name: string
            sort_order: number
            is_active: boolean
          }>}
        />
      </div>
    </main>
  )
}
