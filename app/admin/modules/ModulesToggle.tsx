'use client'

import { useState } from 'react'

import { toggleModuleAction } from './actions'

type Module = {
  id: string
  slug: string
  name: string
  description: string
  category: string
  is_enabled: boolean
  is_protected: boolean
}

export function ModulesToggle({ modules }: { modules: Module[] }) {
  const [error, setError] = useState<string | null>(null)
  const [busySlug, setBusySlug] = useState<string | null>(null)

  const handleToggle = async (m: Module) => {
    setError(null)
    setBusySlug(m.slug)
    const result = await toggleModuleAction(m.slug, !m.is_enabled)
    setBusySlug(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    window.location.reload()
  }

  // Group by category
  const byCategory = new Map<string, Module[]>()
  for (const m of modules) {
    const list = byCategory.get(m.category) ?? []
    list.push(m)
    byCategory.set(m.category, list)
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}

      {[...byCategory.entries()].map(([category, mods]) => (
        <section key={category}>
          <h2 className="text-xs uppercase tracking-wide text-muted mb-2">{category}</h2>
          <div className="flex flex-col gap-2">
            {mods.map((m) => (
              <div
                key={m.id}
                className="border border-hairline rounded-md p-3 flex items-start justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="font-medium">{m.name}</div>
                  {m.description && <div className="text-sm text-muted">{m.description}</div>}
                  {m.is_protected && (
                    <div className="text-xs text-muted mt-1">
                      Protected — cannot be disabled.
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => !m.is_protected && handleToggle(m)}
                  disabled={m.is_protected || busySlug === m.slug}
                  className={
                    (m.is_enabled
                      ? 'bg-ok text-white'
                      : 'bg-transparent border border-hairline text-ink') +
                    ' px-4 py-2 rounded-md text-sm font-medium min-h-tap'
                  }
                >
                  {busySlug === m.slug
                    ? '…'
                    : m.is_enabled
                      ? m.is_protected
                        ? 'Always on'
                        : 'Enabled · click to disable'
                      : 'Disabled · click to enable'}
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
