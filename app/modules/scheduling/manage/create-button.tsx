'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { createScheduleAction } from '../actions'

export function CreateScheduleButton({
  label,
  weekStart,
}: {
  label: string
  weekStart: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const click = () => {
    startTransition(async () => {
      const r = await createScheduleAction(weekStart)
      if (r.ok) {
        router.push(`/modules/scheduling/manage/${weekStart}`)
      } else {
        alert(r.error)
      }
    })
  }

  return (
    <button
      type="button"
      onClick={click}
      disabled={pending}
      className="bg-accent text-white px-4 py-2 rounded-md font-medium disabled:opacity-50"
    >
      {pending ? 'Creating…' : label}
    </button>
  )
}
