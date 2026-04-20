import Link from 'next/link'
import { notFound } from 'next/navigation'

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

  const supabase = await createClient()

  const query = supabase
    .from('form_schemas')
    .select(
      'id, facility_id, module_slug, form_type, schema_definition, draft_definition, version, is_published, updated_at, modules!inner(name)',
    )
    .eq('module_slug', module)

  const { data: row } = formType
    ? await query.eq('form_type', formType).maybeSingle()
    : await query.is('form_type', null).maybeSingle()

  if (!row) notFound()

  return (
    <main>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">
            {(row.modules as { name?: string } | null)?.name ?? module}
            {formType && (
              <span className="ml-2 text-muted font-normal text-base">· {formType}</span>
            )}
          </h1>
          <p className="text-muted text-sm">
            Published v{row.version} · {FORM_SCHEMA_FORMAT_VERSION}
            {row.draft_definition && <> · <span className="text-warn">Draft pending</span></>}
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
          formSchemaId={row.id as string}
          currentVersion={row.version as number}
          currentDefinition={row.schema_definition as Record<string, unknown>}
          draftDefinition={(row.draft_definition as Record<string, unknown> | null) ?? null}
        />
      </div>
    </main>
  )
}
