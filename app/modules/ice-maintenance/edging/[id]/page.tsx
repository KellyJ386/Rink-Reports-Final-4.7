import Link from 'next/link'

import { FormDetail } from '@/components/form-detail/FormDetail'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'

export default async function EdgingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleEnabled('ice_maintenance')
  const { id } = await params
  return (
    <main>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Edging</h1>
        <Link href="/modules/ice-maintenance/edging">← Back to history</Link>
      </div>
      <div className="mt-4">
        <FormDetail moduleSlug="ice_maintenance" formType="edging" submissionId={id} />
      </div>
    </main>
  )
}
