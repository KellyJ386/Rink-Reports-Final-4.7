'use server'

import {
  completeSession,
  recordReading,
  type CompleteSessionResult,
  type RecordReadingInput,
} from '@/lib/ice-depth/session'

export async function recordReadingAction(
  input: RecordReadingInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return recordReading(input)
}

export async function completeSessionAction(sessionId: string): Promise<CompleteSessionResult> {
  return completeSession(sessionId)
}
