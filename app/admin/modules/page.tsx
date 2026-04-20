import { createClient } from '@/lib/supabase/server'

import { ModulesToggle } from './ModulesToggle'

export default async function AdminModulesPage() {
  const supabase = await createClient()

  // Every module + whether this facility has it enabled
  const [{ data: modules }, { data: facilityModules }] = await Promise.all([
    supabase
      .from('modules')
      .select('id, slug, name, description, category, sort_order')
      .order('sort_order', { ascending: true }),
    supabase.from('facility_modules').select('module_id, is_enabled'),
  ])

  const enabledMap = new Map<string, boolean>()
  for (const fm of (facilityModules ?? []) as Array<{ module_id: string; is_enabled: boolean }>) {
    enabledMap.set(fm.module_id, fm.is_enabled)
  }

  const rows = (modules ?? []).map((m: Record<string, unknown>) => ({
    id: m.id as string,
    slug: m.slug as string,
    name: m.name as string,
    description: (m.description as string | null) ?? '',
    category: m.category as string,
    is_enabled: enabledMap.get(m.id as string) ?? false,
    is_protected: m.slug === 'admin_control_center',
  }))

  return (
    <main>
      <h1 className="text-xl font-semibold">Modules</h1>
      <p className="text-muted text-sm mt-1">
        Toggle modules your facility uses. Disabled modules become inaccessible to all staff;
        their data remains for audit and historical detail views.
      </p>

      <div className="mt-6">
        <ModulesToggle modules={rows} />
      </div>
    </main>
  )
}
