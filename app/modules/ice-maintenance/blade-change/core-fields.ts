import { z } from 'zod'

import type { SectionSpec } from '@/lib/forms/types'

/**
 * Blade Change core fields.
 * Surface + zamboni (required — blade belongs to a specific resurfacer) + blade serial.
 */

export const coreFieldsZodSchema = z.object({
  surface_resource_id: z.string().uuid({ message: 'Surface is required' }),
  zamboni_resource_id: z.string().uuid({ message: 'Zamboni is required' }),
  blade_serial: z.string().min(1, 'Blade serial is required').max(64),
})

export const coreFieldsRenderSpec: SectionSpec[] = [
  {
    key: 'equipment',
    label: 'Equipment',
    fields: [
      {
        key: 'surface_resource_id',
        type: 'select',
        label: 'Surface',
        required: true,
        options: { from_resource_type: 'surface' },
      },
      {
        key: 'zamboni_resource_id',
        type: 'select',
        label: 'Zamboni',
        required: true,
        options: { from_resource_type: 'zamboni' },
      },
      {
        key: 'blade_serial',
        type: 'text',
        label: 'New blade serial number',
        required: true,
      },
    ],
  },
]

export const coreFieldsDbColumns: string[] = [
  'surface_resource_id',
  'zamboni_resource_id',
  'blade_serial',
]
