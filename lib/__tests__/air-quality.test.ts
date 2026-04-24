/**
 * lib/__tests__/air-quality.test.ts — CHI-417
 *
 * Covers the two pure functions that drive the AirQualityCard:
 *   pollutantRows()  — builds the per-pollutant bar rows against WHO 2021
 *                      annual-mean guidelines.
 *   aqiConsequence() — returns the overall consequence statement from the
 *                      rolling 12-month AQI mean + trend.
 *
 * Both are user-facing strings — pinning band boundaries explicitly keeps
 * the card in lockstep with the lib on future edits.
 */

import { describe, it, expect } from 'vitest';
import {
  pollutantRows,
  aqiConsequence,
  type AirQualityReadings,
} from '../air-quality';

const EMPTY: AirQualityReadings = {
  pm25_ugm3: null, pm10_ugm3: null, no2_ugm3: null,
  o3_ugm3:   null, so2_ugm3:  null, co_mgm3:  null,
};

describe('pollutantRows', () => {
  it('skips pollutants whose reading is null — never fabricates a zero bar', () => {
    expect(pollutantRows(EMPTY)).toHaveLength(0);
  });

  it('orders pollutants by health impact (PM2.5 first, PM10 second)', () => {
    const rows = pollutantRows({ ...EMPTY, pm10_ugm3: 10, pm25_ugm3: 3, no2_ugm3: 5 });
    expect(rows.map(r => r.code)).toEqual(['PM2.5', 'PM10', 'NO2']);
  });

  it('classifies readings vs the WHO 2021 annual guideline in green/amber/red bands', () => {
    // PM2.5 WHO guideline = 5 µg/m³.
    //   3 µg/m³ → green (within guideline)
    //   8 µg/m³ → amber (above, ≤ 2× guideline)
    //  12 µg/m³ → red   (> 2× guideline)
    const green = pollutantRows({ ...EMPTY, pm25_ugm3: 3  })[0];
    const amber = pollutantRows({ ...EMPTY, pm25_ugm3: 8  })[0];
    const red   = pollutantRows({ ...EMPTY, pm25_ugm3: 12 })[0];

    expect(green.signal).toBe('green');
    expect(amber.signal).toBe('amber');
    expect(red.signal  ).toBe('red');

    // WHO-guideline label must always carry forward into the status copy —
    // it is the anchor the reader uses to judge the bar.
    [green, amber, red].forEach(r => expect(r.status).toMatch(/WHO/));
  });
});

describe('aqiConsequence', () => {
  it('renders a neutral "no data" block when annualMean is null', () => {
    const r = aqiConsequence(null, null);
    expect(r.signal).toBe('neutral');
    expect(r.title.toLowerCase()).toMatch(/no recent/);
    expect(r.action).toBeUndefined();
  });

  it('maps AQI bands green/neutral/amber/red at the documented boundaries', () => {
    expect(aqiConsequence(15, null).signal).toBe('green');    // < 25
    expect(aqiConsequence(30, null).signal).toBe('neutral');  // 25-50
    expect(aqiConsequence(60, null).signal).toBe('amber');    // 50-75
    expect(aqiConsequence(90, null).signal).toBe('red');      // ≥ 75
  });

  it('attaches an action only to the amber and red bands', () => {
    expect(aqiConsequence(15, null).action).toBeUndefined();
    expect(aqiConsequence(30, null).action).toBeUndefined();
    expect(aqiConsequence(60, null).action).toBeDefined();
    expect(aqiConsequence(90, null).action).toBeDefined();
  });

  it('appends a worsening/improving trend sentence only when |trend| >= 1', () => {
    const noTrend   = aqiConsequence(30, 0.4).body;
    const worsening = aqiConsequence(30, 3.2).body;
    const improving = aqiConsequence(30, -2.8).body;
    expect(noTrend).not.toMatch(/trend/i);
    expect(worsening).toMatch(/deteriorating/);
    expect(improving).toMatch(/improving/);
  });
});
