'use client';

/**
 * FloodIntelligenceCard — CHI-417
 *
 * DNA Report composite card that combines, in one place:
 *   1. A static mini-map centred on the property with SNCZI flood-zone
 *      polygons overlaid (T10 red, T100 amber, T500 yellow).
 *   2. The binary Consequence Statement for this exact coordinate
 *      (via <FloodSafetySection/>).
 *   3. A plain-English Spanish insurance-impact block (CCS surcharge +
 *      insurer premium loading / availability).
 *
 * Why combine them?
 *   The buyer's three questions are "am I in a flood zone?", "what does it
 *   look like?" and "what will this cost me?". Splitting these into three
 *   cards would hide the narrative — together they form one decision unit.
 *
 * Design notes:
 *   - The mini-map is 180px tall (shorter than the amenity MiniMapCard's
 *     220px because there are no markers to read). Non-interactive.
 *   - Flood polygons fetched from /api/map/overlay/flood?bbox=... using a
 *     ~1km bbox around the coordinate. Failure is silent — the card still
 *     renders the binary result and insurance block.
 *   - Per D-035 the FloodSafetySection inside this card is still never
 *     hidden or collapsed regardless of map or overlay state.
 */

import { useEffect, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { FloodSafetySection, type FloodResult } from '@/components/map/FloodSafetySection';
import { floodInsuranceImpact } from '@/lib/flood-insurance';
import type { FloodZoneMembership } from '@/lib/consequence-statements';

export interface FloodIntelligenceCardProps {
  lat: number;
  lng: number;
  floodResult?: FloodResult;
}

// Approx metres → degrees at Spanish latitudes. Good enough for a 1km bbox.
const BBOX_HALF_M = 1000;

function bboxAround(lat: number, lng: number, halfM: number): [number, number, number, number] {
  const latRad = (lat * Math.PI) / 180;
  const dLat   = halfM / 111320;
  const dLng   = halfM / (111320 * Math.cos(latRad));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}

function membershipFrom(r?: FloodResult): FloodZoneMembership {
  if (!r) return 'none';
  if (r.in_t10)  return 'in_t10';
  if (r.in_t100) return 'in_t100';
  if (r.in_t500) return 'in_t500';
  return 'none';
}

// Left-border colour per severity — mirrors FloodSafetySection's palette so
// the insurance block visually matches the consequence block above it.
const IMPACT_STYLES = {
  green:   { border: '#34C97A', background: 'rgba(52, 201, 122, 0.08)', icon: '✓', iconColor: '#34C97A', iconBg: 'rgba(52, 201, 122, 0.15)' },
  amber:   { border: '#D4820A', background: 'rgba(212, 130, 10, 0.08)', icon: '€', iconColor: '#D4820A', iconBg: 'rgba(212, 130, 10, 0.15)' },
  red:     { border: '#C94B1A', background: 'rgba(201, 75, 26, 0.08)',  icon: '€', iconColor: '#F5A07A', iconBg: 'rgba(201, 75, 26, 0.18)'  },
  neutral: { border: '#2A4060', background: 'rgba(42, 64, 96, 0.08)',   icon: '€', iconColor: '#8A9BB0', iconBg: 'rgba(138, 155, 176, 0.12)' },
} as const;

export function FloodIntelligenceCard({ lat, lng, floodResult }: FloodIntelligenceCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<maplibregl.Map | null>(null);
  const [mapState, setMapState] = useState<'loading' | 'loaded' | 'failed'>('loading');

  // ── Initialise MapLibre + overlay flood polygons ───────────────────────────
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

      map.on('load', async () => {
        if (cancelled) return;

        // Property pin — same pulsing emerald dot used elsewhere in the DNA Report.
        const pinEl = document.createElement('div');
        pinEl.style.cssText = [
          'width:14px', 'height:14px', 'border-radius:50%',
          'background:#34C97A', 'border:2.5px solid #0D1B2A',
          'animation:pinPulse 1.8s infinite',
        ].join(';');
        new maplibregl.Marker({ element: pinEl }).setLngLat([lng, lat]).addTo(map);

        // Flood zones within the bbox. Silent failure — absent overlay should
        // never block the rest of the card from rendering.
        try {
          const [minLng, minLat, maxLng, maxLat] = bboxAround(lat, lng, BBOX_HALF_M);
          const res = await fetch(
            `/api/map/overlay/flood?bbox=${minLng},${minLat},${maxLng},${maxLat}`,
          );
          if (!res.ok) { setMapState('loaded'); return; }
          const fc = await res.json();
          if (cancelled) return;

          map.addSource('flood-zones', { type: 'geojson', data: fc });

          // Paint order matters: T500 first (broadest, lowest severity) so
          // T100 and T10 render on top where they overlap.
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
        } catch {
          // Overlay fetch failures shouldn't break the card.
        }

        setMapState('loaded');
      });
    }).catch(() => { if (!cancelled) setMapState('failed'); });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [lat, lng]);

  const membership = membershipFrom(floodResult);
  const impact     = floodInsuranceImpact(membership);
  const impactStyles = IMPACT_STYLES[impact.signal];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── Mini-map ───────────────────────────────────────────────────── */}
      <div style={{
        position:     'relative',
        height:       180,
        borderRadius: 8,
        overflow:     'hidden',
        background:   '#0D2B4E',
      }}>
        {mapState !== 'loaded' && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#4A6080', margin: 0 }}>
              {mapState === 'failed' ? 'Map unavailable' : 'Loading flood map…'}
            </p>
          </div>
        )}
        <div
          ref={containerRef}
          style={{ width: '100%', height: '100%', opacity: mapState === 'loaded' ? 1 : 0 }}
        />

        {/* Legend — only shown once map is up */}
        {mapState === 'loaded' && (
          <div style={{
            position:    'absolute',
            bottom:      8,
            left:        8,
            padding:     '6px 10px',
            background:  'rgba(13, 27, 42, 0.82)',
            borderRadius: 6,
            fontFamily:  'var(--font-dm-sans)',
            fontSize:    10,
            color:       '#C5D5E8',
            display:     'flex',
            gap:         10,
          }}>
            <span><span style={{ color: '#C94B1A' }}>■</span> T10</span>
            <span><span style={{ color: '#D4820A' }}>■</span> T100</span>
            <span><span style={{ color: '#D4D40A' }}>■</span> T500</span>
          </div>
        )}
      </div>

      {/* ── Binary consequence for this coordinate ─────────────────────── */}
      <FloodSafetySection floodResult={floodResult} />

      {/* ── Insurance impact block ─────────────────────────────────────── */}
      <section aria-label="Insurance impact">
        <p
          style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 10, letterSpacing: '0.1em', marginBottom: 8 }}
          className="uppercase text-[#8A9BB0]"
        >
          Insurance Impact
        </p>
        <div
          style={{
            borderLeft:   `3px solid ${impactStyles.border}`,
            background:   impactStyles.background,
            borderRadius: '0 8px 8px 0',
            padding:      '14px 16px',
            display:      'flex',
            gap:          14,
            alignItems:   'flex-start',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 36, height: 36, borderRadius: '50%',
              background: impactStyles.iconBg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, color: impactStyles.iconColor, flexShrink: 0, fontWeight: 700,
            }}
          >
            {impactStyles.icon}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 14, fontWeight: 600, color: '#FFFFFF', lineHeight: 1.4, marginBottom: 6 }}>
              {impact.headline}
            </p>
            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: '#C5D5E8', lineHeight: 1.6, marginBottom: impact.action ? 8 : 0 }}>
              {impact.body}
            </p>
            {impact.action && (
              <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: '#C5D5E8', lineHeight: 1.6 }}>
                {impact.action}
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
