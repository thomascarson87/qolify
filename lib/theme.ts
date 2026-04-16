/**
 * lib/theme.ts — Qolify day/night theme utilities.
 *
 * Pure functions only — no React, no side-effectful imports.
 * Consumed by ThemeToggle (component) and the no-FOUC layout script.
 *
 * Theme is encoded as `data-report-theme="dark"` on <html>.
 * CSS variable overrides in globals.css respond to that attribute.
 * Preference is persisted in localStorage under STORAGE_KEY.
 */

export const STORAGE_KEY = 'qolify-report-theme' as const

/** CustomEvent name dispatched by applyTheme so MapClient can update the tile style. */
export const THEME_EVENT = 'qolify-theme-change' as const

export type Theme = 'dark' | 'light'

/**
 * Read the user's saved preference from localStorage.
 * Defaults to 'dark' — the map is dark-first and report pages follow suit.
 * Returns 'light' only when the user has explicitly stored that preference.
 */
export function getStoredTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

/**
 * Apply a theme to the document by setting or removing the
 * `data-report-theme` attribute on <html>, then dispatches a
 * CustomEvent so MapClient can swap the MapLibre tile style.
 */
export function applyTheme(theme: Theme): void {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-report-theme', 'dark')
  } else {
    document.documentElement.removeAttribute('data-report-theme')
  }
  // Notify MapClient (and any other listeners) that the theme has changed.
  // Guard against non-browser environments (SSR / unit tests).
  try {
    document.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: theme }))
  } catch { /* non-browser env — safe to ignore */ }
}

/**
 * Persist a theme preference to localStorage (no-op if unavailable).
 */
export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch { /* localStorage unavailable */ }
}

/**
 * Return the opposite theme — pure function, safe to test without a DOM.
 */
export function toggleTheme(current: Theme): Theme {
  return current === 'dark' ? 'light' : 'dark'
}

/**
 * Inline script content for layout.tsx `<script>` tag.
 * Runs synchronously before first paint to avoid a flash of the wrong theme.
 * Minified intentionally — it goes into the HTML as a raw string.
 */
export const NO_FOUC_SCRIPT =
  `try{var t=localStorage.getItem('${STORAGE_KEY}');` +
  `if(t==='dark')document.documentElement.setAttribute('data-report-theme','dark')}catch(e){}`
