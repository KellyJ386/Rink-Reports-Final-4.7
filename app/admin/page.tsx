import Link from 'next/link'

import { createClient } from '@/lib/supabase/server'

type ChecklistItem = {
  key: string
  label: string
  done: boolean
  detail: string
  href?: string
  disabled?: boolean
  disabledReason?: string
}

export default async function AdminDashboardPage() {
  const supabase = await createClient()

  // Load signals for the setup checklist + dashboard cards
  const [
    { data: subscription },
    { data: invites },
    { data: resources },
    { data: facilityModules },
    { data: recentAudit },
  ] = await Promise.all([
    supabase
      .from('facility_subscriptions')
      .select('status, trial_end, current_period_end, plan_tier')
      .maybeSingle(),
    supabase
      .from('facility_invites')
      .select('id', { count: 'exact', head: false })
      .is('accepted_at', null)
      .is('revoked_at', null),
    supabase
      .from('facility_resources')
      .select('resource_type, is_active'),
    supabase
      .from('facility_modules')
      .select('is_enabled, modules!inner(slug)'),
    supabase
      .from('audit_log')
      .select('id, action, entity_type, created_at, actor_user_id')
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  // Derived signals
  const resourcesList = (resources ?? []) as Array<{ resource_type: string; is_active: boolean }>
  const activeSurfaces = resourcesList.filter((r) => r.resource_type === 'surface' && r.is_active).length
  const activeShiftPositions = resourcesList.filter((r) => r.resource_type === 'shift_position' && r.is_active).length

  const fm = (facilityModules ?? []) as Array<{ is_enabled: boolean; modules: { slug: string } }>
  const enabledOperational = fm.filter(
    (r) => r.is_enabled && r.modules.slug !== 'admin_control_center',
  ).length

  // Non-admin users in this facility
  const { count: nonAdminUserCount } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('active', true)

  const outstandingInvites = (invites ?? []).length

  const subscriptionStatus = (subscription?.status as string | null) ?? 'unknown'
  const isTrial = subscriptionStatus === 'trialing'
  const trialDaysLeft = subscription?.trial_end
    ? Math.max(
        0,
        Math.round(
          (new Date(subscription.trial_end as string).getTime() - Date.now()) /
            (1000 * 60 * 60 * 24),
        ),
      )
    : null

  // Setup checklist
  const checklist: ChecklistItem[] = [
    {
      key: 'resources',
      label: `Add your ice surfaces & shift positions`,
      detail: `${activeSurfaces} surface${activeSurfaces === 1 ? '' : 's'}, ${activeShiftPositions} position${
        activeShiftPositions === 1 ? '' : 's'
      } configured`,
      done: activeSurfaces >= 1 && activeShiftPositions >= 1,
      href: '/admin/resources',
    },
    {
      key: 'team',
      label: 'Invite your team',
      detail:
        (nonAdminUserCount ?? 0) > 1
          ? `${nonAdminUserCount} active users`
          : outstandingInvites > 0
            ? `${outstandingInvites} outstanding invite${outstandingInvites === 1 ? '' : 's'}`
            : 'No users invited yet',
      done: (nonAdminUserCount ?? 0) > 1,
      href: '/admin/invites',
    },
    {
      key: 'modules',
      label: 'Review enabled modules',
      detail: `${enabledOperational} of 8 operational modules enabled`,
      done: enabledOperational >= 1,
      href: '/admin/modules',
    },
    {
      key: 'subscribe',
      label: isTrial ? 'Move from trial to active subscription' : 'Subscription active',
      detail: isTrial
        ? `Trial ends in ${trialDaysLeft ?? '?'} day${trialDaysLeft === 1 ? '' : 's'}`
        : `Status: ${subscriptionStatus}`,
      done: !isTrial && subscriptionStatus === 'active',
      href: '/admin/billing',
      disabled: isTrial, // v1: billing portal stubbed until Agent 7 lands Stripe
      disabledReason: 'Available once billing is configured',
    },
  ]

  const checklistComplete = checklist.every((i) => i.done)

  return (
    <main>
      <h1 className="text-xl font-semibold">Admin Control Center</h1>

      {/* Subscription banner */}
      {isTrial && (
        <div className="mt-4 rounded-md border border-warn bg-amber-50 p-3 text-sm">
          <strong>Trial · {trialDaysLeft ?? '?'} day{trialDaysLeft === 1 ? '' : 's'} left.</strong>{' '}
          Subscribe to keep filing reports past the trial window.
        </div>
      )}
      {subscriptionStatus === 'past_due' && (
        <div className="mt-4 rounded-md border border-danger bg-red-50 p-3 text-sm">
          <strong>Payment past due.</strong> Update your payment method to keep write access.{' '}
          <Link href="/admin/billing">Open billing →</Link>
        </div>
      )}

      {/* Setup checklist */}
      {!checklistComplete && (
        <section className="mt-6 border border-hairline rounded-md p-4">
          <h2 className="font-semibold mb-2">Setup checklist</h2>
          <p className="text-muted text-sm mb-3">
            Finish these steps to turn your trial into a running facility.
          </p>
          <ul className="flex flex-col gap-2">
            {checklist.map((item) => (
              <li key={item.key}>
                <ChecklistRow item={item} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* At-a-glance counters */}
      <section className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Outstanding invites" value={String(outstandingInvites)} href="/admin/invites" />
        <Card label="Active surfaces" value={String(activeSurfaces)} href="/admin/resources?type=surface" />
        <Card label="Active modules" value={`${enabledOperational}/8`} href="/admin/modules" />
        <Card label="Plan" value={subscription?.plan_tier ?? '—'} href="/admin/billing" />
      </section>

      {/* Recent activity */}
      <section className="mt-6">
        <h2 className="font-semibold mb-2">Recent activity</h2>
        {!recentAudit || recentAudit.length === 0 ? (
          <p className="text-muted text-sm">No activity yet.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-muted">
                <th className="py-2 pr-3 font-medium">When</th>
                <th className="py-2 pr-3 font-medium">Action</th>
                <th className="py-2 pr-3 font-medium">Entity</th>
              </tr>
            </thead>
            <tbody>
              {recentAudit.map((a: Record<string, unknown>) => (
                <tr key={a.id as string} className="border-b border-hairline">
                  <td className="py-2 pr-3 text-muted">
                    {new Date(a.created_at as string).toLocaleString()}
                  </td>
                  <td className="py-2 pr-3">{a.action as string}</td>
                  <td className="py-2 pr-3">{(a.entity_type as string) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-sm mt-2">
          <Link href="/admin/audit">Full audit log →</Link>
        </p>
      </section>
    </main>
  )
}

function ChecklistRow({ item }: { item: ChecklistItem }) {
  const body = (
    <div
      className={`flex items-center gap-3 border border-hairline rounded-md p-3 ${
        item.done ? 'bg-emerald-50' : ''
      }`}
    >
      <div
        aria-hidden
        className={`w-6 h-6 rounded-full flex items-center justify-center text-sm ${
          item.done ? 'bg-ok text-white' : 'border border-hairline'
        }`}
      >
        {item.done ? '✓' : ''}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium">{item.label}</div>
        <div className="text-xs text-muted">{item.detail}</div>
      </div>
      {item.disabled && item.disabledReason && (
        <span className="text-xs text-muted italic">{item.disabledReason}</span>
      )}
    </div>
  )
  if (!item.href || item.disabled) return body
  return (
    <Link href={item.href} className="no-underline text-ink block">
      {body}
    </Link>
  )
}

function Card({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link
      href={href}
      className="no-underline block border border-hairline rounded-md p-3 text-ink"
    >
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </Link>
  )
}
