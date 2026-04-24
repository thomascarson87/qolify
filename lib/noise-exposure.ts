/**
 * lib/noise-exposure.ts — CHI-417
 *
 * Plain-English consequence statements + reference points for Lden noise
 * exposure. The DNA Report NoiseExposureCard renders these directly; the
 * same function is also reused by the /map panel.
 *
 * Lden model context — the EU Environmental Noise Directive (END) uses a
 * composite 24-hour metric weighted by time of day (+5 dB evening,
 * +10 dB night). WHO (2018) recommends < 53 dB Lden for roads,
 * < 54 dB for rail, < 45 dB for aircraft.
 *
 * Bands in our schema: 55-60, 60-65, 65-70, 70-75, 75+.
 * Exposure below 55 dB is not represented in EEA strategic noise maps —
 * a "no polygon" result therefore maps to the reassuring green band.
 */

export type NoiseSourceType = 'road' | 'rail' | 'airport' | 'industry';

export interface NoiseExposure {
  /** Lower dB bound of the mapped band. null → outside all noise polygons. */
  lden:        number | null;
  /** Display label, e.g. "60-65" or "75+". */
  band:        string | null;
  /** Dominant source category for this coordinate. */
  source_type: NoiseSourceType | null;
}

export interface NoiseConsequence {
  signal:   'green' | 'amber' | 'red' | 'neutral';
  title:    string;
  body:     string;
  action?:  string;
  /** Everyday-sound comparable for the band ("busy road", "quiet office"). */
  reference: string;
}

/** Human reference points per 5-dB step — used in the horizontal dB ladder. */
export const DB_REFERENCE_POINTS: Array<{ lden: number; label: string }> = [
  { lden: 30, label: 'Quiet bedroom at night'  },
  { lden: 40, label: 'Library reading room'    },
  { lden: 50, label: 'Quiet residential street'},
  { lden: 55, label: 'Suburban daytime ambient'},
  { lden: 60, label: 'Normal conversation'     },
  { lden: 65, label: 'Busy urban street'       },
  { lden: 70, label: 'Secondary road, 50 km/h' },
  { lden: 75, label: 'Motorway, 80 km/h'       },
  { lden: 80, label: 'Passing heavy truck'     },
];

function sourceNoun(s: NoiseSourceType | null): string {
  switch (s) {
    case 'road':     return 'road traffic';
    case 'rail':     return 'rail traffic';
    case 'airport':  return 'aircraft';
    case 'industry': return 'industrial activity';
    default:         return 'mapped environmental sources';
  }
}

export function noiseConsequence(e: NoiseExposure): NoiseConsequence {
  // ---- outside all polygons -------------------------------------------------
  // EEA strategic noise maps only record exposure ≥ 55 dB Lden. A miss means
  // the coordinate is below that threshold and is treated as quiet.
  if (e.lden === null) {
    return {
      signal:    'green',
      title:     'Below mapped noise thresholds.',
      body:      'This address does not fall within any EEA-mapped noise contour, meaning day-evening-night average exposure is under 55 dB Lden — typical of a quiet residential street.',
      reference: '< 55 dB · Quiet residential street',
    };
  }

  const src = sourceNoun(e.source_type);

  // ---- 75+ dB — severe exposure --------------------------------------------
  if (e.lden >= 75) {
    return {
      signal: 'red',
      title:  'Severe noise exposure at this address.',
      body:   `Day-evening-night average ≥ 75 dB Lden from ${src} — comparable to a motorway at close range. WHO links chronic exposure at this level to cardiovascular disease and sleep disruption.`,
      action: 'Inspect the property for double-glazed windows rated ≥ 36 dB Rw, and verify any bedroom windows face away from the source.',
      reference: '75+ dB · Motorway at close range',
    };
  }

  // ---- 70-75 dB — very high ------------------------------------------------
  if (e.lden >= 70) {
    return {
      signal: 'red',
      title:  'Very high noise exposure from nearby source.',
      body:   `70–75 dB Lden from ${src} — well above WHO health-based guidelines. Expect persistent background noise indoors unless glazing and façade insulation have been upgraded.`,
      action: 'Ask the seller about acoustic glazing certificates and whether the façade has been treated for noise attenuation.',
      reference: '70–75 dB · Secondary road at 50 km/h',
    };
  }

  // ---- 65-70 dB — high -----------------------------------------------------
  if (e.lden >= 65) {
    return {
      signal: 'amber',
      title:  'High noise exposure from nearby source.',
      body:   `65–70 dB Lden from ${src} — above WHO guideline thresholds. Daytime use is tolerable for most; sleep quality may be affected without acoustic glazing.`,
      action: 'Check which rooms face the noise source before committing, and factor acoustic-glazing upgrade costs into your offer if bedrooms are on the exposed side.',
      reference: '65–70 dB · Busy urban street',
    };
  }

  // ---- 60-65 dB — moderate-high --------------------------------------------
  if (e.lden >= 60) {
    return {
      signal: 'amber',
      title:  'Moderate-to-high noise exposure.',
      body:   `60–65 dB Lden from ${src} — a noticeable baseline, comparable to normal conversation. Liveable for most buyers but worth confirming during a site visit at peak hours.`,
      reference: '60–65 dB · Normal conversation',
    };
  }

  // ---- 55-60 dB — moderate -------------------------------------------------
  return {
    signal: 'neutral',
    title:  'Moderate ambient noise level.',
    body:   `55–60 dB Lden from ${src} — close to WHO daytime guidance and typical of a suburban address with daytime activity.`,
    reference: '55–60 dB · Suburban daytime ambient',
  };
}
