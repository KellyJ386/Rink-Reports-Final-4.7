'use client'

import { useState, useTransition } from 'react'

import type { NotificationRow } from '@/lib/notifications/queries'

import { markAllReadAction, markReadAction } from './actions'

export function NotificationsList({ items }: { items: NotificationRow[] }) {
  const [local, setLocal] = useState(items)
  const [, startTransition] = useTransition()

  const handleMarkRead = async (id: string) => {
    setLocal((xs) => xs.map((x) => (x.id === id ? { ...x, read_at: new Date().toISOString() } : x)))
    await markReadAction(id)
    startTransition(() => window.location.reload())
  }

  const handleMarkAll = async () => {
    setLocal((xs) => xs.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })))
    await markAllReadAction()
    startTransition(() => window.location.reload())
  }

  if (local.length === 0) {
    return <p className="text-muted text-sm">Nothing yet.</p>
  }

  const unread = local.filter((x) => !x.read_at)

  return (
    <div>
      {unread.length > 0 && (
        <div className="flex justify-end mb-3">
          <button
            type="button"
            onClick={handleMarkAll}
            className="bg-transparent border border-hairline text-ink px-3 py-1 rounded text-xs min-h-0"
          >
            Mark all read
          </button>
        </div>
      )}
      <ul className="flex flex-col gap-2">
        {local.map((n) => (
          <li
            key={n.id}
            className={
              'border border-hairline rounded-md p-3 text-sm ' + (n.read_at ? 'bg-white' : 'bg-sky-50')
            }
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex flex-col gap-1 flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted">{n.kind}</span>
                  <span className="text-xs text-muted">
                    {new Date(n.created_at).toLocaleString()}
                  </span>
                </div>
                <pre className="text-xs overflow-auto whitespace-pre-wrap">
                  {JSON.stringify(n.payload, null, 2)}
                </pre>
              </div>
              {!n.read_at && (
                <button
                  type="button"
                  onClick={() => handleMarkRead(n.id)}
                  className="bg-transparent border border-hairline text-ink px-2 py-1 rounded text-xs min-h-0"
                >
                  Mark read
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
