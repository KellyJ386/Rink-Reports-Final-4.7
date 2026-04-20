import Link from 'next/link'

import { TrendChart } from '@/components/ice-depth/TrendChart'
import { loadTrendReadings } from '@/lib/ice-depth/session'
import { createClient } from '@/lib/supabase/server'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'

export default async function IceDepthTrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ surface?: string }>
}) {
  await requireModuleEnabled('ice_depth')
  const sp = await searchParams
  const supabase = await createClient()

  // List surfaces in the current facility
  const { data: surfaces } = await supabase
    .from('facility_resources')
    .select('id, name')
    .eq('resource_type', 'surface')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  const surfaceList = (surfaces as { id: string; name: string }[] | null) ?? []
  const selectedSurfaceId = sp.surface ?? surfaceList[0]?.id

  let chartData: Awaited<ReturnType<typeof loadTrendReadings>> = []
  let currentPoints: Array<{ key: string; label: string; x_pct: number; y_pct: number; sort_order: number }> = []

  if (selectedSurfaceId) {
    chartData = await loadTrendReadings({ surfaceResourceId: selectedSurfaceId })
    // Resolve the current template's point labels for the legend
    const { data: tmpl } = await supabase
      .from('ice_depth_templates')
      .select('current_points')
      .eq('surface_resource_id', selectedSurfaceId)
      .maybeSingle()
    currentPoints = (tmpl?.current_points as typeof currentPoints) ?? []
  }

  return (
    <main>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold">Ice Depth trends</h1>
        <Link href="/modules/ice-depth">← Back to sessions</Link>
      </div>

      {surfaceList.length === 0 ? (
        <p className="text-muted mt-4 text-sm">
          No ice surfaces configured for this facility. An admin must add a surface in Resources.
        </p>
      ) : (
        <>
          <form method="get" className="mt-4">
            <label className="flex flex-col gap-1 text-sm max-w-xs">
              Surface
              <select name="surface" defaultValue={selectedSurfaceId} onChange={(e) => e.currentTarget.form?.submit()}>
                {surfaceList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </form>

          <div className="mt-6">
            <TrendChart currentPoints={currentPoints} readings={chartData} />
          </div>
        </>
      )}
    </main>
  )
}
