import 'server-only'

import { createClient } from '@/lib/supabase/server'

import type {
  Announcement,
  AnnouncementReceipt,
  AnnouncementWithReadStatus,
} from './types'

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, important: 1, normal: 2 }

function sortAnnouncements(rows: AnnouncementWithReadStatus[]): AnnouncementWithReadStatus[] {
  return [...rows].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 2
    const pb = PRIORITY_ORDER[b.priority] ?? 2
    if (pa !== pb) return pa - pb

    // Unacked required announcements float up
    const aUnacked = a.requires_acknowledgment && !a.acknowledged_at ? 1 : 0
    const bUnacked = b.requires_acknowledgment && !b.acknowledged_at ? 1 : 0
    if (aUnacked !== bUnacked) return bUnacked - aUnacked

    // Unread next
    const aUnread = !a.read_at ? 1 : 0
    const bUnread = !b.read_at ? 1 : 0
    if (aUnread !== bUnread) return bUnread - aUnread

    return new Date(b.posted_at).getTime() - new Date(a.posted_at).getTime()
  })
}

export async function listAnnouncements({
  includeArchived = false,
}: { includeArchived?: boolean } = {}): Promise<AnnouncementWithReadStatus[]> {
  const supabase = await createClient()

  const { data: user } = await supabase.auth.getUser()
  const userId = user.user?.id

  let query = supabase
    .from('announcements')
    .select(`
      *,
      announcement_reads!left(read_at, acknowledged_at)
    `)
    .eq('announcement_reads.user_id', userId ?? '')

  if (includeArchived) {
    query = query.eq('is_archived', true)
  } else {
    query = query
      .eq('is_archived', false)
      .or('expires_at.is.null,expires_at.gte.' + new Date().toISOString())
  }

  query = query.order('posted_at', { ascending: false })

  const { data, error } = await query

  if (error) {
    console.error('listAnnouncements error', error)
    return []
  }

  const rows: AnnouncementWithReadStatus[] = (data ?? []).map((row) => {
    const reads = Array.isArray(row.announcement_reads) ? row.announcement_reads[0] : row.announcement_reads
    return {
      ...(row as unknown as Announcement),
      read_at: reads?.read_at ?? null,
      acknowledged_at: reads?.acknowledged_at ?? null,
    }
  })

  return sortAnnouncements(rows)
}

export async function getAnnouncement(
  id: string,
): Promise<AnnouncementWithReadStatus | null> {
  const supabase = await createClient()

  const { data: user } = await supabase.auth.getUser()
  const userId = user.user?.id

  const { data, error } = await supabase
    .from('announcements')
    .select(`
      *,
      announcement_reads!left(read_at, acknowledged_at)
    `)
    .eq('id', id)
    .eq('announcement_reads.user_id', userId ?? '')
    .maybeSingle()

  if (error || !data) return null

  const reads = Array.isArray(data.announcement_reads)
    ? data.announcement_reads[0]
    : data.announcement_reads

  return {
    ...(data as unknown as Announcement),
    read_at: reads?.read_at ?? null,
    acknowledged_at: reads?.acknowledged_at ?? null,
  }
}

export async function getReceipts(announcementId: string): Promise<AnnouncementReceipt[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('announcement_reads')
    .select(`
      *,
      users!inner(full_name, email)
    `)
    .eq('announcement_id', announcementId)
    .order('read_at', { ascending: true })

  if (error) {
    console.error('getReceipts error', error)
    return []
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    announcement_id: row.announcement_id as string,
    user_id: row.user_id as string,
    read_at: row.read_at as string,
    acknowledged_at: row.acknowledged_at as string | null,
    user_full_name: (row.users as { full_name: string | null } | null)?.full_name ?? null,
    user_email: (row.users as { email: string | null } | null)?.email ?? null,
  }))
}

export async function hasReads(announcementId: string): Promise<boolean> {
  const supabase = await createClient()
  const { count, error } = await supabase
    .from('announcement_reads')
    .select('id', { count: 'exact', head: true })
    .eq('announcement_id', announcementId)

  if (error) return false
  return (count ?? 0) > 0
}
