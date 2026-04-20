import Link from 'next/link'

import { listTemplates } from '@/lib/ice-depth/template'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'

import { StartSessionClient } from './client'

export default async function NewIceDepthSessionPage() {
  await requireModuleEnabled('ice_depth')
  const templates = await listTemplates()

  if (templates.length === 0) {
    return (
      <main>
        <h1 className="text-xl font-semibold">No Ice Depth templates</h1>
        <p className="text-muted mt-2">
          An admin must create at least one template before staff can run sessions.
        </p>
        <p className="mt-4">
          <Link
            href="/modules/ice-depth/templates/new"
            className="no-underline bg-accent text-white px-4 py-2 rounded-md"
          >
            Create template →
          </Link>
        </p>
      </main>
    )
  }

  return (
    <main>
      <h1 className="text-xl font-semibold">Start an Ice Depth session</h1>
      <p className="text-muted text-sm mt-1">Pick the template you're running.</p>
      <div className="mt-6">
        <StartSessionClient
          templates={templates.map((t) => ({
            id: t.id,
            label: `${t.surface_name} — ${t.name} (v${t.version})`,
          }))}
        />
      </div>
    </main>
  )
}
