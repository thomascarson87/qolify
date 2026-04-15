'use client';

/**
 * MiniMapCard — static 220px map infographic card for DNA Report Section 4.
 *
 * NOT interactive — no pan, zoom, or click handlers.
 * Fixed height 220px. Pulsing emerald pin. 400m dashed radius circle.
 * Emoji HTML markers per amenity category (not MapLibre symbol layers).
 * Chip row below renders even if MapLibre fails to initialise.
 *
 * Per INDICATOR_CARD_SPEC.md §4.
 */

import { useEffect, useRef, useState } from 'react';

export interface MiniMapCardProps {
  lat: number;
  lng: number;
}

// Amenity category display config per INDICATOR_CARD_SPEC.md §4.2
const CATEGORY_CONFIG = {
  schools:     { emoji: '🏫', label: 'School',     max: 3 },
  health:      { emoji: '🏥', label: 'Health',      max: 2 },
  transport:   { emoji: '🚌', label: 'Transport',   max: 3 },
  supermarket: { emoji: '🛒', label: 'Supermarket', max: 2 },
  park:        { emoji: '🌳', label: 'Park',         max: 2 },
  pharmacy:    { emoji: '💊', label: 'Pharmacy',     max: 1 },
  // cafe: excluded from markers (too noisy); restaurant: excluded per spec
} as const;

type Category = keyof typeof CATEGORY_CONFIG;

interface AmenityFeature {
  geometry:   { coordinates: [number, number] };
  properties: { name: string; distance_m: number };
}

interface AmenitiesResponse {
  schools?:     AmenityFeature[];
  health?:      AmenityFeature[];
  transport?:   AmenityFeature[];
  supermarket?: AmenityFeature[];
  park?:        AmenityFeature[];
  pharmacy?:    AmenityFeature[];
}

/**
 * Build a GeoJSON polygon approximating a circle of `radiusM` metres
 * around a lat/lng point. Used for the 400m radius ring on the map.
 * Degree offsets derived from standard lat/lng ↔ metres conversions.
 */
function circleGeoJSON(lat: number, lng: number, radiusM: number, steps = 64) {
  const latRad = (lat * Math.PI) / 180;
  const dLat   = radiusM / 111320;
  const dLng   = radiusM / (111320 * Math.cos(latRad));
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(angle), lat + dLat * Math.sin(angle)]);
  }
  return {
    type:     'Feature'  as const,
    geometry: { type: 'Polygon' as const, coordinates: [coords] },
    properties: {},
  };
}

export function MiniMapCard({ lat, lng }: MiniMapCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<maplibregl.Map | null>(null);
  // Tracks amenity markers separately from the centre pin so cleanup is targeted
  const markersRef   = useRef<maplibregl.Marker[]>([]);

  const [mapState,  setMapState]  = useState<'loading' | 'loaded' | 'failed'>('loading');
  const [amenities, setAmenities] = useState<AmenitiesResponse | null>(null);

  // ── Fetch amenities ───────────────────────────────────────────────────────
  // Runs on mount and whenever coordinates change.
  useEffect(() => {
    fetch(`/api/map/amenities?lat=${lat}&lng=${lng}&radius=400`)
      .then(r => r.ok ? r.json() as Promise<AmenitiesResponse> : null)
      .then(data => setAmenities(data))
      .catch(() => setAmenities(null));
  }, [lat, lng]);

  // ── Initialise MapLibre (dynamic import keeps SSR clean) ──────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    // Guard against state updates after unmount or coordinate change
    let cancelled = false;

    import('maplibre-gl').then(({ default: maplibregl }) => {
      if (cancelled || !containerRef.current) return;

      const map = new maplibregl.Map({
        container:          containerRef.current,
        style:              'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        center:             [lng, lat],
        zoom:               15,
        interactive:        false,  // single flag disables ALL pan/zoom/click interactions
        attributionControl: false,
      });

      mapRef.current = map;

      map.on('load', () => {
        if (cancelled) return;

        // 400m radius circle — emerald 8% fill, 2px dashed stroke
        map.addSource('radius-circle', {
          type: 'geojson',
          data: circleGeoJSON(lat, lng, 400),
        });
        map.addLayer({
          id:     'radius-fill',
          type:   'fill',
          source: 'radius-circle',
          paint:  { 'fill-color': '#34C97A', 'fill-opacity': 0.08 },
        });
        map.addLayer({
          id:     'radius-stroke',
          type:   'line',
          source: 'radius-circle',
          paint:  {
            'line-color':     '#34C97A',
            'line-width':     2,
            'line-dasharray': [4, 3],
          },
        });

        // Pulsing emerald centre pin — identical pattern to MapClient.tsx
        const pinEl = document.createElement('div');
        pinEl.style.cssText = [
          'width:14px', 'height:14px', 'border-radius:50%',
          'background:#34C97A', 'border:2.5px solid #0D1B2A',
          'animation:pinPulse 1.8s infinite',
        ].join(';');
        new maplibregl.Marker({ element: pinEl })
          .setLngLat([lng, lat])
          .addTo(map);

        setMapState('loaded');
      });

      map.on('error', () => { if (!cancelled) setMapState('failed'); });
    }).catch(() => { if (!cancelled) setMapState('failed'); });

    return () => {
      cancelled = true;
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [lat, lng]);

  // ── Add amenity emoji markers once both map and data are ready ────────────
  useEffect(() => {
    if (mapState !== 'loaded' || !amenities || !mapRef.current) return;

    import('maplibre-gl').then(({ default: maplibregl }) => {
      const map = mapRef.current;
      if (!map) return;

      // Clear previous amenity markers (the centre pin is managed separately)
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];

      (Object.entries(CATEGORY_CONFIG) as [Category, typeof CATEGORY_CONFIG[Category]][])
        .forEach(([key, cfg]) => {
          (amenities[key] ?? []).slice(0, cfg.max).forEach(feature => {
            const [fLng, fLat] = feature.geometry.coordinates;
            const el = document.createElement('div');
            el.className        = 'map-pin-icon';
            el.style.background = '#0D1B2A';
            el.textContent      = cfg.emoji;
            const marker = new maplibregl.Marker({ element: el })
              .setLngLat([fLng, fLat])
              .addTo(map);
            markersRef.current.push(marker);
          });
        });
    });
  }, [mapState, amenities]);

  // ── Build chip list ───────────────────────────────────────────────────────
  // Sorted by distance. Renders regardless of map state per spec §4.3 point 5.
  const chips: Array<{ emoji: string; name: string; distance: number }> = [];
  if (amenities) {
    (Object.entries(CATEGORY_CONFIG) as [Category, typeof CATEGORY_CONFIG[Category]][])
      .forEach(([key, cfg]) => {
        (amenities[key] ?? []).slice(0, cfg.max).forEach(f => {
          chips.push({
            emoji:    cfg.emoji,
            name:     f.properties.name || cfg.label,
            distance: Math.round(f.properties.distance_m),
          });
        });
      });
    chips.sort((a, b) => a.distance - b.distance);
  }

  return (
    <div>
      {/* ── Map container — fixed 220px, never taller/shorter ────────────── */}
      <div style={{
        position:     'relative',
        height:       220,
        borderRadius: 8,
        overflow:     'hidden',
        background:   '#0D2B4E',
      }}>
        {/* LOADING state */}
        {mapState === 'loading' && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#4A6080', margin: 0 }}>
              Loading area map…
            </p>
          </div>
        )}

        {/* FAILED state — chip row below still renders with amenity data */}
        {mapState === 'failed' && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#4A6080', margin: 0 }}>
              Map unavailable
            </p>
          </div>
        )}

        {/*
          MapLibre renders into this div.
          visibility:hidden (not display:none) — preserves container dimensions
          so MapLibre can measure them correctly on init, avoiding blank canvas.
        */}
        <div
          ref={containerRef}
          style={{
            width:      '100%',
            height:     '100%',
            visibility: mapState === 'loaded' ? 'visible' : 'hidden',
          }}
        />
      </div>

      {/* ── Chip row — horizontal scroll, renders regardless of map state ── */}
      {chips.length > 0 && (
        <div style={{
          display:        'flex',
          gap:            6,
          overflowX:      'auto',
          paddingTop:     10,
          paddingBottom:  2,
          scrollbarWidth: 'none',
        }}>
          {chips.map((chip, i) => (
            <div
              key={i}
              style={{
                flexShrink:   0,
                display:      'flex',
                alignItems:   'center',
                gap:          4,
                background:   'rgba(255,255,255,0.04)',
                border:       '1px solid #1E3050',
                borderRadius: 20,
                padding:      '4px 10px',
                fontFamily:   'var(--font-dm-sans)',
                fontSize:     11,
                color:        '#C5D5E8',
                whiteSpace:   'nowrap',
              }}
            >
              <span>{chip.emoji}</span>
              {/* Distance in DM Mono per design token spec */}
              <span style={{ fontFamily: 'var(--font-dm-mono)' }}>{chip.distance}m</span>
            </div>
          ))}
        </div>
      )}

      {/* No amenities — only shown once fetch has resolved (amenities !== null guard) */}
      {amenities !== null && chips.length === 0 && (
        <p style={{
          fontFamily: 'var(--font-dm-sans)',
          fontSize:   12,
          color:      '#4A6080',
          paddingTop: 8,
          margin:     0,
        }}>
          No amenities found within 400m.
        </p>
      )}
    </div>
  );
}
