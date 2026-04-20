import 'server-only'

import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'

/**
 * Facility settings catalog.
 *
 * Every key ever written to facilities.settings MUST appear here with:
 *   - a Zod validator
 *   - a default value
 *   - the owning agent / module
 *
 * No generic "save any JSON" path exists. All writes go through setSetting(key, value)
 * which looks up the key in this catalog and rejects unknown keys.
 *
 * Agent 6 surfaces writes for:
 *   - Communications settings (Phase 5, after Agent 8)
 *   - Scheduling settings (Phase 5, after Agent 5)
 *   - notifications.email_enabled (Phase 3 — owned by Agent 7 but Agent 6 surfaces it
 *     in a general "Facility preferences" card when Agent 7 lands; deferred for now)
 *
 * Reads via getSetting(key) apply defaults when the key is absent.
 */

export const SETTINGS_SCHEMA = {
  'communications.require_ack_enabled': {
    validator: z.boolean(),
    default: true as boolean,
    owner: 'communications',
  },
  'communications.default_expiry_days': {
    validator: z.number().int().min(1).max(365),
    default: 30 as number,
    owner: 'communications',
  },
  'scheduling.availability_cutoff_days': {
    validator: z.number().int().min(1).max(60),
    default: 14 as number,
    owner: 'scheduling',
  },
  'scheduling.swap_approval_mode': {
    validator: z.enum(['manager_approval', 'free']),
    default: 'manager_approval' as 'manager_approval' | 'free',
    owner: 'scheduling',
  },
  'notifications.email_enabled': {
    validator: z.boolean(),
    default: true as boolean,
    owner: 'notifications',
  },
  'analytics_enabled': {
    validator: z.boolean(),
    default: true as boolean,
    owner: 'platform',
  },
} as const

export type SettingKey = keyof typeof SETTINGS_SCHEMA

export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS_SCHEMA)[K]['validator']>

export async function getAllSettings(): Promise<Record<string, unknown>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('facilities')
    .select('settings')
    .eq('id', (await getCurrentFacilityId(supabase)) ?? '')
    .maybeSingle()

  if (error || !data) return {}
  const raw = (data.settings as Record<string, unknown>) ?? {}

  // Apply defaults for every known key
  const merged: Record<string, unknown> = {}
  for (const key in SETTINGS_SCHEMA) {
    merged[key] = getNested(raw, key) ?? SETTINGS_SCHEMA[key as SettingKey].default
  }
  return merged
}

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const all = await getAllSettings()
  return all[key] as SettingValue<K>
}

export async function setSetting<K extends SettingKey>(
  key: K,
  value: SettingValue<K>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const schema = SETTINGS_SCHEMA[key]
  if (!schema) return { ok: false, error: `Unknown settings key: ${key}` }

  const parsed = schema.validator.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      error: `Invalid value for ${key}: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    }
  }

  const supabase = await createClient()
  const facilityId = await getCurrentFacilityId(supabase)
  if (!facilityId) return { ok: false, error: 'No current facility' }

  // Fetch current settings, patch nested key, write back
  const { data: current } = await supabase
    .from('facilities')
    .select('settings')
    .eq('id', facilityId)
    .maybeSingle()

  const next = setNested(((current?.settings as Record<string, unknown>) ?? {}), key, parsed.data)

  const { error } = await supabase
    .from('facilities')
    .update({ settings: next })
    .eq('id', facilityId)

  if (error) return { ok: false, error: error.message }

  // Audit
  void supabase.from('audit_log').insert({
    facility_id: facilityId,
    actor_user_id: (await supabase.auth.getUser()).data.user?.id ?? null,
    action: 'facility_setting.changed',
    entity_type: 'facility_setting',
    metadata: { key, value: parsed.data },
  })

  return { ok: true }
}

// ---- helpers ----

async function getCurrentFacilityId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const { data } = await supabase.rpc('current_facility_id')
  return (data as string | null) ?? null
}

function getNested(obj: Record<string, unknown>, dotKey: string): unknown {
  const parts = dotKey.split('.')
  let cur: unknown = obj
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

function setNested(
  obj: Record<string, unknown>,
  dotKey: string,
  value: unknown,
): Record<string, unknown> {
  const parts = dotKey.split('.')
  const next = { ...obj }
  let cur: Record<string, unknown> = next
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!
    const existing = cur[k]
    cur[k] =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {}
    cur = cur[k] as Record<string, unknown>
  }
  cur[parts[parts.length - 1]!] = value
  return next
}
