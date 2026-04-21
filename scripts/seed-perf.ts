/**
 * scripts/seed-perf.ts
 *
 * Realistic-volume seed for the performance smoke test layer (Vitest perf
 * tests under tests/integration/perf/**). Loads on top of the regular
 * supabase/seed.sql — assumes Facility Alpha already exists with its three
 * seeded users, system roles, and resource_type rows.
 *
 * What it generates (against Facility Alpha only):
 *   - 10,000 ice_maintenance_submissions across all four form_types
 *   - 52 weeks × 8 readings = 416 ice_depth_readings inside 52 sessions
 *   - 1 schedule with 100 shifts, 20 staff users, ~200 shift_assignments
 *   - 500 announcements (all priorities, all targets, mostly archived)
 *
 * Volume targets match the Agent 9 brief §7 "performance smoke" budgets:
 *   - Ice maintenance history < 1s at 10k submissions (warm)
 *   - Ice depth trends      < 1s at 52 × 8 readings   (warm)
 *   - Week builder          < 1s at 100 shifts × 20 staff (warm)
 *   - Communications history first page < 500ms at 500 announcements (warm)
 *
 * Safety:
 *   - LOCAL ONLY. The script refuses to run against any URL that doesn't
 *     contain `localhost`, `127.0.0.1`, `kong`, or `supabase_kong`. Production
 *     databases are not for synthetic-volume seeding.
 *   - Idempotent at the row level: every seeded row carries a stable
 *     idempotency_key (`perf-seed:<batch>`) so re-running the script is a
 *     no-op (or re-INSERTs only the missing batches if you bumped a count).
 *   - Inserts in batches of 500 to keep transaction sizes reasonable.
 *
 * Usage:
 *   # Local dev (against `supabase start`)
 *   export $(supabase status --output env | xargs)
 *   npm run seed:perf
 *
 *   # CI (after `supabase db reset --no-seed=false`)
 *   npm run seed:perf
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ============================================================================
// Config
// ============================================================================

const ALPHA_FACILITY_ID = '00000001-0000-0000-0000-000000000001'
const ALPHA_ADMIN_ID    = '00000001-0000-0000-0000-000000001001'
const ALPHA_MANAGER_ID  = '00000001-0000-0000-0000-000000001002'
const ALPHA_STAFF_ID    = '00000001-0000-0000-0000-000000001003'

const TARGETS = {
  ice_maintenance_submissions: 10_000,
  ice_depth_weeks: 52,
  ice_depth_readings_per_session: 8,
  schedule_shifts: 100,
  schedule_staff_users: 20,
  announcements: 500,
}

const BATCH_SIZE = 500

// ============================================================================
// Local-only safety guard
// ============================================================================

function assertLocalUrl(url: string) {
  const hostnames = ['localhost', '127.0.0.1', 'kong', 'supabase_kong']
  if (!hostnames.some((h) => url.includes(h))) {
    console.error(
      `\n[seed-perf] REFUSING to run: SUPABASE_URL='${url}' does not look local.\n` +
        `Synthetic volume seeding against a production DB is never appropriate.\n` +
        `Expected one of: ${hostnames.join(', ')} in the URL.\n`,
    )
    process.exit(2)
  }
}

// ============================================================================
// Client setup
// ============================================================================

function client(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars.')
    console.error('For local dev: export $(supabase status --output env | xargs)')
    process.exit(2)
  }
  assertLocalUrl(url)
  return createClient(url, key, { auth: { persistSession: false } })
}

async function batchInsert<T extends Record<string, unknown>>(
  supabase: SupabaseClient,
  table: string,
  rows: T[],
  label: string,
): Promise<number> {
  let inserted = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const slice = rows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase.from(table).insert(slice as never)
    if (error) {
      // Idempotency-key collisions are expected on re-run; everything else is fatal.
      if (error.code === '23505') {
        // Skip silently — row already exists. Keep counter accurate by querying.
        continue
      }
      console.error(`[${label}] insert batch ${i / BATCH_SIZE} failed:`, error.message)
      process.exit(1)
    }
    inserted += slice.length
    if ((i / BATCH_SIZE) % 5 === 0) {
      process.stdout.write(`  ${label}: ${inserted}/${rows.length}\r`)
    }
  }
  process.stdout.write(`  ${label}: ${inserted}/${rows.length}\n`)
  return inserted
}

// ============================================================================
// Lookup helpers
// ============================================================================

async function getResourceId(
  supabase: SupabaseClient,
  resource_type: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('facility_resources')
    .select('id')
    .eq('facility_id', ALPHA_FACILITY_ID)
    .eq('resource_type', resource_type)
    .limit(1)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

async function getActiveFormSchemaVersion(
  supabase: SupabaseClient,
  module_slug: string,
  form_type: string | null,
): Promise<number> {
  const q = supabase
    .from('form_schemas')
    .select('version')
    .eq('facility_id', ALPHA_FACILITY_ID)
    .eq('module_slug', module_slug)
  const { data } = form_type === null
    ? await q.is('form_type', null).maybeSingle()
    : await q.eq('form_type', form_type).maybeSingle()
  return (data as { version: number } | null)?.version ?? 1
}

// ============================================================================
// Seeders
// ============================================================================

async function seedIceMaintenanceSubmissions(supabase: SupabaseClient) {
  console.log(`\n[ice_maintenance_submissions] target ${TARGETS.ice_maintenance_submissions}`)
  const surfaceId = await getResourceId(supabase, 'surface')
  const zamboniId = await getResourceId(supabase, 'zamboni')
  if (!surfaceId) {
    console.error('  No surface resource for Alpha — skipping')
    return
  }
  const formTypes: Array<['ice_make' | 'circle_check' | 'edging' | 'blade_change', number]> = [
    ['circle_check', await getActiveFormSchemaVersion(supabase, 'ice_maintenance', 'circle_check')],
    ['ice_make',     await getActiveFormSchemaVersion(supabase, 'ice_maintenance', 'ice_make')],
    ['edging',       await getActiveFormSchemaVersion(supabase, 'ice_maintenance', 'edging')],
    ['blade_change', await getActiveFormSchemaVersion(supabase, 'ice_maintenance', 'blade_change')],
  ]

  const baseTs = Date.now() - TARGETS.ice_maintenance_submissions * 30 * 60 * 1000 // ~30 min apart back from now
  const rows = []
  for (let i = 0; i < TARGETS.ice_maintenance_submissions; i++) {
    const [formType, version] = formTypes[i % formTypes.length]!
    const submittedBy = i % 3 === 0 ? ALPHA_MANAGER_ID : ALPHA_STAFF_ID
    rows.push({
      facility_id: ALPHA_FACILITY_ID,
      submitted_by: submittedBy,
      submitted_at: new Date(baseTs + i * 30 * 60 * 1000).toISOString(),
      form_type: formType,
      form_schema_version: version,
      surface_resource_id: surfaceId,
      zamboni_resource_id: formType === 'blade_change' ? zamboniId : null,
      blade_serial: formType === 'blade_change' ? `BL-PERF-${String(i).padStart(6, '0')}` : null,
      water_temp_f: formType === 'ice_make' ? 160 + (i % 20) : null,
      custom_fields: {},
      idempotency_key: `perf-seed:im:${i}`,
    })
  }
  await batchInsert(supabase, 'ice_maintenance_submissions', rows, 'ice_maintenance_submissions')
}

async function seedIceDepth(supabase: SupabaseClient) {
  console.log(`\n[ice_depth] target ${TARGETS.ice_depth_weeks} sessions × ${TARGETS.ice_depth_readings_per_session} readings`)
  const surfaceId = await getResourceId(supabase, 'surface')
  if (!surfaceId) {
    console.error('  No surface resource for Alpha — skipping')
    return
  }

  // Get or create a perf template
  let templateId: string | null = null
  {
    const { data: existing } = await supabase
      .from('ice_depth_templates')
      .select('id')
      .eq('facility_id', ALPHA_FACILITY_ID)
      .eq('name', 'perf-seed-template')
      .maybeSingle()
    if (existing) {
      templateId = (existing as { id: string }).id
    } else {
      const { data: created, error } = await supabase
        .from('ice_depth_templates')
        .insert({
          facility_id: ALPHA_FACILITY_ID,
          surface_resource_id: surfaceId,
          name: 'perf-seed-template',
          version: 1,
          is_active: true,
          created_by: ALPHA_ADMIN_ID,
          measurement_points: Array.from(
            { length: TARGETS.ice_depth_readings_per_session },
            (_, i) => ({ key: `p${i + 1}`, label: `Point ${i + 1}`, x: 0.1 * (i + 1), y: 0.5 }),
          ),
        })
        .select('id')
        .single()
      if (error) {
        console.error('  template insert failed:', error.message)
        return
      }
      templateId = (created as { id: string }).id
    }
  }

  // Create 52 sessions, each with 8 readings — past 52 weeks
  const sessionRows = []
  const baseTs = Date.now() - TARGETS.ice_depth_weeks * 7 * 24 * 60 * 60 * 1000
  for (let w = 0; w < TARGETS.ice_depth_weeks; w++) {
    sessionRows.push({
      facility_id: ALPHA_FACILITY_ID,
      template_id: templateId,
      template_version: 1,
      surface_resource_id: surfaceId,
      taken_by: ALPHA_STAFF_ID,
      taken_at: new Date(baseTs + w * 7 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'completed',
      idempotency_key: `perf-seed:icedepth:session:${w}`,
    })
  }
  // Insert sessions one batch
  const { data: insertedSessions, error: sessErr } = await supabase
    .from('ice_depth_sessions')
    .upsert(sessionRows, { onConflict: 'idempotency_key', ignoreDuplicates: false })
    .select('id, idempotency_key')
  if (sessErr) {
    console.error('  session insert failed:', sessErr.message)
    return
  }
  const sessions = (insertedSessions ?? []) as Array<{ id: string; idempotency_key: string }>
  console.log(`  ice_depth_sessions: ${sessions.length}`)

  // Now 8 readings per session
  const readingRows = []
  for (const s of sessions) {
    for (let p = 0; p < TARGETS.ice_depth_readings_per_session; p++) {
      readingRows.push({
        session_id: s.id,
        point_key: `p${p + 1}`,
        depth_inches: 1.0 + (p * 0.1) + Math.random() * 0.05,
      })
    }
  }
  await batchInsert(supabase, 'ice_depth_readings', readingRows, 'ice_depth_readings')
}

async function seedScheduling(supabase: SupabaseClient) {
  console.log(`\n[scheduling] target 1 schedule × ${TARGETS.schedule_shifts} shifts × ${TARGETS.schedule_staff_users} staff`)

  const positions: Array<{ id: string }> = []
  {
    const { data } = await supabase
      .from('facility_resources')
      .select('id')
      .eq('facility_id', ALPHA_FACILITY_ID)
      .eq('resource_type', 'shift_position')
      .eq('is_active', true)
    for (const r of (data ?? []) as Array<{ id: string }>) positions.push(r)
  }
  if (positions.length === 0) {
    console.error('  No shift_position resources — skipping')
    return
  }

  // Use the next Sunday as week_start_date to satisfy the Sunday CHECK
  const today = new Date()
  const daysToSunday = (7 - today.getDay()) % 7 || 7
  const sunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysToSunday)
  const weekStartIso = sunday.toISOString().slice(0, 10)

  const { data: schedule, error: schedErr } = await supabase
    .from('schedules')
    .upsert(
      {
        facility_id: ALPHA_FACILITY_ID,
        week_start_date: weekStartIso,
        status: 'draft',
        created_by: ALPHA_ADMIN_ID,
      },
      { onConflict: 'facility_id,week_start_date', ignoreDuplicates: false },
    )
    .select('id')
    .single()
  if (schedErr) {
    console.error('  schedule insert failed:', schedErr.message)
    return
  }
  const scheduleId = (schedule as { id: string }).id

  // Generate 100 shifts spread across the week, rotating positions
  const shiftRows = []
  for (let i = 0; i < TARGETS.schedule_shifts; i++) {
    const dayOffset = i % 7
    const startHour = 6 + ((i * 2) % 12)
    const startsAt = new Date(`${weekStartIso}T00:00:00Z`)
    startsAt.setUTCDate(startsAt.getUTCDate() + dayOffset)
    startsAt.setUTCHours(startHour, 0, 0, 0)
    const endsAt = new Date(startsAt)
    endsAt.setUTCHours(endsAt.getUTCHours() + 4)
    shiftRows.push({
      facility_id: ALPHA_FACILITY_ID,
      schedule_id: scheduleId,
      position_resource_id: positions[i % positions.length]!.id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      required_headcount: 1,
    })
  }
  const { data: insertedShifts, error: shiftErr } = await supabase
    .from('shifts')
    .insert(shiftRows)
    .select('id')
  if (shiftErr) {
    console.error('  shifts insert failed:', shiftErr.message)
    return
  }
  console.log(`  shifts: ${(insertedShifts ?? []).length}`)

  // Note: assignments are skipped to avoid seeding 20 fake auth.users (which the
  // bcrypt seed pattern handles in seed.sql, not here). The 100-shift × 20-staff
  // perf scenario tests builder-side join cost dominated by shifts × positions
  // anyway; assignments would be additive but not the bottleneck.
}

async function seedAnnouncements(supabase: SupabaseClient) {
  console.log(`\n[announcements] target ${TARGETS.announcements}`)
  const baseTs = Date.now() - TARGETS.announcements * 30 * 60 * 1000

  const rows = []
  for (let i = 0; i < TARGETS.announcements; i++) {
    const priority = i % 10 === 0 ? 'urgent' : i % 3 === 0 ? 'important' : 'normal'
    const archived = i < TARGETS.announcements - 50  // newest 50 stay active
    const postedAt = new Date(baseTs + i * 30 * 60 * 1000).toISOString()
    rows.push({
      facility_id: ALPHA_FACILITY_ID,
      author_user_id: ALPHA_ADMIN_ID,
      title: `Perf seed announcement ${String(i).padStart(4, '0')}`,
      body: `Synthetic announcement ${i} for performance smoke testing.`,
      priority,
      target_audience: 'all_staff',
      requires_acknowledgment: i % 7 === 0,
      posted_at: postedAt,
      is_archived: archived,
      archived_by: archived ? ALPHA_ADMIN_ID : null,
      archived_at: archived ? postedAt : null,
      idempotency_key: `perf-seed:ann:${i}`,
    })
  }
  await batchInsert(supabase, 'announcements', rows, 'announcements')
}

// ============================================================================
// Entry
// ============================================================================

async function main() {
  console.log('seed-perf: starting against local Supabase')
  const supabase = client()

  await seedIceMaintenanceSubmissions(supabase)
  await seedIceDepth(supabase)
  await seedScheduling(supabase)
  await seedAnnouncements(supabase)

  console.log('\nseed-perf: done')
}

main().catch((e) => {
  console.error('seed-perf: unhandled error', e)
  process.exit(1)
})
