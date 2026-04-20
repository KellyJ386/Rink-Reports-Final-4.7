/**
 * Shared types for the Ice Depth module.
 *
 * The SVG backdrop is one of three bundled keys: 'nhl' | 'olympic' | 'studio'.
 * Measurement points are stored as percentage coordinates (0–100) so the point layout
 * is invariant to the SVG viewBox choice.
 */

export type SvgKey = 'nhl' | 'olympic' | 'studio'

export type IceDepthPoint = {
  key: string            // snake_case stable identifier
  label: string          // display, editable
  x_pct: number          // 0–100
  y_pct: number          // 0–100
  sort_order: number
}

export type IceDepthTemplateSummary = {
  id: string
  facility_id: string
  surface_resource_id: string
  surface_name: string
  name: string
  svg_key: SvgKey
  version: number
  is_published: boolean
  has_draft: boolean
  current_points: IceDepthPoint[]
  draft_points: IceDepthPoint[] | null
  updated_at: string
}

export type IceDepthSession = {
  id: string
  facility_id: string
  template_id: string
  form_schema_version: number
  surface_resource_id: string
  status: 'in_progress' | 'completed' | 'abandoned'
  submitted_by: string
  submitted_at: string
  notes: string | null
}

export type IceDepthReading = {
  session_id: string
  point_key: string
  depth_mm: number
  recorded_at: string
}

export type SessionStartInput = {
  template_id: string
  idempotency_key?: string
}

export type SessionStartResult =
  | {
      ok: true
      session_id: string
      template_version: number
      svg_key: SvgKey
      points: IceDepthPoint[]
      idempotent_return: boolean
    }
  | { ok: false; error: string }

export type RecordReadingInput = {
  session_id: string
  point_key: string
  depth_mm: number
}

export type CompleteSessionResult =
  | { ok: true }
  | { ok: false; error: string; missing_point_keys?: string[] }
