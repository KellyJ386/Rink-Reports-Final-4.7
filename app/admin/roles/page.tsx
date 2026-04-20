import Link from 'next/link'

import { createClient } from '@/lib/supabase/server'

import { RolesList } from './RolesList'

export default async function AdminRolesPage() {
  const supabase = await createClient()

  const { data: roles } = await supabase
    .from('roles')
    .select('id, name, description, is_system, user_roles(count)')
    .order('is_system', { ascending: false })
    .order('name', { ascending: true })

  const rows = (roles ?? []).map((r: Record<string, unknown>) => {
    const ur = r.user_roles as Array<{ count: number }> | null
    return {
      id: r.id as string,
      name: r.name as string,
      description: (r.description as string | null) ?? null,
      is_system: r.is_system as boolean,
      user_count: ur?.[0]?.count ?? 0,
    }
  })

  return (
    <main>
      <h1 className="text-xl font-semibold">Roles</h1>
      <p className="text-muted text-sm mt-1">
        New roles start with no access on any module. Grant access explicitly in the role detail.
      </p>
      <div className="mt-6">
        <RolesList roles={rows} />
      </div>
      <p className="mt-6 text-sm">
        <Link href="/admin/users">← Back to users</Link>
      </p>
    </main>
  )
}
