/**
 * lib/pvgis.ts — PVGIS JRC API helpers for Qolify
 *
 * Two endpoints used:
 *   /seriescalc  — raw hourly irradiance data (used by ingest scripts)
 *   /PVcalc      — PV system yield calculation (used by CHI-380 solar potential)
 *
 * Both are public EU services, no API key required.
 * Docs: https://joint-research-centre.ec.europa.eu/pvgis-photovoltaic-geographical-information-system_en
 */

const PVGIS_BASE = 'https://re.jrc.ec.europa.eu/api/v5_2';

// Timeout for PVGIS API calls — 10 seconds. If it times out, the caller should
// gracefully degrade (show zone-level irradiance without PVcalc yield).
const PVGIS_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Azimuth mapping
// ---------------------------------------------------------------------------

/**
 * PVGIS azimuth convention:
 *   0   = South (optimal for Spain)
 *  90   = West
 * -90   = East
 *  180  = North (worst)
 */
export const ASPECT_TO_AZIMUTH: Record<string, number> = {
  S:   0,
  SE: -45,
  SW:  45,
  E:  -90,
  W:   90,
  NE: -135,
  NW:  135,
  N:   180,
};

/**
 * Optimal tilt angle for Spain:
 * Rule of thumb: tilt ≈ latitude − 10°, clamped to [20°, 40°].
 * For Málaga (36.7°N) → 27°; for Bilbao (43.3°N) → 33°.
 */
export function optimalTilt(lat: number): number {
  return Math.max(20, Math.min(40, Math.round(lat - 10)));
}

// ---------------------------------------------------------------------------
// PVcalc response types
// ---------------------------------------------------------------------------

export interface PVcalcResult {
  /** Annual kWh yield for the specified system. */
  annual_kwh: number;
  /** Monthly kWh array, Jan → Dec (length 12). */
  monthly_kwh: number[];
  /** Tilt used (degrees). */
  tilt_deg: number;
  /** Azimuth used (0=S, 90=W, -90=E, 180=N). */
  azimuth_deg: number;
}

interface PVGISPVcalcResponse {
  outputs: {
    totals: { fixed: { E_y: number } };
    monthly: { fixed: Array<{ month: number; E_m: number }> };
  };
}

// ---------------------------------------------------------------------------
// callPvgisPvcalc
// ---------------------------------------------------------------------------

/**
 * Call the PVGIS /PVcalc endpoint to get annual + monthly kWh yield
 * for a PV system at the given location.
 *
 * Returns null on timeout or API error — callers must handle null gracefully.
 *
 * @param lat        Latitude (decimal degrees)
 * @param lng        Longitude (decimal degrees)
 * @param peakpowerKwp  Installed peak power (kWp)
 * @param aspectDeg  Azimuth angle: 0=South, 90=West, -90=East, 180=North
 * @param tiltDeg    Panel tilt in degrees from horizontal (0=flat, 90=vertical)
 */
export async function callPvgisPvcalc(
  lat:            number,
  lng:            number,
  peakpowerKwp:   number,
  aspectDeg:      number = 0,
  tiltDeg:        number = 30,
): Promise<PVcalcResult | null> {
  const url = new URL(`${PVGIS_BASE}/PVcalc`);
  url.searchParams.set('lat',           lat.toFixed(5));
  url.searchParams.set('lon',           lng.toFixed(5));
  url.searchParams.set('peakpower',     peakpowerKwp.toFixed(2));
  url.searchParams.set('loss',          '14');          // 14% system losses (cables, inverter, soiling)
  url.searchParams.set('aspect',        aspectDeg.toString());
  url.searchParams.set('angle',         tiltDeg.toString());
  url.searchParams.set('outputformat',  'json');
  url.searchParams.set('pvtechchoice',  'crystSi');     // standard monocrystalline silicon
  url.searchParams.set('mountingplace', 'building');    // building-integrated (not free-standing)

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PVGIS_TIMEOUT_MS);

    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
      // next.js cache: revalidate once per day since PVGIS data is stable
      next: { revalidate: 86400 },
    });

    clearTimeout(timer);

    if (!res.ok) {
      console.warn(`[pvgis] PVcalc returned HTTP ${res.status} for lat=${lat} lon=${lng}`);
      return null;
    }

    const data = await res.json() as PVGISPVcalcResponse;

    const annualKwh = data?.outputs?.totals?.fixed?.E_y;
    const monthlyArr = data?.outputs?.monthly?.fixed;

    if (!annualKwh || !Array.isArray(monthlyArr) || monthlyArr.length < 12) {
      console.warn('[pvgis] PVcalc response missing expected fields');
      return null;
    }

    // Sort by month number (PVGIS returns them ordered but let's be safe)
    const sorted = [...monthlyArr].sort((a, b) => a.month - b.month);

    return {
      annual_kwh:   Math.round(annualKwh),
      monthly_kwh:  sorted.map(m => Math.round(m.E_m * 10) / 10),
      tilt_deg:     tiltDeg,
      azimuth_deg:  aspectDeg,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('abort') || msg.includes('timeout')) {
      console.warn('[pvgis] PVcalc request timed out');
    } else {
      console.warn('[pvgis] PVcalc request failed:', msg);
    }
    return null;
  }
}
