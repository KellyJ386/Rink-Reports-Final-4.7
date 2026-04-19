import Link from 'next/link'

import { FormDetail } from '@/components/form-detail/FormDetail'

export default async function CircleCheckDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <main>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Circle Check</h1>
        <Link href="/modules/ice-maintenance/circle-check">← Back to history</Link>
      </div>
      <div className="mt-4">
        <FormDetail moduleSlug="ice_maintenance" formType="circle_check" submissionId={id} />
      </div>
    </main>
  )
}
