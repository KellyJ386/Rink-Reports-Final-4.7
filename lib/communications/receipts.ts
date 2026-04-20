import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export type ReceiptRow = {
  user_id: string
  full_name: string | null
  email: string
  role_names: string[]
  read_at: string | null
  acknowledged_at: string | null
  status: 'unread' | 'read' | 'acknowledged'
}

export type ReceiptSummary = {
  announcement_id: string
  total_recipients: number
  read_count: number
  acknowledged_count: number
  requires_acknowledgment: boolean
  rows: ReceiptRow[]
}

/**
 * Fetch read/ack receipts for a single announcement. Facility-admin-only (RLS
 * on announcements + user table enforces visibility; the query fails open for
 * non-admins because they can't see the announcement itself).
 *
 * Logic:
 *   1. Load the announcement to determine audience scope + requires_ack flag
 *   2. Compute the recipient set (same predicate as post.ts uses)
 *   3. Load read rows and join
 *   4. Rows without an announcement_reads entry are "unread"
 *
 * Service role on step 2 because a non-admin-targeted announcement could
 * reference roles the caller can't enumerate under normal RLS — but the caller
 * is a communications admin at this point, established via the SELECT on step 1.
 */
export async function fetchAnnouncementReceipts(
  announcementId: string,
): Promise<ReceiptSummary | null> {
  const supabase = await createClient()

  const { data: announcement, error: annErr } = await supabase
    .from('announcements')
    .select('id, facility_id, target_audience, target_role_ids, requires_acknowledgment')
    .eq('id', announcementId)
    .maybeSingle()

  if (annErr || !announcement) return null

  const facilityId = announcement.facility_id as string
  const audience = announcement.target_audience as 'all_staff' | 'specific_roles'
  const targetRoleIds = (announcement.target_role_ids as string[] | null) ?? []
  const requiresAck = Boolean(announcement.requires_acknowledgment)

  const svc = createServiceClient()

  // Resolve recipient user_ids
  let recipientIds: string[] = []
  if (audience === 'all_staff') {
    const { data: users } = await svc
      .from('users')
      .select('id')
      .eq('facility_id', facilityId)
      .eq('active', true)
    recipientIds = (users ?? []).map((u) => u.id as string)
  } else {
    const { data: userRoles } = await svc
      .from('user_roles')
      .select('user_id, roles!inner(facility_id)')
      .in('role_id', targetRoleIds)
      .eq('roles.facility_id', facilityId)
    const seen = new Set<string>()
    for (const row of userRoles ?? []) {
      const uid = row.user_id as string
      if (!seen.has(uid)) {
        seen.add(uid)
        recipientIds.push(uid)
      }
    }
  }

  // Load user info for recipient set
  const { data: users } = await svc
    .from('users')
    .select('id, full_name, email')
    .in('id', recipientIds)

  // Load role names per user (for display)
  const { data: userRolesWithNames } = await svc
    .from('user_roles')
    .select('user_id, roles!inner(name, facility_id)')
    .in('user_id', recipientIds)
    .eq('roles.facility_id', facilityId)

  const rolesByUser = new Map<string, string[]>()
  for (const row of userRolesWithNames ?? []) {
    const uid = row.user_id as string
    const role = row.roles as { name: string } | { name: string }[]
    const roleName = Array.isArray(role) ? role[0]?.name : role?.name
    if (!roleName) continue
    const arr = rolesByUser.get(uid) ?? []
    arr.push(roleName)
    rolesByUser.set(uid, arr)
  }

  // Load read rows
  const { data: reads } = await svc
    .from('announcement_reads')
    .select('user_id, read_at, acknowledged_at')
    .eq('announcement_id', announcementId)

  const readByUser = new Map<string, { read_at: string | null; acknowledged_at: string | null }>()
  for (const r of reads ?? []) {
    readByUser.set(r.user_id as string, {
      read_at: (r.read_at as string | null) ?? null,
      acknowledged_at: (r.acknowledged_at as string | null) ?? null,
    })
  }

  const rows: ReceiptRow[] = (users ?? []).map((u) => {
    const uid = u.id as string
    const r = readByUser.get(uid)
    const readAt = r?.read_at ?? null
    const ackAt = r?.acknowledged_at ?? null
    let status: ReceiptRow['status'] = 'unread'
    if (ackAt) status = 'acknowledged'
    else if (readAt) status = 'read'
    return {
      user_id: uid,
      full_name: (u.full_name as string | null) ?? null,
      email: u.email as string,
      role_names: rolesByUser.get(uid) ?? [],
      read_at: readAt,
      acknowledged_at: ackAt,
      status,
    }
  })

  // Sort: unread first, then read, then acknowledged; within group by name
  rows.sort((a, b) => {
    const order = { unread: 0, read: 1, acknowledged: 2 }
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status]
    return (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email)
  })

  const readCount = rows.filter((r) => r.status !== 'unread').length
  const ackCount = rows.filter((r) => r.status === 'acknowledged').length

  return {
    announcement_id: announcementId,
    total_recipients: rows.length,
    read_count: readCount,
    acknowledged_count: ackCount,
    requires_acknowledgment: requiresAck,
    rows,
  }
}
