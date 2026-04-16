/**
 * Tests for analysePoller — the pure polling logic for the async analysis pipeline.
 *
 * All tests use a mock `fetchFn` so no network calls are made.
 * The sleep function is also mocked to keep the suite fast.
 */
import { describe, it, expect, vi } from 'vitest'
import { singlePoll, pollJob, MAX_POLLS, type PollState } from '../analysePoller'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockFetch(payload: Record<string, unknown>, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok:     status >= 200 && status < 300,
    status,
    json:   async () => payload,
  } as unknown as Response)
}

function mockFetchError(): typeof fetch {
  return vi.fn().mockRejectedValue(new TypeError('Network error'))
}

const noSleep = () => Promise.resolve()

// ─── singlePoll ───────────────────────────────────────────────────────────────

describe('singlePoll', () => {
  describe('pending / processing', () => {
    it('returns loading phase with step from server', async () => {
      const state = await singlePoll('job-1', mockFetch({ status: 'pending', step: 0 }))
      expect(state).toEqual({ phase: 'loading', step: 0 })
    })

    it('returns loading phase at step 3 (running indicators)', async () => {
      const state = await singlePoll('job-1', mockFetch({ status: 'processing', step: 3 }))
      expect(state).toEqual({ phase: 'loading', step: 3 })
    })

    it('defaults step to 0 when step field is absent', async () => {
      const state = await singlePoll('job-1', mockFetch({ status: 'pending' }))
      expect(state).toEqual({ phase: 'loading', step: 0 })
    })
  })

  describe('complete', () => {
    const COMPLETE_PAYLOAD = {
      status:               'complete',
      id:                   'cache-abc',
      source_url:           'https://www.idealista.com/inmueble/123/',
      cached:               false,
      expires_at:           '2026-04-02T10:00:00Z',
      tvi_score:            72,
      composite_indicators: { health_security: { score: 80, confidence: 'high', details: {}, alerts: [] } },
      alerts:               [],
      property:             { lat: 36.72, lng: -4.42, price_asking: 350000, price_per_sqm: 3888, area_sqm: 90, provincia: 'Málaga', municipio: 'Málaga', build_year: 1995, epc_rating: 'D' },
    }

    it('returns complete phase with result', async () => {
      const state = await singlePoll('job-1', mockFetch(COMPLETE_PAYLOAD))
      expect(state.phase).toBe('complete')
      if (state.phase === 'complete') {
        expect(state.result.tvi_score).toBe(72)
        expect(state.result.id).toBe('cache-abc')
      }
    })

    it('normalises double-encoded composite_indicators string (CHI-331 legacy rows)', async () => {
      const encoded = JSON.stringify({ health_security: { score: 80 } })
      const state = await singlePoll('job-1', mockFetch({ ...COMPLETE_PAYLOAD, composite_indicators: encoded }))
      expect(state.phase).toBe('complete')
      if (state.phase === 'complete') {
        expect(state.result.composite_indicators.health_security).toEqual({ score: 80 })
      }
    })

    it('returns empty object for malformed double-encoded string', async () => {
      const state = await singlePoll('job-1', mockFetch({ ...COMPLETE_PAYLOAD, composite_indicators: 'not-json' }))
      expect(state.phase).toBe('complete')
      if (state.phase === 'complete') {
        expect(state.result.composite_indicators).toEqual({})
      }
    })
  })

  describe('needs_input', () => {
    it('returns needs_input phase with missing fields and sourceUrl', async () => {
      const state = await singlePoll('job-1', mockFetch({
        status:    'needs_input',
        missing:   ['lat', 'lng'],
        sourceUrl: 'https://www.idealista.com/inmueble/123/',
      }))
      expect(state).toEqual({
        phase:     'needs_input',
        missing:   ['lat', 'lng'],
        sourceUrl: 'https://www.idealista.com/inmueble/123/',
      })
    })

    it('defaults missing to [lat, lng] when missing field is absent', async () => {
      const state = await singlePoll('job-1', mockFetch({ status: 'needs_input' }))
      expect(state.phase).toBe('needs_input')
      if (state.phase === 'needs_input') {
        expect(state.missing).toEqual(['lat', 'lng'])
      }
    })

    it('detects needs_input via raw NEEDS_INPUT: prefix in error status (belt-and-suspenders)', async () => {
      const state = await singlePoll('job-1', mockFetch({
        status:  'error',
        message: 'NEEDS_INPUT:lat,lng,price_asking',
      }))
      expect(state.phase).toBe('needs_input')
      if (state.phase === 'needs_input') {
        expect(state.missing).toEqual(['lat', 'lng', 'price_asking'])
      }
    })
  })

  describe('error', () => {
    it('returns error phase with message', async () => {
      const state = await singlePoll('job-1', mockFetch({ status: 'error', message: 'Parse.bot failed' }))
      expect(state).toEqual({ phase: 'error', message: 'Parse.bot failed' })
    })

    it('uses fallback message when message field is absent', async () => {
      const state = await singlePoll('job-1', mockFetch({ status: 'error' }))
      expect(state.phase).toBe('error')
      if (state.phase === 'error') {
        expect(state.message).toBeTruthy()
      }
    })

    it('returns error phase on HTTP 500', async () => {
      const state = await singlePoll('job-1', mockFetch({ error: 'internal' }, 500))
      expect(state.phase).toBe('error')
    })

    it('returns error phase with 404 message on HTTP 404', async () => {
      const state = await singlePoll('job-1', mockFetch({ error: 'not_found' }, 404))
      expect(state).toEqual({ phase: 'error', message: 'Analysis not found. The link may have expired.' })
    })

    it('returns error phase on network failure', async () => {
      const state = await singlePoll('job-1', mockFetchError())
      expect(state).toEqual({ phase: 'error', message: 'Network error — check your connection.' })
    })
  })
})

// ─── pollJob (async generator) ────────────────────────────────────────────────

describe('pollJob', () => {
  it('yields initial loading state immediately (step 0)', async () => {
    const fetchFn = mockFetch({ status: 'complete', id: 'c1', source_url: '', cached: false,
      expires_at: '', tvi_score: 70, composite_indicators: {}, alerts: [], property: {} })
    const gen = pollJob('job-1', fetchFn, noSleep)
    const first = await gen.next()
    expect(first.value).toEqual({ phase: 'loading', step: 0 })
  })

  it('terminates on complete', async () => {
    const fetchFn = mockFetch({ status: 'complete', id: 'c1', source_url: '', cached: false,
      expires_at: '', tvi_score: 70, composite_indicators: {}, alerts: [], property: {} })
    const states: PollState[] = []
    for await (const s of pollJob('job-1', fetchFn, noSleep)) {
      states.push(s)
    }
    expect(states.at(-1)?.phase).toBe('complete')
  })

  it('terminates on error', async () => {
    const fetchFn = mockFetch({ status: 'error', message: 'boom' })
    const states: PollState[] = []
    for await (const s of pollJob('job-1', fetchFn, noSleep)) {
      states.push(s)
    }
    expect(states.at(-1)?.phase).toBe('error')
  })

  it('terminates on needs_input', async () => {
    const fetchFn = mockFetch({ status: 'needs_input', missing: ['lat', 'lng'], sourceUrl: '' })
    const states: PollState[] = []
    for await (const s of pollJob('job-1', fetchFn, noSleep)) {
      states.push(s)
    }
    expect(states.at(-1)?.phase).toBe('needs_input')
  })

  it('yields timeout after MAX_POLLS loading responses', async () => {
    const fetchFn = mockFetch({ status: 'pending', step: 1 })
    const states: PollState[] = []
    for await (const s of pollJob('job-1', fetchFn, noSleep)) {
      states.push(s)
    }
    expect(states.at(-1)?.phase).toBe('timeout')
    // +1 for the immediate initial loading state
    expect(states.length).toBe(MAX_POLLS + 2)
  }, 30_000)

  it('passes loading step values through during polling', async () => {
    let call = 0
    const steps = [1, 2, 3]
    const fetchFn = vi.fn().mockImplementation(async () => {
      const step = steps[call] ?? 3
      const isLast = call >= steps.length - 1
      call++
      return {
        ok: true, status: 200,
        json: async () => isLast
          ? { status: 'complete', id: 'c1', source_url: '', cached: false,
              expires_at: '', tvi_score: 65, composite_indicators: {}, alerts: [], property: {} }
          : { status: 'processing', step },
      } as unknown as Response
    })

    const loadingSteps: number[] = []
    for await (const s of pollJob('job-1', fetchFn as typeof fetch, noSleep)) {
      if (s.phase === 'loading') loadingSteps.push(s.step)
    }
    expect(loadingSteps).toContain(1)
    expect(loadingSteps).toContain(2)
  })
})
