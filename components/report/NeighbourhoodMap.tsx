'use client';

/**
 * NeighbourhoodMap — single shared map for the DNA Report Environment
 * section. Replaces the three per-card MapLibre instances that used to live
 * inside FloodIntelligenceCard, NoiseExposureCard, and the MiniMapCard
 * rendered under Life Proximity.
 *
 * One map instance, three toggle-able layers:
 *   - 'flood'     → SNCZI T10 / T100 / T500 polygons
 *   - 'noise'     → EEA / ENAIRE / model-MVP Lden contour bands
 *   - 'amenities' → 400m radius ring + emoji markers per category
 *
 * The map itself stays mounted; only layer visibility + source data change on
 * toggle. Failures per overlay are silent — an overlay that 404s simply shows
 * no polygons rather than breaking the whole map.
 */

import { useEffect, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';

export type NeighbourhoodMapLayer = 'flood' | 'noise' | 'amenities';

export interface NeighbourhoodMapProps {
  lat:          number;
  lng:          number;
  activeLayer:  NeighbourhoodMapLayer;
  onLayerChange: (layer: NeighbourhoodMapLayer) => void;
}

// Bbox halfsize used by the flood + noise overlays — 1km matches what the
// per-card maps used to request, so we can reuse the same endpoints verbatim.
const BBOX_HALF_M = 1000;

function bboxAround(lat: number, lng: number, halfM: number): [number, number, number, number] {
  const latRad = (lat * Math.PI) / 180;
  const dLat   = halfM / 111320;
  const dLng   = halfM / (111320 * Math.cos(latRad));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}

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
    type:     'Feature' as const,
    geometry: { type: 'Polygon' as const, coordinates: [coords] },
    properties: {},
  };
}

// Layer id lists per category — used to show/hide in bulk without tearing down.
const FLOOD_LAYER_IDS     = ['flood-t500-fill', 'flood-t100-fill', 'flood-t10-fill'];
const NOISE_BANDS         = ['55-60', '60-65', '65-70', '70-75', '75+'] as const;
const NOISE_LAYER_IDS     = NOISE_BANDS.map(b => `noise-${b}`);
const AMENITY_LAYER_IDS   = ['radius-fill', 'radius-stroke'];

const BAND_FILL: Record<string, string> = {
  '55-60': '#F2D03C',
  '60-65': '#F0A236',
  '65-70': '#E06B2A',
  '70-75': '#C94B1A',
  '75+':   '#8A1A0A',
};

// Amenity category display config — mirrors MiniMapCard.
const AMENITY_CATEGORIES = {
  schools:     { emoji: '🏫', max: 3 },
  health:      { emoji: '🏥', max: 2 },
  transport:   { emoji: '🚌', max: 3 },
  supermarket: { emoji: '🛒', max: 2 },
  park:        { emoji: '🌳', max: 2 },
  pharmacy:    { emoji: '💊', max: 1 },
} as const;

type AmenityCategory = keyof typeof AMENITY_CATEGORIES;

interface AmenityFeature {
  geometry:   { coordinates: [number, number] };
  properties: { name: string; distance_m: number };
}
type AmenitiesResponse = Partial<Record<AmenityCategory, AmenityFeature[]>>;

export function NeighbourhoodMap({ lat, lng, activeLayer, onLayerChange }: NeighbourhoodMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<maplibregl.Map | null>(null);
  const amenityMarkersRef = useRef<maplibregl.Marker[]>([]);
  const layerStateRef = useRef<{ flood: boolean; noise: boolean; amenities: boolean }>({
    flood: false, noise: false, amenities: false,
  });

  const [mapState, setMapState] = useState<'loading' | 'loaded' | 'failed'>('loading');

  // ── Init map once per coordinate ─────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    import('maplibre-gl').then(({ default: maplibregl }) => {
      if (cancelled || !containerRef.current) return;

      const map = new maplibregl.Map({
        container:          containerRef.current,
        style:              'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        center:             [lng, lat],
        zoom:               14,
        interactive:        false,
        attributionControl: false,
      });
      mapRef.current = map;

      map.on('error', () => { if (!cancelled) setMapState('failed'); });

      map.on('load', () => {
        if (cancelled) return;

        // Property centre pin — pulsing emerald, matches other report maps.
        const pinEl = document.createElement('div');
        pinEl.style.cssText = [
          'width:14px', 'height:14px', 'border-radius:50%',
          'background:#34C97A', 'border:2.5px solid #0D1B2A',
          'animation:pinPulse 1.8s infinite',
        ].join(';');
        new maplibregl.Marker({ element: pinEl }).setLngLat([lng, lat]).addTo(map);

        setMapState('loaded');
      });
    }).catch(() => { if (!cancelled) setMapState('failed'); });

    return () => {
      cancelled = true;
      amenityMarkersRef.current.forEach(m => m.remove());
      amenityMarkersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
      layerStateRef.current = { flood: false, noise: false, amenities: false };
    };
  }, [lat, lng]);

  // ── Load active overlay on demand ────────────────────────────────────────
  // Each overlay is loaded once, lazily, the first time its layer becomes
  // active. After that we just toggle visibility. This keeps initial map
  // load snappy and avoids fetching data the user never looks at.
  useEffect(() => {
    if (mapState !== 'loaded') return;
    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;

    async function ensureFlood() {
      if (layerStateRef.current.flood) return;
      try {
        const [minLng, minLat, maxLng, maxLat] = bboxAround(lat, lng, BBOX_HALF_M);
        const res = await fetch(`/api/map/overlay/flood?bbox=${minLng},${minLat},${maxLng},${maxLat}`);
        if (!res.ok || cancelled || !map) return;
        const fc = await res.json();
        if (cancelled) return;

        map.addSource('flood-zones', { type: 'geojson', data: fc });
        map.addLayer({
          id: 'flood-t500-fill', type: 'fill', source: 'flood-zones',
          filter: ['==', ['get', 'risk_level'], 'T500'],
          paint:  { 'fill-color': '#D4D40A', 'fill-opacity': 0.18 },
        });
        map.addLayer({
          id: 'flood-t100-fill', type: 'fill', source: 'flood-zones',
          filter: ['==', ['get', 'risk_level'], 'T100'],
          paint:  { 'fill-color': '#D4820A', 'fill-opacity': 0.28 },
        });
        map.addLayer({
          id: 'flood-t10-fill', type: 'fill', source: 'flood-zones',
          filter: ['==', ['get', 'risk_level'], 'T10'],
          paint:  { 'fill-color': '#C94B1A', 'fill-opacity': 0.38 },
        });
        layerStateRef.current.flood = true;
      } catch { /* silent — map still renders without overlay */ }
    }

    async function ensureNoise() {
      if (layerStateRef.current.noise) return;
      try {
        const [minLng, minLat, maxLng, maxLat] = bboxAround(lat, lng, BBOX_HALF_M);
        const res = await fetch(`/api/map/overlay/noise?bbox=${minLng},${minLat},${maxLng},${maxLat}`);
        if (!res.ok || cancelled || !map) return;
        const fc = await res.json();
        if (cancelled) return;

        map.addSource('noise-zones', { type: 'geojson', data: fc });
        for (const band of NOISE_BANDS) {
          map.addLayer({
            id:     `noise-${band}`,
            type:   'fill',
            source: 'noise-zones',
            filter: ['==', ['get', 'lden_band'], band],
            paint:  { 'fill-color': BAND_FILL[band], 'fill-opacity': 0.38 },
          });
        }
        layerStateRef.current.noise = true;
      } catch { /* silent */ }
    }

    async function ensureAmenities() {
      if (layerStateRef.current.amenities) return;
      if (!map) return;

      // 400m radius ring — identical to MiniMapCard's styling.
      map.addSource('radius-circle', { type: 'geojson', data: circleGeoJSON(lat, lng, 400) });
      map.addLayer({
        id: 'radius-fill', type: 'fill', source: 'radius-circle',
        paint: { 'fill-color': '#34C97A', 'fill-opacity': 0.08 },
      });
      map.addLayer({
        id: 'radius-stroke', type: 'line', source: 'radius-circle',
        paint: { 'line-color': '#34C97A', 'line-width': 2, 'line-dasharray': [4, 3] },
      });

      // Fetch + render emoji amenity markers.
      try {
        const res = await fetch(`/api/map/amenities?lat=${lat}&lng=${lng}&radius=400`);
        if (!res.ok || cancelled) return;
        const data = await res.json() as AmenitiesResponse;
        if (cancelled) return;

        const { default: maplibregl } = await import('maplibre-gl');
        (Object.entries(AMENITY_CATEGORIES) as [AmenityCategory, typeof AMENITY_CATEGORIES[AmenityCategory]][])
          .forEach(([key, cfg]) => {
            (data[key] ?? []).slice(0, cfg.max).forEach(feature => {
              const [fLng, fLat] = feature.geometry.coordinates;
              const el = document.createElement('div');
              el.className        = 'map-pin-icon';
              el.style.background = '#0D1B2A';
              el.textContent      = cfg.emoji;
              const marker = new maplibregl.Marker({ element: el }).setLngLat([fLng, fLat]).addTo(map);
              amenityMarkersRef.current.push(marker);
            });
          });
      } catch { /* silent */ }

      layerStateRef.current.amenities = true;
    }

    // Ensure active layer's data is loaded, then toggle visibility for all three.
    (async () => {
      if (activeLayer === 'flood')     await ensureFlood();
      if (activeLayer === 'noise')     await ensureNoise();
      if (activeLayer === 'amenities') await ensureAmenities();
      if (cancelled || !mapRef.current) return;

      const setVis = (ids: string[], visible: boolean) => {
        for (const id of ids) {
          if (mapRef.current!.getLayer(id)) {
            mapRef.current!.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
          }
        }
      };
      setVis(FLOOD_LAYER_IDS,   activeLayer === 'flood');
      setVis(NOISE_LAYER_IDS,   activeLayer === 'noise');
      setVis(AMENITY_LAYER_IDS, activeLayer === 'amenities');

      // Amenity emoji markers are HTMLElements, not style layers — toggle via display.
      for (const marker of amenityMarkersRef.current) {
        marker.getElement().style.display = activeLayer === 'amenities' ? '' : 'none';
      }
    })();

    return () => { cancelled = true; };
  }, [activeLayer, mapState, lat, lng]);

  const tabs: Array<{ key: NeighbourhoodMapLayer; label: string }> = [
    { key: 'flood',     label: 'Flood'     },
    { key: 'noise',     label: 'Noise'     },
    { key: 'amenities', label: 'Amenities' },
  ];

  return (
    <div>
      {/* ── Layer toggle — small pill group, mirrors existing dark navy chips ─ */}
      <div style={{
        display: 'flex',
        gap:     6,
        marginBottom: 10,
        flexWrap: 'wrap',
      }}>
        {tabs.map(t => {
          const active = t.key === activeLayer;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onLayerChange(t.key)}
              style={{
                fontFamily:    'var(--font-dm-sans)',
                fontSize:      12,
                fontWeight:    active ? 600 : 500,
                letterSpacing: '0.02em',
                padding:       '6px 14px',
                borderRadius:  20,
                border:        '1px solid var(--border)',
                background:    active ? 'var(--navy-deep)' : 'var(--surface-2)',
                color:         active ? '#FFFFFF' : 'var(--text-mid)',
                cursor:        'pointer',
                transition:    'background 150ms, color 150ms',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ── Map canvas ───────────────────────────────────────────────────── */}
      <div style={{
        position:     'relative',
        height:       220,
        borderRadius: 10,
        overflow:     'hidden',
        background:   '#0D2B4E',
      }}>
        {mapState !== 'loaded' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#4A6080', margin: 0 }}>
              {mapState === 'failed' ? 'Map unavailable' : 'Loading neighbourhood map…'}
            </p>
          </div>
        )}
        <div ref={containerRef} style={{ width: '100%', height: '100%', opacity: mapState === 'loaded' ? 1 : 0 }} />

        {/* Legend — per active layer */}
        {mapState === 'loaded' && activeLayer === 'flood' && (
          <MapLegend items={[
            { color: '#C94B1A', label: 'T10'  },
            { color: '#D4820A', label: 'T100' },
            { color: '#D4D40A', label: 'T500' },
          ]} />
        )}
        {mapState === 'loaded' && activeLayer === 'noise' && (
          <MapLegend items={NOISE_BANDS.map(b => ({ color: BAND_FILL[b], label: b }))} />
        )}
      </div>
    </div>
  );
}

function MapLegend({ items }: { items: Array<{ color: string; label: string }> }) {
  return (
    <div style={{
      position:     'absolute',
      bottom:       8,
      left:         8,
      padding:      '6px 10px',
      background:   'rgba(13, 27, 42, 0.82)',
      borderRadius: 6,
      fontFamily:   'var(--font-dm-sans)',
      fontSize:     10,
      color:        '#C5D5E8',
      display:      'flex',
      gap:          10,
    }}>
      {items.map(i => (
        <span key={i.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: i.color }} />
          <span style={{ fontFamily: 'var(--font-dm-mono)' }}>{i.label}</span>
        </span>
      ))}
    </div>
  );
}
