/**
 * lib/air-quality.ts — CHI-417
 *
 * Air-quality reasoning for the DNA Report AirQualityCard.
 *
 * Two things live in here:
 *   1. Per-pollutant assessments against WHO 2021 Air Quality Guidelines.
 *   2. An overall consequence statement from the rolling annual AQI mean.
 *
 * Why WHO rather than EU limits? EU legal limits (Directive 2008/50/EC) are
 * significantly laxer than the WHO health-based guidelines (e.g. annual
 * NO2 limit is 40 µg/m³ EU vs 10 µg/m³ WHO). For a buyer deciding where to
 * live, the health-based benchmark is the more decision-useful one — we
 * still mention the EU limit in the body when the reading exceeds it, since
 * that's the legally binding line.
 */

// ---------------------------------------------------------------------------
// Pollutant guideline rows
// ---------------------------------------------------------------------------

export interface PollutantRow {
  /** Pollutant short code — PM2.5, PM10, NO2, O3, SO2, CO. */
  code:   string;
  /** Full display label e.g. "Fine particulate matter". */
  label:  string;
  /** Reading value in standard units for that pollutant. */
  value:  number | null;
  /** Units string, e.g. "µg/m³" or "mg/m³". */
  units:  string;
  /** WHO 2021 annual-mean guideline for this pollutant. */
  who_guideline: number;
  /** Pollutant-specific signal based on the reading vs WHO guideline. */
  signal: 'green' | 'amber' | 'red' | 'neutral';
  /** One-line plain-English label ("Within WHO guideline" / "Above WHO guideline"). */
  status: string;
}

// WHO 2021 Global Air Quality Guidelines — annual-mean values (except CO
// which is 8-hour mean; treated as annual ceiling for simplicity).
// Source: https://www.who.int/publications/i/item/9789240034228
const WHO_ANNUAL: Record<string, number> = {
  'PM2.5': 5,    // µg/m³
  PM10:    15,   // µg/m³
  NO2:     10,   // µg/m³
  O3:      60,   // µg/m³ (peak-season avg — annual proxy)
  SO2:     40,   // µg/m³ (24-hour guideline — used as ceiling)
  CO:      4,    // mg/m³ (24-hour)
};

function classify(value: number, guideline: number): {
  signal: PollutantRow['signal'];
  status: string;
} {
  // Within guideline → green. Up to 2× → amber. Above 2× → red.
  if (value <= guideline)       return { signal: 'green', status: 'Within WHO guideline' };
  if (value <= guideline * 2)   return { signal: 'amber', status: 'Above WHO guideline'  };
  return                              { signal: 'red',   status: 'Well above WHO guideline' };
}

export interface AirQualityReadings {
  pm25_ugm3: number | null;
  pm10_ugm3: number | null;
  no2_ugm3:  number | null;
  o3_ugm3:   number | null;
  so2_ugm3:  number | null;
  co_mgm3:   number | null;
}

export function pollutantRows(r: AirQualityReadings): PollutantRow[] {
  // Order: largest health impact first (particulates → NO2 → O3 → others).
  // We only surface a row when the reading is present — zero-value readings
  // would be misleading (stations that don't measure a pollutant report null).
  const rows: PollutantRow[] = [];

  const push = (code: string, label: string, value: number | null, units: string) => {
    if (value === null) return;
    const guideline = WHO_ANNUAL[code];
    const { signal, status } = classify(value, guideline);
    rows.push({ code, label, value, units, who_guideline: guideline, signal, status });
  };

  push('PM2.5', 'Fine particulate matter',   r.pm25_ugm3, 'µg/m³');
  push('PM10',  'Coarse particulate matter', r.pm10_ugm3, 'µg/m³');
  push('NO2',   'Nitrogen dioxide',          r.no2_ugm3,  'µg/m³');
  push('O3',    'Ground-level ozone',        r.o3_ugm3,   'µg/m³');
  push('SO2',   'Sulphur dioxide',           r.so2_ugm3,  'µg/m³');
  push('CO',    'Carbon monoxide',           r.co_mgm3,   'mg/m³');

  return rows;
}

// ---------------------------------------------------------------------------
// Overall AQI consequence
// ---------------------------------------------------------------------------

export type AqiCategory =
  | 'bueno' | 'razonable' | 'regular' | 'malo' | 'muy_malo' | 'extremadamente_malo';

export interface AqiConsequence {
  signal:   'green' | 'amber' | 'red' | 'neutral';
  title:    string;
  body:     string;
  action?:  string;
}

/**
 * Map the rolling 12-month mean AQI to a consequence statement.
 *
 * The European AQI is computed as the max sub-index across PM2.5, PM10, NO2,
 * O3, SO2 (0-500 scale). In practice Spanish coastal readings sit in the
 * 0-50 range; inland industrial zones can touch 75-100.
 */
export function aqiConsequence(
  annualMean: number | null,
  trend12m:   number | null,
): AqiConsequence {
  if (annualMean === null) {
    return {
      signal: 'neutral',
      title:  'No recent validated readings at the nearest station.',
      body:   'A rolling annual mean could not be computed for the nearest station in the last 12 months. Check the MITECO station dashboard for the most recent data.',
    };
  }

  // Trend sentence — only added when magnitude is meaningful (|trend| > 1 unit).
  const trendSentence =
    trend12m === null || Math.abs(trend12m) < 1
      ? ''
      : trend12m > 0
        ? ` The 12-month trend is deteriorating (+${trend12m.toFixed(1)} AQI points).`
        : ` The 12-month trend is improving (${trend12m.toFixed(1)} AQI points).`;

  if (annualMean < 25) {
    return {
      signal: 'green',
      title:  `Rolling annual AQI ${annualMean.toFixed(0)} — clean air.`,
      body:   `This area sits comfortably in the European "Bueno" (good) band on the rolling 12-month mean.${trendSentence}`,
    };
  }

  if (annualMean < 50) {
    return {
      signal: 'neutral',
      title:  `Rolling annual AQI ${annualMean.toFixed(0)} — typical urban air.`,
      body:   `Readings sit in the "Razonable" band — acceptable for the general population but sensitive groups may notice peaks on high-pollution days.${trendSentence}`,
    };
  }

  if (annualMean < 75) {
    return {
      signal: 'amber',
      title:  `Rolling annual AQI ${annualMean.toFixed(0)} — regular air quality.`,
      body:   `Consistent moderate pollution — sensitive groups (children, elderly, respiratory patients) should follow alert-day guidance.${trendSentence}`,
      action: 'Review the municipal AQI alert feed before committing if anyone in the household has asthma or a respiratory condition.',
    };
  }

  // ≥ 75
  return {
    signal: 'red',
    title:  `Rolling annual AQI ${annualMean.toFixed(0)} — poor air quality.`,
    body:   `Long-term exposure at this level is linked to respiratory and cardiovascular disease.${trendSentence}`,
    action: 'Obtain an independent indoor air-quality test before exchanging contracts — the reading affects both lifestyle and resale value.',
  };
}
