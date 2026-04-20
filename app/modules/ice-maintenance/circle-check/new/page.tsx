import { SchemaRenderErrorBanner } from '@/components/form-errors/SchemaRenderErrorBanner'
import { loadPublishedFormSchema } from '@/lib/forms/load-form-schema'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'

import { NewCircleCheckClient } from './client'

export default async function NewCircleCheckPage() {
  await requireModuleEnabled('ice_maintenance')
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

  if (loaded.renderErrors.length > 0) {
    return (
      <main>
        <h1 className="text-xl font-semibold">New circle check</h1>
        <div className="mt-4">
          <SchemaRenderErrorBanner errors={loaded.renderErrors} />
        </div>
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
