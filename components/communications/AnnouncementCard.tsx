import Link from 'next/link'

import type { AnnouncementWithReadStatus } from '@/lib/communications/types'

const PRIORITY_STRIPE: Record<string, string> = {
  urgent: 'border-l-4 border-l-red-500',
  important: 'border-l-4 border-l-yellow-400',
  normal: '',
}

const PRIORITY_LABEL: Record<string, string> = {
  urgent: 'Urgent',
  important: 'Important',
}

type Props = {
  announcement: AnnouncementWithReadStatus
}

export function AnnouncementCard({ announcement: a }: Props) {
  const stripe = PRIORITY_STRIPE[a.priority] ?? ''
  const unread = !a.read_at
  const needsAck = a.requires_acknowledgment && !a.acknowledged_at
  const priorityLabel = PRIORITY_LABEL[a.priority]

  return (
    <Link
      href={`/modules/communications/${a.id}`}
      className={`block no-underline rounded-md border border-hairline px-4 py-3 hover:bg-surface-raised transition-colors ${stripe} ${unread ? 'bg-surface-raised' : 'bg-surface'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {priorityLabel && (
              <span
                className={`text-xs font-semibold uppercase tracking-wide ${
                  a.priority === 'urgent' ? 'text-red-600' : 'text-yellow-600'
                }`}
              >
                {priorityLabel}
              </span>
            )}
            <span className={`font-medium text-ink truncate ${a.priority === 'urgent' ? 'font-semibold' : ''}`}>
              {a.title}
            </span>
          </div>
          <p className="text-sm text-muted mt-0.5">
            {new Date(a.posted_at).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {unread && (
            <span className="inline-block w-2 h-2 rounded-full bg-accent" title="Unread" />
          )}
          {needsAck && (
            <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full font-medium">
              Ack required
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
