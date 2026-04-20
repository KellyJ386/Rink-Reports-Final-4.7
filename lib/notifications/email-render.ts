import type { NotificationKind } from './email-catalog'

/**
 * Per-kind email template. Returns { subject, html }. Plain HTML for v1.
 *
 * Kinds that aren't covered here will throw, which surfaces as a send error —
 * good signal that a new kind was added to the catalog without a template.
 */

type RenderArgs = {
  appUrl: string
  kind: NotificationKind
  payload: Record<string, unknown>
  recipientName?: string
}

export function renderNotificationEmail(args: RenderArgs): { subject: string; html: string } {
  const { appUrl, kind, payload } = args

  switch (kind) {
    case 'announcement.posted':
      return {
        subject: `[Urgent] ${String(payload.title ?? 'New announcement')}`,
        html: wrap(
          `An urgent announcement was posted at your facility:`,
          `<p><strong>${escape(String(payload.title ?? ''))}</strong></p>`,
          `<p>From: ${escape(String(payload.author_name ?? 'Manager'))}</p>`,
          cta(appUrl, '/modules/communications', 'Open announcement'),
        ),
      }
    case 'announcement.ack_reminder':
      return {
        subject: `Reminder: acknowledge "${String(payload.title ?? 'announcement')}"`,
        html: wrap(
          `A manager is waiting for you to acknowledge this announcement:`,
          `<p><strong>${escape(String(payload.title ?? ''))}</strong></p>`,
          cta(appUrl, '/modules/communications', 'Acknowledge'),
        ),
      }
    case 'schedule.published':
      return {
        subject: `Schedule published for week of ${String(payload.week_start_date ?? '')}`,
        html: wrap(
          `Your shifts for the week are live.`,
          cta(appUrl, '/modules/scheduling', 'View schedule'),
        ),
      }
    case 'schedule.edited_after_publish':
      return {
        subject: `Your shifts have changed`,
        html: wrap(
          `A manager updated the published schedule. Your assignments may have changed.`,
          cta(appUrl, '/modules/scheduling', 'View schedule'),
        ),
      }
    case 'swap.proposed':
      return {
        subject: `Shift swap request from ${String(payload.requester_name ?? 'a colleague')}`,
        html: wrap(
          `${escape(String(payload.requester_name ?? 'Someone'))} proposed a swap with you.`,
          cta(appUrl, '/modules/scheduling/swaps', 'Review swap'),
        ),
      }
    case 'swap.decided':
      return {
        subject: `Swap ${String(payload.status ?? 'decided')}`,
        html: wrap(
          `Your swap request was ${escape(String(payload.status ?? 'decided'))}.`,
          payload.note ? `<p>Note: ${escape(String(payload.note))}</p>` : '',
          cta(appUrl, '/modules/scheduling/swaps', 'View swap'),
        ),
      }
    case 'time_off.decided':
      return {
        subject: `Time-off request ${String(payload.status ?? 'decided')}`,
        html: wrap(
          `Your time-off request was ${escape(String(payload.status ?? 'decided'))}.`,
          payload.note ? `<p>Note: ${escape(String(payload.note))}</p>` : '',
          cta(appUrl, '/modules/scheduling/time-off', 'View time-off'),
        ),
      }
    case 'subscription.trial_ending':
      return {
        subject: `Trial ending in ${String(payload.days_remaining ?? '?')} days`,
        html: wrap(
          `Your trial ends soon. Add a payment method to keep filing reports.`,
          cta(appUrl, '/admin/billing', 'Manage billing'),
        ),
      }
    case 'subscription.past_due':
      return {
        subject: `Payment past due`,
        html: wrap(
          `Your most recent payment failed. Update your payment method to avoid losing write access.`,
          cta(appUrl, '/admin/billing', 'Manage billing'),
        ),
      }
    case 'swap.accepted_by_target':
      // Not email-eligible; we include a template for completeness in case policy changes.
      return {
        subject: `Swap accepted, awaiting your approval`,
        html: wrap(
          `A shift swap is pending your manager approval.`,
          cta(appUrl, '/modules/scheduling/manage/swaps', 'Review'),
        ),
      }
    case 'time_off.submitted':
      // Manager-facing; not currently email-eligible but template kept for completeness.
      return {
        subject: `New time-off request from ${String(payload.requester_name ?? 'staff')}`,
        html: wrap(
          `A staff member submitted a time-off request.`,
          cta(appUrl, '/modules/scheduling/manage/time-off', 'Review'),
        ),
      }
    case 'time_off.withdrawn_after_approval':
      return {
        subject: `Time-off withdrawn after approval`,
        html: wrap(
          `A previously-approved time-off request was withdrawn by the requester. Your published schedule was not changed.`,
          cta(appUrl, '/modules/scheduling/manage/time-off', 'Review'),
        ),
      }
    case 'availability.cutoff_approaching':
      return {
        subject: `Availability cutoff approaching for week of ${String(payload.week_start_date ?? '')}`,
        html: wrap(
          `The availability submission deadline is coming up. If you haven't submitted availability for this week, your manager will schedule without it.`,
          cta(appUrl, '/modules/scheduling/availability', 'Submit availability'),
        ),
      }
    default: {
      const _exhaustive: never = kind
      throw new Error(`No email template for kind: ${String(_exhaustive)}`)
    }
  }
}

function wrap(...parts: string[]): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111827;max-width:600px;margin:0 auto;padding:24px">${parts.filter(Boolean).join('')}</body></html>`
}

function cta(appUrl: string, path: string, label: string): string {
  const href = `${appUrl}${path}`
  return `<p style="margin-top:24px"><a href="${href}" style="display:inline-block;padding:12px 20px;background:#0ea5e9;color:white;text-decoration:none;border-radius:6px">${escape(label)}</a></p>`
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
