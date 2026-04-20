import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Subscription gating middleware. Call at the top of every write-path server
 * action. Reads fall through (don't call this; RLS already gates by facility).
 *
 * Status matrix (non-strict):
 *   trialing                     → allow
 *   active                       → allow
 *   past_due within 7-day grace  → allow
 *   past_due past grace          → block
 *   canceled                     → block
 *   (no row)                     → block
 *
 * strict=true collapses the grace window; useful for nuclear ops.
 */

export type GatingReason =
  | 'not_authenticated'
  | 'no_subscription'
  | 'past_due_expired'
  | 'canceled'
  | 'unknown'

export type GatingResult =
  | { ok: true }
  | { ok: false; reason: GatingReason; status?: string; current_period_end?: string | null }

const GRACE_DAYS = 7

export async function requireActiveSubscription(opts?: { strict?: boolean }): Promise<GatingResult> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'not_authenticated' }

  const { data: sub, error } = await supabase
    .from('facility_subscriptions')
    .select('status, current_period_end, plan_tier')
    .maybeSingle()

  if (error) {
    // Fail open for read errors? No — fail closed. Platform admins have an
    // escape hatch elsewhere; an admin who can't read their subscription is
    // unusual and worth surfacing.
    return { ok: false, reason: 'unknown' }
  }
  if (!sub) return { ok: false, reason: 'no_subscription' }

  const status = sub.status as string

  if (status === 'trialing' || status === 'active') return { ok: true }

  if (status === 'canceled') {
    return { ok: false, reason: 'canceled', status, current_period_end: (sub.current_period_end as string | null) ?? null }
  }

  if (status === 'past_due') {
    if (opts?.strict) {
      return {
        ok: false,
        reason: 'past_due_expired',
        status,
        current_period_end: (sub.current_period_end as string | null) ?? null,
      }
    }
    const periodEnd = sub.current_period_end as string | null
    if (!periodEnd) return { ok: false, reason: 'past_due_expired', status }

    const graceCutoff = new Date(periodEnd).getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000
    if (Date.now() <= graceCutoff) return { ok: true }
    return { ok: false, reason: 'past_due_expired', status, current_period_end: periodEnd }
  }

  return { ok: false, reason: 'unknown', status }
}

export type SubscriptionBannerState = {
  kind: 'none' | 'trialing_soon' | 'past_due_grace' | 'past_due_locked' | 'canceled'
  message: string
  days_remaining?: number
}

/**
 * Helper for the global banner component. Reads subscription status and returns
 * a display state. No gating — this is UX-only.
 */
export async function resolveBannerState(): Promise<SubscriptionBannerState> {
  const supabase = await createClient()
  const { data: sub } = await supabase
    .from('facility_subscriptions')
    .select('status, trial_end, current_period_end')
    .maybeSingle()

  if (!sub) return { kind: 'none', message: '' }

  const status = sub.status as string
  const now = Date.now()

  if (status === 'trialing') {
    const trialEnd = sub.trial_end as string | null
    if (!trialEnd) return { kind: 'none', message: '' }
    const daysLeft = Math.max(0, Math.ceil((new Date(trialEnd).getTime() - now) / (1000 * 60 * 60 * 24)))
    if (daysLeft <= 7) {
      return {
        kind: 'trialing_soon',
        message: `Trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
        days_remaining: daysLeft,
      }
    }
    return { kind: 'none', message: '' }
  }

  if (status === 'past_due') {
    const periodEnd = sub.current_period_end as string | null
    if (!periodEnd) return { kind: 'past_due_locked', message: 'Payment past due — account write-locked.' }
    const graceCutoff = new Date(periodEnd).getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000
    if (now <= graceCutoff) {
      return { kind: 'past_due_grace', message: 'Payment failed — update your payment method to keep writing.' }
    }
    return { kind: 'past_due_locked', message: 'Account write-locked. Resolve billing to file reports.' }
  }

  if (status === 'canceled') {
    return { kind: 'canceled', message: 'Subscription canceled — viewing only.' }
  }

  return { kind: 'none', message: '' }
}
