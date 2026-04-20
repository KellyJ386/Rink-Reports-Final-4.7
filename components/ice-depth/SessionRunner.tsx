'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import type { IceDepthPoint, IceDepthReading, SvgKey } from '@/lib/ice-depth/types'

import { ReadingModal } from './ReadingModal'
import { SvgRink, type PointWithState } from './SvgRink'

type Props = {
  sessionId: string
  svgKey: SvgKey
  points: IceDepthPoint[]
  initialReadings: IceDepthReading[]
  /** Previous session's readings for the same surface, keyed by point_key (for context in the modal). */
  previousReadings?: Record<string, number>
  onRecordReading: (input: {
    session_id: string
    point_key: string
    depth_mm: number
  }) => Promise<{ ok: true } | { ok: false; error: string }>
  onComplete: (
    sessionId: string,
  ) => Promise<{ ok: true } | { ok: false; error: string; missing_point_keys?: string[] }>
}

export function SessionRunner({
  sessionId,
  svgKey,
  points,
  initialReadings,
  previousReadings = {},
  onRecordReading,
  onComplete,
}: Props) {
  const router = useRouter()
  const [readings, setReadings] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {}
    for (const r of initialReadings) map[r.point_key] = Number(r.depth_mm)
    return map
  })
  const [selectedPoint, setSelectedPoint] = useState<IceDepthPoint | null>(null)
  const [saving, setSaving] = useState(false)
  const [completeError, setCompleteError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const recordedCount = Object.keys(readings).length
  const totalCount = points.length
  const progressPct = totalCount === 0 ? 0 : Math.round((recordedCount / totalCount) * 100)
  const allRecorded = recordedCount >= totalCount

  const pointsWithState: PointWithState[] = points.map((p) => ({
    ...p,
    state:
      selectedPoint?.key === p.key
        ? 'selected'
        : readings[p.key] != null
          ? 'recorded'
          : 'empty',
    depth_mm: readings[p.key] ?? null,
  }))

  const onPointTap = (p: PointWithState) => {
    setSelectedPoint(p)
  }

  const handleSave = async (depthMm: number) => {
    if (!selectedPoint) return
    setSaving(true)
    const result = await onRecordReading({
      session_id: sessionId,
      point_key: selectedPoint.key,
      depth_mm: depthMm,
    })
    setSaving(false)
    if (result.ok) {
      setReadings((prev) => ({ ...prev, [selectedPoint.key]: depthMm }))
      setSelectedPoint(null)
      startTransition(() => router.refresh())
    } else {
      // Show error under the input by re-opening with the error (ReadingModal manages local error state)
      // Simplest: keep modal open; caller can retry. We bubble into completeError for visibility.
      setCompleteError(result.error)
    }
  }

  const handleComplete = async () => {
    setCompleteError(null)
    const result = await onComplete(sessionId)
    if (result.ok) {
      router.push('/modules/ice-depth')
      router.refresh()
    } else {
      const missing = result.missing_point_keys ?? []
      setCompleteError(
        missing.length > 0
          ? `Still need readings for ${missing.length} point(s): ${missing.join(', ')}`
          : result.error,
      )
    }
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <SvgRink
          svgKey={svgKey}
          points={pointsWithState}
          onPointTap={onPointTap}
          className="border border-hairline rounded-md bg-white"
        />

        <div className="flex items-center justify-between text-sm">
          <div className="flex-1">
            <div className="h-2 rounded bg-hairline overflow-hidden">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${progressPct}%` }}
                aria-hidden
              />
            </div>
            <div className="text-muted mt-1">
              {recordedCount} of {totalCount} points recorded
            </div>
          </div>
        </div>

        {completeError && (
          <p role="alert" className="text-danger text-sm">
            {completeError}
          </p>
        )}

        <button
          type="button"
          onClick={handleComplete}
          disabled={!allRecorded}
          className="self-start py-2"
        >
          {allRecorded ? 'Complete session' : `Complete (${recordedCount}/${totalCount})`}
        </button>
      </div>

      {selectedPoint && (
        <ReadingModal
          point={selectedPoint}
          previousDepthMm={previousReadings[selectedPoint.key] ?? null}
          initialDepthMm={readings[selectedPoint.key] ?? null}
          pending={saving}
          onSave={handleSave}
          onCancel={() => setSelectedPoint(null)}
        />
      )}
    </>
  )
}
