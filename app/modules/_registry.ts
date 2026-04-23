/**
 * Agent 2 Phase 2 Seam 3 — submission module registry.
 *
 * Single source of truth for "which modules use the form engine, which
 * form_types each has, which submission table each writes to, and where
 * each form_type's core-fields.ts lives on disk."
 *
 * Consumed by:
 *   - `lib/forms/module-registry.ts` — accessor for the engine + editor contract
 *   - `tests/unit/modules/registry-filesystem.test.ts` — drift-prevention on fs paths
 *   - `tests/integration/modules/registry-db.test.ts` — drift-prevention on DB shape
 *
 * When Agent 3 or Agent 4 adds a module: ADD AN ENTRY HERE IN THE SAME PR
 * that ships the core-fields.ts file and the submission-table migration.
 * The unit job's registry-filesystem test catches any mismatch; the
 * integration job (gated by fixture graduation) catches DB-shape mismatches.
 *
 * ── slug vs. filesystem path ──
 * `slug` is the snake_case value matching `modules.slug` in the DB and the
 * `moduleSlug` argument to submitForm / loadCoreFields. The on-disk directory
 * may be kebab-case (e.g. `ice-maintenance/circle-check/`) — we store the
 * explicit file path rather than deriving it from slug so the two naming
 * schemes can coexist. This file IS the translation table.
 *
 * ── what IS NOT in this registry ──
 * Custom-UI modules (ice_depth, scheduling, communications, admin_control_center).
 * Those don't use the form engine; they have bespoke tables and their own
 * server actions. Attempting to call submitForm with one of their slugs
 * throws from `getSubmissionTable` (retained behavior from Phase 1).
 */

export type RegistryForm = {
  /** Snake_case form_type value matching the DB. `null` for single-form modules. */
  formType: string | null
  /**
   * Path to the core-fields.ts file, relative to repo root. Must export the three
   * symbols (coreFieldsZodSchema, coreFieldsRenderSpec, coreFieldsDbColumns).
   */
  coreFieldsPath: string
}

export type RegistryEntry = {
  /** Snake_case slug matching `modules.slug`. */
  slug: string
  /** The submission table name. Convention is `${slug}_submissions`; Ice Maintenance overrides. */
  submissionTable: string
  /** True when one table stores multiple form_types (only Ice Maintenance today). */
  hasFormTypeColumn: boolean
  /** Every form this module exposes via the engine. Length 1 for single-form modules. */
  forms: RegistryForm[]
}

export const MODULE_REGISTRY: readonly RegistryEntry[] = [
  {
    slug: 'ice_maintenance',
    submissionTable: 'ice_maintenance_submissions',
    hasFormTypeColumn: true,
    forms: [
      {
        formType: 'circle_check',
        coreFieldsPath: 'app/modules/ice-maintenance/circle-check/core-fields.ts',
      },
      {
        formType: 'ice_make',
        coreFieldsPath: 'app/modules/ice-maintenance/ice-make/core-fields.ts',
      },
      {
        formType: 'blade_change',
        coreFieldsPath: 'app/modules/ice-maintenance/blade-change/core-fields.ts',
      },
      {
        formType: 'edging',
        coreFieldsPath: 'app/modules/ice-maintenance/edging/core-fields.ts',
      },
    ],
  },
  {
    slug: 'accident',
    submissionTable: 'accident_submissions',
    hasFormTypeColumn: false,
    forms: [
      {
        formType: null,
        coreFieldsPath: 'app/modules/accident/core-fields.ts',
      },
    ],
  },
  {
    slug: 'incident',
    submissionTable: 'incident_submissions',
    hasFormTypeColumn: false,
    forms: [
      {
        formType: null,
        coreFieldsPath: 'app/modules/incident/core-fields.ts',
      },
    ],
  },
  {
    slug: 'refrigeration',
    submissionTable: 'refrigeration_submissions',
    hasFormTypeColumn: false,
    forms: [
      {
        formType: null,
        coreFieldsPath: 'app/modules/refrigeration/core-fields.ts',
      },
    ],
  },
  {
    slug: 'air_quality',
    submissionTable: 'air_quality_submissions',
    hasFormTypeColumn: false,
    forms: [
      {
        formType: null,
        coreFieldsPath: 'app/modules/air-quality/core-fields.ts',
      },
    ],
  },
] as const

/**
 * Slugs of modules that DO NOT use the form engine. Exposed for the engine's
 * `getSubmissionTable` failure message and for the filesystem self-test, which
 * treats these as expected orphans (they have app/modules/<slug>/ directories
 * with no core-fields.ts).
 */
export const CUSTOM_UI_MODULE_SLUGS = [
  'ice_depth',
  'scheduling',
  'communications',
  'admin_control_center',
] as const

/** Map kebab-case directory names under app/modules/ to their canonical slug. */
export const DIRECTORY_TO_SLUG: Record<string, string> = {
  'ice-maintenance': 'ice_maintenance',
  'air-quality': 'air_quality',
  'ice-depth': 'ice_depth',
  // others share name with slug
}
