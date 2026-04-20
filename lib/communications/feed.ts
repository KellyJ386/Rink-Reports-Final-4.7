import 'server-only'

import { createClient } from '@/lib/supabase/server'

import type { AnnouncementFeedRow } from './types'

export type FetchFeedOptions = {
  includeArchived?: boolean
  /** Pagination cap — defaults to 100. */
  limit?: number
}

/**
 * Fetch the announcement feed for the current authenticated user.
 *
 * Delegates ordering to the SQL function announcements_for_current_user(),
 * which returns a sort_bucket integer per row:
 *   1 = urgent + unread
 *   2 = requires_acknowledgment + not yet acked
 *   3 = other unread
 *   4 = read
 *   5 = archived or expired
 *
 * We then order by (sort_bucket asc, posted_at desc) so newest-first within
 * each bucket. Centralising the bucket logic in SQL means /modules/communications
 * and the nav-badge unread counter share the same definition of "unread".
 */
export async function fetchAnnouncementFeed(
  opts: FetchFeedOptions = {},
): Promise<AnnouncementFeedRow[]> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('announcements_for_current_user')
  if (error) {
    console.error('fetchAnnouncementFeed: rpc error', error)
    return []
  }

  let rows = (data ?? []) as AnnouncementFeedRow[]
  if (!opts.includeArchived) {
    rows = rows.filter((r) => r.sort_bucket !== 5)
  }

  rows.sort((a, b) => {
    if (a.sort_bucket !== b.sort_bucket) return a.sort_bucket - b.sort_bucket
    return b.posted_at.localeCompare(a.posted_at)
  })

  const limit = opts.limit ?? 100
  return rows.slice(0, limit)
}

/**
 * Count of unread-or-unacked items for the current user. Used by the global
 * nav badge. Deliberately excludes archived/expired.
 */
export async function fetchAnnouncementBadgeCount(): Promise<number> {
  const rows = await fetchAnnouncementFeed({ includeArchived: false, limit: 1000 })
  return rows.filter((r) => r.sort_bucket <= 3).length
}

/**
 * Load a single announcement by id (returns null if not visible to caller).
 * Uses the direct announcements table read + announcement_reads self-row;
 * includes author display name.
 */
export async function fetchAnnouncementById(id: string) {
  const supabase = await createClient()

  const { data: a, error } = await supabase
    .from('announcements')
    .select(
      'id, facility_id, author_user_id, title, body, priority, target_audience, target_role_ids, requires_acknowledgment, posted_at, expires_at, is_archived, archived_by, archived_at, created_at, users!announcements_author_user_id_fkey(full_name, email)',
    )
    .eq('id', id)
    .maybeSingle()

  if (error || !a) return null

  const authorRaw = a.users as
    | { full_name: string | null; email: string }
    | Array<{ full_name: string | null; email: string }>
    | null
  const author = Array.isArray(authorRaw) ? authorRaw[0] ?? null : authorRaw

  const { data: readRow } = await supabase
    .from('announcement_reads')
    .select('read_at, acknowledged_at')
    .eq('announcement_id', id)
    .maybeSingle()

  return {
    id: a.id as string,
    facility_id: a.facility_id as string,
    author_user_id: a.author_user_id as string,
    author_name: author?.full_name ?? author?.email ?? null,
    title: a.title as string,
    body: a.body as string,
    priority: a.priority as 'normal' | 'important' | 'urgent',
    target_audience: a.target_audience as 'all_staff' | 'specific_roles',
    target_role_ids: (a.target_role_ids as string[] | null) ?? null,
    requires_acknowledgment: Boolean(a.requires_acknowledgment),
    posted_at: a.posted_at as string,
    expires_at: (a.expires_at as string | null) ?? null,
    is_archived: Boolean(a.is_archived),
    archived_by: (a.archived_by as string | null) ?? null,
    archived_at: (a.archived_at as string | null) ?? null,
    created_at: a.created_at as string,
    read_at: (readRow?.read_at as string | null) ?? null,
    acknowledged_at: (readRow?.acknowledged_at as string | null) ?? null,
  }
}
