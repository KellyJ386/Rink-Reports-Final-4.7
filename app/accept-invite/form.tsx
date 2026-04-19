'use client'

import { useActionState } from 'react'

import { acceptInviteAction, type AcceptInviteFormState } from './actions'

const INITIAL: AcceptInviteFormState = {}

type Props = {
  token: string
  email: string
  facilityName: string
}

export function AcceptInviteForm({ token, email, facilityName }: Props) {
  const [state, formAction, pending] = useActionState(acceptInviteAction, INITIAL)

  return (
    <form action={formAction}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="email" value={email} />

      <label>
        Email
        <input type="email" value={email} readOnly />
      </label>

      <label>
        Full name
        <input
          type="text"
          name="fullName"
          required
          autoComplete="name"
          defaultValue={state.fullName ?? ''}
        />
      </label>

      <label>
        Password (12+ characters)
        <input
          type="password"
          name="password"
          required
          autoComplete="new-password"
          minLength={12}
        />
      </label>

      {state.error && (
        <p role="alert" aria-live="polite">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending}>
        {pending ? 'Creating your account…' : `Join ${facilityName}`}
      </button>
    </form>
  )
}
