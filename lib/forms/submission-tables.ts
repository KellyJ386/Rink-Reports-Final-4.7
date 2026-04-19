/**
 * Module slug → submission table name mapping.
 *
 * Convention: `${module_slug}_submissions` (e.g. 'accident' → 'accident_submissions').
 * Overrides: explicit entries in MODULE_TABLE_OVERRIDES for modules where the
 * convention doesn't fit (Ice Maintenance uses one shared table across four form types).
 *
 * When Agent 3 or Agent 4 add a module, they either name their table following the
 * convention and require no changes here, or add a line to MODULE_TABLE_OVERRIDES.
 */

type ModuleTableConfig = {
  tableName: string
  /** True if the table discriminates form types via a `form_type` column. */
  hasFormTypeColumn: boolean
}

const MODULE_TABLE_OVERRIDES: Record<string, ModuleTableConfig> = {
  // Ice Maintenance: one table, four form types.
  ice_maintenance: {
    tableName: 'ice_maintenance_submissions',
    hasFormTypeColumn: true,
  },
}

/**
 * Resolve the submission table for a module. Throws if the module slug isn't known
 * to follow the convention and has no explicit override — better to fail fast than
 * write to a table that might not exist.
 */
export function getSubmissionTable(moduleSlug: string): ModuleTableConfig {
  const override = MODULE_TABLE_OVERRIDES[moduleSlug]
  if (override) return override

  // Modules that don't ship submissions at all (custom UI: ice_depth's own tables,
  // scheduling, communications) should never call submitForm — they use their own
  // server actions. If this function is called for one, that's a bug.
  const CUSTOM_UI_MODULES = new Set(['ice_depth', 'scheduling', 'communications', 'admin_control_center'])
  if (CUSTOM_UI_MODULES.has(moduleSlug)) {
    throw new Error(
      `getSubmissionTable: module "${moduleSlug}" does not use the form engine. ` +
        `Submissions for this module go through its own server actions, not submitForm.`,
    )
  }

  return {
    tableName: `${moduleSlug}_submissions`,
    hasFormTypeColumn: false,
  }
}
