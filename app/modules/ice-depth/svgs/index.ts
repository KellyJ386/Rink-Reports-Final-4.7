import type { ReactElement } from 'react'

import type { SvgKey } from '@/lib/ice-depth/types'

import { NHL_VIEWBOX, NhlRinkSvg } from './nhl'
import { OLYMPIC_VIEWBOX, OlympicRinkSvg } from './olympic'
import { STUDIO_VIEWBOX, StudioRinkSvg } from './studio'

type SvgBundle = {
  viewBox: string
  Component: () => ReactElement
  label: string
}

export const RINK_SVGS: Record<SvgKey, SvgBundle> = {
  nhl:     { viewBox: NHL_VIEWBOX,     Component: NhlRinkSvg,     label: 'NHL (200 × 85 ft)' },
  olympic: { viewBox: OLYMPIC_VIEWBOX, Component: OlympicRinkSvg, label: 'Olympic (200 × 100 ft)' },
  studio:  { viewBox: STUDIO_VIEWBOX,  Component: StudioRinkSvg,  label: 'Studio (170 × 75 ft)' },
}
