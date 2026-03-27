# Qolify — Product Tiers & Feature Gating

---

## Tier Definitions

| Tier | Price | Model | `user_profiles.tier` value |
|---|---|---|---|
| Free | €0 | B only | `'free'` |
| Pro | €19/month | B only | `'pro'` |
| Explorer | €39/month | A + B | `'explorer'` |
| Intelligence | €79/month | A + B | `'intelligence'` |
| Report (one-time) | €9 | B only | n/a — one-time purchase, not a subscription tier |

Annual option: €590/year for Intelligence (saves ~€358 vs monthly). Stored as same `'intelligence'` tier with `tier_expires_at` set to 12 months.

---

## Feature Matrix

| Feature | Free | Pro | Explorer | Intelligence |
|---|---|---|---|---|
| URL paste analysis | ✓ (3/day) | ✓ unlimited | ✓ unlimited | ✓ unlimited |
| Browser extension | ✓ | ✓ | ✓ | ✓ |
| Shareable report link | ✓ | ✓ | ✓ | ✓ |
| Tier 1 indicators (5) | ✓ | ✓ | ✓ | ✓ |
| Tier 2 indicators (7) | ✗ locked | ✓ | ✓ | ✓ |
| Tier 3 indicators (3) | ✗ locked | ✗ locked | ✗ locked | ✓ |
| ICO calculator | ✗ | ✓ | ✓ | ✓ |
| PDF report export | ✗ | ✓ | ✓ | ✓ |
| URL price alerts | ✗ | ✓ | ✓ | ✓ |
| Saved properties (limit) | 3 | Unlimited | Unlimited | Unlimited |
| Filter presets | ✗ | ✓ | ✓ | ✓ |
| **Multi-URL batch import** | ✗ | ✓ (up to 10) | ✓ (up to 25) | ✓ (up to 50) |
| **Favourites page import (extension)** | ✗ | ✓ | ✓ | ✓ |
| **Share-list URL import** | ✗ | ✓ | ✓ | ✓ |
| **Comparison view** | ✗ | ✓ | ✓ | ✓ |
| **Saved comparisons** | ✗ | 3 | Unlimited | Unlimited |
| **Shareable comparison link** | ✗ | ✓ | ✓ | ✓ |
| **Comparison weighted re-ranking** | ✗ | ✓ | ✓ | ✓ |
| Compare properties (single pair) | ✗ | ✓ | ✓ | ✓ |
| Map portal (Model A) | ✗ | ✗ | ✓ | ✓ |
| National listing inventory | ✗ | ✗ | ✓ | ✓ |
| NTI + Arbitrage map layers | ✗ | ✗ | ✓ | ✓ |
| Composite indicator map filters | ✗ | ✗ | ✓ | ✓ |
| New listing search alerts | ✗ | ✗ | ✓ | ✓ |
| Historical price charts | ✗ | ✗ | ✗ | ✓ |
| Zone trend dashboards | ✗ | ✗ | ✗ | ✓ |
| Gentrification Confirmation | ✗ | ✗ | ✗ | ✓ |
| Price Velocity signal | ✗ | ✗ | ✗ | ✓ |
| Seasonal Distortion filter | ✗ | ✗ | ✗ | ✓ |
| API access | ✗ | ✗ | ✗ | 500 calls/month |
| Weekly market digest email | ✗ | ✗ | ✗ | ✓ |

---

## Gating Implementation

### How tiers are stored
`user_profiles.tier` — set by Stripe webhook on subscription events.

```sql
-- Possible values
'free'           -- default for all new signups
'pro'
'explorer'
'intelligence'
```

`user_profiles.tier_expires_at` — set for paid tiers. Null for free. Checked by API routes.

### How gating is enforced in API routes

```typescript
// lib/auth/getTierFromRequest.ts
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'

export type Tier = 'free' | 'pro' | 'explorer' | 'intelligence'

export async function getTierFromRequest(request: Request): Promise<Tier> {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) return 'free'

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tier, tier_expires_at')
    .eq('id', session.user.id)
    .single()

  if (!profile) return 'free'

  // Check expiry for paid tiers
  if (profile.tier_expires_at && new Date(profile.tier_expires_at) < new Date()) {
    // Expired — downgrade to free (Stripe webhook should have caught this)
    return 'free'
  }

  return profile.tier as Tier
}

// Tier hierarchy helpers
export const TIER_RANK: Record<Tier, number> = {
  free: 0, pro: 1, explorer: 2, intelligence: 3
}

export function tierAtLeast(userTier: Tier, required: Tier): boolean {
  return TIER_RANK[userTier] >= TIER_RANK[required]
}
```

### Enforcing gating in an API route

```typescript
// Example: /api/properties route (Explorer+ only)
export async function GET(request: Request) {
  const tier = await getTierFromRequest(request)

  if (!tierAtLeast(tier, 'explorer')) {
    return Response.json({
      error: 'upgrade_required',
      message: 'Map access requires Explorer tier or above.',
      upgrade_url: '/account/upgrade'
    }, { status: 401 })
  }

  // ... serve map data
}
```

### Gating in the /api/analyse response

The `/api/analyse` endpoint returns all indicator data internally. The response is filtered by tier before sending:

```typescript
function filterIndicatorsByTier(indicators: AllIndicators, tier: Tier): PartialIndicators {
  const result = { ...indicators }

  if (!tierAtLeast(tier, 'pro')) {
    // Free: only Tier 1 indicators
    result.nti = { locked: true, upgrade_tier: 'pro' }
    result.community_stability = { locked: true, upgrade_tier: 'pro' }
    result.climate_resilience = { locked: true, upgrade_tier: 'pro' }
    result.infrastructure_arbitrage = { locked: true, upgrade_tier: 'pro' }
    result.motivated_seller = { locked: true, upgrade_tier: 'pro' }
    result.rental_trap = { locked: true, upgrade_tier: 'pro' }
    result.expat_liveability = { locked: true, upgrade_tier: 'pro' }
  }

  if (!tierAtLeast(tier, 'intelligence')) {
    // Free + Pro + Explorer: Tier 3 locked
    result.price_velocity = { locked: true, upgrade_tier: 'intelligence' }
    result.gentrification_confirmation = { locked: true, upgrade_tier: 'intelligence' }
    result.seasonal_distortion = { locked: true, upgrade_tier: 'intelligence' }
  }

  return result
}
```

### Batch analysis limits (Pro+)

```typescript
const BATCH_LIMITS: Record<Tier, number> = {
  free: 0,
  pro: 10,
  explorer: 25,
  intelligence: 50,
}

// In /api/analyse/batch:
export async function POST(request: Request) {
  const tier = await getTierFromRequest(request)
  const { urls } = await request.json()

  if (!tierAtLeast(tier, 'pro')) {
    return Response.json({
      error: 'upgrade_required',
      message: 'Batch analysis requires Pro tier or above.',
      upgrade_url: '/account/upgrade'
    }, { status: 401 })
  }

  const limit = BATCH_LIMITS[tier]
  if (urls.length > limit) {
    return Response.json({
      error: 'batch_limit_exceeded',
      message: `Your ${tier} plan supports up to ${limit} URLs per batch.`,
      limit,
      submitted: urls.length
    }, { status: 400 })
  }

  // Process batch...
}
```

### Comparison save limits (Pro: 3, Explorer+: unlimited)

```typescript
const COMPARISON_SAVE_LIMITS: Record<Tier, number | 'unlimited'> = {
  free: 0,
  pro: 3,
  explorer: 'unlimited',
  intelligence: 'unlimited',
}

// In POST /api/comparisons (save a comparison):
if (tier === 'pro') {
  const { count } = await supabase
    .from('comparisons')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)

  if (count >= 3) {
    return Response.json({
      error: 'comparison_limit_reached',
      message: 'Pro accounts can save up to 3 comparisons. Upgrade to Explorer for unlimited.',
      upgrade_url: '/account/upgrade'
    }, { status: 400 })
  }
}
```

Free tier is limited to 3 on-demand analyses per day, enforced via Upstash Redis:

```typescript
// lib/ratelimit.ts
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

export const analysisRateLimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(3, '24 h'),
  analytics: true,
})

// In /api/analyse:
const identifier = session?.user?.id ?? request.headers.get('x-forwarded-for') ?? 'anonymous'
const { success, remaining } = await analysisRateLimit.limit(identifier)

if (!success && tier === 'free') {
  return Response.json({
    error: 'rate_limit_exceeded',
    message: 'Free accounts are limited to 3 analyses per day. Upgrade to Pro for unlimited access.',
    remaining: 0,
    upgrade_url: '/account/upgrade'
  }, { status: 429 })
}
```

---

## Stripe Integration

### Stripe products and price IDs
Configure in Stripe Dashboard. Store IDs in environment variables:

```bash
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_EXPLORER_MONTHLY=price_...
STRIPE_PRICE_INTELLIGENCE_MONTHLY=price_...
STRIPE_PRICE_INTELLIGENCE_ANNUAL=price_...
STRIPE_PRICE_REPORT_ONE_TIME=price_...
```

### Webhook events that update `user_profiles.tier`

```typescript
// app/api/webhooks/stripe/route.ts
// Handle these events:
// checkout.session.completed    → set tier + tier_expires_at
// customer.subscription.updated → update tier if plan changed
// customer.subscription.deleted → downgrade to 'free'
// invoice.payment_failed        → optionally warn user before downgrade
```

---

## UI Behaviour for Locked Features

When a feature is locked:

1. **Indicator cards**: render with blurred/greyed content + padlock icon + "Upgrade to Pro" CTA
2. **Map routes**: redirect to `/account/upgrade` with a message explaining what Explorer unlocks
3. **API responses**: return `{ locked: true, upgrade_tier: 'pro', upgrade_url: '/account/upgrade' }` — never return null or throw a 500
4. **Never hide locked features entirely** — show them locked so users understand what they're missing
