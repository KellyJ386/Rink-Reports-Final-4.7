'use client'

import { useState } from 'react'

import { setRoleModuleAccessAction } from '../actions'

type Module = {
  id: string
  slug: string
  name: string
  category: string
  access_level: 'none' | 'read' | 'write' | 'admin'
}

const LEVELS: Array<'none' | 'read' | 'write' | 'admin'> = ['none', 'read', 'write', 'admin']

export function RoleAccessMatrix({ roleId, modules }: { roleId: string; modules: Module[] }) {
  const [saving, setSaving] = useState<string | null>(null) // module_id being saved
  const [error, setError] = useState<string | null>(null)

  const handleChange = async (
    moduleId: string,
    newLevel: 'none' | 'read' | 'write' | 'admin',
  ) => {
    setSaving(moduleId)
    setError(null)
    const result = await setRoleModuleAccessAction(roleId, moduleId, newLevel)
    setSaving(null)
    if (!result.ok) setError(result.error)
  }

  // Group by category
  const byCategory = new Map<string, Module[]>()
  for (const m of modules) {
    const list = byCategory.get(m.category) ?? []
    list.push(m)
    byCategory.set(m.category, list)
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}

      {[...byCategory.entries()].map(([category, mods]) => (
        <section key={category}>
          <h3 className="text-xs uppercase tracking-wide text-muted mb-2">{category}</h3>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-muted">
                <th className="py-2 pr-3 font-medium">Module</th>
                <th className="py-2 pr-3 font-medium">Access</th>
              </tr>
            </thead>
            <tbody>
              {mods.map((m) => (
                <tr key={m.id} className="border-b border-hairline">
                  <td className="py-2 pr-3">{m.name}</td>
                  <td className="py-2 pr-3">
                    <div className="flex gap-2 flex-wrap">
                      {LEVELS.map((lv) => (
                        <label key={lv} className="flex-row items-center gap-1 font-normal text-xs min-h-0">
                          <input
                            type="radio"
                            className="w-auto"
                            name={`access-${m.id}`}
                            checked={m.access_level === lv}
                            onChange={() => handleChange(m.id, lv)}
                            disabled={saving === m.id}
                          />
                          <span>{lv}</span>
                        </label>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  )
}
