import Link from 'next/link'

import { createClient } from '@/lib/supabase/server'

import { UsersTable } from './UsersTable'

export default async function AdminUsersPage() {
  const supabase = await createClient()

  const [{ data: users }, { data: roles }] = await Promise.all([
    supabase
      .from('users')
      .select('id, full_name, email, active, created_at, user_roles(role_id, roles(id, name))')
      .order('created_at', { ascending: true }),
    supabase.from('roles').select('id, name').order('name', { ascending: true }),
  ])

  const userRows = (users ?? []).map((u: Record<string, unknown>) => {
    const ur = (u.user_roles as Array<{ roles: { id: string; name: string } | null }> | null) ?? []
    const userRoles = ur.map((r) => r.roles).filter((r): r is { id: string; name: string } => r !== null)
    return {
      id: u.id as string,
      full_name: (u.full_name as string) ?? '',
      email: u.email as string,
      active: u.active as boolean,
      created_at: u.created_at as string,
      roles: userRoles,
    }
  })

  return (
    <main>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold">Users</h1>
        <Link
          href="/admin/invites"
          className="no-underline bg-accent text-white px-4 py-2 rounded-md font-medium"
        >
          + Invite user
        </Link>
      </div>
      <p className="text-muted text-sm mt-1">
        Deactivating a user signs them out immediately and blocks re-login. Reactivate to restore access.
      </p>
      <div className="mt-6">
        <UsersTable users={userRows} availableRoles={(roles ?? []) as { id: string; name: string }[]} />
      </div>
    </main>
  )
}
