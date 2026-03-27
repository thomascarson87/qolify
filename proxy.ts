/**
 * proxy.ts — Next.js 16 request interceptor (replaces middleware.ts)
 * Runs on the Node.js runtime before every request.
 *
 * 1. Refreshes Supabase session cookie (keeps server-side auth valid)
 * 2. Rate limits /api/* routes: 100 req/min anon, 1000 req/min authenticated
 */
import { NextResponse, type NextRequest } from 'next/server'
import { updateSession }  from '@/lib/supabase/middleware'
import { checkRateLimit } from '@/lib/ratelimit'

// Only rate-limit API routes (not pages, static assets, etc.)
const RATE_LIMITED_PREFIX = '/api/'

// Cron routes are called by Vercel with CRON_SECRET — skip user rate limit
const CRON_PREFIX = '/api/cron/'

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  )
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Session refresh (always runs — needed for Supabase auth on all routes)
  const { supabaseResponse, user } = await updateSession(request)

  // Rate limiting — API routes only, skip cron
  if (pathname.startsWith(RATE_LIMITED_PREFIX) && !pathname.startsWith(CRON_PREFIX)) {
    const identifier    = user?.id ?? getClientIp(request)
    const authenticated = user != null

    const rl = await checkRateLimit(identifier, authenticated)

    if (!rl.success) {
      return new NextResponse(
        JSON.stringify({
          error:       'Too many requests',
          retry_after: rl.reset - Math.floor(Date.now() / 1000),
        }),
        {
          status:  429,
          headers: {
            'Content-Type':  'application/json',
            'X-RateLimit-Limit':     String(rl.limit),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset':     String(rl.reset),
            'Retry-After':           String(rl.reset - Math.floor(Date.now() / 1000)),
          },
        },
      )
    }

    // Pass rate limit headers through on successful requests
    if (rl.limit > 0) {
      supabaseResponse.headers.set('X-RateLimit-Limit',     String(rl.limit))
      supabaseResponse.headers.set('X-RateLimit-Remaining', String(rl.remaining))
      supabaseResponse.headers.set('X-RateLimit-Reset',     String(rl.reset))
    }
  }

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
