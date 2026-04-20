import Link from 'next/link'
import type { ReactNode } from 'react'

import { requireAdminControlCenterAdmin } from '@/lib/admin/require-admin'

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdminControlCenterAdmin()

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <nav
        aria-label="Admin sections"
        className="md:w-56 border-b md:border-b-0 md:border-r border-hairline p-4 md:p-6"
      >
        <div className="font-semibold mb-4">
          <Link href="/admin" className="no-underline text-ink">
            Admin Control Center
          </Link>
        </div>
        <NavSection title="People">
          <NavLink href="/admin/users">Users</NavLink>
          <NavLink href="/admin/invites">Invites</NavLink>
          <NavLink href="/admin/roles">Roles</NavLink>
        </NavSection>
        <NavSection title="Configuration">
          <NavLink href="/admin/modules">Modules</NavLink>
          <NavLink href="/admin/resources">Resources</NavLink>
          <NavLink href="/admin/forms">Forms</NavLink>
          <NavLink href="/admin/option-lists">Option lists</NavLink>
        </NavSection>
        <NavSection title="Modules">
          <NavLink href="/admin/ice-depth">Ice Depth</NavLink>
          {/* Communications + Scheduling land in Phase 5 */}
        </NavSection>
        <NavSection title="Account">
          <NavLink href="/admin/billing">Billing</NavLink>
          <NavLink href="/admin/audit">Audit log</NavLink>
        </NavSection>
      </nav>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

function NavSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-xs uppercase tracking-wide text-muted mb-1">{title}</div>
      <ul className="flex flex-col gap-1">{children}</ul>
    </div>
  )
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <li>
      <Link href={href} className="no-underline text-ink text-sm block py-1">
        {children}
      </Link>
    </li>
  )
}
