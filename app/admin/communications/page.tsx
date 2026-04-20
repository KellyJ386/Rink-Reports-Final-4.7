import Link from 'next/link'

import { createClient } from '@/lib/supabase/server'
import { getAllSettings } from '@/lib/facility/settings'

import { CommunicationsSettingsClient } from './client'

export default async function AdminCommunicationsPage() {
  const settings = await getAllSettings()

  // Surface a read-only summary of which roles can post announcements (admin
  // access on the communications module). Agent 6's /admin/roles page handles
  // mutations; this page just lists them.
  const supabase = await createClient()
  const { data: roles } = await supabase
    .from('role_module_access')
    .select(
      'access_level, roles!inner(id, name, description), modules!inner(slug)',
    )
    .eq('modules.slug', 'communications')

  const adminRoles: Array<{ id: string; name: string; description: string | null }> = []
  for (const row of (roles ?? []) as Array<{
    access_level: string
    roles: { id: string; name: string; description: string | null } | Array<{ id: string; name: string; description: string | null }>
  }>) {
    if (row.access_level !== 'admin') continue
    const r = Array.isArray(row.roles) ? row.roles[0] : row.roles
    if (r) adminRoles.push(r)
  }

  const [{ count: totalAnnouncements }, { count: activeAnnouncements }] = await Promise.all([
    supabase.from('announcements').select('*', { count: 'exact', head: true }),
    supabase
      .from('announcements')
      .select('*', { count: 'exact', head: true })
      .eq('is_archived', false),
  ])

  return (
    <main>
      <h1 className="text-xl font-semibold">Communications</h1>
      <p className="text-muted text-sm mt-1">
        Configure facility-wide announcement defaults. Posting itself happens under{' '}
        <Link href="/modules/communications" className="underline">
          /modules/communications
        </Link>.
      </p>

      <section className="mt-6 grid grid-cols-2 gap-3 max-w-md">
        <div className="border border-hairline rounded-md p-3">
          <div className="text-xs uppercase tracking-wide text-muted">Announcements</div>
          <div className="text-2xl font-semibold">{totalAnnouncements ?? 0}</div>
        </div>
        <div className="border border-hairline rounded-md p-3">
          <div className="text-xs uppercase tracking-wide text-muted">Active (non-archived)</div>
          <div className="text-2xl font-semibold">{activeAnnouncements ?? 0}</div>
        </div>
      </section>

      <CommunicationsSettingsClient
        initialRequireAck={Boolean(settings['communications.require_ack_enabled'])}
        initialDefaultExpiryDays={Number(settings['communications.default_expiry_days'] ?? 30)}
      />

      <section className="mt-10 max-w-2xl">
        <h2 className="font-medium">Who can post announcements</h2>
        <p className="text-muted text-sm mt-1">
          Roles with <strong>admin</strong> access on Communications. Change access under{' '}
          <Link href="/admin/roles" className="underline">
            /admin/roles
          </Link>
          .
        </p>
        {adminRoles.length === 0 ? (
          <p className="text-amber-700 text-sm mt-2">
            No roles have admin access on Communications. Nobody can post until you grant access
            under /admin/roles.
          </p>
        ) : (
          <ul className="mt-3 divide-y border rounded-md">
            {adminRoles.map((r) => (
              <li key={r.id} className="p-3">
                <Link
                  href={`/admin/roles/${r.id}`}
                  className="font-medium no-underline text-ink"
                >
                  {r.name}
                </Link>
                {r.description ? (
                  <div className="text-xs text-muted mt-1">{r.description}</div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
