import 'server-only'

/**
 * Resend wrapper. If RESEND_API_KEY is not set, sendEmail is a silent no-op —
 * useful for local dev and preview environments that don't want to hit the API.
 *
 * Email rendering is intentionally simple (plain HTML, no external template
 * engine). v1 accepts string subject + html/text. Future templates can compose
 * via @react-email if the product needs fancier HTML.
 */

type SendEmailInput = {
  to: string
  subject: string
  html: string
  text?: string
}

export type SendEmailResult =
  | { ok: true; provider_id?: string; skipped?: false }
  | { ok: true; skipped: true }
  | { ok: false; error: string }

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_ADDRESS

  if (!apiKey || !from) {
    // Gracefully degrade — no-op so the caller doesn't need to branch.
    return { ok: true, skipped: true }
  }

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text ?? stripHtml(input.html),
      }),
    })

    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      return { ok: false, error: `Resend ${resp.status}: ${body.slice(0, 200)}` }
    }
    const data = (await resp.json().catch(() => ({}))) as { id?: string }
    return { ok: true, provider_id: data.id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
