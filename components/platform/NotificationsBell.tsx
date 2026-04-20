import Link from 'next/link'

import { countMyUnread } from '@/lib/notifications/queries'

/**
 * Server component version: shows unread count on every render. For live updates,
 * wrap with a Realtime subscription client component (v2 polish).
 */
export async function NotificationsBell() {
  const unread = await countMyUnread()
  return (
    <Link
      href="/notifications"
      aria-label={`Notifications (${unread} unread)`}
      className="no-underline text-ink inline-flex items-center gap-1"
    >
      <span aria-hidden>🔔</span>
      {unread > 0 && (
        <span className="bg-danger text-white rounded-full text-xs font-bold px-2">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  )
}
