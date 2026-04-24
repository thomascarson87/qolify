'use client';

/**
 * NeighbourhoodIntel — merges three pin-panel sections into the DNA Report.
 *
 * Sections (in order):
 *   1. Area Overview       — Claude-generated summary
 *   2. Flood Safety        — SNCZI T10/T100/T500 membership
 *   3. Community Character — VUT tourist-rental licences within 200m
 *
 * Data sources:
 *   - POST /api/map/pin          → flood result + vut_count_200m + facilities
 *   - GET  /api/map/zone/{cp}    → zone-level context (TVI, avg price, T10)
 *   - generateAreaSummary()      → Claude summary using the two above as input
 *
 * Why fetch client-side instead of extending the analyse-job pipeline?
 *   The pin endpoint already answers every sub-query in < 1 s against the
 *   same PostGIS indexes the background job would use. Persisting those fields
 *   on the job row buys us one-round-trip load but adds a schema change,
 *   duplicated SQL, and a migration cost. We can promote to server-side
 *   persistence later if DNA-report opens become a hot path.
 *
 * States:
 *   - Skeleton for each section while its data is loading
 *   - On fetch failure, each section falls back to its own unavailable state
 */

import { useEffect, useRef, useState } from 'react';
import { FloodIntelligenceCard } from '@/components/report/FloodIntelligenceCard';
import { NoiseExposureCard } from '@/components/report/NoiseExposureCard';
import { AirQualityCard } from '@/components/report/AirQualityCard';
import { AreaSummarySection } from '@/components/map/AreaSummarySection';
import { CommunityCharacterTriage } from '@/components/map/CommunityCharacterTriage';
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

// Shape mirrors PinReport (only the fields this component consumes).
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
  // Noise exposure — all three fields are null when the coordinate sits
  // outside every mapped noise contour polygon (treated as < 55 dB Lden).
  noise?: {
    lden:        number | null;
    band:        string | null;
    source_type: 'road' | 'rail' | 'airport' | 'industry' | null;
  };
  // Air quality — null when no station within 25 km has a rolling annual
  // mean available. Card renders its own UNAVAILABLE state in that case.
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

function SectionShell({ children }: { children: React.ReactNode }) {
  // Light-surface wrapper that matches the DNA Report's other cards. The
  // inner components (Flood, Community) draw their own severity-coloured
  // left border; this shell supplies the card chrome around them.
  return (
    <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 20, boxShadow: 'var(--shadow-sm)' }}>
      {children}
    </div>
  );
}

export function NeighbourhoodIntel({
  lat: latRaw, lng: lngRaw, codigoPostal, municipio, priceAsking, areaSqm,
}: NeighbourhoodIntelProps) {
  // Numeric columns from Postgres can arrive as strings in JSON — coerce once
  // here so every downstream consumer (fetch body, toFixed guard) sees a number.
  const lat = typeof latRaw === 'number' ? latRaw : Number(latRaw);
  const lng = typeof lngRaw === 'number' ? lngRaw : Number(lngRaw);
  const coordsValid = Number.isFinite(lat) && Number.isFinite(lng);
  const [pin,            setPin]            = useState<PinFetch | null>(null);
  const [pinLoading,     setPinLoading]     = useState(true);
  const [pinError,       setPinError]       = useState(false);

  const [areaSummary,    setAreaSummary]    = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  // Guard: coordinates occasionally change reference between polls — only
  // re-fire the intel fetches when the effective value changes.
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

    // 1. Pin data (flood + VUT + facilities) — single POST to /api/map/pin.
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

    // 2. Zone data — only needed for AI summary input (price context, TVI).
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

  return (
    <section style={{ marginBottom: 48 }}>
      <h2 style={{ fontFamily: 'var(--font-playfair)', fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
        Neighbourhood Intelligence
      </h2>
      <p style={{ fontFamily: 'var(--font-playfair)', fontStyle: 'italic', fontSize: 16, color: 'var(--text-mid)', marginBottom: 24 }}>
        What the street feels like.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 1. Area overview — AI summary. Hidden entirely when we have neither
            a loading state nor a generated summary (e.g. the /pin call failed
            before we could even try). */}
        {(summaryLoading || areaSummary) && (
          <SectionShell>
            <AreaSummarySection tone="light" loading={summaryLoading} summary={areaSummary} />
          </SectionShell>
        )}

        {/* 2. Flood — always rendered (see D-035). During load we show a
            skeleton rather than the "could not retrieve" fallback so a slow
            pin fetch doesn't flash a false-negative. */}
        <SectionShell>
          {pinLoading ? (
            <div className="animate-pulse" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ height: 11, width: 80,    background: 'var(--border)',    borderRadius: 4 }} />
              <div style={{ height: 48, width: '100%', background: 'var(--surface-3, #EEF2F7)', borderRadius: 8 }} />
            </div>
          ) : (
            <FloodIntelligenceCard
              lat={lat}
              lng={lng}
              floodResult={pin && !pinError ? pin.flood : undefined}
            />
          )}
        </SectionShell>

        {/* 3. Noise exposure — EEA / ENAIRE / modelled Lden contours.
            Rendered once pin data arrives; the card itself handles the
            "below all mapped thresholds" case with a green reassurance
            state, so we never hide the section for a quiet address. */}
        {pin && !pinLoading && (
          <SectionShell>
            <NoiseExposureCard
              lat={lat}
              lng={lng}
              exposure={{
                lden:        pin.noise?.lden        ?? null,
                band:        pin.noise?.band        ?? null,
                source_type: pin.noise?.source_type ?? null,
              }}
            />
          </SectionShell>
        )}

        {/* 4. Air quality — nearest EEA/MITECO station within 25 km.
            AirQualityCard renders its own UNAVAILABLE state when no
            station is close enough, so we still render the section for
            rural addresses rather than silently omitting air-quality
            information. */}
        {pin && !pinLoading && (
          <SectionShell>
            <AirQualityCard data={pin.air_quality ?? null} />
          </SectionShell>
        )}

        {/* 5. Community character — shown once pin data arrives. */}
        {pin && !pinLoading && (
          <SectionShell>
            <CommunityCharacterTriage tone="light" vutCount={pin.vut_count_200m} />
          </SectionShell>
        )}
      </div>
    </section>
  );
}
