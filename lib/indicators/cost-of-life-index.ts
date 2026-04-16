/**
 * Indicator 18 — Cost of Life Index
 *
 * What it tells the user: What daily life actually costs beyond the mortgage —
 * a figure invisible on every portal and highly variable across Spanish cities.
 *
 * New indicator introduced in the QoL Enrichment Layer (CHI-377).
 * Blocked on CHI-376 (Numbeo ingest) — returns null until cost_of_living data
 * is ingested. The supermarket tier breakdown (OSM) works independently.
 *
 * Inputs:
 * - cost_of_living row for ciudad (matched via municipio)
 * - Supermarket operator tier breakdown within 500m — from amenities
 *
 * Note: Confidence is always 'medium' — data is city-level (not postcode).
 * This is disclosed in the UI as per D-027.
 */
import type { Sql } from 'postgres'
import type { PropertyInput, IndicatorResult, Alert } from './types'

export async function calcCostOfLifeIndex(
  sql: Sql,
  property: PropertyInput,
): Promise<IndicatorResult & { details: Record<string, unknown> }> {
  const alerts: Alert[] = []

  // --- CTE: cost_of_living by municipio + supermarket tier breakdown ---
  const [row] = await sql<{
    coffee_eur:               number | null
    beer_eur:                 number | null
    meal_cheap_eur:           number | null
    meal_midrange_eur:        number | null
    grocery_index:            number | null
    supermarket_discount_pct: number | null
    supermarket_premium_pct:  number | null
    recorded_quarter:         Date | null
    total_supermarkets_500m:  number
    discount_count:           number
    premium_count:            number
  }[]>`
    WITH
      col AS (
        -- Match cost_of_living by municipio (case-insensitive)
        -- Falls back to NULL row if no data for this municipio/ciudad yet
        SELECT
          coffee_eur,
          beer_eur,
          meal_cheap_eur,
          meal_midrange_eur,
          grocery_index,
          supermarket_discount_pct,
          supermarket_premium_pct,
          recorded_quarter
        FROM cost_of_living
        WHERE LOWER(municipio) = LOWER(${property.municipio ?? ''})
           OR LOWER(ciudad)    = LOWER(${property.municipio ?? ''})
        ORDER BY recorded_quarter DESC
        LIMIT 1
      ),
      supermarkets AS (
        -- Supermarket tier breakdown from OSM operator tags (500m radius)
        SELECT
          COUNT(*)::int                                                     AS total,
          COUNT(*) FILTER (WHERE LOWER(COALESCE(operator, '')) SIMILAR TO
            '%(lidl|aldi|dia|d\u00eda|consum|simply|supeco|charter)%'
          )::int                                                            AS discount,
          COUNT(*) FILTER (WHERE LOWER(COALESCE(operator, '')) SIMILAR TO
            '%(el corte ingl[eé]s|supercor|gourmet experience)%'
          )::int                                                            AS premium
        FROM amenities
        WHERE category = 'supermarket'
          AND ST_DWithin(
            geom,
            ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY,
            500
          )
      )
    SELECT
      col.coffee_eur,
      col.beer_eur,
      col.meal_cheap_eur,
      col.meal_midrange_eur,
      col.grocery_index,
      col.supermarket_discount_pct,
      col.supermarket_premium_pct,
      col.recorded_quarter,
      sm.total  AS total_supermarkets_500m,
      sm.discount AS discount_count,
      sm.premium  AS premium_count
    FROM (SELECT 1) dummy
    LEFT JOIN col ON TRUE
    CROSS JOIN supermarkets sm
  `

  const coffeeEur      = row?.coffee_eur               ?? null
  const groceryIndex   = row?.grocery_index             ?? null
  const totalSm        = row?.total_supermarkets_500m   ?? 0
  const discountCount  = row?.discount_count            ?? 0

  // No cost_of_living data yet — blocked on CHI-376 (Numbeo API key)
  if (coffeeEur == null && groceryIndex == null) {
    return {
      score: null,
      confidence: 'insufficient_data',
      details: {
        coffee_eur:               null,
        beer_eur:                 null,
        meal_cheap_eur:           null,
        grocery_index:            null,
        supermarket_discount_pct: null,
        total_supermarkets_500m:  totalSm,
        discount_supermarkets:    discountCount,
        data_note:                'Blocked on CHI-376: Numbeo API key required',
      },
      alerts: [],
    }
  }

  // --- Coffee affordability score ---
  // Spain range ~€1.20 (rural) to ~€2.20 (Madrid centre)
  // €1.00 = 100, each €0.015 above = -1 pt
  const coffeeScore  = coffeeEur != null
    ? Math.max(0, 100 - (coffeeEur - 1.0) * 65)
    : 70

  // --- Grocery affordability score ---
  // Numbeo index 100 = global avg; Spain typically 75–95
  // Index 50 = 100 pts, index 100 = 50 pts, index 150 = 0 pts
  const groceryScore = groceryIndex != null
    ? Math.max(0, 100 - (groceryIndex - 50))
    : 70

  // --- Supermarket tier score (local OSM data) ---
  // Use Numbeo field if available, otherwise derive from OSM operator tags
  let discountPct: number
  if (row?.supermarket_discount_pct != null) {
    discountPct = row.supermarket_discount_pct
  } else if (totalSm > 0) {
    discountPct = Math.round((discountCount / totalSm) * 100)
  } else {
    discountPct = 50  // neutral if no local supermarket data
  }
  const discountScore = discountPct  // 0–100, higher = more affordable nearby

  // --- Final weighted score ---
  const score = Math.round(
    coffeeScore   * 0.30 +
    groceryScore  * 0.40 +
    discountScore * 0.30,
  )

  return {
    score,
    confidence: 'medium',  // always medium — city-level data, not postcode
    details: {
      coffee_eur:               coffeeEur,
      beer_eur:                 row?.beer_eur          ?? null,
      meal_cheap_eur:           row?.meal_cheap_eur    ?? null,
      meal_midrange_eur:        row?.meal_midrange_eur ?? null,
      grocery_index:            groceryIndex,
      supermarket_discount_pct: discountPct,
      supermarket_premium_pct:  row?.supermarket_premium_pct ?? null,
      total_supermarkets_500m:  totalSm,
      discount_supermarkets:    discountCount,
      recorded_quarter:         row?.recorded_quarter ?? null,
      sub_scores: {
        coffee:   Math.round(coffeeScore),
        grocery:  Math.round(groceryScore),
        discount: Math.round(discountScore),
      },
    },
    alerts,
  }
}
