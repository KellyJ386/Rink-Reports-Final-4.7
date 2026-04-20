import Link from 'next/link'

import { createClient } from '@/lib/supabase/server'

export default async function PlatformFacilitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const sp = await searchParams
  const supabase = await createClient()

  let query = supabase
    .from('facilities')
    .select('id, slug, name, plan_tier, created_at, is_platform, facility_subscriptions(status, trial_end)')
    .eq('is_platform', false)
    .order('created_at', { ascending: false })

  const { data } = await query

  const rows = (data ?? []).map((f: Record<string, unknown>) => {
    const sub = (f.facility_subscriptions as Array<{ status: string; trial_end: string | null }> | null)?.[0]
    return {
      id: f.id as string,
      slug: f.slug as string,
      name: f.name as string,
      plan_tier: f.plan_tier as string,
      created_at: f.created_at as string,
      status: sub?.status ?? 'unknown',
      trial_end: sub?.trial_end ?? null,
    }
  })

  const filtered = sp.status
    ? rows.filter((r) => r.status === sp.status)
    : rows

  return (
    <main>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold">Facilities</h1>
        <Link
          href="/platform-admin/facilities/new"
          className="no-underline bg-accent text-white px-4 py-2 rounded-md font-medium"
        >
          + Create facility
        </Link>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-muted">
              <th className="py-2 pr-3 font-medium">Name</th>
              <th className="py-2 pr-3 font-medium">Slug</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">Plan</th>
              <th className="py-2 pr-3 font-medium">Created</th>
              <th className="py-2 pr-3" aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((f) => (
              <tr key={f.id} className="border-b border-hairline">
                <td className="py-2 pr-3">{f.name}</td>
                <td className="py-2 pr-3 font-mono text-xs">{f.slug}</td>
                <td className="py-2 pr-3">{f.status}</td>
                <td className="py-2 pr-3">{f.plan_tier}</td>
                <td className="py-2 pr-3 text-muted">{new Date(f.created_at).toLocaleDateString()}</td>
                <td className="py-2 pr-3">
                  <Link href={`/platform-admin/facilities/${f.id}`}>Open</Link>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="py-4 text-muted text-sm">No facilities match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  )
}
