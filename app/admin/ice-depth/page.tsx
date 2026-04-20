import Link from 'next/link'

import { createClient } from '@/lib/supabase/server'

export default async function AdminIceDepthPage() {
  const supabase = await createClient()

  const { count: templateCount } = await supabase
    .from('ice_depth_templates')
    .select('*', { count: 'exact', head: true })

  const { count: sessionCount } = await supabase
    .from('ice_depth_sessions')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'completed')

  return (
    <main>
      <h1 className="text-xl font-semibold">Ice Depth</h1>
      <p className="text-muted text-sm mt-1">
        Ice Depth templates are managed inside the module, not here. Use the buttons below.
      </p>

      <section className="mt-6 grid grid-cols-2 gap-3 max-w-md">
        <div className="border border-hairline rounded-md p-3">
          <div className="text-xs uppercase tracking-wide text-muted">Templates</div>
          <div className="text-2xl font-semibold">{templateCount ?? 0}</div>
        </div>
        <div className="border border-hairline rounded-md p-3">
          <div className="text-xs uppercase tracking-wide text-muted">Completed sessions</div>
          <div className="text-2xl font-semibold">{sessionCount ?? 0}</div>
        </div>
      </section>

      <div className="mt-6 flex gap-2 flex-wrap">
        <Link
          href="/modules/ice-depth/templates"
          className="no-underline bg-accent text-white px-4 py-2 rounded-md font-medium"
        >
          Manage templates →
        </Link>
        <Link
          href="/modules/ice-depth/trends"
          className="no-underline bg-transparent border border-hairline text-ink px-4 py-2 rounded-md font-medium"
        >
          View trends →
        </Link>
      </div>
    </main>
  )
}
