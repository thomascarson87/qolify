-- Migration 012 — saved_pins table
-- Allows authenticated users to save coordinate pin drops, name them,
-- and optionally attach Idealista/Fotocasa listing URLs to a location.
-- RLS: users can only read and write their own pins.

CREATE TABLE saved_pins (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  lat          DECIMAL(10,7) NOT NULL,
  lng          DECIMAL(10,7) NOT NULL,
  geom         GEOGRAPHY(POINT, 4326) NOT NULL,
  name         TEXT        NOT NULL DEFAULT 'Unnamed pin',
  address      TEXT,                          -- geocoded place_name or user-supplied
  notes        TEXT,
  listing_urls TEXT[]      NOT NULL DEFAULT '{}',  -- Idealista/Fotocasa URLs attached
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX saved_pins_user_idx  ON saved_pins (user_id, created_at DESC);
CREATE INDEX saved_pins_geom_idx  ON saved_pins USING GIST (geom);

ALTER TABLE saved_pins ENABLE ROW LEVEL SECURITY;

-- Users can read, insert, update, and delete only their own pins.
CREATE POLICY "saved_pins_owner" ON saved_pins
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
