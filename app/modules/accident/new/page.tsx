import { SchemaRenderErrorBanner } from '@/components/form-errors/SchemaRenderErrorBanner'
import { loadPublishedFormSchema } from '@/lib/forms/load-form-schema'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'

import { NewAccidentClient } from './client'

export default async function NewAccidentPage() {
  await requireModuleEnabled('accident')
  const loaded = await loadPublishedFormSchema('accident', null)
  if (!loaded) {
    return (
      <main>
        <h1 className="text-xl font-semibold">Accident reports unavailable</h1>
        <p className="text-muted mt-2">No form schema configured.</p>
      </main>
    )
  }

  if (loaded.renderErrors.length > 0) {
    return (
      <main>
        <h1 className="text-xl font-semibold">New accident report</h1>
        <div className="mt-4">
          <SchemaRenderErrorBanner errors={loaded.renderErrors} />
        </div>
      </main>
    )
  }

  return (
    <main>
      <h1 className="text-xl font-semibold">New accident report</h1>
      <p className="text-muted text-sm mt-1">Schema v{loaded.schema.version}</p>
      <div className="mt-6">
        <NewAccidentClient sections={loaded.schema.sections} />
      </div>
    </main>
  )
}
