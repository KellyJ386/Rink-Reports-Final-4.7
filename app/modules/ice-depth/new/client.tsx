'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

import { startSessionAction } from './actions'

type TemplateOption = { id: string; label: string }

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `k_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

export function StartSessionClient({ templates }: { templates: TemplateOption[] }) {
  const router = useRouter()
  const [templateId, setTemplateId] = useState<string>(templates[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const idempotencyKey = useMemo(() => newIdempotencyKey(), [])

  const handleStart = async () => {
    if (!templateId) return
    setError(null)
    setPending(true)
    const result = await startSessionAction({
      template_id: templateId,
      idempotency_key: idempotencyKey,
    })
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.push(`/modules/ice-depth/${result.session_id}/run`)
  }

  return (
    <div className="flex flex-col gap-4">
      <label>
        Template
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}
      <button type="button" onClick={handleStart} disabled={!templateId || pending} className="self-start">
        {pending ? 'Starting…' : 'Start session'}
      </button>
    </div>
  )
}
