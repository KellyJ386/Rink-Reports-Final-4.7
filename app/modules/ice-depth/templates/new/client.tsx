'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { RINK_SVGS } from '@/app/modules/ice-depth/svgs'
import type { SvgKey } from '@/lib/ice-depth/types'

import { createTemplateAction } from './actions'

type Props = {
  surfaces: { id: string; name: string }[]
}

export function CreateTemplateClient({ surfaces }: Props) {
  const router = useRouter()
  const [surfaceId, setSurfaceId] = useState(surfaces[0]?.id ?? '')
  const [name, setName] = useState('Weekly depth check')
  const [svgKey, setSvgKey] = useState<SvgKey>('nhl')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const handleCreate = async () => {
    setError(null)
    setPending(true)
    const result = await createTemplateAction({
      surface_resource_id: surfaceId,
      name,
      svg_key: svgKey,
    })
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.push(`/modules/ice-depth/templates/${result.template_id}/edit`)
  }

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <label>
        Surface
        <select value={surfaceId} onChange={(e) => setSurfaceId(e.target.value)}>
          {surfaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Template name
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      </label>

      <label>
        Rink backdrop
        <select value={svgKey} onChange={(e) => setSvgKey(e.target.value as SvgKey)}>
          {(Object.keys(RINK_SVGS) as SvgKey[]).map((k) => (
            <option key={k} value={k}>
              {RINK_SVGS[k].label}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}

      <button type="button" onClick={handleCreate} disabled={!surfaceId || pending} className="self-start">
        {pending ? 'Creating…' : 'Create template'}
      </button>
    </div>
  )
}
