'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { MarkdownRenderer } from '@/components/communications/MarkdownRenderer'

import { postAnnouncementAction } from '../actions'
import type {
  AnnouncementAudience,
  AnnouncementPriority,
  PostAnnouncementInput,
} from '@/lib/communications/types'

type Role = { id: string; name: string; description: string | null }

const TITLE_MAX = 200
const BODY_MAX = 20000

export function NewAnnouncementClient({ roles }: { roles: Role[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [priority, setPriority] = useState<AnnouncementPriority>('normal')
  const [audience, setAudience] = useState<AnnouncementAudience>('all_staff')
  const [targetRoleIds, setTargetRoleIds] = useState<string[]>([])
  const [requiresAck, setRequiresAck] = useState(false)
  const [expiresAt, setExpiresAt] = useState<string>('')
  const [showPreview, setShowPreview] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Stable idempotency key for this form instance — defeats double-submit.
  const idempotencyKey = useMemo(
    () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`,
    [],
  )

  const canSubmit =
    title.trim().length > 0 &&
    title.length <= TITLE_MAX &&
    body.trim().length > 0 &&
    body.length <= BODY_MAX &&
    (audience === 'all_staff' || targetRoleIds.length > 0)

  const toggleRole = (roleId: string) => {
    setTargetRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((r) => r !== roleId) : [...prev, roleId],
    )
  }

  const handleSubmit = () => {
    setError(null)
    const input: PostAnnouncementInput = {
      title: title.trim(),
      body,
      priority,
      target_audience: audience,
      target_role_ids: audience === 'specific_roles' ? targetRoleIds : undefined,
      requires_acknowledgment: requiresAck,
      expires_at: expiresAt
        ? new Date(expiresAt).toISOString()
        : undefined,
      idempotency_key: idempotencyKey,
    }
    startTransition(async () => {
      const res = await postAnnouncementAction(input)
      if (res.ok) {
        router.push(`/modules/communications/${res.announcement_id}`)
      } else {
        setError(res.error)
      }
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (canSubmit && !pending) handleSubmit()
      }}
      className="space-y-6 max-w-2xl"
    >
      <div>
        <label className="block text-sm font-medium">
          Title <span className="text-muted text-xs">({title.length}/{TITLE_MAX})</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={TITLE_MAX}
          required
          className="mt-1 w-full border rounded-md px-3 py-2"
        />
      </div>

      <div>
        <label className="block text-sm font-medium">Priority</label>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as AnnouncementPriority)}
          className="mt-1 border rounded-md px-3 py-2"
        >
          <option value="normal">Normal</option>
          <option value="important">Important</option>
          <option value="urgent">Urgent (emails recipients)</option>
        </select>
      </div>

      <div>
        <span className="block text-sm font-medium">Audience</span>
        <div className="mt-2 space-y-2">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={audience === 'all_staff'}
              onChange={() => setAudience('all_staff')}
            />
            <span>All staff (active users at this facility)</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={audience === 'specific_roles'}
              onChange={() => setAudience('specific_roles')}
            />
            <span>Specific roles</span>
          </label>
        </div>
        {audience === 'specific_roles' ? (
          <div className="mt-3 ml-6 space-y-1">
            {roles.length === 0 ? (
              <p className="text-sm text-muted">No roles defined for this facility.</p>
            ) : (
              roles.map((r) => (
                <label key={r.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={targetRoleIds.includes(r.id)}
                    onChange={() => toggleRole(r.id)}
                  />
                  <span>{r.name}</span>
                </label>
              ))
            )}
          </div>
        ) : null}
      </div>

      <div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={requiresAck}
            onChange={(e) => setRequiresAck(e.target.checked)}
          />
          <span className="text-sm">
            Requires acknowledgment (tracked per-user; reminders sent if unacked)
          </span>
        </label>
      </div>

      <div>
        <label className="block text-sm font-medium">Expires at (optional)</label>
        <input
          type="datetime-local"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          className="mt-1 border rounded-md px-3 py-2"
        />
        <p className="text-xs text-muted mt-1">
          If blank, uses facility default. Expired announcements move to the archive bucket.
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium">
            Body (Markdown)
            <span className="text-muted text-xs ml-2">
              ({body.length}/{BODY_MAX})
            </span>
          </label>
          <button
            type="button"
            onClick={() => setShowPreview((p) => !p)}
            className="text-sm underline"
          >
            {showPreview ? 'Edit' : 'Preview'}
          </button>
        </div>
        {showPreview ? (
          <div className="mt-1 border rounded-md p-3 min-h-[12rem] bg-white">
            {body.trim().length === 0 ? (
              <p className="text-muted text-sm">(empty)</p>
            ) : (
              <MarkdownRenderer>{body}</MarkdownRenderer>
            )}
          </div>
        ) : (
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={BODY_MAX}
            rows={10}
            required
            className="mt-1 w-full border rounded-md px-3 py-2 font-mono text-sm"
            placeholder="Supports headings (## / ###), **bold**, *italic*, lists, [links](https://…). No images, tables, or raw HTML."
          />
        )}
        <p className="text-xs text-muted mt-1">
          Links open in a new tab. Raw HTML is stripped.
        </p>
      </div>

      {error ? <p className="text-red-700 text-sm">{error}</p> : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit || pending}
          className="bg-accent text-white px-4 py-2 rounded-md font-medium disabled:opacity-50"
        >
          {pending ? 'Posting…' : 'Post announcement'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/modules/communications')}
          className="underline text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
