import Link from 'next/link'

import { FormDetail } from '@/components/form-detail/FormDetail'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'

export default async function AccidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireModuleEnabled('accident')
  const { id } = await params
  return (
    <main>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Accident report</h1>
        <Link href="/modules/accident">← Back to history</Link>
      </div>
      <div className="mt-4">
        <FormDetail moduleSlug="accident" formType={null} submissionId={id} />
      </div>
    </main>
  )
}
