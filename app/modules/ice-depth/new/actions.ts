'use server'

import { startSession, type SessionStartInput, type SessionStartResult } from '@/lib/ice-depth/session'

export async function startSessionAction(input: SessionStartInput): Promise<SessionStartResult> {
  return startSession(input)
}
