-- Migration: 009_amenity_display_category
-- Purpose: Add display_category column to amenities table and backfill
--          from existing category values using the taxonomy defined in
--          lib/amenity-categories.ts and CHI-350.
--
-- display_category is the human-readable grouping used by the walking
-- proximity summary. Multiple OSM category values map to the same
-- display_category (e.g. 'park' and 'garden' both become 'park').
-- Unmapped categories default to 'other' and are excluded from the
-- proximity summary display.

ALTER TABLE amenities
  ADD COLUMN IF NOT EXISTS display_category TEXT NOT NULL DEFAULT 'other';

-- Backfill existing rows from the canonical mapping
UPDATE amenities
SET display_category = CASE category
  -- Daily necessities
  WHEN 'supermarket'   THEN 'supermarket'
  WHEN 'convenience'   THEN 'supermarket'
  WHEN 'grocery'       THEN 'supermarket'
  WHEN 'bakery'        THEN 'bakery'
  WHEN 'pastry'        THEN 'bakery'
  WHEN 'bank'          THEN 'bank'
  WHEN 'atm'           THEN 'bank'
  WHEN 'pharmacy'      THEN 'pharmacy'
  -- Lifestyle
  WHEN 'cafe'          THEN 'cafe'
  WHEN 'coffee_shop'   THEN 'cafe'
  WHEN 'restaurant'    THEN 'restaurant'
  WHEN 'fast_food'     THEN 'restaurant'
  WHEN 'bar'           THEN 'bar'
  WHEN 'pub'           THEN 'bar'
  WHEN 'gym'           THEN 'gym'
  WHEN 'sports_centre' THEN 'gym'
  WHEN 'swimming'      THEN 'gym'
  WHEN 'park'          THEN 'park'
  WHEN 'garden'        THEN 'park'
  WHEN 'coworking'     THEN 'coworking'
  -- Everything else → other (not surfaced in proximity summary)
  ELSE 'other'
END;

-- Index for proximity query filtering.
-- The pin API filters WHERE display_category != 'other' to exclude
-- non-summary amenities from the walking radius query.
CREATE INDEX IF NOT EXISTS amenities_display_category_idx
  ON amenities (display_category);
