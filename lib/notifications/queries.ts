import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type NotificationRow = {
  id: string
  kind: string
  payload: Record<string, unknown>
  read_at: string | null
  email_sent_at: string | null
  created_at: string
}

export async function listMyNotifications(limit = 50): Promise<NotificationRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('notifications')
    .select('id, kind, payload, read_at, email_sent_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error || !data) {
    if (error) console.error('listMyNotifications error', error)
    return []
  }
  return data as NotificationRow[]
}

export async function countMyUnread(): Promise<number> {
  const supabase = await createClient()
  const { count } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .is('read_at', null)
  return count ?? 0
}

export async function markRead(notificationId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function markAllRead(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
