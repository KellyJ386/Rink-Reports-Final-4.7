export type AnnouncementPriority = 'normal' | 'important' | 'urgent'
export type TargetAudience = 'all_staff' | 'specific_roles'

export type Announcement = {
  id: string
  facility_id: string
  author_user_id: string
  title: string
  body: string
  priority: AnnouncementPriority
  target_audience: TargetAudience
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
