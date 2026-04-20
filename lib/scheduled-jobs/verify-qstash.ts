import 'server-only'

import { Receiver } from '@upstash/qstash'

/**
 * Verify a QStash signature on a scheduled-job route. QStash signs every
 * request with `Upstash-Signature`; we verify with current + next signing keys
 * (QStash rotates keys).
 *
 * Usage at the top of each /api/jobs/... route:
 *
 *   export async function POST(request: Request) {
 *     const verified = await verifyQstashRequest(request)
 *     if (!verified.ok) return new Response(verified.error, { status: 401 })
 *     // ... job body
 *   }
 *
 * If QStash env vars aren't set, the function returns ok: true with a warning —
 * so local dev (without a QStash account) can trigger jobs manually by curl.
 * Production deployments MUST set both keys; we surface the warning via logger.
 */

let cachedReceiver: Receiver | null | undefined

function getReceiver(): Receiver | null {
  if (cachedReceiver !== undefined) return cachedReceiver
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY
  if (!currentSigningKey || !nextSigningKey) {
    cachedReceiver = null
    return null
  }
  cachedReceiver = new Receiver({ currentSigningKey, nextSigningKey })
  return cachedReceiver
}

export type VerifyResult = { ok: true } | { ok: false; error: string }

export async function verifyQstashRequest(request: Request): Promise<VerifyResult> {
  const receiver = getReceiver()
  if (!receiver) {
    if (process.env.NODE_ENV === 'production') {
      return {
        ok: false,
        error: 'QStash signing keys not configured in production',
      }
    }
    console.warn(
      '[qstash] QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY not set; skipping signature verification (dev only)',
    )
    return { ok: true }
  }

  const signature = request.headers.get('upstash-signature')
  if (!signature) return { ok: false, error: 'Missing Upstash-Signature header' }

  const body = await request.clone().text()

  try {
    await receiver.verify({
      signature,
      body,
      clockTolerance: 60, // seconds
    })
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: `QStash signature invalid: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
