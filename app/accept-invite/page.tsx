import { headers } from 'next/headers'

import { lookupInvite } from '@/lib/invites/accept'
import { AcceptInviteForm } from './form'

function clientIp(hdrs: Headers): string {
  const xff = hdrs.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  return hdrs.get('x-real-ip') ?? 'unknown'
}

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams

  if (!token) {
    return (
      <main>
        <h1>Invalid invite link</h1>
        <p>This link is missing a token.</p>
      </main>
    )
  }

  const hdrs = await headers()
  const ip = clientIp(hdrs)
  const lookup = await lookupInvite(token, ip)

  if (lookup.state === 'not_found') {
    return (
      <main>
        <h1>Invalid invite link</h1>
        <p>We couldn't find this invite. Ask your facility admin for a new one.</p>
      </main>
    )
  }

  if (lookup.state === 'expired') {
    return (
      <main>
        <h1>Invite expired</h1>
        <p>This invite has expired. Ask your facility admin to send a new one.</p>
      </main>
    )
  }

  if (lookup.state === 'accepted') {
    return (
      <main>
        <h1>Invite already used</h1>
        <p>
          This invite has already been accepted. If that wasn't you, contact your
          facility admin.
        </p>
      </main>
    )
  }

  if (lookup.state === 'revoked') {
    return (
      <main>
        <h1>Invite revoked</h1>
        <p>This invite was revoked. Ask your facility admin for a new one.</p>
      </main>
    )
  }

  // state === 'valid'
  return (
    <main>
      <h1>Welcome to {lookup.facility_name}</h1>
      <p>
        You were invited as <strong>{lookup.role_name}</strong>. Finish setting up your
        account by creating a password.
      </p>
      <AcceptInviteForm
        token={token}
        email={lookup.email}
        facilityName={lookup.facility_name}
      />
    </main>
  )
}
