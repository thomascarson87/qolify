'use client';

/**
 * NeighbourhoodIntel — renders two adjacent DNA Report sections:
 *
 *   • Neighbourhood Intelligence — Area Overview (AI paragraph) + a single
 *     inline VUT line (tourist-rental licence count within 200m), per the
 *     analysis-page-UX-restructure: Community Character is no longer its
 *     own section.
 *
 *   • Environment — one shared <NeighbourhoodMap/> (flood/noise/amenities
 *     layer switcher) followed by three collapsed-by-default sub-cards:
 *     Flood, Noise, Air Quality.
 *
 * Data sources (unchanged from previous revision):
 *   - POST /api/map/pin          → flood + vut_count_200m + noise + air_quality
 *   - GET  /api/map/zone/{cp}    → zone context (TVI, avg price) for AI input
 *   - generateAreaSummary()      → Claude summary using the two above as input
 *
 * See previous file header for rationale on client-side fetching.
 */

import { useEffect, useRef, useState } from 'react';
import { FloodIntelligenceCard } from '@/components/report/FloodIntelligenceCard';
import { NoiseExposureCard } from '@/components/report/NoiseExposureCard';
import { AirQualityCard } from '@/components/report/AirQualityCard';
import { AreaSummarySection } from '@/components/map/AreaSummarySection';
import { NeighbourhoodMap, type NeighbourhoodMapLayer } from '@/components/report/NeighbourhoodMap';
import { generateAreaSummary, type AreaSummaryInput } from '@/app/actions/generateAreaSummary';

interface ZoneSummary {
  zone_tvi:          number;
  school_score_norm: number;
  flood_risk_score:  number;
  has_t10_flood:     boolean;
  price_context:     { avg_price_sqm: number; sample_count: number } | null;
  signals:           string[] | null;
  municipio:         string | null;
}

interface PinFetch {
  flood: { in_t10: boolean; in_t100: boolean; in_t500: boolean };
  vut_count_200m: number;
  facilities: {
    school_primary_count: number;
    school_nearest_m:     number;
    gp_count:             number;
    supermarket_count:    number;
    park_count:           number;
  };
  fibre: { coverage_type: string } | null;
  codigo_postal: string | null;
  noise?: {
    lden:        number | null;
    band:        string | null;
    source_type: 'road' | 'rail' | 'airport' | 'industry' | null;
  };
  air_quality?: {
    station_name:   string;
    municipio_name: string | null;
    distance_m:     number | null;
    aqi_value:      number | null;
    aqi_category:   string | null;
    aqi_annual_avg: number | null;
    aqi_trend_12m:  number | null;
    pm25_ugm3:      number | null;
    pm10_ugm3:      number | null;
    no2_ugm3:       number | null;
    o3_ugm3:        number | null;
    so2_ugm3:       number | null;
    co_mgm3:        number | null;
    reading_at:     string | null;
  } | null;
}

interface NeighbourhoodIntelProps {
  lat:            number;
  lng:            number;
  codigoPostal?:  string | null;
  municipio?:     string | null;
  priceAsking?:   number | null;
  areaSqm?:       number | null;
}

function gradeLetter(score: number): string {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

// Merged VUT line — replaces the old standalone Community Character section.
// Tone + copy match the prior CommunityCharacterTriage green/amber/red bands.
function vutLineCopy(n: number): { dot: string; text: string } {
  if (n <= 3)  return { dot: '#34C97A', text: `${n} active tourist-rental licences within 200m — predominantly residential.` };
  if (n <= 10) return { dot: '#D4820A', text: `${n} active tourist-rental licences within 200m — moderate tourist activity.` };
  return            { dot: '#C94B1A', text: `${n} active tourist-rental licences within 200m — high tourist-rental density.` };
}

function SectionShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 20, boxShadow: 'var(--shadow-sm)' }}>
      {children}
    </div>
  );
}

export function NeighbourhoodIntel({
  lat: latRaw, lng: lngRaw, codigoPostal, municipio, priceAsking, areaSqm,
}: NeighbourhoodIntelProps) {
  const lat = typeof latRaw === 'number' ? latRaw : Number(latRaw);
  const lng = typeof lngRaw === 'number' ? lngRaw : Number(lngRaw);
  const coordsValid = Number.isFinite(lat) && Number.isFinite(lng);

  const [pin,            setPin]            = useState<PinFetch | null>(null);
  const [pinLoading,     setPinLoading]     = useState(true);
  const [pinError,       setPinError]       = useState(false);

  const [areaSummary,    setAreaSummary]    = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  // Active layer for the shared Environment map. Starts on flood — the most
  // safety-critical overlay, per D-035 (flood always leads the Environment
  // story). User can switch to noise or amenities at any time.
  const [mapLayer, setMapLayer] = useState<NeighbourhoodMapLayer>('flood');

  const firedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!coordsValid) return;
    const key = `${lat.toFixed(5)}_${lng.toFixed(5)}`;
    if (firedKey.current === key) return;
    firedKey.current = key;

    setPinLoading(true);
    setPinError(false);
    setSummaryLoading(true);
    setPin(null);
    setAreaSummary(null);

    const pinPromise = fetch('/api/map/pin', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat, lng,
        price_asking: priceAsking ?? null,
        area_sqm:     areaSqm     ?? null,
      }),
    })
      .then(r => r.ok ? r.json() as Promise<PinFetch> : null)
      .catch(() => null);

    const postcode = codigoPostal ?? null;
    const zonePromise: Promise<ZoneSummary | null> = postcode
      ? fetch(`/api/map/zone/${postcode}`)
          .then(r => r.ok ? r.json() as Promise<ZoneSummary> : null)
          .catch(() => null)
      : Promise.resolve(null);

    Promise.all([pinPromise, zonePromise])
      .then(async ([pinData, zoneData]) => {
        if (!pinData) {
          setPinError(true);
          setPinLoading(false);
          setSummaryLoading(false);
          return;
        }

        setPin(pinData);
        setPinLoading(false);

        const floodStatus: AreaSummaryInput['floodStatus'] =
          pinData.flood.in_t10  ? 't10'  :
          pinData.flood.in_t100 ? 't100' :
          pinData.flood.in_t500 ? 't500' : 'safe';

        const input: AreaSummaryInput = {
          floodStatus,
          schoolCount:      pinData.facilities.school_primary_count,
          nearestSchoolM:   pinData.facilities.school_nearest_m,
          gpCount:          pinData.facilities.gp_count,
          supermarketCount: pinData.facilities.supermarket_count,
          parkCount:        pinData.facilities.park_count,
          vutCount:         pinData.vut_count_200m,
          zoneScore:        zoneData?.zone_tvi != null ? Math.round(zoneData.zone_tvi)  : null,
          zoneGrade:        zoneData?.zone_tvi != null ? gradeLetter(zoneData.zone_tvi) : null,
          priceSqm:         zoneData?.price_context?.avg_price_sqm ?? null,
          fibreStatus:      pinData.fibre?.coverage_type ?? null,
          postcode:         postcode ?? '',
          city:             zoneData?.municipio ?? municipio ?? 'Málaga',
        };

        try {
          const text = await generateAreaSummary(input);
          setAreaSummary(text);
        } catch {
          /* silent — section renders without summary */
        } finally {
          setSummaryLoading(false);
        }
      });
  }, [coordsValid, lat, lng, codigoPostal, municipio, priceAsking, areaSqm]);

  if (!coordsValid) return null;

  const vutLine = pin ? vutLineCopy(pin.vut_count_200m) : null;

  return (
    <>
      {/* ── Neighbourhood Intelligence ─────────────────────────────────── */}
      <section id="neighbourhood" style={{ marginBottom: 48, scrollMarginTop: 140 }}>
        <h2 style={{ fontFamily: 'var(--font-playfair)', fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
          Neighbourhood Intelligence
        </h2>
        <p style={{ fontFamily: 'var(--font-playfair)', fontStyle: 'italic', fontSize: 16, color: 'var(--text-mid)', marginBottom: 24 }}>
          What the street feels like.
        </p>

        {(summaryLoading || areaSummary || vutLine) && (
          <SectionShell>
            {(summaryLoading || areaSummary) && (
              <AreaSummarySection tone="light" loading={summaryLoading} summary={areaSummary} />
            )}

            {/* VUT line — merged from the former Community Character section.
                Renders as a single dot + sentence beneath the AI paragraph. */}
            {vutLine && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                marginTop: (summaryLoading || areaSummary) ? 14 : 0,
                paddingTop: (summaryLoading || areaSummary) ? 14 : 0,
                borderTop: (summaryLoading || areaSummary) ? '1px solid var(--border)' : 'none',
              }}>
                <span aria-hidden="true" style={{
                  width: 8, height: 8, borderRadius: '50%', background: vutLine.dot,
                  flexShrink: 0, boxShadow: `0 0 0 3px ${vutLine.dot}22`,
                }} />
                <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: 'var(--text-mid)', margin: 0, lineHeight: 1.5 }}>
                  {vutLine.text}
                </p>
              </div>
            )}
          </SectionShell>
        )}
      </section>

      {/* ── Environment — shared map + Flood/Noise/AQ collapsible cards ── */}
      <section id="environment" style={{ marginBottom: 48, scrollMarginTop: 140 }}>
        <h2 style={{ fontFamily: 'var(--font-playfair)', fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
          Environment
        </h2>
        <p style={{ fontFamily: 'var(--font-playfair)', fontStyle: 'italic', fontSize: 16, color: 'var(--text-mid)', marginBottom: 24 }}>
          Flood risk, noise exposure, and air quality at this address.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SectionShell>
            <NeighbourhoodMap
              lat={lat}
              lng={lng}
              activeLayer={mapLayer}
              onLayerChange={setMapLayer}
            />
          </SectionShell>

          {/* Flood — always rendered (see D-035); loading shows skeleton. */}
          <SectionShell>
            {pinLoading ? (
              <div className="animate-pulse" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ height: 11, width: 80,    background: 'var(--border)',    borderRadius: 4 }} />
                <div style={{ height: 20, width: '70%', background: 'var(--surface-3, #EEF2F7)', borderRadius: 6 }} />
              </div>
            ) : (
              <FloodIntelligenceCard floodResult={pin && !pinError ? pin.flood : undefined} />
            )}
          </SectionShell>

          {pin && !pinLoading && (
            <SectionShell>
              <NoiseExposureCard
                exposure={{
                  lden:        pin.noise?.lden        ?? null,
                  band:        pin.noise?.band        ?? null,
                  source_type: pin.noise?.source_type ?? null,
                }}
              />
            </SectionShell>
          )}

          {pin && !pinLoading && (
            <SectionShell>
              <AirQualityCard data={pin.air_quality ?? null} />
            </SectionShell>
          )}
        </div>
      </section>
    </>
  );
}
