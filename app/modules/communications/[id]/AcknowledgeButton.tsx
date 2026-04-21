'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { acknowledge } from '@/lib/communications/actions'

export function AcknowledgeButton({ announcementId }: { announcementId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAck() {
    setLoading(true)
    setError(null)
    const result = await acknowledge(announcementId)
    if (result.ok) {
      router.refresh()
    } else {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <div>
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      <button
        onClick={handleAck}
        disabled={loading}
        className="bg-accent text-white px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
      >
        {loading ? 'Acknowledging…' : "I've read this"}
      </button>
    </div>
  )
}
