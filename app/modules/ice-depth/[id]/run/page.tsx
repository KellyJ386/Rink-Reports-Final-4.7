import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { loadSessionForDetail, loadTrendReadings } from '@/lib/ice-depth/session'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'

import { SessionRunnerClient } from './client'

export default async function RunSessionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireModuleEnabled('ice_depth')
  const { id } = await params
  const loaded = await loadSessionForDetail(id)
  if (!loaded) notFound()

  const { session, svg_key, points, readings, surface_name } = loaded

  // If already completed, redirect to the detail view
  if (session.status === 'completed') {
    redirect(`/modules/ice-depth/${session.id}`)
  }
  if (session.status === 'abandoned') {
    return (
      <main>
        <h1 className="text-xl font-semibold">Session abandoned</h1>
        <p className="text-muted mt-2">This session cannot be resumed.</p>
        <p className="mt-4">
          <Link href="/modules/ice-depth">← Back to history</Link>
        </p>
      </main>
    )
  }

  // Previous session's readings for contextual display in the ReadingModal
  const trend = await loadTrendReadings({
    surfaceResourceId: session.surface_resource_id,
  })
  const previousReadings: Record<string, number> = {}
  const mostRecentByPoint = new Map<string, { date: string; depth: number }>()
  for (const t of trend) {
    const existing = mostRecentByPoint.get(t.point_key)
    if (!existing || t.submitted_at > existing.date) {
      mostRecentByPoint.set(t.point_key, { date: t.submitted_at, depth: t.depth_mm })
    }
  }
  for (const [k, v] of mostRecentByPoint) previousReadings[k] = v.depth

  return (
    <main>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold">Ice Depth — {surface_name}</h1>
        <Link href="/modules/ice-depth">Leave (save progress)</Link>
      </div>
      <p className="text-muted text-sm mt-1">Tap a point to record a depth.</p>

      <div className="mt-4">
        <SessionRunnerClient
          sessionId={session.id}
          svgKey={svg_key}
          points={points}
          initialReadings={readings}
          previousReadings={previousReadings}
        />
      </div>
    </main>
  )
}
