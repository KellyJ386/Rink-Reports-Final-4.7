export type AnnouncementPriority = 'normal' | 'important' | 'urgent'
export type TargetAudience = 'all_staff' | 'specific_roles'

export type AnnouncementAudience = 'all_staff' | 'specific_roles'

export type Announcement = {
  id: string
  facility_id: string
  author_user_id: string
  title: string
  body: string
  priority: AnnouncementPriority
  target_audience: TargetAudience
  author_name: string | null
  title: string
  body: string
  priority: AnnouncementPriority
  target_audience: AnnouncementAudience
  target_role_ids: string[] | null
  requires_acknowledgment: boolean
  posted_at: string
  expires_at: string | null
  is_archived: boolean
  archived_by: string | null
  archived_at: string | null
  idempotency_key: string | null
  created_at: string
}

export type AnnouncementRead = {
  id: string
  announcement_id: string
  user_id: string
  read_at: string
  acknowledged_at: string | null
}

export type AnnouncementWithReadStatus = Announcement & {
  read_at: string | null
  acknowledged_at: string | null
}

export type AnnouncementReceipt = AnnouncementRead & {
  user_full_name: string | null
  user_email: string | null
}
/**
 * Row shape returned by announcements_for_current_user() SQL function. Joins
 * announcement_reads + user info for the caller. sort_bucket:
 *   1 = urgent + unread (non-archived, non-expired)
 *   2 = requires_acknowledgment, not yet acked (non-archived, non-expired)
 *   3 = other unread (non-archived, non-expired)
 *   4 = read, non-archived, non-expired
 *   5 = archived OR expired
 */
export type AnnouncementFeedRow = {
  id: string
  title: string
  body: string
  priority: AnnouncementPriority
  posted_at: string
  expires_at: string | null
  is_archived: boolean
  requires_acknowledgment: boolean
  author_user_id: string
  author_name: string | null
  read_at: string | null
  acknowledged_at: string | null
  sort_bucket: 1 | 2 | 3 | 4 | 5
}

export type PostAnnouncementInput = {
  title: string
  body: string
  priority: AnnouncementPriority
  target_audience: AnnouncementAudience
  /** Required when target_audience === 'specific_roles'. */
  target_role_ids?: string[]
  requires_acknowledgment: boolean
  /** Optional explicit expiry. If undefined, the app layer resolves from
   *  facilities.settings.communications.default_expiry_days. */
  expires_at?: string | null
  idempotency_key?: string
}

export type PostAnnouncementResult =
  | { ok: true; announcement_id: string; recipient_count: number; email_sent_count: number }
  | { ok: false; error: string }
