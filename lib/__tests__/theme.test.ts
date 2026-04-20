/**
 * Unit tests for lib/theme.ts
 *
 * All browser globals (localStorage, document.documentElement) are mocked
 * inline — no jsdom needed, runs in the default node environment.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { STORAGE_KEY, getStoredTheme, applyTheme, saveTheme, toggleTheme } from '../theme'

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

function makeStorageMock() {
  let store: Record<string, string> = {}
  return {
    getItem:    (k: string) => store[k] ?? null,
    setItem:    (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
    clear:      () => { store = {} },
  }
}

// ---------------------------------------------------------------------------
// document.documentElement mock
// ---------------------------------------------------------------------------

function makeHtmlMock() {
  const attrs: Record<string, string> = {}
  return {
    setAttribute:    vi.fn((k: string, v: string) => { attrs[k] = v }),
    removeAttribute: vi.fn((k: string) => { delete attrs[k] }),
    getAttribute:    (k: string) => attrs[k] ?? null,
  }
}

// ---------------------------------------------------------------------------
// toggleTheme — pure, no globals
// ---------------------------------------------------------------------------

describe('toggleTheme', () => {
  it('flips dark to light', () => {
    expect(toggleTheme('dark')).toBe('light')
  })
  it('flips light to dark', () => {
    expect(toggleTheme('light')).toBe('dark')
  })
})

// ---------------------------------------------------------------------------
// getStoredTheme
// ---------------------------------------------------------------------------

describe('getStoredTheme', () => {
  let storage: ReturnType<typeof makeStorageMock>

  beforeEach(() => {
    storage = makeStorageMock()
    vi.stubGlobal('localStorage', storage)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Default theme is 'dark' — Qolify's map-centric UI is dark-themed, and
  // only an explicit 'light' value in localStorage opts a user out of it.
  it('returns "dark" when nothing is stored', () => {
    expect(getStoredTheme()).toBe('dark')
  })

  it('returns "dark" when stored value is "dark"', () => {
    storage.setItem(STORAGE_KEY, 'dark')
    expect(getStoredTheme()).toBe('dark')
  })

  it('returns "light" when stored value is "light"', () => {
    storage.setItem(STORAGE_KEY, 'light')
    expect(getStoredTheme()).toBe('light')
  })

  it('returns "dark" when stored value is something unexpected', () => {
    storage.setItem(STORAGE_KEY, 'unknown')
    expect(getStoredTheme()).toBe('dark')
  })

  it('returns "dark" when localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
    })
    expect(getStoredTheme()).toBe('dark')
  })
})

// ---------------------------------------------------------------------------
// applyTheme
// ---------------------------------------------------------------------------

describe('applyTheme', () => {
  let htmlEl: ReturnType<typeof makeHtmlMock>

  beforeEach(() => {
    htmlEl = makeHtmlMock()
    vi.stubGlobal('document', { documentElement: htmlEl })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sets data-report-theme="dark" for dark theme', () => {
    applyTheme('dark')
    expect(htmlEl.setAttribute).toHaveBeenCalledWith('data-report-theme', 'dark')
  })

  it('removes data-report-theme for light theme', () => {
    applyTheme('light')
    expect(htmlEl.removeAttribute).toHaveBeenCalledWith('data-report-theme')
  })
})

// ---------------------------------------------------------------------------
// saveTheme
// ---------------------------------------------------------------------------

describe('saveTheme', () => {
  let storage: ReturnType<typeof makeStorageMock>

  beforeEach(() => {
    storage = makeStorageMock()
    vi.stubGlobal('localStorage', storage)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes "dark" to localStorage', () => {
    saveTheme('dark')
    expect(storage.getItem(STORAGE_KEY)).toBe('dark')
  })

  it('writes "light" to localStorage', () => {
    saveTheme('light')
    expect(storage.getItem(STORAGE_KEY)).toBe('light')
  })

  it('does not throw when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => { throw new Error('blocked') },
    })
    expect(() => saveTheme('dark')).not.toThrow()
  })
})
