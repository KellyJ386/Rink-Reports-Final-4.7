import Link from 'next/link'
import { notFound } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'

import { CopyJsonButton } from './CopyJsonButton'

export default async function FormSchemaHistoryVersionPage({
  params,
}: {
  params: Promise<{ module: string; form_type: string; version: string }>
}) {
  const { module, form_type: ftParam, version: versionParam } = await params
  const formType = ftParam === '_' ? null : ftParam
  const version = Number(versionParam)
  if (!Number.isFinite(version)) notFound()

  const supabase = await createClient()
  const query = supabase
    .from('form_schema_history')
    .select('version, schema_definition, published_at, users:published_by(full_name)')
    .eq('module_slug', module)
    .eq('version', version)

  const { data } = formType
    ? await query.eq('form_type', formType).maybeSingle()
    : await query.is('form_type', null).maybeSingle()

  if (!data) notFound()

  const prettyJson = JSON.stringify(data.schema_definition, null, 2)

  return (
    <main>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold">
          Form schema history — v{data.version}
        </h1>
        <Link href={`/admin/forms/${module}/${formType ?? '_'}/history`}>← All versions</Link>
      </div>

      <p className="text-muted text-sm mt-1">
        Published {new Date(data.published_at as string).toLocaleString()}
        {data.users && typeof data.users === 'object' && 'full_name' in data.users
          ? ` by ${(data.users as { full_name?: string }).full_name ?? ''}`
          : ''}
      </p>

      <div className="mt-4 flex items-center gap-2">
        <CopyJsonButton json={prettyJson} />
        <span className="text-xs text-muted">
          To "roll back" to this version: paste the JSON into a new draft, save, then publish.
        </span>
      </div>

      <pre className="mt-4 p-4 bg-gray-900 text-gray-100 rounded-md overflow-auto text-xs leading-5">
        <code>{prettyJson}</code>
      </pre>
    </main>
  )
}
