import Link from 'next/link'

import { FormDetail } from '@/components/form-detail/FormDetail'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'

export default async function RefrigerationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireModuleEnabled('refrigeration')
  const { id } = await params
  return (
    <main>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Refrigeration reading</h1>
        <Link href="/modules/refrigeration">← Back to history</Link>
      </div>
      <div className="mt-4">
        <FormDetail moduleSlug="refrigeration" formType={null} submissionId={id} />
      </div>
    </main>
  )
}
