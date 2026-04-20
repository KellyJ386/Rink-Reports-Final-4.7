'use client'

import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { TrendPoint } from '@/lib/ice-depth/session'
import type { IceDepthPoint } from '@/lib/ice-depth/types'

type Props = {
  /** Current template's active points — used to label lines. A reading whose point_key is no
   *  longer in the template still appears (via its key); the legend just won't have a friendly label. */
  currentPoints: IceDepthPoint[]
  readings: TrendPoint[]
}

const LINE_COLORS = [
  '#0ea5e9',
  '#22c55e',
  '#f97316',
  '#a855f7',
  '#ef4444',
  '#14b8a6',
  '#eab308',
  '#6366f1',
  '#ec4899',
  '#64748b',
]

export function TrendChart({ currentPoints, readings }: Props) {
  const [threshold, setThreshold] = useState<string>('')
  const thresholdN = Number(threshold)
  const thresholdActive = Number.isFinite(thresholdN) && thresholdN > 0

  const { data, pointKeys, labelByKey } = useMemo(() => {
    // Group by session submission date (UTC date string)
    const bySession = new Map<string, Record<string, number | string>>()
    const pointKeys = new Set<string>()

    for (const r of readings) {
      const dateKey = new Date(r.submitted_at).toISOString().slice(0, 10)
      const existing = bySession.get(dateKey) ?? { date: dateKey }
      existing[r.point_key] = Number(r.depth_mm)
      bySession.set(dateKey, existing)
      pointKeys.add(r.point_key)
    }

    const labelByKey: Record<string, string> = {}
    for (const p of currentPoints) labelByKey[p.key] = p.label
    for (const k of pointKeys) if (!labelByKey[k]) labelByKey[k] = k

    const data = [...bySession.values()].sort((a, b) =>
      String(a.date).localeCompare(String(b.date)),
    )
    return { data, pointKeys: [...pointKeys], labelByKey }
  }, [readings, currentPoints])

  if (readings.length === 0) {
    return <p className="text-muted text-sm">No completed readings yet for this surface.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex-row items-center gap-2 text-sm">
        <span>Highlight below</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="1"
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          placeholder="mm"
          className="w-24"
        />
      </label>

      <div className="w-full h-72 border border-hairline rounded-md bg-white p-2">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis
              domain={['auto', 'auto']}
              unit="mm"
              tick={{ fontSize: 12 }}
              width={56}
            />
            <Tooltip
              formatter={(value: unknown, name: unknown) => [
                `${value} mm`,
                labelByKey[String(name)] ?? String(name),
              ]}
            />
            <Legend formatter={(value) => labelByKey[String(value)] ?? String(value)} />
            {thresholdActive && (
              <ReferenceLine y={thresholdN} stroke="#dc2626" strokeDasharray="4 4" />
            )}
            {pointKeys.map((k, idx) => (
              <Line
                key={k}
                type="monotone"
                dataKey={k}
                stroke={LINE_COLORS[idx % LINE_COLORS.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
