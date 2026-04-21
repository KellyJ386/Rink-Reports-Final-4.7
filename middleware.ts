import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Auth middleware.
 *
 * Two jobs:
 *   1. Refresh the Supabase session on every request so server components read a fresh token.
 *   2. Enforce `users.active = true` for authenticated users. Deactivated users are signed out
 *      and redirected to `/login?reason=deactivated`. This is the enforcement layer for
 *      Agent 6's admin-deactivates-a-user flow and Agent 7's `forceLogoutUser`.
 *
 * RLS lives in Postgres. This middleware handles only the auth-side gate; it does not
 * duplicate tenant isolation logic.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseUrl.startsWith('http') || !supabaseAnonKey) {
    return response
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(
          cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>,
        ) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return response
  }

  // Authenticated → verify profile row is active
  const { data: profile } = await supabase
    .from('users')
    .select('active')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile || profile.active === false) {
    await supabase.auth.signOut()
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('reason', 'deactivated')
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  /**
   * Exclude static assets, the login page, the invite acceptance endpoint (unauthenticated
   * by design — Agent 1b handles hostile input there), and the Stripe webhook handler
   * (signature-verified; lives outside the auth boundary — Agent 7).
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|login|accept-invite|api/stripe).*)',
  ],
}
