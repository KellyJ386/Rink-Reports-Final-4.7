import { z } from 'zod'

import type { SectionSpec } from '@/lib/forms/types'

/**
 * Ice Make core fields.
 * Shares surface_resource_id with every Ice Maintenance form type plus the
 * resurface-specific columns water_temp_f + resurface_start_at / _end_at.
 */

export const coreFieldsZodSchema = z.object({
  surface_resource_id: z.string().uuid({ message: 'Surface is required' }),
  water_temp_f: z.coerce.number({ invalid_type_error: 'Water temp is required' }),
  resurface_start_at: z.string().min(1, 'Start time is required'),
  resurface_end_at: z.string().min(1, 'End time is required'),
})

export const coreFieldsRenderSpec: SectionSpec[] = [
  {
    key: 'which_surface',
    label: 'Surface',
    fields: [
      {
        key: 'surface_resource_id',
        type: 'select',
        label: 'Which ice surface?',
        required: true,
        options: { from_resource_type: 'surface' },
      },
    ],
  },
  {
    key: 'resurface_timing',
    label: 'Resurface timing',
    fields: [
      { key: 'resurface_start_at', type: 'datetime', label: 'Start', required: true },
      { key: 'resurface_end_at',   type: 'datetime', label: 'End',   required: true },
      {
        key: 'water_temp_f',
        type: 'number',
        label: 'Water temperature',
        required: true,
        min: 80,
        max: 200,
        step: 1,
        unit: '°F',
      },
    ],
  },
]

export const coreFieldsDbColumns: string[] = [
  'surface_resource_id',
  'water_temp_f',
  'resurface_start_at',
  'resurface_end_at',
]
