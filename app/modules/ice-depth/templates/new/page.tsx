import Link from 'next/link'

import { createClient } from '@/lib/supabase/server'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'

import { CreateTemplateClient } from './client'

export default async function NewTemplatePage() {
  await requireModuleEnabled('ice_depth')

  const supabase = await createClient()
  const { data: surfaces } = await supabase
    .from('facility_resources')
    .select('id, name')
    .eq('resource_type', 'surface')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  const surfaceList = (surfaces as { id: string; name: string }[] | null) ?? []

  if (surfaceList.length === 0) {
    return (
      <main>
        <h1 className="text-xl font-semibold">No ice surfaces</h1>
        <p className="text-muted mt-2">
          Add at least one surface under Resources before creating an Ice Depth template.
        </p>
        <p className="mt-4">
          <Link href="/admin/resources">Open Resources (admin) →</Link>
        </p>
      </main>
    )
  }

  // Exclude surfaces that already have a template (one per surface)
  const { data: existing } = await supabase
    .from('ice_depth_templates')
    .select('surface_resource_id')
  const taken = new Set((existing ?? []).map((r: { surface_resource_id: string }) => r.surface_resource_id))
  const available = surfaceList.filter((s) => !taken.has(s.id))

  if (available.length === 0) {
    return (
      <main>
        <h1 className="text-xl font-semibold">All surfaces have templates</h1>
        <p className="text-muted mt-2">
          Each ice surface already has an Ice Depth template. Edit an existing one instead.
        </p>
        <p className="mt-4">
          <Link href="/modules/ice-depth/templates">← Templates list</Link>
        </p>
      </main>
    )
  }

  return (
    <main>
      <h1 className="text-xl font-semibold">New Ice Depth template</h1>
      <p className="text-muted text-sm mt-1">
        The template ships with 8 default points you can reposition in the editor.
      </p>
      <div className="mt-6">
        <CreateTemplateClient surfaces={available} />
      </div>
    </main>
  )
}
