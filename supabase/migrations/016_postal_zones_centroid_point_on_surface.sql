-- CHI-410: Rebuild postal_zones.centroid using ST_PointOnSurface.
--
-- Why ST_PointOnSurface over ST_Centroid:
--   ST_Centroid can return a coordinate OUTSIDE the polygon for concave or
--   multi-part shapes (C-shaped boundaries, doughnut holes, islands). This
--   breaks any downstream query that assumes "centroid ∈ polygon" — e.g. the
--   education-deep-dive uses centroid as the origin for the 1.5km school
--   search radius, so a bad centroid silently returns zero matches.
--   ST_PointOnSurface is guaranteed to return a point inside the polygon.
--
-- Note: 190/207 rows currently have geom polygons that are themselves corrupt
-- (outside Spain). This migration makes centroid consistent with geom but
-- does NOT fix the polygons — those require a separate re-ingest
-- (see scripts/ingest/ingest_postal_zones.py --fetch-cartociudad).

UPDATE postal_zones
SET centroid = ST_PointOnSurface(geom)
WHERE geom IS NOT NULL;
