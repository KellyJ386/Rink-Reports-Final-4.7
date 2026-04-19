import Link from 'next/link'

import { FormHistory, type FormHistoryColumn } from '@/components/form-history/FormHistory'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'

/**
 * Ice Maintenance shell. Thin tab wrapper around four FormHistory components — one
 * per form_type. Tab order: Ice Make → Circle Check → Edging → Blade Change
 * (typical shift order).
 *
 * This wrapper is the ONE authorized deviation from engine-pure composition
 * (Agent 3 brief). Do not add filtering, sorting, or merged-view logic here; those
 * are engine-level features. Escalate if anyone asks for them.
 */

const TABS = [
  {
    key: 'ice_make',
    label: 'Ice Make',
    href: '/modules/ice-maintenance/ice-make',
    newHref: '/modules/ice-maintenance/ice-make/new',
    baseUrl: '/modules/ice-maintenance/ice-make',
    columns: [
      { key: 'submitted_at', label: 'Submitted', source: 'submitted_at', format: 'datetime' },
      { key: 'observed_condition', label: 'Condition', source: 'custom.observed_condition', format: 'label-snapshot' },
    ] as FormHistoryColumn[],
  },
  {
    key: 'circle_check',
    label: 'Circle Check',
    href: '/modules/ice-maintenance/circle-check',
    newHref: '/modules/ice-maintenance/circle-check/new',
    baseUrl: '/modules/ice-maintenance/circle-check',
    columns: [
      { key: 'submitted_at', label: 'Submitted', source: 'submitted_at', format: 'datetime' },
      { key: 'ice_condition', label: 'Ice', source: 'custom.ice_condition', format: 'label-snapshot' },
      { key: 'doors_clear', label: 'Doors clear?', source: 'custom.doors_clear' },
    ] as FormHistoryColumn[],
  },
  {
    key: 'edging',
    label: 'Edging',
    href: '/modules/ice-maintenance/edging',
    newHref: '/modules/ice-maintenance/edging/new',
    baseUrl: '/modules/ice-maintenance/edging',
    columns: [
      { key: 'submitted_at', label: 'Submitted', source: 'submitted_at', format: 'datetime' },
      { key: 'edger_used', label: 'Edger', source: 'custom.edger_used', format: 'label-snapshot' },
    ] as FormHistoryColumn[],
  },
  {
    key: 'blade_change',
    label: 'Blade Change',
    href: '/modules/ice-maintenance/blade-change',
    newHref: '/modules/ice-maintenance/blade-change/new',
    baseUrl: '/modules/ice-maintenance/blade-change',
    columns: [
      { key: 'submitted_at', label: 'Submitted', source: 'submitted_at', format: 'datetime' },
      { key: 'blade_serial', label: 'New serial', source: 'blade_serial' },
    ] as FormHistoryColumn[],
  },
] as const

export default async function IceMaintenanceShellPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  await requireModuleEnabled('ice_maintenance')
  const sp = await searchParams
  const activeKey = (sp.tab && TABS.some((t) => t.key === sp.tab) ? sp.tab : 'ice_make')
  const active = TABS.find((t) => t.key === activeKey)!

  return (
    <main>
      <h1 className="text-xl font-semibold">Ice Maintenance</h1>
      <nav aria-label="Form type tabs" className="mt-4 border-b border-hairline flex gap-4 overflow-x-auto">
        {TABS.map((tab) => {
          const isActive = tab.key === activeKey
          return (
            <Link
              key={tab.key}
              href={`/modules/ice-maintenance?tab=${tab.key}`}
              aria-current={isActive ? 'page' : undefined}
              className={`no-underline py-2 ${isActive ? 'border-b-2 border-accent font-semibold text-ink' : 'text-muted'}`}
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>

      <div className="flex items-center justify-between mt-4">
        <h2 className="text-lg font-semibold">{active.label}</h2>
        <div className="flex gap-2">
          <Link href={active.href} className="no-underline text-sm">Dedicated view →</Link>
          <Link
            href={active.newHref}
            className="no-underline bg-accent text-white px-3 py-2 rounded-md text-sm font-medium"
          >
            + New
          </Link>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <FormHistory
          moduleSlug="ice_maintenance"
          formType={active.key}
          baseUrl={active.baseUrl}
          columns={active.columns as FormHistoryColumn[]}
        />
      </div>
    </main>
  )
}
