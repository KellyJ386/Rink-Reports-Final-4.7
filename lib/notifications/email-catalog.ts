/**
 * Email-eligible notification kinds. Only kinds listed here are considered for
 * email delivery. In-app delivery + Realtime are always performed regardless.
 *
 * Adding a new email-eligible kind requires: (a) adding it here, (b) adding the
 * corresponding template rendering case in lib/notifications/email-template.ts.
 */

export type NotificationKind =
  | 'announcement.posted'
  | 'announcement.ack_reminder'
  | 'schedule.published'
  | 'schedule.edited_after_publish'
  | 'swap.proposed'
  | 'swap.accepted_by_target'
  | 'swap.decided'
  | 'time_off.decided'
  | 'subscription.trial_ending'
  | 'subscription.past_due'

/** Predicate: should this payload trigger email delivery? */
export type EmailEligibility = {
  kind: NotificationKind
  /** Returns true if this specific payload is eligible for email. Some kinds
   *  (e.g. announcement.posted) only email for urgent priority; others always email. */
  isEligible: (payload: Record<string, unknown>) => boolean
}

export const EMAIL_CATALOG: EmailEligibility[] = [
  {
    kind: 'announcement.posted',
    isEligible: (p) => p.priority === 'urgent',
  },
  { kind: 'announcement.ack_reminder', isEligible: () => true },
  { kind: 'schedule.published', isEligible: () => true },
  { kind: 'schedule.edited_after_publish', isEligible: () => true },
  { kind: 'swap.proposed', isEligible: () => true },
  { kind: 'swap.accepted_by_target', isEligible: () => false }, // in-app only
  { kind: 'swap.decided', isEligible: () => true },
  { kind: 'time_off.decided', isEligible: () => true },
  { kind: 'subscription.trial_ending', isEligible: () => true },
  { kind: 'subscription.past_due', isEligible: () => true },
]

export function isEmailEligible(
  kind: string,
  payload: Record<string, unknown>,
): boolean {
  const entry = EMAIL_CATALOG.find((e) => e.kind === kind)
  if (!entry) return false
  return entry.isEligible(payload)
}
