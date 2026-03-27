/**
 * Rate limiting via Upstash Redis + @upstash/ratelimit.
 *
 * Two tiers:
 *   anon          — 100 requests / 60s sliding window (IP-keyed)
 *   authenticated — 1000 requests / 60s sliding window (user ID-keyed)
 *
 * If UPSTASH_REDIS_REST_URL / TOKEN are not set (local dev without Redis),
 * all checks pass — rate limiting is silently bypassed.
 *
 * Usage:
 *   const result = await checkRateLimit(identifier, isAuthenticated)
 *   if (!result.success) return 429
 */
import { Ratelimit } from '@upstash/ratelimit'
import { Redis }     from '@upstash/redis'

const WINDOW = '60 s'

let anonLimiter:      Ratelimit | null = null
let authLimiter:      Ratelimit | null = null
let redisUnavailable: boolean          = false

function getLimiters(): { anon: Ratelimit; auth: Ratelimit } | null {
  if (redisUnavailable) return null
  if (anonLimiter && authLimiter) return { anon: anonLimiter, auth: authLimiter }

  const url   = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) {
    redisUnavailable = true
    return null
  }

  const redis = new Redis({ url, token })

  anonLimiter = new Ratelimit({
    redis,
    limiter:   Ratelimit.slidingWindow(100, WINDOW),
    prefix:    'rl:anon',
    analytics: false,
  })

  authLimiter = new Ratelimit({
    redis,
    limiter:   Ratelimit.slidingWindow(1000, WINDOW),
    prefix:    'rl:auth',
    analytics: false,
  })

  return { anon: anonLimiter, auth: authLimiter }
}

export interface RateLimitResult {
  success:   boolean
  limit:     number
  remaining: number
  reset:     number   // Unix timestamp (seconds) when the window resets
}

/**
 * Check rate limit for a request.
 * @param identifier  IP address (anon) or user ID (authenticated)
 * @param authenticated  Whether the request comes from a logged-in user
 */
export async function checkRateLimit(
  identifier:    string,
  authenticated: boolean,
): Promise<RateLimitResult> {
  const limiters = getLimiters()

  // Bypass: Redis not configured (local dev)
  if (!limiters) {
    return { success: true, limit: 0, remaining: 0, reset: 0 }
  }

  const limiter = authenticated ? limiters.auth : limiters.anon
  const key     = `${authenticated ? 'user' : 'ip'}:${identifier}`

  try {
    const result = await limiter.limit(key)
    return {
      success:   result.success,
      limit:     result.limit,
      remaining: result.remaining,
      reset:     Math.ceil(result.reset / 1000),  // Upstash returns ms
    }
  } catch (err) {
    // Redis error — fail open to avoid blocking legitimate traffic
    console.error('[ratelimit] Redis error, failing open:', err)
    return { success: true, limit: 0, remaining: 0, reset: 0 }
  }
}
