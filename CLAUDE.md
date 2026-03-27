# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## What is Qolify?

A property intelligence platform for the Spanish residential market. It aggregates government, environmental, social, and market data to give house hunters a complete picture of a property's true quality of life and value — data no mainstream portal (Idealista, Fotocasa) currently provides.

**Tagline:** Invest in your Life, not just a Postcode.

---

## The Builder

Thomas is the product owner, not a software engineer. He relies on Claude Code for all technical implementation and uses Claude (chat) to design and plan first.

- Thomas reviews plans before code is written
- Prefer clear, commented code over terse code
- Always explain what a file or function does before writing it
- Never delete or overwrite existing working code without explicit instruction
- When in doubt, ask — do not assume

---

## Reference Documents

All project decisions are captured in `MD files/`. Read the relevant ones before starting any task:

| File | What it covers |
|---|---|
| `PRODUCT.md` | What Qolify is, who it's for, the problem it solves |
| `DECISIONS.md` | All key product and technical decisions with rationale |
| `ARCHITECTURE.md` | Full system architecture, tech stack, database schema, pipelines |
| `ROADMAP.md` | Phased build plan with success criteria per phase |
| `DATA_SOURCES.md` | Every data source, API, URL, collection method |
| `INDICATORS.md` | All 15 composite indicators — inputs, formulas, outputs |
| `TIERS.md` | Product tiers, feature gating, pricing |
| `SCHEMA.md` | Complete database schema — canonical source of truth |
| `ANNEX_WEATHER_SOLAR.md` | Full spec for climate, solar and orientation data ingestion |

---

## Project Resources

| Resource | Value |
|---|---|
| GitHub repo | https://github.com/thomascarson87/qolify |
| Supabase project URL | https://btnnaoitbrgyjjzpwoze.supabase.co |
| Supabase project ref | `btnnaoitbrgyjjzpwoze` |
| Supabase anon key | `sb_publishable_-j0F6WziKKDN3cEzJoJyqA_P0k3cYmq` |
| Linear workspace | https://linear.app/chimeopen — team `CHI` (Chimeopen) |

**Env var names for `.env.local` and Vercel:**
```
NEXT_PUBLIC_SUPABASE_URL=https://btnnaoitbrgyjjzpwoze.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_-j0F6WziKKDN3cEzJoJyqA_P0k3cYmq
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.btnnaoitbrgyjjzpwoze.supabase.co:5432/postgres
DATABASE_URL_POOLER=postgresql://postgres.btnnaoitbrgyjjzpwoze:[PASSWORD]@aws-1-eu-west-1.pooler.supabase.com:6543/postgres
SUPABASE_SERVICE_ROLE_KEY=
AEMET_API_KEY=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
CRON_SECRET=
```

> The DB password is a secret — store it only in `.env.local` (never commit) and in Vercel environment variables. The anon key is public and safe for client-side use.

---

## Current Phase

**Phase 0 — Foundation & QoL Data.** See `ROADMAP.md` for the full checklist. Active issue tracking is in Linear (project: Chimeopen, team: CHI).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16.2.1 (App Router, Turbopack) + Tailwind CSS v4 |
| Map | MapLibre GL JS |
| Database | Supabase (PostgreSQL + PostGIS) |
| Auth | Supabase Auth |
| API | Next.js API Routes on Vercel |
| On-demand extraction | Parse.bot |
| Bulk scraping (Phase 4+) | Cloudflare Browser Rendering `/crawl` |
| Pipeline orchestration | Cloudflare Workers (cron) |
| Rate limiting | Upstash Redis |
| Payments | Stripe |
| Monitoring | Vercel Analytics + Sentry |
| Deployment | Vercel |

---

## Development Commands

**Next.js app** (project root):
```bash
npm run dev      # dev server — user must run this in their own terminal (Turbopack OOMs in background)
npm run build    # production build
npm run lint     # ESLint
```

**Python ingest scripts** (`scripts/ingest/`):
```bash
cd scripts/ingest

python ingest_municipios.py           # municipal boundaries + reference data
python ingest_aemet_climate.py        # AEMET 30-year climate normals
python ingest_pvgis_solar.py          # PVGIS solar irradiance grid
python ingest_gtfs.py                 # MITMA/ALSA bus stops
python ingest_flood_zones.py          # SNCZI flood zone polygons (WFS/MVT)
python ingest_schools.py              # OSM schools (Málaga bbox)
python ingest_health_centres.py       # OSM health centres (Málaga bbox)
python ingest_air_quality.py          # air quality stations

# Single station dry-run (AEMET):
python ingest_aemet_climate.py --station 6155A --dry-run

# Bounding box filter (GTFS, Málaga only):
python ingest_gtfs.py --bbox 36.4,-5.1,36.8,-4.3
```

**Validation gate** (run after ingest, before marking Phase 0 done):
```bash
bash scripts/validate_phase0.sh        # tests 3 Málaga properties against /api/analyse
```

**Database migrations:**
```bash
# Via Supabase MCP (preferred): use mcp__claude_ai_Supabase__apply_migration
# Via CLI: supabase db push --db-url $DATABASE_URL
```

---

## Architecture

### Two-model design

**Model A — Bulk (Phase 4+):** Cloudflare Workers scrape listings → Parse.bot extracts structured data → stored in `properties` table → nightly cron aggregates zone metrics into `zone_metrics_history`.

**Model B — On-demand (live now):** User submits a property URL → `/api/analyse` route fetches listing via Parse.bot → joins QoL reference data from PostGIS → returns composite score → cached in `analysis_cache` (48h TTL).

### Reference data layers

All reference data is pre-ingested by Python scripts in `scripts/ingest/` and served at query time.

| Table | Source | Script |
|---|---|---|
| `municipios` | INE shapefile | `ingest_municipios.py` |
| `climate_data` | AEMET OpenData API | `ingest_aemet_climate.py` |
| `solar_radiation` | PVGIS JRC REST API (`MRcalculation`) | `ingest_pvgis_solar.py` |
| `transport_stops` | MITMA GTFS (ALSA S3 mirror) | `ingest_gtfs.py` |
| `flood_zones` | SNCZI / MITECO MVT tiles | `ingest_flood_zones.py` |
| `schools` | OpenStreetMap Overpass | `ingest_schools.py` |
| `health_centres` | OpenStreetMap Overpass | `ingest_health_centres.py` |

### Database connections

- **Python scripts:** use `_db.py` → `get_conn()` — prefers `DATABASE_URL_POOLER` (port 6543, transaction pooler) with TCP keepalives. The pooler has an app-level idle timeout (~10–15 min); any script running longer needs `except psycopg2.OperationalError: conn = get_conn()` reconnect logic around every DB call in its main loop.
- **Next.js app:** uses the `postgres` package (v3) with `DATABASE_URL` (direct port 5432).

### Key files

```
app/api/analyse/route.ts              ← on-demand property analysis (POST)
app/api/cron/zone-metrics/route.ts    ← nightly zone aggregation (Vercel cron, 02:00 UTC)
scripts/ingest/_db.py                 ← shared psycopg2 connection helper
supabase/migrations/                  ← all schema migrations (must match SCHEMA.md)
```

---

## Absolute Rules

1. **Never hardcode secrets.** All API keys, connection strings, and tokens go in `.env.local` (local) or Vercel environment variables (production).
2. **Never modify the database schema without updating `SCHEMA.md`.** The schema file is the canonical source of truth. Supabase migrations must match it exactly.
3. **Never skip tier gating.** Every API route that serves Explorer or Intelligence data must check the user's `tier` claim from the Supabase JWT. See `TIERS.md`.
4. **Always log to `property_price_history`.** Every analysis — on-demand or scraped — must write a price observation. This time-series data is irreplaceable.
5. **Always write `zone_metrics_history`.** The nightly cron that aggregates zone data must never be allowed to silently fail. Sentry cron monitoring is mandatory.
6. **PostGIS for all spatial queries.** Never calculate distances in application code. Use `ST_DWithin`, `ST_Distance`, `ST_Intersects` in SQL.

---

## Issue Tracking Rule

**Any serious or repeating failure must be filed as a Linear issue before or immediately after being fixed.**

This applies to:
- Ingest script crashes or data quality bugs (wrong values written, silent skips, connection drops)
- External API breakages (endpoint moved, parameter changes, authentication failures)
- Schema or migration mismatches discovered at runtime
- Any issue that required more than one debug cycle to diagnose
- Any issue that could recur (connection timeouts, rate limits, API deprecations)

**Why:** Bugs that are just fixed locally leave no trail. If the same failure recurs, there's no history to diagnose from. Linear issues give every non-trivial failure a ticket, a root cause write-up, and acceptance criteria — the same traceability as any build task.

**How to file:**
- Team: `CHI` (Chimeopen), project: `Chimeopen`
- Priority: High (2) for data correctness bugs, Normal (3) for latency/performance
- Title: descriptive enough to find by searching — include the script name and failure mode
- Description must include: **symptom**, **root cause**, **fix required**, **acceptance criteria**
- Link related tickets with `relatedTo` or `blockedBy` where relevant
- Use the `mcp__claude_ai_Linear__save_issue` MCP tool — do not rely on code comments or memory

**When in doubt, file it.** A ticket that turns out to be trivial costs nothing. An undocumented failure that recurs costs a full debug session.
