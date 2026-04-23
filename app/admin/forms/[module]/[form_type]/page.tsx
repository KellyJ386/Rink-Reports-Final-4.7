import Link from 'next/link'
import { notFound } from 'next/navigation'

import { loadFormSchemaForEditor } from '@/lib/forms/editor'
import { createClient } from '@/lib/supabase/server'
import { FORM_SCHEMA_FORMAT_VERSION } from '@/lib/forms/types'

import { FormSchemaEditor } from './FormSchemaEditor'

export default async function AdminFormSchemaEditorPage({
  params,
}: {
  params: Promise<{ module: string; form_type: string }>
}) {
  const { module, form_type: ftParam } = await params
  const formType = ftParam === '_' ? null : ftParam

  // Phase 2 Seam 1 contract: bundles the published doc, the draft (or null),
  // the version, and the annotations the editor needs — core-field keys for
  // lock badges, protected keys for rename-block UX, available option-list
  // slugs + resource types for autocomplete.
  const result = await loadFormSchemaForEditor({ moduleSlug: module, formType })
  if (!result.ok) notFound()

  const moduleName = await fetchModuleDisplayName(module)

  return (
    <main>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">
            {moduleName ?? module}
            {formType && (
              <span className="ml-2 text-muted font-normal text-base">· {formType}</span>
            )}
          </h1>
          <p className="text-muted text-sm">
            Published v{result.version} · {FORM_SCHEMA_FORMAT_VERSION}
            {result.draft && <> · <span className="text-warn">Draft pending</span></>}
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href={`/admin/forms/${module}/${formType ?? '_'}/history`}>History</Link>
          <Link href="/admin/forms">← All forms</Link>
        </div>
      </div>

      {/* Desktop-only gate */}
      <div className="md:hidden border border-warn bg-amber-50 rounded-md p-4 mt-4 text-sm">
        The form schema editor is desktop-only. Open this page on a device at least 1024px wide to edit.
      </div>

      <div className="hidden md:block mt-4">
        <FormSchemaEditor
          formSchemaId={result.schemaId}
          currentVersion={result.version}
          currentDefinition={result.published as Record<string, unknown>}
          draftDefinition={(result.draft as Record<string, unknown> | null) ?? null}
          annotations={result.annotations}
        />
      </div>
    </main>
  )
}

/**
 * The editor contract intentionally doesn't return the module display name —
 * it's cosmetic, not core to the contract. One extra select keeps the page
 * header friendly. RLS scopes this to the caller's facility (admin access is
 * required to reach /admin at all).
 */
async function fetchModuleDisplayName(slug: string): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('modules')
    .select('name')
    .eq('slug', slug)
    .maybeSingle()
  return (data as { name?: string } | null)?.name ?? null
}
