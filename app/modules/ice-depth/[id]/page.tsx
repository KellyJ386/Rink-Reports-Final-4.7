import Link from 'next/link'
import { notFound } from 'next/navigation'

import { SvgRink, type PointWithState } from '@/components/ice-depth/SvgRink'
import { loadSessionForDetail } from '@/lib/ice-depth/session'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'

export default async function IceDepthSessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireModuleEnabled('ice_depth')
  const { id } = await params
  const loaded = await loadSessionForDetail(id)
  if (!loaded) notFound()

  const { session, svg_key, points, readings, surface_name } = loaded
  const readingByKey = new Map<string, number>()
  for (const r of readings) readingByKey.set(r.point_key, Number(r.depth_mm))

  const pointsWithState: PointWithState[] = points.map((p) => ({
    ...p,
    state: readingByKey.has(p.key) ? 'recorded' : 'empty',
    depth_mm: readingByKey.get(p.key) ?? null,
  }))

  return (
    <main>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold">Ice Depth session — {surface_name}</h1>
        <Link href="/modules/ice-depth">← Back to history</Link>
      </div>

      <div className="text-sm text-muted mt-1">
        Filed {new Date(session.submitted_at).toLocaleString()} · Template v{session.form_schema_version} · Status: {session.status}
      </div>

      {session.status === 'in_progress' && (
        <p className="mt-2 text-sm">
          <Link href={`/modules/ice-depth/${session.id}/run`}>Continue session →</Link>
        </p>
      )}

      <div className="mt-6">
        <SvgRink
          svgKey={svg_key}
          points={pointsWithState}
          className="border border-hairline rounded-md bg-white"
        />
      </div>

      <h2 className="text-lg font-semibold mt-6">Readings</h2>
      <table className="w-full border-collapse text-sm mt-2">
        <thead>
          <tr className="border-b border-hairline text-left text-muted">
            <th className="py-2 pr-3 font-medium">Point</th>
            <th className="py-2 pr-3 font-medium">Label</th>
            <th className="py-2 pr-3 font-medium">Depth (mm)</th>
            <th className="py-2 pr-3 font-medium">Recorded</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => {
            const reading = readings.find((r) => r.point_key === p.key)
            return (
              <tr key={p.key} className="border-b border-hairline">
                <td className="py-2 pr-3 font-mono text-xs">{p.sort_order}</td>
                <td className="py-2 pr-3">{p.label}</td>
                <td className="py-2 pr-3">
                  {reading ? `${Number(reading.depth_mm)} mm` : '—'}
                </td>
                <td className="py-2 pr-3 text-muted">
                  {reading ? new Date(reading.recorded_at).toLocaleTimeString() : ''}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </main>
  )
}
