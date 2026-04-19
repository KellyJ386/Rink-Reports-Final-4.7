import { z } from 'zod'

import type { SectionSpec } from '@/lib/forms/types'

/**
 * Edging core fields. Same shape as Circle Check — surface only.
 */

export const coreFieldsZodSchema = z.object({
  surface_resource_id: z.string().uuid({ message: 'Surface is required' }),
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
]

export const coreFieldsDbColumns: string[] = ['surface_resource_id']
