export type ScheduleStatus = 'draft' | 'published' | 'archived'

export type Schedule = {
  id: string
  facility_id: string
  week_start_date: string
  status: ScheduleStatus
  created_by: string
  created_at: string
  published_at: string | null
  published_by: string | null
  archived_at: string | null
  archived_by: string | null
}

export type Shift = {
  id: string
  facility_id: string
  schedule_id: string
  position_resource_id: string
  starts_at: string
  ends_at: string
  notes: string | null
  required_headcount: number
  created_at: string
}

export type ShiftAssignment = {
  id: string
  shift_id: string
  user_id: string
  assigned_at: string
  assigned_by: string | null
}

export type AvailabilityStatus = 'available' | 'unavailable' | 'preferred'

export type AvailabilityTemplateRow = {
  id: string
  facility_id: string
  user_id: string
  day_of_week: 0 | 1 | 2 | 3 | 4 | 5 | 6
  start_time: string
  end_time: string
  status: AvailabilityStatus
  created_at: string
  updated_at: string
}

export type AvailabilityOverrideRow = {
  id: string
  facility_id: string
  user_id: string
  week_start_date: string
  day_of_week: 0 | 1 | 2 | 3 | 4 | 5 | 6
  start_time: string
  end_time: string
  status: AvailabilityStatus
  created_at: string
}

export type EffectiveAvailabilityRow = {
  day_of_week: 0 | 1 | 2 | 3 | 4 | 5 | 6
  start_time: string
  end_time: string
  status: AvailabilityStatus
  source: 'override' | 'template'
}

export type TimeOffStatus = 'pending' | 'approved' | 'denied' | 'withdrawn'

export type TimeOffRequest = {
  id: string
  facility_id: string
  user_id: string
  starts_at: string
  ends_at: string
  reason: string | null
  status: TimeOffStatus
  decided_by: string | null
  decided_at: string | null
  decision_note: string | null
  schedule_adjusted_before_withdraw: boolean
  created_at: string
  idempotency_key: string | null
}

export type SwapStatus =
  | 'pending_target'
  | 'pending_manager'
  | 'approved'
  | 'denied'
  | 'withdrawn'

export type SwapApprovalMode = 'free' | 'manager_approval'

export type ShiftSwapRequest = {
  id: string
  facility_id: string
  requester_user_id: string
  requester_shift_id: string
  target_user_id: string
  target_shift_id: string | null
  status: SwapStatus
  target_response_at: string | null
  decided_by: string | null
  decided_at: string | null
  decision_note: string | null
  created_at: string
  idempotency_key: string | null
}

export type ShiftPosition = {
  id: string
  name: string
  sort_order: number
}
