'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { acceptInvite, signInAfterAccept } from '@/lib/invites/accept'

function clientIp(hdrs: Headers): string {
  // Vercel and most proxies populate x-forwarded-for with "client, proxy1, proxy2".
  // First entry is the client. Fall back to x-real-ip or a placeholder.
  const xff = hdrs.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  return hdrs.get('x-real-ip') ?? 'unknown'
}

export type AcceptInviteFormState = {
  error?: string
  // Preserve user-entered values for re-render on error
  fullName?: string
}

export async function acceptInviteAction(
  _prev: AcceptInviteFormState,
  formData: FormData,
): Promise<AcceptInviteFormState> {
  const rawToken = String(formData.get('token') ?? '')
  const password = String(formData.get('password') ?? '')
  const fullName = String(formData.get('fullName') ?? '').trim()

  if (!rawToken) return { error: 'Missing invite token.' }
  if (!fullName) return { error: 'Full name is required.', fullName }
  if (password.length < 12) {
    return { error: 'Password must be at least 12 characters.', fullName }
  }

  const hdrs = await headers()
  const ip = clientIp(hdrs)

  const result = await acceptInvite({ rawToken, password, fullName, clientIp: ip })

  if (!result.ok) {
    switch (result.reason) {
      case 'rate_limited':
        return { error: 'Too many attempts. Wait a few minutes and try again.', fullName }
      case 'expired':
        return { error: 'This invite link has expired. Ask your facility admin for a new one.' }
      case 'accepted':
        return { error: 'This invite has already been accepted.' }
      case 'revoked':
        return { error: 'This invite was revoked.' }
      case 'invalid_token':
        return { error: 'Invalid invite link.' }
      case 'weak_password':
        return { error: 'Password must be at least 12 characters.', fullName }
      case 'auth_create_failed':
        return { error: 'Could not create your account. Try again.', fullName }
      case 'db_error':
        return { error: 'Something went wrong finishing your signup. Try again.', fullName }
      default:
        return { error: 'Unknown error. Try again.', fullName }
    }
  }

  // Sign the user in using the email from the invite. We don't have it in this scope
  // after the accept, but we can derive it from the password submission by calling
  // the SSR client with a follow-up query; simpler: use the email passed in the form.
  const email = String(formData.get('email') ?? '')
  if (email) {
    try {
      await signInAfterAccept(email, password)
    } catch {
      // Sign-in failure is non-fatal — user can log in at /login manually.
    }
  }

  redirect('/')
}
