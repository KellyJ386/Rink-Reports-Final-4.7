import Link from 'next/link'

import { FormDetail } from '@/components/form-detail/FormDetail'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'

export default async function BladeChangeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireModuleEnabled('ice_maintenance')
  const { id } = await params
  return (
    <main>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Blade Change</h1>
        <Link href="/modules/ice-maintenance/blade-change">← Back to history</Link>
      </div>
      <div className="mt-4">
        <FormDetail moduleSlug="ice_maintenance" formType="blade_change" submissionId={id} />
      </div>
    </main>
  )
}
