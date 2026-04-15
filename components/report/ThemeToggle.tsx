'use client';

/**
 * ThemeToggle — day/night mode switcher.
 *
 * Reads the stored preference on mount, applies it immediately (no flash),
 * and writes back to localStorage on every toggle.
 *
 * Logic lives in lib/theme.ts so it can be unit-tested independently.
 */

import { useEffect, useState } from 'react';
import { applyTheme, getStoredTheme, saveTheme, toggleTheme, type Theme } from '@/lib/theme';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const stored = getStoredTheme();
    // Reading localStorage and syncing to state on mount is the correct
    // SSR-safe pattern for theme initialisation — disable the rule here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(stored);
    applyTheme(stored);
  }, []);

  function handleToggle() {
    const next = toggleTheme(theme);
    setTheme(next);
    applyTheme(next);
    saveTheme(next);
  }

  const dark = theme === 'dark';

  return (
    <button
      onClick={handleToggle}
      title={dark ? 'Switch to day mode' : 'Switch to night mode'}
      style={{
        display:     'flex',
        alignItems:  'center',
        gap:         5,
        fontFamily:  'var(--font-dm-sans)',
        fontSize:    12,
        fontWeight:  500,
        color:       'var(--text-light)',
        background:  'transparent',
        border:      '1px solid var(--border)',
        borderRadius: 6,
        padding:     '4px 10px',
        cursor:      'pointer',
        transition:  'color 120ms, border-color 120ms',
        lineHeight:  1,
        whiteSpace:  'nowrap',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-light)'; }}
    >
      <span aria-hidden style={{ fontSize: 13 }}>{dark ? '☀' : '☾'}</span>
      {dark ? 'Day' : 'Night'}
    </button>
  );
}
