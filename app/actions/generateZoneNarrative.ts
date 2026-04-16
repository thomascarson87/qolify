'use server';

/**
 * generateZoneNarrative — Zone Report page
 *
 * Generates a 3–4 sentence plain-English summary of a postcode zone for a
 * property buyer, synthesising TVI grade, flood risk, school access, solar
 * exposure, and VUT density into a readable narrative.
 *
 * Uses Haiku (minimum cost). Returns null on any error or missing API key.
 */

import Anthropic from '@anthropic-ai/sdk';

export async function generateZoneNarrative(data: {
  postcode:           string;
  city:               string;
  tvi:                number;
  grade:              string;
  floodSafe:          boolean;
  hasT10Flood:        boolean;
  schoolScore:        number | null;
  nearestSchoolM:     number | null;
  schoolsIn400m:      number;
  healthScore:        number | null;
  nearestGpM:         number | null;
  communityScore:     number | null;
  vutDensityPct:      number | null;
  solarScore:         number | null;
  annualSunshineH:    number | null;
  avgPriceSqm:        number | null;
}): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const client = new Anthropic();

  const floodText = data.hasT10Flood
    ? 'in a T10 (high-frequency) flood zone'
    : data.floodSafe
      ? 'outside all SNCZI flood zones (low flood risk)'
      : 'in a flood risk zone but not T10';

  const schoolText = data.nearestSchoolM != null
    ? `nearest school ${Math.round(data.nearestSchoolM)}m away, ${data.schoolsIn400m} within 400m`
    : 'school proximity data unavailable';

  const gpText = data.nearestGpM != null
    ? `nearest GP ${Math.round(data.nearestGpM)}m away`
    : '';

  const vutText = data.vutDensityPct != null
    ? `VUT (Airbnb-style) rental density: ${data.vutDensityPct.toFixed(1)}%`
    : '';

  const priceText = data.avgPriceSqm != null
    ? `average price ~€${data.avgPriceSqm.toLocaleString('es-ES')}/m²`
    : '';

  const prompt = `Write 3–4 plain-English sentences characterising postcode ${data.postcode} in ${data.city}, Spain for a property buyer. Grade: ${data.grade} (overall score ${Math.round(data.tvi)}/100).

Data: ${floodText}. ${schoolText}. ${gpText ? gpText + '.' : ''} ${vutText ? vutText + '.' : ''} ${priceText ? priceText + '.' : ''}${data.annualSunshineH ? ` ${data.annualSunshineH} sunshine hours/year.` : ''}

Rules: Do not use scores or numbers from the grade system. Do not start with "This postcode" or "This zone". Translate data into plain language. End with the main concern or standout strength if clear. No bullet points, no headers.`;

  try {
    const message = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 160,
      messages:   [{ role: 'user', content: prompt }],
    });
    return message.content[0].type === 'text' ? message.content[0].text : null;
  } catch {
    return null;
  }
}
