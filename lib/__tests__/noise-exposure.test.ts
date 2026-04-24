/**
 * lib/__tests__/noise-exposure.test.ts — CHI-417
 *
 * Covers noiseConsequence() — the function that drives the NoiseExposureCard
 * consequence block and dB-ladder "equivalent sound" copy. These strings are
 * user-facing advice, so the band boundaries and source-noun substitutions
 * are pinned explicitly rather than tested via snapshot.
 */

import { describe, it, expect } from 'vitest';
import {
  noiseConsequence,
  DB_REFERENCE_POINTS,
  type NoiseExposure,
} from '../noise-exposure';

const at = (lden: number | null, source: NoiseExposure['source_type'] = 'road'): NoiseExposure =>
  ({ lden, band: lden == null ? null : `${lden}-${lden + 5}`, source_type: lden == null ? null : source });

describe('noiseConsequence', () => {
  it('returns a reassuring green statement when below mapped thresholds', () => {
    const r = noiseConsequence(at(null));
    expect(r.signal).toBe('green');
    // Must mention the 55 dB cutoff so the user understands *why* there's
    // no reading, not just that one is absent.
    expect(r.body.toLowerCase()).toMatch(/55\s*db/);
    expect(r.reference.toLowerCase()).toMatch(/quiet/);
  });

  it('classifies 55-60 dB as neutral moderate', () => {
    expect(noiseConsequence(at(55)).signal).toBe('neutral');
  });

  it('classifies 60-65 and 65-70 dB as amber with escalating action advice', () => {
    const mid  = noiseConsequence(at(60));
    const high = noiseConsequence(at(65));
    expect(mid.signal).toBe('amber');
    expect(high.signal).toBe('amber');
    // 65-70 carries a specific "which rooms face the noise source" action —
    // the 60-65 band should not, so buyers don't see escalating advice for
    // a merely moderate level.
    expect(high.action).toBeDefined();
    expect(mid.action).toBeUndefined();
  });

  it('classifies 70-75 and 75+ as red with strong acoustic-glazing guidance', () => {
    const veryHigh = noiseConsequence(at(70));
    const severe   = noiseConsequence(at(75));
    expect(veryHigh.signal).toBe('red');
    expect(severe.signal).toBe('red');
    expect(veryHigh.action).toBeDefined();
    expect(severe.action).toBeDefined();
    // 75+ specifically mentions "36 dB Rw" acoustic glazing — the canonical
    // EU insulation spec for severe noise exposure.
    expect(severe.action!).toMatch(/36 dB Rw/);
  });

  it('swaps the source noun per source_type so copy reads correctly', () => {
    expect(noiseConsequence(at(70, 'road')).body).toMatch(/road traffic/);
    expect(noiseConsequence(at(70, 'rail')).body).toMatch(/rail traffic/);
    expect(noiseConsequence(at(70, 'airport')).body).toMatch(/aircraft/);
    expect(noiseConsequence(at(70, 'industry')).body).toMatch(/industrial/);
  });

  it('exports a sorted dB reference scale covering 30-80', () => {
    // The card's horizontal dB ladder relies on the scale being sorted and
    // spanning the 30-80 range — assert both rather than trusting the array
    // author to keep it in order on future edits.
    const ldens = DB_REFERENCE_POINTS.map(p => p.lden);
    expect(ldens[0]).toBe(30);
    expect(ldens[ldens.length - 1]).toBe(80);
    for (let i = 1; i < ldens.length; i++) {
      expect(ldens[i]).toBeGreaterThan(ldens[i - 1]);
    }
  });
});
