'use server';

/**
 * generateHealthNarrative — Health deep-dive page
 *
 * Generates a 2-3 sentence plain-English narrative about healthcare access
 * for a postcode. Server action — Claude API runs server-side only.
 * Returns null on any error or missing API key.
 */

import Anthropic from '@anthropic-ai/sdk';

export async function generateHealthNarrative(data: {
  postcode:           string;
  city:               string;
  nearestGpM:         number | null;
  nearestHospitalKm:  number | null;
  nearestUrgenciasKm: number | null;
  pharmacies500m:     number;
  avgDaysGp:          number | null;
  avgDaysSurgery:     number | null;
}): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const client = new Anthropic();

  const gpText = data.nearestGpM != null
    ? `Nearest GP is ${data.nearestGpM}m away`
    : 'GP distance unknown';

  const hospitalText = data.nearestHospitalKm != null
    ? `, nearest hospital ${data.nearestHospitalKm.toFixed(1)}km away`
    : '';

  const urgenciasText = data.nearestUrgenciasKm != null
    ? `, nearest 24h emergency unit ${data.nearestUrgenciasKm.toFixed(1)}km away`
    : '';

  const waitText = data.avgDaysGp != null || data.avgDaysSurgery != null
    ? `. Regional waiting times: ${data.avgDaysGp != null ? `GP ~${data.avgDaysGp} days` : ''}${data.avgDaysSurgery != null ? `, surgery ~${Math.round(data.avgDaysSurgery)} days` : ''}`
    : '';

  const pharmacyText = data.pharmacies500m > 0
    ? `. ${data.pharmacies500m} pharmacies within 500m`
    : '';

  const prompt = `Write 2-3 plain-English sentences about healthcare access for someone buying a property in ${data.city}, Spain (postcode ${data.postcode}).

Data: ${gpText}${hospitalText}${urgenciasText}${waitText}${pharmacyText}.

One sentence on what the healthcare proximity means for day-to-day life. One sentence on what this means practically — be honest about any limitations. No scores or numbers unless from the data above.`;

  try {
    const message = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 140,
      messages:   [{ role: 'user', content: prompt }],
    });
    return message.content[0].type === 'text' ? message.content[0].text : null;
  } catch {
    return null;
  }
}
