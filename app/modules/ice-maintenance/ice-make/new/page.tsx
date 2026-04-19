import { SchemaRenderErrorBanner } from '@/components/form-errors/SchemaRenderErrorBanner'
import { loadPublishedFormSchema } from '@/lib/forms/load-form-schema'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'

import { NewIceMakeClient } from './client'

export default async function NewIceMakePage() {
  await requireModuleEnabled('ice_maintenance')
  const loaded = await loadPublishedFormSchema('ice_maintenance', 'ice_make')
  if (!loaded) {
    return (
      <main>
        <h1 className="text-xl font-semibold">Ice Make unavailable</h1>
        <p className="text-muted mt-2">No form schema configured for Ice Make at this facility.</p>
      </main>
    )
  }

  if (loaded.renderErrors.length > 0) {
    return (
      <main>
        <h1 className="text-xl font-semibold">New ice make</h1>
        <div className="mt-4">
          <SchemaRenderErrorBanner errors={loaded.renderErrors} />
        </div>
      </main>
    )
  }

  return (
    <main>
      <h1 className="text-xl font-semibold">New ice make</h1>
      <p className="text-muted text-sm mt-1">Schema v{loaded.schema.version}</p>
      <div className="mt-6">
        <NewIceMakeClient sections={loaded.schema.sections} />
      </div>
    </main>
  )
}
