'use client'

/**
 * Client-side bridge to the server-side submitForm. The offline queue cannot
 * import the server action directly (server-only imports). Instead, each module
 * registers its `'use server'` action once, and the sync loop dispatches by
 * module_slug + form_type.
 *
 * Agent 3's per-module `actions.ts` files can register themselves here in a
 * future pass. For v1 we use a minimal registry the application wires up at
 * client boot, and a universal fallback that invokes a route handler at
 * /api/offline-submit (Agent 7's own route) which re-issues submitForm
 * server-side.
 *
 * v1 strategy: the route handler `/api/offline-submit` receives the payload +
 * idempotency key + module/form_type and re-issues submitForm. This keeps the
 * sync loop simple (one endpoint to POST to) at the cost of one extra hop.
 */

export type SubmitBridgeResult =
  | { ok: true; id: string; idempotentReturn: boolean }
  | { ok: false; kind: 'validation' | 'transient' | 'unknown'; error: string }

export async function submitFormFromClient(input: {
  moduleSlug: string
  formType: string | null
  values: Record<string, unknown>
  idempotencyKey: string
}): Promise<SubmitBridgeResult> {
  try {
    const resp = await fetch('/api/offline-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module_slug: input.moduleSlug,
        form_type: input.formType,
        values: input.values,
        idempotency_key: input.idempotencyKey,
      }),
    })

    if (resp.ok) {
      const data = (await resp.json()) as { id: string; idempotent_return: boolean }
      return { ok: true, id: data.id, idempotentReturn: !!data.idempotent_return }
    }
    if (resp.status >= 400 && resp.status < 500) {
      const body = await resp.text().catch(() => '')
      return { ok: false, kind: 'validation', error: body.slice(0, 300) || 'Validation error' }
    }
    return { ok: false, kind: 'transient', error: `HTTP ${resp.status}` }
  } catch (err) {
    return {
      ok: false,
      kind: 'transient',
      error: err instanceof Error ? err.message : 'Network error',
    }
  }
}
