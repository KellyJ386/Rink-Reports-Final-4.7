'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { activeCount, startQueueSync } from '@/lib/offline-queue/sync'

/**
 * Header badge showing "Offline — N queued" when the Dexie queue has unsynced
 * items. Also boots the sync loop on mount.
 */
export function OfflineQueueBadge() {
  const [count, setCount] = useState<number>(0)
  const [online, setOnline] = useState<boolean>(true)

  useEffect(() => {
    startQueueSync()

    const poll = async () => {
      try {
        setCount(await activeCount())
      } catch {
        // Dexie not yet open; noop
      }
    }
    const interval = setInterval(poll, 5000)
    void poll()

    const updateOnline = () => setOnline(navigator.onLine)
    updateOnline()
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)

    return () => {
      clearInterval(interval)
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
    }
  }, [])

  if (count === 0 && online) return null

  return (
    <Link
      href="/queue"
      className="no-underline text-ink inline-flex items-center gap-1 text-xs font-medium"
    >
      <span
        aria-hidden
        className={`w-2 h-2 rounded-full ${online ? 'bg-warn' : 'bg-danger'}`}
      />
      <span>
        {online ? `${count} queued` : `Offline · ${count} queued`}
      </span>
    </Link>
  )
}
