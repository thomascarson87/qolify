'use client';

/**
 * AirQualityCard — CHI-417
 *
 * DNA Report card for air-quality exposure. Visually distinct from the
 * Noise card:
 *
 *   - No large mini-map. Air quality is a point reading from the nearest
 *     EEA/MITECO station, not a continuous spatial field — so the card
 *     leads with the reading itself.
 *   - A station "chip" header shows which station the data is from and
 *     how far away it is (critical context — a 22 km station is a
 *     regional proxy, not an address reading).
 *   - A large AQI value panel with its band + 12-month trend arrow.
 *   - A table of per-pollutant bars showing each reading against its WHO
 *     annual-mean guideline — a reader can see at a glance which specific
 *     pollutant is elevated.
 *   - A consequence block and (if relevant) an action sentence.
 *
 * No emojis — glyphs are either typographic arrows or filled shapes via CSS.
 */

import {
  aqiConsequence,
  pollutantRows,
  type AirQualityReadings,
} from '@/lib/air-quality';

export interface AirQualityCardProps {
  data: (AirQualityReadings & {
    station_name:   string;
    municipio_name: string | null;
    distance_m:     number | null;
    aqi_value:      number | null;
    aqi_category:   string | null;
    aqi_annual_avg: number | null;
    aqi_trend_12m:  number | null;
    reading_at:     string | null;
  }) | null;
}

// AQI band boundaries for the band pill — these are the European
// AQI boundaries (max-sub-index scale). Must match the lib classifier.
const BAND_STYLE = {
  bueno:                { border: '#34C97A', bg: 'rgba(52, 201, 122, 0.10)',  label: 'Good',          labelColor: '#34C97A' },
  razonable:            { border: '#8AB07A', bg: 'rgba(138, 176, 122, 0.10)', label: 'Fair',          labelColor: '#8AB07A' },
  regular:              { border: '#D4820A', bg: 'rgba(212, 130, 10, 0.10)',  label: 'Moderate',      labelColor: '#D4820A' },
  malo:                 { border: '#C94B1A', bg: 'rgba(201, 75, 26, 0.10)',   label: 'Poor',          labelColor: '#F5A07A' },
  muy_malo:             { border: '#8A1A0A', bg: 'rgba(138, 26, 10, 0.15)',   label: 'Very poor',     labelColor: '#E06B6B' },
  extremadamente_malo:  { border: '#5A0A00', bg: 'rgba(90, 10, 0, 0.20)',     label: 'Extremely poor', labelColor: '#E06B6B' },
} as const;

const ROW_SIGNAL_COLOURS = {
  green:   '#34C97A',
  amber:   '#D4820A',
  red:     '#C94B1A',
  neutral: '#8A9BB0',
} as const;

function formatDistance(m: number | null): string {
  if (m === null) return '';
  if (m < 1000) return `${m} m away`;
  return `${(m / 1000).toFixed(1)} km away`;
}

function formatReadingDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

function trendGlyph(trend: number | null): { symbol: string; colour: string; label: string } | null {
  if (trend === null || Math.abs(trend) < 1) return null;
  if (trend > 0) return { symbol: '↑', colour: '#C94B1A', label: 'Worsening 12-mo' };
  return             { symbol: '↓', colour: '#34C97A', label: 'Improving 12-mo' };
}

export function AirQualityCard({ data }: AirQualityCardProps) {
  // ── UNAVAILABLE: no nearby station with a 12-month mean ──────────────────
  if (!data) {
    return (
      <section aria-label="Air quality">
        <p
          style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 10, letterSpacing: '0.1em', marginBottom: 8 }}
          className="uppercase text-[#8A9BB0]"
        >
          Air Quality
        </p>
        <div style={{
          borderLeft:   '3px solid #2A4060',
          background:   'rgba(42, 64, 96, 0.08)',
          borderRadius: '0 8px 8px 0',
          padding:      '14px 16px',
        }}>
          <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 14, fontWeight: 600, color: '#FFFFFF', lineHeight: 1.4, marginBottom: 6 }}>
            No air-quality station within 25&thinsp;km of this address.
          </p>
          <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: '#C5D5E8', lineHeight: 1.6, margin: 0 }}>
            Spain&rsquo;s national monitoring network does not cover this location closely enough to give a representative reading.
          </p>
        </div>
      </section>
    );
  }

  const category = (data.aqi_category ?? 'razonable') as keyof typeof BAND_STYLE;
  const band     = BAND_STYLE[category] ?? BAND_STYLE.razonable;

  const readings: AirQualityReadings = {
    pm25_ugm3: data.pm25_ugm3,
    pm10_ugm3: data.pm10_ugm3,
    no2_ugm3:  data.no2_ugm3,
    o3_ugm3:   data.o3_ugm3,
    so2_ugm3:  data.so2_ugm3,
    co_mgm3:   data.co_mgm3,
  };
  const rows = pollutantRows(readings);

  const consequence = aqiConsequence(data.aqi_annual_avg, data.aqi_trend_12m);
  const trend       = trendGlyph(data.aqi_trend_12m);

  return (
    <section aria-label="Air quality" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── Section label + station provenance chip ───────────────────── */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <p
          style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 10, letterSpacing: '0.1em', margin: 0 }}
          className="uppercase text-[#8A9BB0]"
        >
          Air Quality
        </p>
        <span style={{
          fontFamily: 'var(--font-dm-sans)',
          fontSize:   10,
          color:      '#8A9BB0',
          letterSpacing: '0.03em',
        }}>
          <span style={{ color: '#C5D5E8' }}>Station: </span>
          {data.station_name}
          {data.distance_m != null && <span> · {formatDistance(data.distance_m)}</span>}
          {formatReadingDate(data.reading_at) && <span> · {formatReadingDate(data.reading_at)}</span>}
        </span>
      </div>

      {/* ── AQI value panel — the card's signature visual ─────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '120px 1fr',
        gap: 14,
        padding:    '16px 18px',
        borderRadius: 10,
        border:     `1px solid ${band.border}`,
        background: band.bg,
      }}>
        {/* Left column — big value */}
        <div style={{ borderRight: '1px solid rgba(138, 155, 176, 0.2)', paddingRight: 14 }}>
          <p style={{
            fontFamily:  'var(--font-dm-mono)',
            fontSize:    42,
            fontWeight:  600,
            color:       '#FFFFFF',
            margin:      0,
            lineHeight:  1,
          }}>
            {data.aqi_annual_avg != null ? data.aqi_annual_avg.toFixed(0) : '—'}
          </p>
          <p style={{
            fontFamily:  'var(--font-dm-sans)',
            fontSize:    10,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color:       '#8A9BB0',
            margin:      '4px 0 0 0',
          }}>
            Annual mean AQI
          </p>
        </div>

        {/* Right column — band + trend + most-recent-reading */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4 }}>
          <span style={{
            fontFamily:   'var(--font-dm-sans)',
            fontSize:     12,
            fontWeight:   700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color:        band.labelColor,
          }}>
            {band.label}
          </span>
          {data.aqi_value != null && (
            <span style={{
              fontFamily: 'var(--font-dm-sans)',
              fontSize:   12,
              color:      '#C5D5E8',
            }}>
              Most recent reading: <span style={{ fontFamily: 'var(--font-dm-mono)', color: '#FFFFFF' }}>{data.aqi_value}</span>
            </span>
          )}
          {trend && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontFamily: 'var(--font-dm-mono)',
                fontSize:   16,
                color:      trend.colour,
                fontWeight: 700,
                lineHeight: 1,
              }}>{trend.symbol}</span>
              <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, color: '#C5D5E8' }}>
                {trend.label}
                {data.aqi_trend_12m != null && (
                  <span style={{ color: '#8A9BB0' }}> ({data.aqi_trend_12m > 0 ? '+' : ''}{data.aqi_trend_12m.toFixed(1)})</span>
                )}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* ── Pollutant breakdown — per-row bars vs WHO guideline ───────── */}
      {rows.length > 0 && (
        <div style={{
          borderRadius: 8,
          border:       '1px solid rgba(42, 64, 96, 0.25)',
          background:   'rgba(42, 64, 96, 0.04)',
          overflow:     'hidden',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '86px 1fr 100px',
            gap: 10,
            padding: '8px 14px',
            borderBottom: '1px solid rgba(42, 64, 96, 0.25)',
            fontFamily:   'var(--font-dm-sans)',
            fontSize:     10,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color:        '#8A9BB0',
          }}>
            <span>Pollutant</span>
            <span>vs WHO annual guideline</span>
            <span style={{ textAlign: 'right' }}>Reading</span>
          </div>
          {rows.map(row => {
            // Cap bar at 2× guideline visually — anything above is already
            // "red" so the exact overflow ratio doesn't help the reader.
            const pct = Math.min(1, row.value! / (row.who_guideline * 2));
            return (
              <div key={row.code} style={{
                display: 'grid',
                gridTemplateColumns: '86px 1fr 100px',
                gap: 10,
                alignItems: 'center',
                padding:    '10px 14px',
                borderBottom: '1px solid rgba(42, 64, 96, 0.12)',
              }}>
                <div>
                  <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, fontWeight: 600, color: '#FFFFFF', margin: 0, lineHeight: 1.2 }}>
                    {row.code}
                  </p>
                  <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 10, color: '#8A9BB0', margin: '2px 0 0 0', lineHeight: 1.2 }}>
                    {row.label}
                  </p>
                </div>

                {/* Bar + WHO guideline tick */}
                <div style={{ position: 'relative' }}>
                  <div style={{
                    height:        8,
                    borderRadius:  4,
                    background:    'rgba(138, 155, 176, 0.15)',
                    position:      'relative',
                    overflow:      'hidden',
                  }}>
                    <div style={{
                      width:     `${(pct * 100).toFixed(1)}%`,
                      height:    '100%',
                      background: ROW_SIGNAL_COLOURS[row.signal],
                      transition: 'width 0.3s ease',
                    }} />
                  </div>
                  {/* 50% tick = WHO guideline; label above */}
                  <div style={{
                    position:   'absolute',
                    left:       '50%',
                    top:        -4,
                    width:      1,
                    height:     16,
                    background: '#C5D5E8',
                    opacity:    0.6,
                  }} />
                  <p style={{
                    fontFamily: 'var(--font-dm-sans)',
                    fontSize:   9,
                    color:      row.signal === 'green' ? '#34C97A'
                              : row.signal === 'amber' ? '#D4820A'
                              : row.signal === 'red'   ? '#F5A07A'
                                                       : '#8A9BB0',
                    margin:     '6px 0 0 0',
                    lineHeight: 1.2,
                  }}>
                    {row.status} (WHO {row.who_guideline} {row.units})
                  </p>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 13, color: '#FFFFFF', fontWeight: 600 }}>
                    {row.value!.toFixed(1)}
                  </span>
                  <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 10, color: '#8A9BB0', marginLeft: 4 }}>
                    {row.units}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Consequence + action ───────────────────────────────────────── */}
      <div style={{
        borderLeft:   `3px solid ${band.border}`,
        background:   'rgba(13, 27, 42, 0.04)',
        borderRadius: '0 8px 8px 0',
        padding:      '14px 16px',
      }}>
        <p style={{
          fontFamily: 'var(--font-dm-sans)',
          fontSize:   14,
          fontWeight: 600,
          color:      '#FFFFFF',
          lineHeight: 1.4,
          marginBottom: 6,
        }}>
          {consequence.title}
        </p>
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
    </section>
  );
}
