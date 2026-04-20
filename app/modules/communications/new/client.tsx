'use client'

import { useRouter } from 'next/navigation'
import { useState, useId } from 'react'

import { MarkdownBody } from '@/components/communications/MarkdownBody'
import type { AnnouncementPriority, TargetAudience } from '@/lib/communications/types'

import { postAnnouncement } from './actions'

type Role = { id: string; name: string }

type Props = {
  defaultRequireAck: boolean
  defaultExpiryDays: number
  roles: Role[]
}

function defaultExpiresAt(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `k_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

export function NewAnnouncementClient({ defaultRequireAck, defaultExpiryDays, roles }: Props) {
  const router = useRouter()
  const formId = useId()

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [priority, setPriority] = useState<AnnouncementPriority>('normal')
  const [audience, setAudience] = useState<TargetAudience>('all_staff')
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([])
  const [requireAck, setRequireAck] = useState(defaultRequireAck)
  const [expiresAt, setExpiresAt] = useState(defaultExpiresAt(defaultExpiryDays))
  const [showPreview, setShowPreview] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const idempotencyKey = useState(() => newIdempotencyKey())[0]

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const result = await postAnnouncement({
        title: title.trim(),
        body: body.trim(),
        priority,
        target_audience: audience,
        target_role_ids: audience === 'specific_roles' ? selectedRoleIds : null,
        requires_acknowledgment: requireAck,
        expires_at: expiresAt || null,
        idempotency_key: idempotencyKey,
      })
      if (result.ok) {
        router.push('/modules/communications')
        router.refresh()
      } else {
        setError(result.error)
      }
    } finally {
      setSubmitting(false)
    }
  }

  function toggleRole(id: string) {
    setSelectedRoleIds((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id],
    )
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Title */}
      <div>
        <label htmlFor={`${formId}-title`} className="block text-sm font-medium mb-1">
          Title
        </label>
        <input
          id={`${formId}-title`}
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full border border-hairline rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          placeholder="Announcement title"
        />
      </div>

      {/* Body */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label htmlFor={`${formId}-body`} className="block text-sm font-medium">
            Message
          </label>
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="text-xs text-accent hover:underline"
          >
            {showPreview ? 'Edit' : 'Preview'}
          </button>
        </div>
        {showPreview ? (
          <div className="min-h-32 border border-hairline rounded-md px-3 py-2 bg-surface-raised">
            {body.trim() ? (
              <MarkdownBody body={body} />
            ) : (
              <p className="text-muted text-sm italic">Nothing to preview.</p>
            )}
          </div>
        ) : (
          <textarea
            id={`${formId}-body`}
            required
            rows={8}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full border border-hairline rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent resize-y"
            placeholder="Supports Markdown: **bold**, *italic*, ## headings, - lists, [link](https://...)"
          />
        )}
        <p className="text-xs text-muted mt-1">
          Markdown supported. Images, code blocks, and HTML are not permitted.
        </p>
      </div>

      {/* Priority */}
      <fieldset>
        <legend className="text-sm font-medium mb-2">Priority</legend>
        <div className="flex gap-4">
          {(['normal', 'important', 'urgent'] as AnnouncementPriority[]).map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="priority"
                value={p}
                checked={priority === p}
                onChange={() => setPriority(p)}
              />
              <span className="capitalize">{p}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Audience */}
      <fieldset>
        <legend className="text-sm font-medium mb-2">Audience</legend>
        <div className="flex gap-4 mb-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name="audience"
              value="all_staff"
              checked={audience === 'all_staff'}
              onChange={() => setAudience('all_staff')}
            />
            All staff
          </label>
          {roles.length > 0 && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="audience"
                value="specific_roles"
                checked={audience === 'specific_roles'}
                onChange={() => setAudience('specific_roles')}
              />
              Specific roles
            </label>
          )}
        </div>
        {audience === 'specific_roles' && roles.length > 0 && (
          <div className="ml-4 space-y-1">
            {roles.map((role) => (
              <label key={role.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedRoleIds.includes(role.id)}
                  onChange={() => toggleRole(role.id)}
                />
                {role.name}
              </label>
            ))}
            {selectedRoleIds.length === 0 && (
              <p className="text-xs text-red-600 mt-1">Select at least one role.</p>
            )}
          </div>
        )}
      </fieldset>

      {/* Requires acknowledgment */}
      <div>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={requireAck}
            onChange={(e) => setRequireAck(e.target.checked)}
            className="w-4 h-4"
          />
          <span className="text-sm font-medium">Require acknowledgment</span>
        </label>
        <p className="text-xs text-muted mt-1 ml-7">
          Recipients will be prompted to confirm they&apos;ve read this.
        </p>
      </div>

      {/* Expiry */}
      <div>
        <label htmlFor={`${formId}-expires`} className="block text-sm font-medium mb-1">
          Expires on
        </label>
        <input
          id={`${formId}-expires`}
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          className="border border-hairline rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <p className="text-xs text-muted mt-1">
          After this date the announcement will no longer appear in the active list.
          Leave blank for no expiry.
        </p>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={
            submitting ||
            !title.trim() ||
            !body.trim() ||
            (audience === 'specific_roles' && selectedRoleIds.length === 0)
          }
          className="bg-accent text-white px-5 py-2 rounded-md font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'Posting…' : 'Post announcement'}
        </button>
        <a
          href="/modules/communications"
          className="px-5 py-2 rounded-md font-medium text-sm border border-hairline text-ink no-underline"
        >
          Cancel
        </a>
      </div>
    </form>
  )
}
