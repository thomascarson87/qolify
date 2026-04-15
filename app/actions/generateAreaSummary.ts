'use server';

/**
 * generateAreaSummary — CHI-368
 *
 * Server action that calls the Claude API to produce a 3–4 sentence
 * plain-English characterisation of a pin location for a property buyer.
 *
 * Input is structured data already collected by POST /api/map/pin — no
 * speculation, no hallucination. The summary is a narrative synthesis of
 * real data points already on screen.
 *
 * Returns null on any error so the caller can silently hide the section.
 */

import Anthropic from '@anthropic-ai/sdk';

export interface AreaSummaryInput {
  floodStatus:    'safe' | 't10' | 't100' | 't500';
  schoolCount:    number;
  nearestSchoolM: number;
  gpCount:        number;
  supermarketCount: number;
  parkCount:      number;
  vutCount:       number;
  zoneScore:      number | null;
  zoneGrade:      string | null;
  priceSqm:       number | null;
  fibreStatus:    string | null;
  postcode:       string;
  city:           string;
}

export async function generateAreaSummary(
  data: AreaSummaryInput
): Promise<string | null> {
  // Require API key — fail silently if not configured
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const client = new Anthropic();

  const floodText =
    data.floodStatus === 'safe'
      ? 'No flood risk (outside all SNCZI zones)'
      : `In SNCZI ${data.floodStatus.toUpperCase()} flood zone`;

  const prompt = `You are writing a 3-4 sentence plain-English summary of a location in ${data.city}, Spain for a property buyer.

Use only the data provided. Do not speculate. Do not use jargon or scores in the summary — translate them into plain language. Do not start with "This location" — vary the opening.

Data:
- Flood risk: ${floodText}
- Schools within 400m: ${data.schoolCount} (nearest ${data.nearestSchoolM}m)
- GP surgeries within 400m: ${data.gpCount}
- Supermarkets within 400m: ${data.supermarketCount}
- Parks within 400m: ${data.parkCount}
- Active tourist rental licences within 200m: ${data.vutCount}
- Zone quality of life score: ${data.zoneScore !== null ? `${data.zoneScore}/100` : 'not available'}
- Price context: ${data.priceSqm ? `~€${data.priceSqm.toLocaleString('es-ES')}/m²` : 'no data'}
- Fibre connectivity: ${data.fibreStatus || 'unknown'}
- Postcode: ${data.postcode}

Write 3-4 sentences. Start with what kind of area this is. Mention the most important facts. End with the main limitation or standout concern if there is one. Plain English only — no bullet points, no headers.`;

  try {
    const message = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 220,
      messages:   [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : null;
    // Strip any markdown headings the model occasionally inserts despite instructions
    return text ? text.replace(/^#+\s*/gm, '').trim() : null;
  } catch {
    return null;
  }
}
