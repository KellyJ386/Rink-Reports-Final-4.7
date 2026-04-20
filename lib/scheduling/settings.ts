import 'server-only'

import { createClient } from '@/lib/supabase/server'

import type { SwapApprovalMode } from './types'

export type SchedulingSettings = {
  swap_approval_mode: SwapApprovalMode
  availability_cutoff_days: number
}

const DEFAULTS: SchedulingSettings = {
  swap_approval_mode: 'manager_approval',
  availability_cutoff_days: 14,
}

/**
 * Read `facilities.settings.scheduling.*` for the caller's facility, falling
 * back to documented defaults when a key is unset. The config pane that writes
 * these keys is Agent 6 Phase 5.
 */
export async function loadSchedulingSettings(): Promise<SchedulingSettings> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('facilities')
    .select('settings')
    .maybeSingle()

  const raw = (data?.settings as { scheduling?: Partial<SchedulingSettings> } | null)
    ?.scheduling

  return {
    swap_approval_mode:
      raw?.swap_approval_mode === 'free' || raw?.swap_approval_mode === 'manager_approval'
        ? raw.swap_approval_mode
        : DEFAULTS.swap_approval_mode,
    availability_cutoff_days:
      typeof raw?.availability_cutoff_days === 'number' && raw.availability_cutoff_days > 0
        ? Math.floor(raw.availability_cutoff_days)
        : DEFAULTS.availability_cutoff_days,
  }
}
