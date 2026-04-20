import Link from 'next/link'
import { notFound } from 'next/navigation'

import { loadTemplate } from '@/lib/ice-depth/template'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'

import { EditTemplateClient } from './client'

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireModuleEnabled('ice_depth')
  const { id } = await params
  const tmpl = await loadTemplate(id)
  if (!tmpl) notFound()

  return (
    <main>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold">
          Edit template — {tmpl.surface_name}
        </h1>
        <Link href="/modules/ice-depth/templates">← Back</Link>
      </div>
      <p className="text-muted text-sm mt-1">
        Published v{tmpl.version}
        {tmpl.has_draft ? ' · Draft pending' : ''}
      </p>

      <div className="mt-6">
        <EditTemplateClient
          templateId={tmpl.id}
          initial={{
            name: tmpl.name,
            svg_key: tmpl.svg_key,
            current_points: tmpl.current_points,
            draft_points: tmpl.draft_points,
            version: tmpl.version,
          }}
        />
      </div>
    </main>
  )
}
