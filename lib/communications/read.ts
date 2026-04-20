import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type MarkReadResult = { ok: true } | { ok: false; error: string }

/**
 * Record that the caller has read an announcement. Idempotent: repeated calls
 * keep the original read_at (the first-seen time is historical truth).
 *
 * Uses ON CONFLICT DO NOTHING: if a row already exists the INSERT is a noop.
 * We don't update read_at on subsequent loads because that would repeatedly
 * "reset" the read timestamp, confusing admins reviewing read receipts.
 */
export async function markAnnouncementRead(announcementId: string): Promise<MarkReadResult> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  // Insert-or-ignore. The (announcement_id, user_id) unique constraint makes
  // re-reads silently noop. Supabase postgrest: use upsert with ignoreDuplicates.
  const { error } = await supabase
    .from('announcement_reads')
    .upsert(
      {
        announcement_id: announcementId,
        user_id: user.id,
      },
      {
        onConflict: 'announcement_id,user_id',
        ignoreDuplicates: true,
      },
    )

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * Acknowledge an announcement (implies read). Setting acknowledged_at also
 * records read_at if it wasn't already set. Preserves original read_at when
 * already present — acking doesn't overwrite the first-seen time.
 *
 * This is two-step:
 *   1. ensure the read row exists (idempotent insert)
 *   2. update acknowledged_at, leaving read_at untouched
 *
 * Unlike markAnnouncementRead, acknowledging is always recorded (idempotent on
 * acknowledged_at — re-acking keeps the existing timestamp to preserve the
 * first-ack time).
 */
export async function acknowledgeAnnouncement(announcementId: string): Promise<MarkReadResult> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const now = new Date().toISOString()

  // Upsert: insert if missing, update acknowledged_at if missing (preserve if set).
  // We can't express "update only if null" in a single upsert call — do it in two
  // steps so we don't clobber a previous ack timestamp.
  const { error: insertErr } = await supabase
    .from('announcement_reads')
    .upsert(
      {
        announcement_id: announcementId,
        user_id: user.id,
        acknowledged_at: now,
      },
      {
        onConflict: 'announcement_id,user_id',
        ignoreDuplicates: true,
      },
    )

  if (insertErr) return { ok: false, error: insertErr.message }

  // If a row already existed (ignoreDuplicates made the insert a noop), set
  // acknowledged_at only when it's still null. read_at is left alone.
  const { error: updateErr } = await supabase
    .from('announcement_reads')
    .update({ acknowledged_at: now })
    .eq('announcement_id', announcementId)
    .eq('user_id', user.id)
    .is('acknowledged_at', null)

  if (updateErr) return { ok: false, error: updateErr.message }

  return { ok: true }
}
