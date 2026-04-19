import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { timezoneFromPostalCode } from '@/lib/timezone/from-postal-code'

export type Address = {
  street: string
  city: string
  state: string
  postal_code: string
}

export type CreateFacilityInput = {
  name: string
  address: Address
  firstAdminEmail: string
  /**
   * Optional IANA timezone override. If omitted, derived from address.postal_code
   * via the static lookup. If derivation fails, falls back to 'UTC'.
   */
  timezone?: string
  /** URL-safe slug override. If omitted, derived from name. */
  slug?: string
}

export type CreateFacilityResult = {
  facility_id: string
  invite_url: string
}

/**
 * Platform-admin-only. Creates a facility + subscription + admin role + enables all
 * modules + issues the first admin invite. Returns the accept-invite URL for the
 * platform admin to deliver.
 *
 * Runs as the caller (who must be platform admin — AuthZ is enforced inside the SQL
 * function via is_platform_admin()). We do NOT use the service role here because the
 * RPC itself is SECURITY DEFINER and checks caller identity; using service role would
 * bypass that check.
 */
export async function createFacilityWithFirstAdmin(
  input: CreateFacilityInput,
): Promise<CreateFacilityResult> {
  const supabase = await createClient()

  const timezone =
    input.timezone ??
    timezoneFromPostalCode(input.address.postal_code) ??
    'UTC'

  const { data, error } = await supabase.rpc('rpc_create_facility_with_first_admin', {
    p_name: input.name,
    p_timezone: timezone,
    p_address: input.address,
    p_first_admin_email: input.firstAdminEmail,
    p_slug: input.slug ?? null,
  })

  if (error) {
    throw new Error(`createFacilityWithFirstAdmin: ${error.message}`)
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row?.facility_id || !row?.invite_token) {
    throw new Error('createFacilityWithFirstAdmin: RPC returned malformed response')
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.rinkreports.com'
  const inviteUrl = `${appUrl}/accept-invite?token=${encodeURIComponent(row.invite_token)}`

  return {
    facility_id: row.facility_id,
    invite_url: inviteUrl,
  }
}
