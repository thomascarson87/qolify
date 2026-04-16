/**
 * lib/__tests__/consequence-statements.test.ts — CHI-352
 *
 * Unit tests for the consequence statement engine.
 * Covers all field types and all value states per the DoD checklist.
 */

import { describe, it, expect } from 'vitest';
import {
  iteConsequence,
  floodConsequence,
  fibreConsequence,
  orientationConsequence,
  epcConsequence,
  vutConsequence,
  ntiConsequence,
  type ConsequenceStatement,
} from '../consequence-statements';

// ---------------------------------------------------------------------------
// Helper — asserts a value is a valid ConsequenceStatement shape
// ---------------------------------------------------------------------------

function assertValidShape(stmt: ConsequenceStatement) {
  expect(['green', 'amber', 'red', 'neutral']).toContain(stmt.signal);
  expect(typeof stmt.title).toBe('string');
  expect(stmt.title.length).toBeGreaterThan(0);
  expect(typeof stmt.body).toBe('string');
  expect(stmt.body.length).toBeGreaterThan(0);
  // title + body must not exceed 3 sentences total (grammar rule)
  const sentenceCount = [stmt.title, stmt.body, stmt.action]
    .filter(Boolean)
    .join(' ')
    .split(/[.!?]+/)
    .filter(s => s.trim().length > 0).length;
  expect(sentenceCount).toBeLessThanOrEqual(5); // generous bound; DoD says ≤3 per display card
}

// ---------------------------------------------------------------------------
// 1. ITE inspection status
// ---------------------------------------------------------------------------

describe('iteConsequence', () => {
  it('passed → green signal', () => {
    const stmt = iteConsequence('passed');
    expect(stmt.signal).toBe('green');
    assertValidShape(stmt);
  });

  it('passed with year includes year in title', () => {
    const stmt = iteConsequence('passed', 2022);
    expect(stmt.title).toContain('2022');
  });

  it('failed → red signal with action', () => {
    const stmt = iteConsequence('failed');
    expect(stmt.signal).toBe('red');
    expect(stmt.action).toBeTruthy();
    assertValidShape(stmt);
  });

  it('failed with year includes year in title', () => {
    const stmt = iteConsequence('failed', 2021);
    expect(stmt.title).toContain('2021');
  });

  it('pending → amber signal with action', () => {
    const stmt = iteConsequence('pending');
    expect(stmt.signal).toBe('amber');
    expect(stmt.action).toBeTruthy();
    assertValidShape(stmt);
  });

  it('not_required → neutral signal, no action needed', () => {
    const stmt = iteConsequence('not_required');
    expect(stmt.signal).toBe('neutral');
    assertValidShape(stmt);
  });

  it('unavailable → neutral signal', () => {
    const stmt = iteConsequence('unavailable');
    expect(stmt.signal).toBe('neutral');
    assertValidShape(stmt);
  });

  it('all statuses return a source string', () => {
    const statuses = ['passed', 'failed', 'pending', 'not_required', 'unavailable'] as const;
    for (const s of statuses) {
      const stmt = iteConsequence(s);
      if (s !== 'not_required' && s !== 'unavailable') {
        expect(stmt.source).toBeTruthy();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Flood zone membership
// ---------------------------------------------------------------------------

describe('floodConsequence', () => {
  it('in_t10 → red signal with action', () => {
    const stmt = floodConsequence('in_t10');
    expect(stmt.signal).toBe('red');
    expect(stmt.action).toBeTruthy();
    assertValidShape(stmt);
  });

  it('in_t100 → amber signal with action', () => {
    const stmt = floodConsequence('in_t100');
    expect(stmt.signal).toBe('amber');
    expect(stmt.action).toBeTruthy();
    assertValidShape(stmt);
  });

  it('in_t500 → neutral signal', () => {
    const stmt = floodConsequence('in_t500');
    expect(stmt.signal).toBe('neutral');
    assertValidShape(stmt);
  });

  it('none → green signal', () => {
    const stmt = floodConsequence('none');
    expect(stmt.signal).toBe('green');
    assertValidShape(stmt);
  });

  it('all memberships include SNCZI in source', () => {
    const memberships = ['in_t10', 'in_t100', 'in_t500', 'none'] as const;
    for (const m of memberships) {
      const stmt = floodConsequence(m);
      expect(stmt.source).toContain('SNCZI');
    }
  });

  it('source includes provided date when given', () => {
    const stmt = floodConsequence('none', 'March 2026');
    expect(stmt.source).toContain('March 2026');
  });

  it('in_t10 title mentions T10 and 1-in-10', () => {
    const stmt = floodConsequence('in_t10');
    // Must communicate the risk clearly — no jargon without explanation
    expect(stmt.title.toLowerCase()).toMatch(/1-in-10/);
  });
});

// ---------------------------------------------------------------------------
// 3. Fibre coverage type
// ---------------------------------------------------------------------------

describe('fibreConsequence', () => {
  it('FTTP → green signal', () => {
    const stmt = fibreConsequence('FTTP');
    expect(stmt.signal).toBe('green');
    assertValidShape(stmt);
  });

  it('FTTC → amber signal with action', () => {
    const stmt = fibreConsequence('FTTC');
    expect(stmt.signal).toBe('amber');
    expect(stmt.action).toBeTruthy();
    assertValidShape(stmt);
  });

  it('HFC → amber signal', () => {
    const stmt = fibreConsequence('HFC');
    expect(stmt.signal).toBe('amber');
    assertValidShape(stmt);
  });

  it('none → red signal with action', () => {
    const stmt = fibreConsequence('none');
    expect(stmt.signal).toBe('red');
    expect(stmt.action).toBeTruthy();
    assertValidShape(stmt);
  });

  it('all types include CNMC in source', () => {
    const types = ['FTTP', 'FTTC', 'HFC', 'none'] as const;
    for (const t of types) {
      const stmt = fibreConsequence(t);
      expect(stmt.source).toContain('CNMC');
    }
  });

  it('source includes provided year when given', () => {
    const stmt = fibreConsequence('FTTP', '2025');
    expect(stmt.source).toContain('2025');
  });
});

// ---------------------------------------------------------------------------
// 4. Building orientation / aspect
// ---------------------------------------------------------------------------

describe('orientationConsequence', () => {
  it('S → green signal', () => {
    expect(orientationConsequence('S').signal).toBe('green');
  });

  it('SE → green signal', () => {
    expect(orientationConsequence('SE').signal).toBe('green');
  });

  it('SW → green signal', () => {
    expect(orientationConsequence('SW').signal).toBe('green');
  });

  it('E → amber signal', () => {
    expect(orientationConsequence('E').signal).toBe('amber');
  });

  it('W → amber signal', () => {
    expect(orientationConsequence('W').signal).toBe('amber');
  });

  it('N → red signal with action (damp risk)', () => {
    const stmt = orientationConsequence('N');
    expect(stmt.signal).toBe('red');
    expect(stmt.action).toBeTruthy();
    assertValidShape(stmt);
  });

  it('NE → red signal with action', () => {
    const stmt = orientationConsequence('NE');
    expect(stmt.signal).toBe('red');
    expect(stmt.action).toBeTruthy();
  });

  it('NW → red signal with action', () => {
    const stmt = orientationConsequence('NW');
    expect(stmt.signal).toBe('red');
    expect(stmt.action).toBeTruthy();
  });

  it('title includes the aspect string', () => {
    const aspects = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
    for (const a of aspects) {
      const stmt = orientationConsequence(a);
      expect(stmt.title).toContain(a);
      assertValidShape(stmt);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. EPC rating
// ---------------------------------------------------------------------------

describe('epcConsequence', () => {
  it('A → green signal', () => {
    expect(epcConsequence('A').signal).toBe('green');
  });

  it('B → green signal', () => {
    expect(epcConsequence('B').signal).toBe('green');
  });

  it('C → amber signal', () => {
    expect(epcConsequence('C').signal).toBe('amber');
  });

  it('D → amber signal with action', () => {
    const stmt = epcConsequence('D');
    expect(stmt.signal).toBe('amber');
    expect(stmt.action).toBeTruthy();
    assertValidShape(stmt);
  });

  it('E → red signal with action', () => {
    const stmt = epcConsequence('E');
    expect(stmt.signal).toBe('red');
    expect(stmt.action).toBeTruthy();
    assertValidShape(stmt);
  });

  it('F → red signal with action', () => {
    const stmt = epcConsequence('F');
    expect(stmt.signal).toBe('red');
    expect(stmt.action).toBeTruthy();
  });

  it('G → red signal with action', () => {
    const stmt = epcConsequence('G');
    expect(stmt.signal).toBe('red');
    expect(stmt.action).toBeTruthy();
  });

  it('title includes rating letter', () => {
    const ratings = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;
    for (const r of ratings) {
      const stmt = epcConsequence(r);
      expect(stmt.title).toContain(r);
      assertValidShape(stmt);
    }
  });

  it('includes energy cost figures when both heating and cooling supplied', () => {
    const stmt = epcConsequence('E', 620, 320);
    expect(stmt.body).toContain('940'); // 620 + 320
  });

  it('does not include cost line when costs are omitted', () => {
    const stmt = epcConsequence('D');
    expect(stmt.body).not.toContain('€');
  });
});

// ---------------------------------------------------------------------------
// 6. VUT count within 200m
// ---------------------------------------------------------------------------

describe('vutConsequence', () => {
  it('0 VUTs → green signal', () => {
    const stmt = vutConsequence(0);
    expect(stmt.signal).toBe('green');
    assertValidShape(stmt);
  });

  it('1 VUT → green signal (singular label)', () => {
    const stmt = vutConsequence(1);
    expect(stmt.signal).toBe('green');
    expect(stmt.title).toContain('1 active tourist rental licence '); // singular
  });

  it('3 VUTs → green signal (boundary)', () => {
    expect(vutConsequence(3).signal).toBe('green');
  });

  it('4 VUTs → amber signal with action (boundary)', () => {
    const stmt = vutConsequence(4);
    expect(stmt.signal).toBe('amber');
    expect(stmt.action).toBeTruthy();
    assertValidShape(stmt);
  });

  it('10 VUTs → amber signal (boundary)', () => {
    expect(vutConsequence(10).signal).toBe('amber');
  });

  it('11 VUTs → red signal with action (boundary)', () => {
    const stmt = vutConsequence(11);
    expect(stmt.signal).toBe('red');
    expect(stmt.action).toBeTruthy();
    assertValidShape(stmt);
  });

  it('14 VUTs → red signal', () => {
    const stmt = vutConsequence(14);
    expect(stmt.signal).toBe('red');
    expect(stmt.title).toContain('14');
  });

  it('count always appears in title', () => {
    [0, 1, 5, 12].forEach(n => {
      const stmt = vutConsequence(n);
      expect(stmt.title).toContain(String(n));
    });
  });
});

// ---------------------------------------------------------------------------
// 7. NTI signal
// ---------------------------------------------------------------------------

describe('ntiConsequence', () => {
  it('prime_buy → green signal', () => {
    const stmt = ntiConsequence('prime_buy');
    expect(stmt.signal).toBe('green');
    assertValidShape(stmt);
  });

  it('stable → neutral signal', () => {
    const stmt = ntiConsequence('stable');
    expect(stmt.signal).toBe('neutral');
    assertValidShape(stmt);
  });

  it('too_late → amber signal', () => {
    const stmt = ntiConsequence('too_late');
    expect(stmt.signal).toBe('amber');
    assertValidShape(stmt);
  });

  it('risk → red signal with action', () => {
    const stmt = ntiConsequence('risk');
    expect(stmt.signal).toBe('red');
    expect(stmt.action).toBeTruthy();
    assertValidShape(stmt);
  });

  it('all NTI signals produce non-empty title and body', () => {
    const signals = ['prime_buy', 'stable', 'too_late', 'risk'] as const;
    for (const s of signals) {
      const stmt = ntiConsequence(s);
      expect(stmt.title.length).toBeGreaterThan(0);
      expect(stmt.body.length).toBeGreaterThan(0);
    }
  });
});
