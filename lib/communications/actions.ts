'use server'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { publishNotificationMany } from '@/lib/notifications/publish'

import type { AnnouncementPriority, TargetAudience } from './types'

export type PostAnnouncementInput = {
  title: string
  body: string
  priority: AnnouncementPriority
  target_audience: TargetAudience
  target_role_ids?: string[] | null
  requires_acknowledgment: boolean
  expires_at?: string | null
  idempotency_key?: string
}

export type PostAnnouncementResult =
  | { ok: true; id: string }
  | { ok: false; error: string }

export async function postAnnouncement(
  input: PostAnnouncementInput,
): Promise<PostAnnouncementResult> {
  const supabase = await createClient()

  const { data: authData } = await supabase.auth.getUser()
  const authorId = authData.user?.id
  if (!authorId) return { ok: false, error: 'Not authenticated' }

  const { data: inserted, error: insertError } = await supabase
    .from('announcements')
    .insert({
      author_user_id: authorId,
      title: input.title,
      body: input.body,
      priority: input.priority,
      target_audience: input.target_audience,
      target_role_ids: input.target_role_ids ?? null,
      requires_acknowledgment: input.requires_acknowledgment,
      expires_at: input.expires_at ?? null,
      idempotency_key: input.idempotency_key ?? null,
    })
    .select('id, facility_id')
    .single()

  if (insertError || !inserted) {
    return { ok: false, error: insertError?.message ?? 'Insert failed' }
  }

  const announcementId = inserted.id as string
  const facilityId = inserted.facility_id as string

  // Resolve target user IDs (service role to read users/roles without RLS)
  const svc = createServiceClient()
  let targetUserIds: string[] = []

  if (input.target_audience === 'all_staff') {
    const { data: users } = await svc
      .from('users')
      .select('id')
      .eq('facility_id', facilityId)
      .neq('id', authorId)
    targetUserIds = (users ?? []).map((u) => u.id as string)
  } else if (input.target_audience === 'specific_roles' && input.target_role_ids?.length) {
    const { data: roleUsers } = await svc
      .from('user_roles')
      .select('user_id')
      .in('role_id', input.target_role_ids)
    const seen = new Set<string>()
    for (const r of roleUsers ?? []) {
      const uid = r.user_id as string
      if (uid !== authorId) seen.add(uid)
    }
    targetUserIds = [...seen]
  }

  // Fan-out in-app notifications (non-blocking failures are tolerated)
  if (targetUserIds.length > 0) {
    const { data: authorUser } = await svc
      .from('users')
      .select('full_name')
      .eq('id', authorId)
      .maybeSingle()
    const authorName = (authorUser?.full_name as string | null) ?? 'Staff'

    void publishNotificationMany(
      targetUserIds.map((uid) => ({
        user_id: uid,
        kind: 'announcement.posted' as const,
        payload: {
          announcement_id: announcementId,
          title: input.title,
          priority: input.priority,
          author_name: authorName,
        },
      })),
    )
  }

  // Audit log
  void supabase.from('audit_log').insert({
    facility_id: facilityId,
    actor_user_id: authorId,
    action: 'announcement.posted',
    entity_type: 'announcement',
    entity_id: announcementId,
    metadata: { title: input.title, priority: input.priority, target_audience: input.target_audience },
  })

  return { ok: true, id: announcementId }
}

// ─────────────────────────────────────────────────────────────────────────────

export type EditAnnouncementInput = {
  id: string
  title: string
  body: string
  priority: AnnouncementPriority
  target_audience: TargetAudience
  target_role_ids?: string[] | null
  requires_acknowledgment: boolean
  expires_at?: string | null
}

export type EditAnnouncementResult =
  | { ok: true }
  | { ok: false; error: string; code?: 'blocked_by_reads' }

export async function editAnnouncement(
  input: EditAnnouncementInput,
): Promise<EditAnnouncementResult> {
  const supabase = await createClient()

  // Guard: block edit if any reads exist
  const { count, error: countError } = await supabase
    .from('announcement_reads')
    .select('id', { count: 'exact', head: true })
    .eq('announcement_id', input.id)

  if (countError) return { ok: false, error: countError.message }
  if ((count ?? 0) > 0) {
    return { ok: false, error: 'Cannot edit after recipients have read the announcement.', code: 'blocked_by_reads' }
  }

  const { error } = await supabase
    .from('announcements')
    .update({
      title: input.title,
      body: input.body,
      priority: input.priority,
      target_audience: input.target_audience,
      target_role_ids: input.target_role_ids ?? null,
      requires_acknowledgment: input.requires_acknowledgment,
      expires_at: input.expires_at ?? null,
    })
    .eq('id', input.id)

  if (error) return { ok: false, error: error.message }

  const { data: authData } = await supabase.auth.getUser()
  void supabase.from('audit_log').insert({
    actor_user_id: authData.user?.id ?? null,
    action: 'announcement.edited',
    entity_type: 'announcement',
    entity_id: input.id,
    metadata: { title: input.title },
  })

  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────

export type ArchiveAnnouncementResult =
  | { ok: true }
  | { ok: false; error: string }

export async function archiveAnnouncement(
  id: string,
): Promise<ArchiveAnnouncementResult> {
  const supabase = await createClient()

  const { data: authData } = await supabase.auth.getUser()
  const actorId = authData.user?.id
  if (!actorId) return { ok: false, error: 'Not authenticated' }

  const { error } = await supabase
    .from('announcements')
    .update({
      is_archived: true,
      archived_by: actorId,
      archived_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) return { ok: false, error: error.message }

  void supabase.from('audit_log').insert({
    actor_user_id: actorId,
    action: 'announcement.archived',
    entity_type: 'announcement',
    entity_id: id,
    metadata: {},
  })

  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────

export type MarkReadResult =
  | { ok: true }
  | { ok: false; error: string }

export async function markRead(announcementId: string): Promise<MarkReadResult> {
  const supabase = await createClient()

  const { data: authData } = await supabase.auth.getUser()
  const userId = authData.user?.id
  if (!userId) return { ok: false, error: 'Not authenticated' }

  const { error } = await supabase
    .from('announcement_reads')
    .upsert(
      { announcement_id: announcementId, user_id: userId },
      { onConflict: 'announcement_id,user_id', ignoreDuplicates: true },
    )

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────

export type AcknowledgeResult =
  | { ok: true }
  | { ok: false; error: string }

export async function acknowledge(announcementId: string): Promise<AcknowledgeResult> {
  const supabase = await createClient()

  const { data: authData } = await supabase.auth.getUser()
  const userId = authData.user?.id
  if (!userId) return { ok: false, error: 'Not authenticated' }

  // Upsert the read row first (idempotent), then stamp acknowledged_at
  await supabase
    .from('announcement_reads')
    .upsert(
      { announcement_id: announcementId, user_id: userId },
      { onConflict: 'announcement_id,user_id', ignoreDuplicates: true },
    )

  const { error } = await supabase
    .from('announcement_reads')
    .update({ acknowledged_at: new Date().toISOString() })
    .eq('announcement_id', announcementId)
    .eq('user_id', userId)
    .is('acknowledged_at', null)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
