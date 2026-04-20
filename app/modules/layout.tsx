import Link from 'next/link'
import type { ReactNode } from 'react'

import { ImpersonationBanner } from '@/components/platform/ImpersonationBanner'
import { NotificationsBell } from '@/components/platform/NotificationsBell'
import { OfflineQueueBadge } from '@/components/platform/OfflineQueueBadge'
import { SubscriptionBanner } from '@/components/platform/SubscriptionBanner'

export default function ModulesLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <ImpersonationBanner />
      <SubscriptionBanner />
      <header className="border-b border-hairline px-4 py-2 flex items-center justify-between gap-3">
        <Link href="/" className="no-underline text-ink font-semibold text-sm">
          Rink Reports
        </Link>
        <div className="flex items-center gap-4">
          <OfflineQueueBadge />
          <NotificationsBell />
        </div>
      </header>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}
