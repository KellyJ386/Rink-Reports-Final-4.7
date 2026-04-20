'use client'

import type { CSSProperties } from 'react'

import { RINK_SVGS } from '@/app/modules/ice-depth/svgs'
import type { IceDepthPoint, SvgKey } from '@/lib/ice-depth/types'

export type PointState = 'empty' | 'recorded' | 'selected'

export type PointWithState = IceDepthPoint & {
  state: PointState
  depth_mm?: number | null
}

type Props = {
  svgKey: SvgKey
  points: PointWithState[]
  onPointTap?: (point: PointWithState) => void
  /**
   * Optional threshold (mm). Points recorded below this render with a danger fill.
   */
  threshold?: number
  /** Optional color per point, overrides default fills (used by detail overlay). */
  fillByKey?: Record<string, string>
  className?: string
  style?: CSSProperties
}

/**
 * Shared SVG rink renderer. Draws the chosen bundled backdrop, overlays points,
 * and forwards taps.
 */
export function SvgRink({ svgKey, points, onPointTap, threshold, fillByKey, className, style }: Props) {
  const bundle = RINK_SVGS[svgKey]
  const viewBox = bundle.viewBox
  const [, , vw, vh] = viewBox.split(' ').map(Number)

  return (
    <svg
      viewBox={viewBox}
      role="img"
      aria-label={`${bundle.label} with ${points.length} measurement points`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      style={{ touchAction: 'pan-x pan-y pinch-zoom', width: '100%', height: 'auto', ...style }}
    >
      <bundle.Component />

      {points.map((p) => {
        const cx = (vw * p.x_pct) / 100
        const cy = (vh * p.y_pct) / 100
        const custom = fillByKey?.[p.key]
        const { fill, stroke } = colorsFor(p, threshold, custom)
        const radius = p.state === 'selected' ? 4.5 : 3.5

        return (
          <g key={p.key}>
            {/* Tap-target halo: larger invisible circle (≥44px at typical render sizes) */}
            <circle
              cx={cx}
              cy={cy}
              r={6}
              fill="transparent"
              style={{ cursor: onPointTap ? 'pointer' : 'default' }}
              onClick={onPointTap ? () => onPointTap(p) : undefined}
              onKeyDown={
                onPointTap
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onPointTap(p)
                      }
                    }
                  : undefined
              }
              tabIndex={onPointTap ? 0 : -1}
              role={onPointTap ? 'button' : undefined}
              aria-label={onPointTap ? `${p.label}${p.depth_mm != null ? ` (${p.depth_mm} mm)` : ''}` : undefined}
            />
            {/* Visible marker */}
            <circle cx={cx} cy={cy} r={radius} fill={fill} stroke={stroke} strokeWidth="0.6" />
            {/* Label */}
            <text
              x={cx + 5}
              y={cy + 1.5}
              fontSize="3"
              fill="#1e293b"
              fontFamily="system-ui, sans-serif"
              pointerEvents="none"
            >
              {labelNumberFor(p)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function colorsFor(
  p: PointWithState,
  threshold: number | undefined,
  custom: string | undefined,
): { fill: string; stroke: string } {
  if (custom) return { fill: custom, stroke: '#1e293b' }

  if (p.state === 'empty') {
    return { fill: '#ffffff', stroke: '#64748b' }
  }
  if (p.state === 'selected') {
    return { fill: '#facc15', stroke: '#a16207' }
  }
  // recorded
  if (threshold != null && p.depth_mm != null && p.depth_mm < threshold) {
    return { fill: '#fecaca', stroke: '#b91c1c' }
  }
  return { fill: '#bbf7d0', stroke: '#166534' }
}

function labelNumberFor(p: IceDepthPoint): string {
  // Show sort_order or the key's trailing digit as a small label
  if (Number.isFinite(p.sort_order) && p.sort_order > 0) return String(p.sort_order)
  const m = p.key.match(/(\d+)$/)
  return m?.[1] ?? ''
}
