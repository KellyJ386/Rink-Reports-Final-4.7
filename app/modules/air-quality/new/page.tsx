import { SchemaRenderErrorBanner } from '@/components/form-errors/SchemaRenderErrorBanner'
import { loadPublishedFormSchema } from '@/lib/forms/load-form-schema'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'

import { NewAirQualityClient } from './client'

export default async function NewAirQualityPage() {
  await requireModuleEnabled('air_quality')
  const loaded = await loadPublishedFormSchema('air_quality', null)
  if (!loaded) {
    return (
      <main>
        <h1 className="text-xl font-semibold">Air Quality unavailable</h1>
        <p className="text-muted mt-2">No form schema configured.</p>
      </main>
    )
  }

  if (loaded.renderErrors.length > 0) {
    return (
      <main>
        <h1 className="text-xl font-semibold">New air quality reading</h1>
        <div className="mt-4">
          <SchemaRenderErrorBanner errors={loaded.renderErrors} />
        </div>
      </main>
    )
  }

  return (
    <main>
      <h1 className="text-xl font-semibold">New air quality reading</h1>
      <p className="text-muted text-sm mt-1">Schema v{loaded.schema.version}</p>
      <div className="mt-6">
        <NewAirQualityClient sections={loaded.schema.sections} />
      </div>
    </main>
  )
}
