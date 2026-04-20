import { createClient } from '@/lib/supabase/server'

import { OptionListsManager } from './OptionListsManager'

export default async function AdminOptionListsPage() {
  const supabase = await createClient()

  const { data: lists } = await supabase
    .from('option_lists')
    .select('id, slug, name, description, option_list_items(count)')
    .order('slug', { ascending: true })

  const rows = (lists ?? []).map((l: Record<string, unknown>) => {
    const itemsAgg = l.option_list_items as Array<{ count: number }> | null
    return {
      id: l.id as string,
      slug: l.slug as string,
      name: l.name as string,
      description: (l.description as string | null) ?? null,
      item_count: itemsAgg?.[0]?.count ?? 0,
    }
  })

  return (
    <main>
      <h1 className="text-xl font-semibold">Option lists</h1>
      <p className="text-muted text-sm mt-1">
        Shared dropdown sources. Slugs are plural snake_case (e.g. <code>hazards</code>,{' '}
        <code>injury_types</code>). Forms reference lists via{' '}
        <code>{'{"from_option_list":"<slug>"}'}</code>.
      </p>

      <div className="mt-6">
        <OptionListsManager lists={rows} />
      </div>
    </main>
  )
}
