import 'server-only'

import { createClient } from '@/lib/supabase/server'

import type {
  AvailabilityOverrideRow,
  AvailabilityTemplateRow,
  EffectiveAvailabilityRow,
} from './types'

/**
 * Read the caller's recurring template.
 */
export async function fetchMyTemplate(): Promise<AvailabilityTemplateRow[]> {
  const supabase = await createClient()
  const { data: user } = await supabase.auth.getUser()
  if (!user.user) return []
  const { data } = await supabase
    .from('availability_templates')
    .select('*')
    .eq('user_id', user.user.id)
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true })
  return (data ?? []) as AvailabilityTemplateRow[]
}

export type TemplateBlockInput = {
  day_of_week: number
  start_time: string // HH:MM
  end_time: string
  status: 'available' | 'unavailable' | 'preferred'
}

/**
 * Replace the caller's template with the given set of blocks. We delete + bulk
 * insert inside a single round trip — simpler than diffing row-by-row and the
 * data volume is tiny (tens of rows per user max).
 */
export async function replaceTemplate(blocks: TemplateBlockInput[]): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: user } = await supabase.auth.getUser()
  if (!user.user) return { ok: false, error: 'not_authenticated' }
  const { error: delErr } = await supabase
    .from('availability_templates')
    .delete()
    .eq('user_id', user.user.id)
  if (delErr) return { ok: false, error: delErr.message }
  if (blocks.length === 0) return { ok: true }
  const { error: insErr } = await supabase.from('availability_templates').insert(
    blocks.map((b) => ({
      user_id: user.user!.id,
      day_of_week: b.day_of_week,
      start_time: b.start_time,
      end_time: b.end_time,
      status: b.status,
    })),
  )
  if (insErr) return { ok: false, error: insErr.message }
  return { ok: true }
}

export async function fetchMyOverridesForWeek(weekStartDate: string): Promise<AvailabilityOverrideRow[]> {
  const supabase = await createClient()
  const { data: user } = await supabase.auth.getUser()
  if (!user.user) return []
  const { data } = await supabase
    .from('availability_overrides')
    .select('*')
    .eq('user_id', user.user.id)
    .eq('week_start_date', weekStartDate)
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true })
  return (data ?? []) as AvailabilityOverrideRow[]
}

export type OverrideBlockInput = TemplateBlockInput

/**
 * Replace the caller's overrides for `weekStartDate` with the given blocks.
 * Additive semantics: only days included in `blocks` get override rows; days
 * not present fall back to the template.
 */
export async function replaceOverridesForWeek(
  weekStartDate: string,
  blocks: OverrideBlockInput[],
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: user } = await supabase.auth.getUser()
  if (!user.user) return { ok: false, error: 'not_authenticated' }
  const { error: delErr } = await supabase
    .from('availability_overrides')
    .delete()
    .eq('user_id', user.user.id)
    .eq('week_start_date', weekStartDate)
  if (delErr) return { ok: false, error: delErr.message }
  if (blocks.length === 0) return { ok: true }
  const { error: insErr } = await supabase.from('availability_overrides').insert(
    blocks.map((b) => ({
      user_id: user.user!.id,
      week_start_date: weekStartDate,
      day_of_week: b.day_of_week,
      start_time: b.start_time,
      end_time: b.end_time,
      status: b.status,
    })),
  )
  if (insErr) return { ok: false, error: insErr.message }
  return { ok: true }
}

/**
 * Effective availability for a specific user and week. Calls the SQL function
 * which encapsulates the additive override + template resolution.
 */
export async function fetchEffectiveAvailability(
  userId: string,
  weekStartDate: string,
): Promise<EffectiveAvailabilityRow[]> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('effective_availability_for_week', {
    p_user_id: userId,
    p_week_start_date: weekStartDate,
  })
  return (data ?? []) as EffectiveAvailabilityRow[]
}
