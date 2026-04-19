import { z } from 'zod'

import type { SectionSpec } from '@/lib/forms/types'

/**
 * Circle Check core fields. Common to every facility, locked in code, not editable
 * by facility admins.
 *
 * The form engine reads these three exports:
 *   coreFieldsZodSchema    — validation for the core portion of the submission
 *   coreFieldsRenderSpec   — how core fields appear in <DynamicForm />
 *   coreFieldsDbColumns    — which submission-table columns receive core field values
 *
 * For ice_maintenance_submissions, Circle Check's only common-core column is
 * `surface_resource_id`. Other form types (Ice Make, Blade Change) have additional
 * core columns, declared in their own core-fields.ts files.
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
        help_text: 'The sheet you are inspecting.',
        options: { from_resource_type: 'surface' },
      },
    ],
  },
]

export const coreFieldsDbColumns: string[] = ['surface_resource_id']
