import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

import { isEmailEligible, type NotificationKind } from './email-catalog'
import { renderNotificationEmail } from './email-render'
import { sendEmail } from './email-send'

/**
 * publishNotification: single entry point for any module to fire a notification.
 *
 *   1. Calls DB publish_notification(user_id, kind, payload) — inserts row, fires
 *      Supabase Realtime via the notifications table's changefeed automatically.
 *   2. If email-eligible per catalog AND facility's
 *      settings.notifications.email_enabled !== false, renders + sends via Resend
 *      and stamps email_sent_at on the notification row.
 *
 * Callers don't need to know about email — this function handles delivery policy.
 */

export type PublishNotificationInput = {
  user_id: string
  kind: NotificationKind
  payload?: Record<string, unknown>
}

export type PublishNotificationResult =
  | { ok: true; notification_id: string; email_sent: boolean }
  | { ok: false; error: string }

export async function publishNotification(
  input: PublishNotificationInput,
): Promise<PublishNotificationResult> {
  const supabase = await createClient()
  const payload = input.payload ?? {}

  // 1. Insert the notification
  const { data: notifId, error: rpcError } = await supabase.rpc('publish_notification', {
    p_user_id: input.user_id,
    p_kind: input.kind,
    p_payload: payload,
  })
  if (rpcError) return { ok: false, error: rpcError.message }
  if (!notifId) return { ok: false, error: 'publish_notification returned no id' }

  const notificationId = notifId as string

  // 2. Email eligibility check
  if (!isEmailEligible(input.kind, payload)) {
    return { ok: true, notification_id: notificationId, email_sent: false }
  }

  // 3. Check facility setting (service role — notification RLS wouldn't let us read
  //    cross-user anyway, so we use service role for this read + the subsequent
  //    email_sent_at update).
  const svc = createServiceClient()
  const { data: user } = await svc
    .from('users')
    .select('email, full_name, facility_id')
    .eq('id', input.user_id)
    .maybeSingle()

  if (!user?.email) {
    // No email on file; skip silently
    return { ok: true, notification_id: notificationId, email_sent: false }
  }

  const { data: facility } = await svc
    .from('facilities')
    .select('settings')
    .eq('id', user.facility_id as string)
    .maybeSingle()

  const emailEnabled =
    (facility?.settings as { notifications?: { email_enabled?: boolean } } | null)?.notifications
      ?.email_enabled !== false

  if (!emailEnabled) {
    return { ok: true, notification_id: notificationId, email_sent: false }
  }

  // 4. Render + send
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.rinkreports.com'
  const { subject, html } = renderNotificationEmail({
    appUrl,
    kind: input.kind,
    payload,
    recipientName: (user.full_name as string | null) ?? undefined,
  })

  const send = await sendEmail({ to: user.email as string, subject, html })
  if (!send.ok) {
    console.error('publishNotification: email send failed', send.error)
    // Non-fatal — the in-app notification still exists
    return { ok: true, notification_id: notificationId, email_sent: false }
  }

  if (send.skipped) {
    return { ok: true, notification_id: notificationId, email_sent: false }
  }

  // 5. Mark email_sent_at (service role bypass; UPDATE trigger restricts what authenticated can touch)
  const { error: stampError } = await svc
    .from('notifications')
    .update({ email_sent_at: new Date().toISOString() })
    .eq('id', notificationId)

  if (stampError) {
    console.error('publishNotification: failed to stamp email_sent_at', stampError)
  }

  return { ok: true, notification_id: notificationId, email_sent: true }
}

/**
 * Bulk-publish. Useful when an announcement posts to every staff member in a
 * facility. Runs serially to keep things simple — tens of recipients at a time
 * is typical.
 */
export async function publishNotificationMany(
  inputs: PublishNotificationInput[],
): Promise<{ successes: number; failures: number }> {
  let successes = 0
  let failures = 0
  for (const input of inputs) {
    const r = await publishNotification(input)
    if (r.ok) successes++
    else failures++
  }
  return { successes, failures }
}

// Re-export kind type for callers
export type { NotificationKind } from './email-catalog'
