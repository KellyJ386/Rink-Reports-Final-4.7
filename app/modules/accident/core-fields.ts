import { z } from 'zod'

import type { SectionSpec } from '@/lib/forms/types'

export const coreFieldsZodSchema = z.object({
  date_of_accident: z.string().min(1, 'Date is required'),
  time_of_accident: z.string().min(1, 'Time is required'),
  location_in_facility: z.string().min(1, 'Location is required').max(200),
})

export const coreFieldsRenderSpec: SectionSpec[] = [
  {
    key: 'when_where',
    label: 'When and where',
    fields: [
      { key: 'date_of_accident',      type: 'date', label: 'Date of accident',      required: true },
      { key: 'time_of_accident',      type: 'time', label: 'Time of accident',      required: true },
      { key: 'location_in_facility',  type: 'text', label: 'Location in facility',  required: true,
        help_text: 'e.g. "lobby near concession", "Main Rink penalty box"' },
    ],
  },
]

export const coreFieldsDbColumns: string[] = [
  'date_of_accident',
  'time_of_accident',
  'location_in_facility',
]
