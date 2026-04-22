/**
 * Backwards-compatibility shim.
 *
 * Phase 1 kept the module-slug → submission-table map in this file. Seam 3
 * (Phase 2) consolidated it into `app/modules/_registry.ts` as part of a
 * broader submission registry. All logic now lives in
 * `lib/forms/module-registry.ts`; this file re-exports to keep existing
 * import paths working.
 *
 * New callers: import from `@/lib/forms/module-registry` directly.
 */

export { getSubmissionTable } from './module-registry'
export type { SubmissionTableConfig } from './module-registry'
