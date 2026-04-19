import { z } from 'zod'

import type { SectionSpec } from '@/lib/forms/types'

/**
 * Refrigeration Report core fields. Single-form module.
 */

export const coreFieldsZodSchema = z.object({
  reading_taken_at: z.string().min(1, 'Reading time is required'),
  compressor_resource_id: z.string().uuid({ message: 'Compressor is required' }),
})

export const coreFieldsRenderSpec: SectionSpec[] = [
  {
    key: 'reading_context',
    label: 'Reading context',
    fields: [
      {
        key: 'reading_taken_at',
        type: 'datetime',
        label: 'Reading taken at',
        required: true,
      },
      {
        key: 'compressor_resource_id',
        type: 'select',
        label: 'Compressor',
        required: true,
        options: { from_resource_type: 'compressor' },
      },
    ],
  },
]

export const coreFieldsDbColumns: string[] = ['reading_taken_at', 'compressor_resource_id']
