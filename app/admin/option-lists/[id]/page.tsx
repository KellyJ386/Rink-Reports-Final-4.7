import Link from 'next/link'
import { notFound } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'

import { OptionListItemsEditor } from './OptionListItemsEditor'

export default async function AdminOptionListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: list }, { data: items }] = await Promise.all([
    supabase.from('option_lists').select('id, slug, name, description').eq('id', id).maybeSingle(),
    supabase
      .from('option_list_items')
      .select('id, key, label, sort_order, is_active')
      .eq('option_list_id', id)
      .order('sort_order', { ascending: true }),
  ])

  if (!list) notFound()

  return (
    <main>
      <h1 className="text-xl font-semibold">
        {list.name} <span className="text-muted font-mono text-sm">({list.slug})</span>
      </h1>
      {list.description && <p className="text-muted text-sm mt-1">{list.description}</p>}

      <p className="text-sm mt-4">
        <Link href="/admin/option-lists">← All lists</Link>
      </p>

      <div className="mt-6">
        <OptionListItemsEditor
          optionListId={id}
          items={(items ?? []) as Array<{
            id: string
            key: string
            label: string
            sort_order: number
            is_active: boolean
          }>}
        />
      </div>
    </main>
  )
}
