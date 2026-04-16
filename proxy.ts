/**
 * proxy.ts — Next.js 16 request interceptor (replaces middleware.ts)
 * Runs on the Node.js runtime before every request.
 *
 * Refreshes the Supabase session cookie on every page request so that
 * server-side auth (supabase.auth.getUser()) stays valid across navigations.
 *
 * API routes are passed through without session refresh — they handle their
 * own auth checks at the route handler level.
 *
 * NOTE: Rate limiting is intentionally NOT implemented here. Importing
 * @upstash/redis/@upstash/ratelimit in the proxy causes an ESM/CJS interop
 * failure in Turbopack's lazy proxy compilation. Add rate limiting inside
 * individual API route handlers using lib/ratelimit.ts instead.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // API routes don't use session cookies — skip the Supabase refresh round-trip.
  // Each API route handler performs its own auth check if needed.
  if (pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Session refresh — keeps the Supabase auth cookie valid for page routes.
  const { supabaseResponse } = await updateSession(request)
  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimisation)
     * - favicon.ico, sitemap.xml, robots.txt
     * - public folder files
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
