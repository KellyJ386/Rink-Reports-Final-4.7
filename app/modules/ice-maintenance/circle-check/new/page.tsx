import { redirect } from 'next/navigation'

import { loadPublishedFormSchema } from '@/lib/forms/load-form-schema'

import { NewCircleCheckClient } from './client'

export default async function NewCircleCheckPage() {
  const loaded = await loadPublishedFormSchema('ice_maintenance', 'circle_check')
  if (!loaded) {
    return (
      <main>
        <h1 className="text-xl font-semibold">Circle Check unavailable</h1>
        <p className="text-muted mt-2">
          No form schema is configured for Circle Check at this facility. An admin must
          enable Ice Maintenance under /admin/modules first.
        </p>
      </main>
    )
  }

  return (
    <main>
      <h1 className="text-xl font-semibold">New circle check</h1>
      <p className="text-muted text-sm mt-1">Schema v{loaded.schema.version}</p>
      <div className="mt-6">
        <NewCircleCheckClient sections={loaded.schema.sections} />
      </div>
    </main>
  )
}

export async function redirectToHistoryAfterSubmit(_id: string): Promise<never> {
  redirect('/modules/ice-maintenance/circle-check')
}
