'use client';

/**
 * NoiseExposureCard — CHI-417
 *
 * DNA Report card for environmental noise exposure. Visual identity is
 * deliberately different from the Air Quality and Flood cards — noise is a
 * continuous field over space, so the card is built around:
 *
 *   1. A thermal contour mini-map — Lden polygons from EEA / ENAIRE /
 *      modelled sources, coloured along the WHO-mapped dB gradient
 *      (55→light, 75+ → dark red).
 *   2. A horizontal dB ladder showing the reading's position relative to
 *      everyday sound references (quiet bedroom → motorway).
 *   3. A consequence block explaining the practical impact and action.
 *
 * Inputs: lat/lng + the three noise fields from /api/map/pin.
 * No emojis — all symbols are typographic (bullets, dashes, arrows).
 */

import { useEffect, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  noiseConsequence,
  DB_REFERENCE_POINTS,
  type NoiseExposure,
} from '@/lib/noise-exposure';

export interface NoiseExposureCardProps {
  lat: number;
  lng: number;
  exposure: NoiseExposure;
}

// Band → fill colour mapping for the mini-map. A perceptually-ordered
// thermal ramp: cool yellow for the lowest dB band, saturated red for 75+.
// Any future 45-50 / 50-55 bands would slot in before 55-60 with lighter
// green-yellow; the indexer returns 'transparent' for unknown labels so
// an unexpected band in the data never breaks the layer.
const BAND_FILL: Record<string, string> = {
  '55-60': '#F2D03C',
  '60-65': '#F0A236',
  '65-70': '#E06B2A',
  '70-75': '#C94B1A',
  '75+':   '#8A1A0A',
};

// Source-type → accent colour for the small legend chip on the map.
const SOURCE_ACCENT: Record<string, string> = {
  road:     '#D4820A',
  rail:     '#6B4CC9',
  airport:  '#1E7FC9',
  industry: '#8A7A4C',
};

// 1 km half-width around the coordinate — wide enough to show 2-3 bands
// of the modelled contours around typical Málaga addresses.
const BBOX_HALF_M = 1000;

function bboxAround(lat: number, lng: number, halfM: number): [number, number, number, number] {
  const latRad = (lat * Math.PI) / 180;
  const dLat   = halfM / 111320;
  const dLng   = halfM / (111320 * Math.cos(latRad));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}

// Map a dB value to a 0-1 position on the ladder — clamped at the endpoints
// so any out-of-range reading still renders at the edge rather than vanishing.
function ladderPosition(lden: number, min = 30, max = 80): number {
  return Math.max(0, Math.min(1, (lden - min) / (max - min)));
}

const CONSEQUENCE_STYLES = {
  green:   { border: '#34C97A', background: 'rgba(52, 201, 122, 0.08)', label: 'Quiet',     labelColor: '#34C97A' },
  amber:   { border: '#D4820A', background: 'rgba(212, 130, 10, 0.08)', label: 'Noticeable', labelColor: '#D4820A' },
  red:     { border: '#C94B1A', background: 'rgba(201, 75, 26, 0.08)',  label: 'Loud',       labelColor: '#F5A07A' },
  neutral: { border: '#2A4060', background: 'rgba(42, 64, 96, 0.08)',   label: 'Moderate',   labelColor: '#8A9BB0' },
} as const;

export function NoiseExposureCard({ lat, lng, exposure }: NoiseExposureCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<maplibregl.Map | null>(null);
  const [mapState, setMapState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const [hasOverlay, setHasOverlay] = useState(false);

  // ── Map + noise polygon overlay ───────────────────────────────────────────
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

        // Property pin — same pulsing emerald as other report mini-maps.
        const pinEl = document.createElement('div');
        pinEl.style.cssText = [
          'width:14px', 'height:14px', 'border-radius:50%',
          'background:#34C97A', 'border:2.5px solid #0D1B2A',
          'animation:pinPulse 1.8s infinite',
        ].join(';');
        new maplibregl.Marker({ element: pinEl }).setLngLat([lng, lat]).addTo(map);

        try {
          const [minLng, minLat, maxLng, maxLat] = bboxAround(lat, lng, BBOX_HALF_M);
          const res = await fetch(
            `/api/map/overlay/noise?bbox=${minLng},${minLat},${maxLng},${maxLat}`,
          );
          if (!res.ok) { setMapState('loaded'); return; }
          const fc = await res.json() as GeoJSON.FeatureCollection;
          if (cancelled) return;

          if (fc.features.length > 0) setHasOverlay(true);

          map.addSource('noise', { type: 'geojson', data: fc });

          // Paint bands from lowest to highest so the louder contours
          // render on top of quieter ones. A single data-driven fill layer
          // is avoided because the expression for 5 literal strings is
          // longer than five filtered layers and slower to diff.
          (['55-60', '60-65', '65-70', '70-75', '75+'] as const).forEach(band => {
            map.addLayer({
              id:     `noise-${band}`,
              type:   'fill',
              source: 'noise',
              filter: ['==', ['get', 'lden_band'], band],
              paint:  { 'fill-color': BAND_FILL[band], 'fill-opacity': 0.38 },
            });
          });
        } catch {
          /* overlay failure must not block the rest of the card */
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

  const consequence = noiseConsequence(exposure);
  const cStyles     = CONSEQUENCE_STYLES[consequence.signal];
  // Centre of the reading's band on the ladder — for 75+, treat as 77.5 so
  // the marker still lands inside the visible 30-80 dB range.
  const readingDb   = exposure.lden == null ? null
                    : exposure.lden >= 75    ? 77
                    : exposure.lden + 2;  // mid-band display; visual only
  const markerPos   = readingDb != null ? ladderPosition(readingDb) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── Section header — noise cards distinguish themselves with a
            typographic marker instead of the section label used by Flood/AQ. */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <p
          style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 10, letterSpacing: '0.1em', margin: 0 }}
          className="uppercase text-[#8A9BB0]"
        >
          Noise Exposure
        </p>
        {exposure.source_type && (
          <span style={{
            fontFamily:  'var(--font-dm-sans)',
            fontSize:    10,
            letterSpacing: '0.08em',
            color:       SOURCE_ACCENT[exposure.source_type] ?? '#8A9BB0',
            textTransform: 'uppercase',
          }}>
            {exposure.source_type === 'road'     ? 'Dominant source: road'
             : exposure.source_type === 'rail'    ? 'Dominant source: rail'
             : exposure.source_type === 'airport' ? 'Dominant source: aircraft'
             : 'Dominant source: industry'}
          </span>
        )}
      </div>

      {/* ── Mini-map with thermal contour overlay ─────────────────────── */}
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
              {mapState === 'failed' ? 'Map unavailable' : 'Loading noise contours…'}
            </p>
          </div>
        )}
        <div
          ref={containerRef}
          style={{ width: '100%', height: '100%', opacity: mapState === 'loaded' ? 1 : 0 }}
        />

        {/* Thermal ramp legend — only shown once overlay successfully loaded */}
        {mapState === 'loaded' && hasOverlay && (
          <div style={{
            position:    'absolute',
            bottom:      8,
            left:        8,
            right:       8,
            padding:     '6px 10px',
            background:  'rgba(13, 27, 42, 0.85)',
            borderRadius: 6,
            fontFamily:  'var(--font-dm-sans)',
            fontSize:    10,
            color:       '#C5D5E8',
            display:     'flex',
            justifyContent: 'space-between',
            alignItems:  'center',
          }}>
            <span style={{ letterSpacing: '0.05em' }}>Lden</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['55-60', '60-65', '65-70', '70-75', '75+'] as const).map(band => (
                <span key={band} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{
                    display: 'inline-block', width: 10, height: 10, borderRadius: 2,
                    background: BAND_FILL[band],
                  }} />
                  <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 10 }}>{band}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── dB ladder — the defining noise-card visual ────────────────── */}
      <div style={{
        padding:    '14px 16px',
        borderRadius: 8,
        background: 'rgba(42, 64, 96, 0.04)',
        border:     '1px solid rgba(42, 64, 96, 0.15)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, color: '#8A9BB0', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Everyday sound reference
          </span>
          {readingDb != null && (
            <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 12, color: '#FFFFFF', fontWeight: 600 }}>
              {exposure.band} dB Lden
            </span>
          )}
        </div>

        {/* The ladder bar — gradient from cool yellow through saturated red
            mirrors the map's thermal ramp so both elements tell the same
            story. A tick is placed for each DB_REFERENCE_POINTS entry, and
            a white vertical marker is drawn at the reading's position. */}
        <div style={{ position: 'relative', height: 10, borderRadius: 5,
          background: 'linear-gradient(90deg, #2A4060 0%, #2A4060 8%, #F2D03C 50%, #E06B2A 72%, #8A1A0A 100%)',
        }}>
          {markerPos != null && (
            <>
              <div style={{
                position: 'absolute',
                left:     `calc(${(markerPos * 100).toFixed(1)}% - 1px)`,
                top:      -4,
                width:    2,
                height:   18,
                background: '#FFFFFF',
                boxShadow: '0 0 0 1px rgba(13, 27, 42, 0.9)',
              }} />
              <div style={{
                position: 'absolute',
                left:     `calc(${(markerPos * 100).toFixed(1)}% - 14px)`,
                top:      -20,
                width:    28,
                textAlign: 'center',
                fontFamily: 'var(--font-dm-mono)',
                fontSize:   9,
                color:      '#FFFFFF',
              }}>
                HERE
              </div>
            </>
          )}
        </div>

        {/* Tick labels — every 10 dB */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
          {DB_REFERENCE_POINTS.filter((_, i) => i % 2 === 0).map(p => (
            <span key={p.lden} style={{
              fontFamily: 'var(--font-dm-mono)',
              fontSize:   9,
              color:      '#8A9BB0',
            }}>
              {p.lden}
            </span>
          ))}
        </div>

        {/* Reading-aligned reference — the dB value's own "everyday sound" label */}
        <p style={{
          fontFamily: 'var(--font-dm-sans)',
          fontSize:   11,
          color:      '#C5D5E8',
          marginTop:  10,
          lineHeight: 1.5,
        }}>
          <span style={{ color: '#8A9BB0' }}>Equivalent to: </span>
          <span style={{ color: '#FFFFFF' }}>{consequence.reference}</span>
        </p>
      </div>

      {/* ── Consequence block ─────────────────────────────────────────── */}
      <div
        style={{
          borderLeft:   `3px solid ${cStyles.border}`,
          background:   cStyles.background,
          borderRadius: '0 8px 8px 0',
          padding:      '14px 16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
          <span style={{
            fontFamily:  'var(--font-dm-sans)',
            fontSize:    10,
            fontWeight:  700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color:       cStyles.labelColor,
          }}>
            {cStyles.label}
          </span>
          <span style={{ color: '#4A6080', fontSize: 11 }}>—</span>
          <span style={{
            fontFamily: 'var(--font-dm-sans)',
            fontSize:   14,
            fontWeight: 600,
            color:      '#FFFFFF',
            lineHeight: 1.3,
          }}>
            {consequence.title}
          </span>
        </div>
        <p style={{
          fontFamily: 'var(--font-dm-sans)',
          fontSize:   13,
          color:      '#C5D5E8',
          lineHeight: 1.6,
          margin:     0,
        }}>
          {consequence.body}
        </p>
        {consequence.action && (
          <p style={{
            fontFamily: 'var(--font-dm-sans)',
            fontSize:   13,
            color:      '#C5D5E8',
            lineHeight: 1.6,
            marginTop:  8,
            marginBottom: 0,
          }}>
            {consequence.action}
          </p>
        )}
      </div>
    </div>
  );
}
