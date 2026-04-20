'use client'

import { TemplateEditor } from '@/components/ice-depth/TemplateEditor'
import type { IceDepthPoint, SvgKey } from '@/lib/ice-depth/types'

import { discardDraftAction, publishAction, saveDraftAction } from './actions'

type Props = {
  templateId: string
  initial: {
    name: string
    svg_key: SvgKey
    current_points: IceDepthPoint[]
    draft_points: IceDepthPoint[] | null
    version: number
  }
}

export function EditTemplateClient(props: Props) {
  return (
    <TemplateEditor
      templateId={props.templateId}
      initial={props.initial}
      onSaveDraft={saveDraftAction}
      onPublish={publishAction}
      onDiscardDraft={discardDraftAction}
    />
  )
}
