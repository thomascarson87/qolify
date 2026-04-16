/**
 * GET /api/catastro
 *
 * Proxy for the Catastro OVC (Oficina Virtual del Catastro) API.
 * Attempts to resolve a referencia catastral from a street address.
 *
 * Query params:
 *   streetNumber  — the house number entered by the user (required)
 *   address       — resolved address string from Nominatim (optional)
 *                   e.g. "Calle Almona 45, 29016 Málaga"
 *
 * Calls ObtenerNumerero endpoint, parses the XML response, and returns:
 *   { ref_catastral: string | null }
 *
 * The Catastro OVC API is public and requires no authentication.
 * We proxy it server-side to avoid browser CORS restrictions.
 */

import { NextRequest, NextResponse } from 'next/server';

// Spanish street type prefixes → Catastro sigla codes
const SIGLA_MAP: Record<string, string> = {
  'calle':    'CL',
  'cl':       'CL',
  'avenida':  'AV',
  'av':       'AV',
  'avda':     'AV',
  'paseo':    'PS',
  'ps':       'PS',
  'plaza':    'PZ',
  'pl':       'PZ',
  'carretera':'CR',
  'ctra':     'CR',
  'camino':   'CM',
  'cm':       'CM',
  'ronda':    'RD',
  'rd':       'RD',
  'urbanización': 'UR',
  'ur':       'UR',
};

interface ParsedAddress {
  sigla:   string;
  calle:   string;
  numero:  string;
}

/**
 * Attempt to parse a Spanish street address into Catastro sigla + street name + number.
 * Input examples:
 *   "Calle Almona 45, 29016 Málaga"    → { sigla: 'CL', calle: 'Almona', numero: '45' }
 *   "Avenida de Andalucía 12, Málaga"  → { sigla: 'AV', calle: 'de Andalucía', numero: '12' }
 *
 * Returns null if the address cannot be parsed with reasonable confidence.
 */
function parseAddress(address: string, streetNumber: string): ParsedAddress | null {
  // Normalise — remove postal code and city suffix after the last comma block
  const cleaned = address
    .replace(/,\s*\d{5}\s*\w*/g, '')   // remove ", 29016 Málaga"
    .replace(/,.*$/, '')               // remove anything after remaining comma
    .trim();

  const parts = cleaned.split(/\s+/);
  if (parts.length < 2) return null;

  const firstWord = parts[0].toLowerCase().replace(/[^a-záéíóúüñ]/gi, '');
  const sigla = SIGLA_MAP[firstWord];

  if (!sigla) return null;

  // Street name = everything after the type prefix, minus any trailing house number
  // that may have been included in the resolved address string.
  const afterType = parts.slice(1).join(' ');
  // Remove a trailing number segment (e.g. "45" or "45B") if present
  const calle = afterType.replace(/\s+\d+\w*$/, '').trim();

  if (!calle) return null;

  return { sigla, calle, numero: streetNumber.trim() };
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const streetNumber = searchParams.get('streetNumber')?.trim() ?? '';
  const address      = searchParams.get('address')?.trim() ?? '';

  if (!streetNumber) {
    return NextResponse.json({ ref_catastral: null, reason: 'no_street_number' });
  }

  const parsed = address ? parseAddress(address, streetNumber) : null;

  if (!parsed) {
    // Cannot parse address well enough to attempt lookup
    return NextResponse.json({ ref_catastral: null, reason: 'address_parse_failed' });
  }

  const url = new URL(
    'https://ovc.catastro.meh.es/OVCServWeb/OVCWcfLibres/OVCFotoFachada.svc/ObtenerNumerero'
  );
  url.searchParams.set('Provincia', 'malaga');
  url.searchParams.set('Municipio', 'malaga');
  url.searchParams.set('Sigla',     parsed.sigla);
  url.searchParams.set('Calle',     parsed.calle.toUpperCase());
  url.searchParams.set('Numero',    parsed.numero);

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/xml, text/xml' },
      signal:  AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return NextResponse.json({ ref_catastral: null, reason: `catastro_http_${res.status}` });
    }

    const xml = await res.text();

    // Extract pc1 + pc2 to form the 14-character referencia catastral.
    // The XML contains <pc><pc1>XXXXXXX</pc1><pc2>XXXXXXX</pc2></pc>
    const pc1Match = xml.match(/<pc1>([^<]+)<\/pc1>/i);
    const pc2Match = xml.match(/<pc2>([^<]+)<\/pc2>/i);

    if (pc1Match && pc2Match) {
      const ref = `${pc1Match[1].trim()}${pc2Match[1].trim()}`;
      return NextResponse.json({ ref_catastral: ref });
    }

    // Alternatively, look for a full <rc> element
    const rcMatch = xml.match(/<rc>([^<]{14,20})<\/rc>/i);
    if (rcMatch) {
      return NextResponse.json({ ref_catastral: rcMatch[1].trim() });
    }

    return NextResponse.json({ ref_catastral: null, reason: 'not_found_in_response' });

  } catch {
    return NextResponse.json(
      { ref_catastral: null, reason: 'fetch_error' },
      { status: 502 }
    );
  }
}
