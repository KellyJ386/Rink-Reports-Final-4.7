import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { publishNotification } from '@/lib/notifications/publish'
import { logger } from '@/lib/observability/logger'

import type { PostAnnouncementInput, PostAnnouncementResult } from './types'

/**
 * Post a new announcement to the caller's facility.
 *
 * Call site: server actions invoked from /modules/communications/new.
 *
 * Flow:
 *   1. Insert the announcement. facility_id is set via DEFAULT current_facility_id()
 *      — never accepted from the client. RLS WITH CHECK verifies the caller has
 *      admin access on communications.
 *   2. Resolve the distinct set of recipient user_ids via a SQL query that
 *      mirrors the announcement SELECT audience predicate. DISTINCT ensures a
 *      user in multiple targeted roles receives exactly one notification.
 *   3. Fan out via publishNotification() — serial, not parallel. At v1 scale
 *      (tens of users per facility) this is trivially fast and keeps error
 *      surface simple. TODO(agent-7-fan-out): revisit if facilities grow to
 *      hundreds of recipients and the serial loop dominates server action time;
 *      at that point a QStash-queued fan-out with per-recipient retry is the
 *      upgrade path.
 *   4. publishNotification itself handles email eligibility — urgent priority
 *      triggers email per EMAIL_CATALOG; normal/important are in-app + Realtime
 *      only.
 *
 * Idempotency: the announcements partial unique index on
 * (facility_id, idempotency_key) WHERE idempotency_key IS NOT NULL collapses
 * duplicate submissions. On conflict we re-read and return the existing row.
 */
export async function postAnnouncement(
  input: PostAnnouncementInput,
): Promise<PostAnnouncementResult> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  // Title/body length + audience shape validation (server-side; client validates too)
  if (input.title.trim().length === 0 || input.title.length > 200) {
    return { ok: false, error: 'title_invalid' }
  }
  if (input.body.trim().length === 0 || input.body.length > 20000) {
    return { ok: false, error: 'body_invalid' }
  }
  if (input.target_audience === 'specific_roles') {
    if (!input.target_role_ids || input.target_role_ids.length === 0) {
      return { ok: false, error: 'target_roles_required' }
    }
  }

  // Resolve the effective expires_at. Explicit input wins; otherwise fall back
  // to facility default (communications.default_expiry_days in facility settings),
  // otherwise null (no expiry).
  let expiresAt: string | null = input.expires_at ?? null
  if (expiresAt === null && input.expires_at === undefined) {
    const { data: fac } = await supabase
      .from('facilities')
      .select('settings')
      .maybeSingle()
    const days = (fac?.settings as { communications?: { default_expiry_days?: number } } | null)
      ?.communications?.default_expiry_days
    if (typeof days === 'number' && days > 0) {
      expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
    }
  }

  // INSERT. facility_id defaults to current_facility_id(); author_user_id to auth.uid().
  const insertPayload = {
    author_user_id: user.id,
    title: input.title,
    body: input.body,
    priority: input.priority,
    target_audience: input.target_audience,
    target_role_ids: input.target_audience === 'specific_roles' ? input.target_role_ids : null,
    requires_acknowledgment: input.requires_acknowledgment,
    expires_at: expiresAt,
    idempotency_key: input.idempotency_key ?? null,
  }

  const { data: inserted, error: insertError } = await supabase
    .from('announcements')
    .insert(insertPayload)
    .select('id, facility_id')
    .single()

  if (insertError) {
    // Idempotency collision → re-read the existing row and continue
    if (insertError.code === '23505' && input.idempotency_key) {
      const { data: existing } = await supabase
        .from('announcements')
        .select('id, facility_id')
        .eq('idempotency_key', input.idempotency_key)
        .maybeSingle()
      if (existing) {
        return {
          ok: true,
          announcement_id: existing.id as string,
          recipient_count: 0,
          email_sent_count: 0,
        }
      }
    }
    logger.error('announcements.post.insert_failed', { error: insertError.message })
    return { ok: false, error: insertError.message }
  }

  const announcementId = inserted.id as string
  const facilityId = inserted.facility_id as string

  // Resolve distinct recipients via service role (bypasses RLS for the internal
  // fan-out query — announcement RLS already governed whether the post was
  // allowed; now we need the full active-staff list regardless of which roles
  // the actor can see).
  const svc = createServiceClient()
  let recipients: string[] = []

  if (input.target_audience === 'all_staff') {
    const { data: users, error: e } = await svc
      .from('users')
      .select('id')
      .eq('facility_id', facilityId)
      .eq('active', true)
    if (e) {
      logger.error('announcements.post.recipients_failed', { error: e.message })
    } else {
      recipients = (users ?? []).map((u) => u.id as string)
    }
  } else {
    // specific_roles — DISTINCT user_ids via user_roles JOIN
    const { data: userRoles, error: e } = await svc
      .from('user_roles')
      .select('user_id, role_id, roles!inner(facility_id)')
      .in('role_id', input.target_role_ids ?? [])
      .eq('roles.facility_id', facilityId)
    if (e) {
      logger.error('announcements.post.recipients_failed', { error: e.message })
    } else {
      const seen = new Set<string>()
      for (const row of userRoles ?? []) {
        const uid = row.user_id as string
        if (!seen.has(uid)) {
          seen.add(uid)
          recipients.push(uid)
        }
      }
    }
  }

  // Author never notifies themselves
  recipients = recipients.filter((uid) => uid !== user.id)

  // Fan out serially. publishNotification internally handles email gating.
  let emailSentCount = 0
  for (const uid of recipients) {
    const r = await publishNotification({
      user_id: uid,
      kind: 'announcement.posted',
      payload: {
        announcement_id: announcementId,
        title: input.title,
        priority: input.priority,
        requires_acknowledgment: input.requires_acknowledgment,
      },
    })
    if (r.ok && r.email_sent) emailSentCount++
  }

  // Audit
  void svc
    .from('audit_log')
    .insert({
      facility_id: facilityId,
      actor_user_id: user.id,
      action: 'announcement.posted',
      entity_type: 'announcement',
      entity_id: announcementId,
      metadata: {
        priority: input.priority,
        target_audience: input.target_audience,
        requires_acknowledgment: input.requires_acknowledgment,
        recipient_count: recipients.length,
      },
    })
    .then(({ error }) => {
      if (error) console.error('postAnnouncement: audit write failed', error)
    })

  return {
    ok: true,
    announcement_id: announcementId,
    recipient_count: recipients.length,
    email_sent_count: emailSentCount,
  }
}
