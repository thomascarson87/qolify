/**
 * lib/__tests__/flood-insurance.test.ts — CHI-417
 *
 * Covers the floodInsuranceImpact() mapping that drives the DNA Report
 * FloodIntelligenceCard's Spanish-insurance block. The mapping is a narrow
 * but product-critical function — wrong copy here is misleading financial
 * advice to a buyer, so every band is asserted explicitly.
 */

import { describe, it, expect } from 'vitest';
import { floodInsuranceImpact } from '../flood-insurance';

describe('floodInsuranceImpact', () => {
  it('flags T10 as the highest-severity insurance risk with an action', () => {
    const r = floodInsuranceImpact('in_t10');
    expect(r.signal).toBe('red');
    expect(r.headline.toLowerCase()).toMatch(/harder|difficult|expensive/);
    expect(r.action).toBeDefined();
    // Must warn that a declined policy blocks the mortgage — this is the
    // single most load-bearing piece of information in the T10 band.
    expect(r.body.toLowerCase()).toMatch(/decline|mortgage|block/);
  });

  it('flags T100 as amber with an action to get a written quote', () => {
    const r = floodInsuranceImpact('in_t100');
    expect(r.signal).toBe('amber');
    expect(r.action).toBeDefined();
    expect(r.action!.toLowerCase()).toMatch(/quote/);
  });

  it('treats T500 as low-impact on current pricing, no action required', () => {
    const r = floodInsuranceImpact('in_t500');
    expect(r.signal).toBe('neutral');
    expect(r.action).toBeUndefined();
  });

  it('returns a reassuring green block when there is no flood membership', () => {
    const r = floodInsuranceImpact('none');
    expect(r.signal).toBe('green');
    expect(r.action).toBeUndefined();
    expect(r.headline.toLowerCase()).toMatch(/no flood loading|standard/);
  });

  it('always mentions the CCS surcharge in the body so buyers understand mandatory cover exists', () => {
    (['in_t10', 'in_t100', 'in_t500', 'none'] as const).forEach(m => {
      const r = floodInsuranceImpact(m);
      // "Consorcio de Compensación de Seguros" or the acronym "CCS" must be
      // present — this is the one sentence that is legally/financially
      // identical across bands and must never be silently dropped.
      expect(r.body).toMatch(/Consorcio de Compensaci[oó]n de Seguros|CCS/);
      expect(r.body.toLowerCase()).toMatch(/mandatory/);
    });
  });
});
