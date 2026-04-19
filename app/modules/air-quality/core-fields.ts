import { z } from 'zod'

import type { SectionSpec } from '@/lib/forms/types'

export const coreFieldsZodSchema = z.object({
  reading_taken_at: z.string().min(1, 'Reading time is required'),
  device_resource_id: z.string().uuid({ message: 'Device is required' }),
  location_of_reading: z.string().min(1, 'Location is required').max(120),
})

export const coreFieldsRenderSpec: SectionSpec[] = [
  {
    key: 'reading_context',
    label: 'Reading context',
    fields: [
      { key: 'reading_taken_at',   type: 'datetime', label: 'Reading taken at', required: true },
      {
        key: 'device_resource_id',
        type: 'select',
        label: 'Device',
        required: true,
        options: { from_resource_type: 'air_quality_device' },
      },
      { key: 'location_of_reading', type: 'text',     label: 'Location of reading', required: true,
        help_text: 'e.g. "center ice", "lobby", "zamboni room"' },
    ],
  },
]

export const coreFieldsDbColumns: string[] = [
  'reading_taken_at',
  'device_resource_id',
  'location_of_reading',
]
