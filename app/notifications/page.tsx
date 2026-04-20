import Link from 'next/link'

import { listMyNotifications } from '@/lib/notifications/queries'
import { NotificationsList } from './NotificationsList'

export default async function NotificationsPage() {
  const items = await listMyNotifications(100)
  return (
    <main>
      <h1 className="text-xl font-semibold">Notifications</h1>
      <p className="text-muted text-sm mt-1">
        Everything the app has pushed to you. Unread items are at the top.
      </p>
      <div className="mt-6">
        <NotificationsList items={items} />
      </div>
      <p className="text-sm mt-4">
        <Link href="/">← Back</Link>
      </p>
    </main>
  )
}
