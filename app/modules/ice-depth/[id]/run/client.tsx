'use client'

import { SessionRunner } from '@/components/ice-depth/SessionRunner'
import type { IceDepthPoint, IceDepthReading, SvgKey } from '@/lib/ice-depth/types'

import { completeSessionAction, recordReadingAction } from './actions'

type Props = {
  sessionId: string
  svgKey: SvgKey
  points: IceDepthPoint[]
  initialReadings: IceDepthReading[]
  previousReadings: Record<string, number>
}

export function SessionRunnerClient(props: Props) {
  return (
    <SessionRunner
      sessionId={props.sessionId}
      svgKey={props.svgKey}
      points={props.points}
      initialReadings={props.initialReadings}
      previousReadings={props.previousReadings}
      onRecordReading={recordReadingAction}
      onComplete={completeSessionAction}
    />
  )
}
