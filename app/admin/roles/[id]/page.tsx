import Link from 'next/link'
import { notFound } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'

import { RoleAccessMatrix } from './RoleAccessMatrix'

export default async function AdminRoleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: role }, { data: modules }, { data: rma }] = await Promise.all([
    supabase.from('roles').select('id, name, description, is_system').eq('id', id).maybeSingle(),
    supabase
      .from('modules')
      .select('id, slug, name, category, sort_order')
      .order('sort_order', { ascending: true }),
    supabase.from('role_module_access').select('module_id, access_level').eq('role_id', id),
  ])

  if (!role) notFound()

  const accessByModule = new Map<string, 'none' | 'read' | 'write' | 'admin'>()
  for (const r of (rma ?? []) as Array<{ module_id: string; access_level: string }>) {
    accessByModule.set(r.module_id, r.access_level as 'none' | 'read' | 'write' | 'admin')
  }

  const moduleRows = (modules ?? []).map((m: Record<string, unknown>) => ({
    id: m.id as string,
    slug: m.slug as string,
    name: m.name as string,
    category: m.category as string,
    access_level: accessByModule.get(m.id as string) ?? 'none',
  }))

  return (
    <main>
      <h1 className="text-xl font-semibold">
        {role.name}
        {role.is_system && (
          <span className="ml-2 text-xs font-normal text-muted">(system role)</span>
        )}
      </h1>
      {role.description && <p className="text-muted text-sm mt-1">{role.description}</p>}

      <p className="text-sm mt-4">
        <Link href="/admin/roles">← All roles</Link>
      </p>

      <h2 className="font-semibold mt-6">Module access</h2>
      <p className="text-muted text-sm">
        none &lt; read &lt; write &lt; admin. Users with this role get the highest level granted here.
      </p>

      <div className="mt-4">
        <RoleAccessMatrix roleId={id} modules={moduleRows} />
      </div>
    </main>
  )
}
