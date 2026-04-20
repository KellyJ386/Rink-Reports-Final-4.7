import Link from 'next/link'
import type { ReactNode } from 'react'

import { requirePlatformAdmin } from '@/lib/platform-admin/require'

export default async function PlatformAdminLayout({ children }: { children: ReactNode }) {
  await requirePlatformAdmin()

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <nav
        aria-label="Platform admin sections"
        className="md:w-56 border-b md:border-b-0 md:border-r border-hairline p-4 md:p-6 bg-gray-900 text-gray-100"
      >
        <div className="font-semibold mb-4">
          <Link href="/platform-admin" className="no-underline text-white">
            Platform Admin
          </Link>
        </div>
        <ul className="flex flex-col gap-1 text-sm">
          <li><Link href="/platform-admin/facilities" className="no-underline text-gray-100">Facilities</Link></li>
          <li><Link href="/platform-admin/health" className="no-underline text-gray-100">Health</Link></li>
          <li><Link href="/platform-admin/events" className="no-underline text-gray-100">Billing events</Link></li>
        </ul>
        <div className="mt-6 text-xs text-gray-400">
          <Link href="/" className="no-underline text-gray-400">← Back to app</Link>
        </div>
      </nav>
      <div className="flex-1 min-w-0 bg-gray-50">{children}</div>
    </div>
  )
}
