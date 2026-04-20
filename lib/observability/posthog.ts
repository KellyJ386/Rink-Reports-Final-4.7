/**
 * PostHog wrapper — opt-in per-facility. If NEXT_PUBLIC_POSTHOG_KEY is unset,
 * the client import noops. The facility setting `analytics_enabled` (default
 * true) also gates per-facility; Agent 7 reads that setting during
 * identify / capture in server-side contexts.
 *
 * For v1 we instrument three high-signal events:
 *   - submission.created        (from lib/forms/submit.ts)
 *   - schedule.published        (Agent 5)
 *   - announcement.posted       (Agent 8)
 *
 * Client-side page views auto-capture via posthog-js default config.
 */

type CaptureOpts = {
  distinct_id?: string
  facility_id?: string
  properties?: Record<string, unknown>
}

function enabled(): boolean {
  return !!process.env.NEXT_PUBLIC_POSTHOG_KEY
}

/**
 * Server-side event capture. Respects the facility setting
 * `analytics_enabled = false`. Fire-and-forget; errors are swallowed with a log.
 */
export async function captureServerEvent(event: string, opts: CaptureOpts = {}): Promise<void> {
  if (!enabled()) return
  if (opts.facility_id) {
    try {
      const { createServiceClient } = await import('@/lib/supabase/service')
      const svc = createServiceClient()
      const { data: facility } = await svc
        .from('facilities')
        .select('settings')
        .eq('id', opts.facility_id)
        .maybeSingle()
      const analyticsEnabled =
        (facility?.settings as { analytics_enabled?: boolean } | null)?.analytics_enabled !== false
      if (!analyticsEnabled) return
    } catch {
      // If we can't check the setting, default to capturing (fail open for analytics)
    }
  }

  try {
    const { PostHog } = await import('posthog-node')
    const client = new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY as string, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
    })
    client.capture({
      distinctId: opts.distinct_id ?? 'anonymous',
      event,
      properties: {
        ...opts.properties,
        facility_id: opts.facility_id,
      },
    })
    await client.shutdown()
  } catch (err) {
    console.warn('[posthog:capture-failed]', err)
  }
}
