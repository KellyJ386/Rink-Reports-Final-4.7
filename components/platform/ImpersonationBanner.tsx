import { readImpersonationCookies } from '@/lib/auth/impersonation'
import { createClient } from '@/lib/supabase/server'

/**
 * Persistent banner shown to platform admins while an impersonation session is
 * active. Makes it hard to forget you're masquerading.
 */
export async function ImpersonationBanner() {
  const imp = await readImpersonationCookies()
  if (!imp) return null

  // Resolve facility name for the banner label. Platform admins see the row via
  // is_platform_admin() escape hatch; no impersonation needed for this lookup.
  const supabase = await createClient()
  const { data: facility } = await supabase
    .from('facilities')
    .select('name, slug')
    .eq('id', imp.facility_id)
    .maybeSingle()

  return (
    <div className="bg-amber-400 border-b-2 border-amber-600 px-4 py-2 text-sm flex items-center justify-between gap-3 text-ink">
      <span>
        <strong>Impersonating:</strong> {facility?.name ?? 'Unknown facility'}{' '}
        <span className="font-mono text-xs">({facility?.slug ?? imp.facility_id})</span>
      </span>
      <form action="/platform-admin/stop-impersonating" method="POST">
        <button
          type="submit"
          className="bg-ink text-white px-3 py-1 rounded text-xs font-medium min-h-0"
        >
          Stop impersonating
        </button>
      </form>
    </div>
  )
}
