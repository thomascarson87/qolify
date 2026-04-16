'use server';

/**
 * generateEducationNarrative — CHI-368
 *
 * Generates a 2-sentence plain-English narrative about school access
 * for the Education report page. Server action — Claude API only runs
 * server-side. Returns null on any error or missing API key.
 */

import Anthropic from '@anthropic-ai/sdk';

export async function generateEducationNarrative(data: {
  postcode:        string;
  city:            string;
  schoolCount:     number;
  nearestSchoolM:  number;
  zoneSchoolScore: number | null;
}): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const client = new Anthropic();

  const scoreContext = data.zoneSchoolScore != null
    ? `Zone school score: ${Math.round(data.zoneSchoolScore)}/100.`
    : '';

  const prompt = `Write exactly 2 plain-English sentences about what school access means for a family buying in ${data.city}, Spain (postcode ${data.postcode}).

Data: ${data.schoolCount} school${data.schoolCount !== 1 ? 's' : ''} within 1km, nearest ${data.nearestSchoolM}m away. ${scoreContext}

One sentence on what the school access is like. One sentence on what this means practically for families with children. No jargon.`;

  try {
    const message = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages:   [{ role: 'user', content: prompt }],
    });
    return message.content[0].type === 'text' ? message.content[0].text : null;
  } catch {
    return null;
  }
}
