import { createClient } from '@/lib/supabase/server'

import { InvitesManager } from './InvitesManager'

export default async function AdminInvitesPage() {
  const supabase = await createClient()

  const [{ data: invites }, { data: roles }] = await Promise.all([
    supabase
      .from('facility_invites')
      .select('id, email, expires_at, accepted_at, revoked_at, created_at, roles(id, name)')
      .order('created_at', { ascending: false }),
    supabase.from('roles').select('id, name').order('name', { ascending: true }),
  ])

  const rows = (invites ?? []).map((i: Record<string, unknown>) => ({
    id: i.id as string,
    email: i.email as string,
    role_name: (i.roles as { name?: string } | null)?.name ?? '—',
    expires_at: i.expires_at as string,
    accepted_at: (i.accepted_at as string | null) ?? null,
    revoked_at: (i.revoked_at as string | null) ?? null,
    created_at: i.created_at as string,
  }))

  return (
    <main>
      <h1 className="text-xl font-semibold">Invites</h1>
      <p className="text-muted text-sm mt-1">
        Outstanding invites appear at the top. Share the link with the recipient via email or chat.
        Every accept-invite link is one-shot and expires in 7 days.
      </p>
      <div className="mt-6">
        <InvitesManager invites={rows} roles={(roles ?? []) as { id: string; name: string }[]} />
      </div>
    </main>
  )
}
