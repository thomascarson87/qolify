/**
 * analysePoller — pure async polling logic for the async analysis pipeline.
 *
 * Extracted from the React layer so it can be unit-tested in Node/Vitest
 * without any DOM, router, or component dependencies.
 *
 * Usage:
 *   for await (const state of pollJob('abc-123')) {
 *     if (state.phase === 'complete') return state.result
 *   }
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AnalysisProperty {
  lat: number | null
  lng: number | null
  price_asking: number | null
  price_per_sqm: number | null
  area_sqm: number | null
  provincia: string | null
  municipio: string | null
  build_year: number | null
  epc_rating: string | null
  address: string | null
  bedrooms: number | null
  bathrooms: number | null
  property_type: string | null
  floor: number | null
}

export interface AnalysisResult {
  id: string
  source_url: string
  cached: boolean
  expires_at: string
  tvi_score: number
  composite_indicators: Record<string, unknown>
  alerts: Array<{ type: 'red' | 'amber' | 'green'; title: string; description: string }>
  property: AnalysisProperty
}

export type PollState =
  | { phase: 'loading';     step: number }
  | { phase: 'needs_input'; missing: string[]; sourceUrl: string }
  | { phase: 'complete';    result: AnalysisResult }
  | { phase: 'error';       message: string }
  | { phase: 'timeout' }

// ─── Constants ────────────────────────────────────────────────────────────────

export const MAX_POLLS     = 90   // 90 × 2 000ms = 3 min max
export const POLL_INTERVAL = 2_000

// ─── Single poll ──────────────────────────────────────────────────────────────

/**
 * Fetches one status snapshot for `jobId`.
 * Returns a `PollState` — never throws (errors are returned as `{ phase: 'error' }`).
 *
 * Pure function: the only side effect is the `fetch` call. Easily mockable in tests.
 */
export async function singlePoll(
  jobId: string,
  fetchFn: typeof fetch = fetch,
): Promise<PollState> {
  let res: Response
  try {
    res = await fetchFn(`/api/analyse/status?jobId=${encodeURIComponent(jobId)}`)
  } catch {
    return { phase: 'error', message: 'Network error — check your connection.' }
  }

  if (!res.ok) {
    if (res.status === 404) {
      return { phase: 'error', message: 'Analysis not found. The link may have expired.' }
    }
    return { phase: 'error', message: `Status check failed (HTTP ${res.status}).` }
  }

  let data: Record<string, unknown>
  try {
    data = await res.json()
  } catch {
    return { phase: 'error', message: 'Invalid response from server.' }
  }

  if (data.status === 'complete') {
    // Normalise composite_indicators: handle legacy double-encoded rows (CHI-331)
    const raw = data.composite_indicators
    const indicators: Record<string, unknown> =
      typeof raw === 'string'
        ? (() => { try { return JSON.parse(raw) } catch { return {} } })()
        : (raw && typeof raw === 'object' ? raw as Record<string, unknown> : {})

    return {
      phase:  'complete',
      result: { ...data, composite_indicators: indicators } as AnalysisResult,
    }
  }

  if (data.status === 'needs_input') {
    return {
      phase:     'needs_input',
      missing:   Array.isArray(data.missing) ? (data.missing as string[]) : ['lat', 'lng'],
      sourceUrl: typeof data.sourceUrl === 'string' ? data.sourceUrl : '',
    }
  }

  if (data.status === 'error') {
    const msg = typeof data.message === 'string' ? data.message : 'Analysis failed.'
    // Belt-and-suspenders: detect structured NEEDS_INPUT via raw error_message
    if (msg.startsWith('NEEDS_INPUT:')) {
      const missing = msg.slice('NEEDS_INPUT:'.length).split(',').filter(Boolean)
      return { phase: 'needs_input', missing, sourceUrl: '' }
    }
    return { phase: 'error', message: msg }
  }

  // pending or processing
  return { phase: 'loading', step: typeof data.step === 'number' ? data.step : 0 }
}

// ─── Polling loop (async generator) ──────────────────────────────────────────

/**
 * Async generator that yields a `PollState` every `POLL_INTERVAL`ms until the
 * job reaches a terminal state (`complete`, `error`, `needs_input`, `timeout`).
 *
 * The caller is responsible for breaking out of the loop on terminal states.
 *
 * @example
 * for await (const state of pollJob(jobId)) {
 *   onStateChange(state)
 *   if (state.phase !== 'loading') break
 * }
 */
export async function* pollJob(
  jobId: string,
  fetchFn: typeof fetch = fetch,
  sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
): AsyncGenerator<PollState> {
  // Emit an immediate loading state (step 0) so the UI shows something right away
  yield { phase: 'loading', step: 0 }

  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL)
    const state = await singlePoll(jobId, fetchFn)
    yield state
    if (state.phase !== 'loading') return
  }

  yield { phase: 'timeout' }
}
