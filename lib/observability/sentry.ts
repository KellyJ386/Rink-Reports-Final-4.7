/**
 * Sentry wrapper. No-op when SENTRY_DSN is not configured, which keeps local
 * dev and preview builds light. The public DSN is picked up by Sentry's
 * Next.js plugin on the client; server-side captures go through captureException
 * below.
 */

type CaptureOpts = {
  facility_id?: string
  user_id?: string
  action?: string
  extra?: Record<string, unknown>
}

function isEnabled(): boolean {
  return !!process.env.SENTRY_DSN || !!process.env.NEXT_PUBLIC_SENTRY_DSN
}

export function captureException(error: unknown, opts?: CaptureOpts): void {
  if (!isEnabled()) {
    // Still log to stdout so we don't swallow errors in dev.
    console.error('[sentry:disabled]', error, opts)
    return
  }
  // Dynamic import keeps bundle size down when Sentry isn't used.
  import('@sentry/nextjs')
    .then((Sentry) => {
      Sentry.withScope((scope) => {
        if (opts?.facility_id) scope.setTag('facility_id', opts.facility_id)
        if (opts?.user_id) scope.setTag('user_id', opts.user_id)
        if (opts?.action) scope.setTag('action', opts.action)
        if (opts?.extra) {
          for (const [k, v] of Object.entries(opts.extra)) scope.setExtra(k, v)
        }
        Sentry.captureException(error)
      })
    })
    .catch(() => {
      console.error('[sentry:import-failed]', error)
    })
}

export function captureMessage(message: string, opts?: CaptureOpts): void {
  if (!isEnabled()) {
    console.warn('[sentry:disabled]', message, opts)
    return
  }
  import('@sentry/nextjs')
    .then((Sentry) => {
      Sentry.captureMessage(message, {
        tags: {
          ...(opts?.facility_id ? { facility_id: opts.facility_id } : {}),
          ...(opts?.user_id ? { user_id: opts.user_id } : {}),
          ...(opts?.action ? { action: opts.action } : {}),
        },
        extra: opts?.extra,
      })
    })
    .catch(() => {
      console.warn('[sentry:import-failed]', message)
    })
}
