'use server'

import { markAllRead, markRead } from '@/lib/notifications/queries'

export async function markReadAction(id: string) {
  return markRead(id)
}

export async function markAllReadAction() {
  return markAllRead()
}
