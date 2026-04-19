import Link from 'next/link'

import { FormDetail } from '@/components/form-detail/FormDetail'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'

export default async function AirQualityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireModuleEnabled('air_quality')
  const { id } = await params
  return (
    <main>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Air Quality reading</h1>
        <Link href="/modules/air-quality">← Back to history</Link>
      </div>
      <div className="mt-4">
        <FormDetail moduleSlug="air_quality" formType={null} submissionId={id} />
      </div>
    </main>
  )
}
