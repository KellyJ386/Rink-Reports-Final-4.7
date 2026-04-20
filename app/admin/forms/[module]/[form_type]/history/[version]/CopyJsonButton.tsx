'use client'

import { useState } from 'react'

export function CopyJsonButton({ json }: { json: string }) {
  const [copied, setCopied] = useState(false)

  const handle = async () => {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable; user selects + copies manually from the <pre> below.
    }
  }

  return (
    <button
      type="button"
      onClick={handle}
      className="bg-accent text-white px-4 py-2 rounded-md text-sm font-medium"
    >
      {copied ? 'Copied ✓' : 'Copy JSON'}
    </button>
  )
}
