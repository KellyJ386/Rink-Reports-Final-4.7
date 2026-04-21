'use client'

import { useRouter } from 'next/navigation'
import { useState, useId } from 'react'

import { MarkdownBody } from '@/components/communications/MarkdownBody'
import type { Announcement, AnnouncementPriority, TargetAudience } from '@/lib/communications/types'

import { editAnnouncement, archiveAnnouncement } from '@/lib/communications/actions'

type Role = { id: string; name: string }

type Props = {
  announcement: Announcement
  hasReads: boolean
  roles: Role[]
}

export function EditAnnouncementClient({ announcement, hasReads, roles }: Props) {
  const router = useRouter()
  const formId = useId()

  const [title, setTitle] = useState(announcement.title)
  const [body, setBody] = useState(announcement.body)
  const [priority, setPriority] = useState<AnnouncementPriority>(announcement.priority)
  const [audience, setAudience] = useState<TargetAudience>(announcement.target_audience)
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>(
    announcement.target_role_ids ?? [],
  )
  const [requireAck, setRequireAck] = useState(announcement.requires_acknowledgment)
  const [expiresAt, setExpiresAt] = useState(
    announcement.expires_at ? announcement.expires_at.slice(0, 10) : '',
  )
  const [showPreview, setShowPreview] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const result = await editAnnouncement({
        id: announcement.id,
        title: title.trim(),
        body: body.trim(),
        priority,
        target_audience: audience,
        target_role_ids: audience === 'specific_roles' ? selectedRoleIds : null,
        requires_acknowledgment: requireAck,
        expires_at: expiresAt || null,
      })
      if (result.ok) {
        router.push(`/modules/communications/${announcement.id}`)
        router.refresh()
      } else {
        setError(result.error)
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function handleArchive() {
    if (!window.confirm('Archive this announcement? It will be moved to the archive and no longer visible on the main list.')) return
    setArchiving(true)
    setError(null)
    try {
      const result = await archiveAnnouncement(announcement.id)
      if (result.ok) {
        router.push('/modules/communications')
        router.refresh()
      } else {
        setError(result.error)
      }
    } finally {
      setArchiving(false)
    }
  }

  function toggleRole(id: string) {
    setSelectedRoleIds((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id],
    )
  }

  if (hasReads) {
    return (
      <div className="space-y-4 max-w-2xl">
        <div className="rounded-md border border-yellow-200 bg-yellow-50 px-4 py-4">
          <p className="text-sm text-yellow-800 font-medium">
            This announcement has been read by recipients and can no longer be edited.
          </p>
          <p className="text-sm text-yellow-700 mt-1">
            You can archive it and create a corrected version instead.
          </p>
        </div>
        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="flex gap-3">
          <button
            onClick={handleArchive}
            disabled={archiving}
            className="bg-accent text-white px-5 py-2 rounded-md font-medium text-sm disabled:opacity-50"
          >
            {archiving ? 'Archiving…' : 'Archive this announcement'}
          </button>
          <a
            href={`/modules/communications/${announcement.id}`}
            className="px-5 py-2 rounded-md font-medium text-sm border border-hairline text-ink no-underline"
          >
            Cancel
          </a>
        </div>
      </div>
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
          />
        )}
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
          {submitting ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={handleArchive}
          disabled={archiving}
          className="px-5 py-2 rounded-md font-medium text-sm border border-hairline text-ink disabled:opacity-50"
        >
          {archiving ? 'Archiving…' : 'Archive'}
        </button>
        <a
          href={`/modules/communications/${announcement.id}`}
          className="px-5 py-2 rounded-md font-medium text-sm text-muted no-underline"
        >
          Cancel
        </a>
      </div>
    </form>
  )
}
