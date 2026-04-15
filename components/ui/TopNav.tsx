'use client';

/**
 * TopNav — global navigation bar, added to app/layout.tsx.
 *
 * Spec: REPORT_PAGE_SPEC.md Section 6.1
 *
 * - 64px height, Navy (#0D2B4E) background, sticky top-0 z-50
 * - Left:   Qolify wordmark → /
 * - Centre: Analyse · Map links, desktop only (hidden sm:flex)
 *           Active = Emerald text + 2px underline. Inactive = slate-300.
 * - Right:  Unauthenticated → "Sign In" ghost + "Get Started" pill
 *           Authenticated   → initial circle (Emerald bg, Navy text)
 * - Mobile: Hamburger icon → bottom sheet, navy bg, closes on tap/outside
 *
 * Active link detection: usePathname()
 *   /analyse → active for any path starting with /analyse
 *   /map     → active for any path starting with /map
 *
 * Auth: supabase.auth.getSession() on mount + onAuthStateChange listener.
 * Sign In and Get Started route to /sign-in and /sign-up (not yet built —
 * links are placeholders that will 404 until auth routes exist).
 */

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ThemeToggle } from '@/components/report/ThemeToggle';
import type { User } from '@supabase/supabase-js';

// ─── Nav link config ──────────────────────────────────────────────────────────
// Saved and Compare are Phase 3 — not included yet (REPORT_PAGE_SPEC.md §7)

interface NavLink { label: string; href: string; match: (p: string) => boolean; }

const NAV_LINKS: NavLink[] = [
  { label: 'Analyse', href: '/analyse', match: (p) => p.startsWith('/analyse') },
  { label: 'Map',     href: '/map',     match: (p) => p.startsWith('/map') },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function TopNav() {
  const pathname = usePathname();
  const [user,       setUser]       = useState<User | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [menuOpen,   setMenuOpen]   = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Auth state — fetch once, then subscribe to changes
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthLoaded(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Close bottom sheet on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function onOutside(e: MouseEvent) {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [menuOpen]);

  // Close bottom sheet whenever route changes (e.g. browser back/forward).
  // setState-in-effect is intentional here — this is the correct pattern for
  // reacting to external navigation that doesn't go through a Link onClick.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  const userInitial = user?.email ? user.email[0].toUpperCase() : null;

  return (
    <>
      {/* ── Bar ───────────────────────────────────────────────────────────── */}
      <header style={{
        position:       'sticky',
        top:            0,
        zIndex:         50,
        width:          '100%',
        height:         64,
        background:     '#0D2B4E',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '0 24px',
        boxSizing:      'border-box',
        borderBottom:   '1px solid rgba(255,255,255,0.08)',
        flexShrink:     0,
      }}>

        {/* Wordmark */}
        <Link href="/" style={{
          fontFamily:     'var(--font-playfair)',
          fontStyle:      'italic',
          fontSize:       24,
          fontWeight:     600,
          color:          '#FFFFFF',
          textDecoration: 'none',
          letterSpacing:  '-0.02em',
          flexShrink:     0,
        }}>
          Qolify
        </Link>

        {/* Centre nav — desktop only */}
        <nav
          aria-label="Main navigation"
          className="hidden sm:flex"
          style={{
            alignItems: 'center',
            gap:        4,
            position:   'absolute',
            left:       '50%',
            transform:  'translateX(-50%)',
          }}
        >
          {NAV_LINKS.map(({ label, href, match }) => {
            const active = match(pathname);
            return (
              <Link
                key={href}
                href={href}
                style={{
                  fontFamily:     'var(--font-dm-sans)',
                  fontSize:       14,
                  fontWeight:     active ? 600 : 400,
                  color:          active ? '#34C97A' : '#CBD5E1',
                  textDecoration: 'none',
                  padding:        '6px 14px',
                  borderRadius:   6,
                  borderBottom:   active ? '2px solid #34C97A' : '2px solid transparent',
                  transition:     'color 120ms, border-color 120ms',
                  whiteSpace:     'nowrap',
                }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLAnchorElement).style.color = '#FFFFFF'; }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLAnchorElement).style.color = '#CBD5E1'; }}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Right side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>

          {/* Theme toggle — always visible on desktop */}
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>

          {/* Auth — desktop only, shown once loaded to avoid flash */}
          {authLoaded && (
            <div className="hidden sm:flex" style={{ alignItems: 'center', gap: 8 }}>
              {user ? (
                /* Authenticated: initial circle */
                <div style={{
                  width:          36,
                  height:         36,
                  borderRadius:   '50%',
                  background:     '#34C97A',
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'center',
                  flexShrink:     0,
                }}>
                  <span style={{
                    fontFamily: 'var(--font-dm-sans)',
                    fontSize:   14,
                    fontWeight: 600,
                    color:      '#0D2B4E',
                  }}>
                    {userInitial}
                  </span>
                </div>
              ) : (
                /* Unauthenticated: Sign In ghost + Get Started pill */
                <>
                  <Link
                    href="/sign-in"
                    style={{
                      fontFamily:     'var(--font-dm-sans)',
                      fontSize:       13,
                      fontWeight:     500,
                      color:          '#CBD5E1',
                      textDecoration: 'none',
                      padding:        '7px 14px',
                      borderRadius:   8,
                      border:         '1px solid rgba(255,255,255,0.18)',
                      transition:     'color 120ms, border-color 120ms',
                      whiteSpace:     'nowrap',
                    }}
                    onMouseEnter={e => {
                      const el = e.currentTarget as HTMLAnchorElement;
                      el.style.color       = '#FFFFFF';
                      el.style.borderColor = 'rgba(255,255,255,0.4)';
                    }}
                    onMouseLeave={e => {
                      const el = e.currentTarget as HTMLAnchorElement;
                      el.style.color       = '#CBD5E1';
                      el.style.borderColor = 'rgba(255,255,255,0.18)';
                    }}
                  >
                    Sign In
                  </Link>
                  <Link
                    href="/sign-up"
                    style={{
                      fontFamily:     'var(--font-dm-sans)',
                      fontSize:       13,
                      fontWeight:     600,
                      color:          '#0D2B4E',
                      background:     '#34C97A',
                      textDecoration: 'none',
                      padding:        '7px 18px',
                      borderRadius:   20,
                      transition:     'opacity 120ms',
                      whiteSpace:     'nowrap',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '0.88'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '1'; }}
                  >
                    Get Started
                  </Link>
                </>
              )}
            </div>
          )}

          {/* Hamburger — mobile only */}
          <button
            className="flex sm:hidden"
            onClick={() => setMenuOpen(o => !o)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            style={{
              background: 'transparent',
              border:     'none',
              cursor:     'pointer',
              padding:    6,
              color:      '#FFFFFF',
              flexShrink: 0,
            }}
          >
            {menuOpen
              ? <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
                  <line x1="4" y1="4" x2="18" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <line x1="18" y1="4" x2="4" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              : <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
                  <line x1="3" y1="6"  x2="19" y2="6"  stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <line x1="3" y1="11" x2="19" y2="11" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <line x1="3" y1="16" x2="19" y2="16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
            }
          </button>

        </div>
      </header>

      {/* ── Mobile backdrop ────────────────────────────────────────────────── */}
      {menuOpen && (
        <div
          aria-hidden
          onClick={() => setMenuOpen(false)}
          style={{
            position:   'fixed',
            inset:      0,
            zIndex:     48,
            background: 'rgba(0,0,0,0.45)',
          }}
        />
      )}

      {/* ── Mobile bottom sheet ─────────────────────────────────────────────── */}
      <div
        ref={sheetRef}
        style={{
          position:      'fixed',
          bottom:        0,
          left:          0,
          right:         0,
          zIndex:        49,
          background:    '#0D2B4E',
          borderTop:     '1px solid rgba(255,255,255,0.12)',
          borderRadius:  '16px 16px 0 0',
          padding:       '12px 0 36px',
          transform:     menuOpen ? 'translateY(0)' : 'translateY(100%)',
          transition:    'transform 200ms cubic-bezier(0.4,0,0.2,1)',
          pointerEvents: menuOpen ? 'auto' : 'none',
        }}
      >
        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)' }} />
        </div>

        {/* Nav links */}
        {NAV_LINKS.map(({ label, href, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setMenuOpen(false)}
              style={{
                display:        'block',
                fontFamily:     'var(--font-dm-sans)',
                fontSize:       16,
                fontWeight:     active ? 600 : 400,
                color:          active ? '#34C97A' : '#CBD5E1',
                textDecoration: 'none',
                padding:        '14px 24px',
                borderLeft:     active ? '3px solid #34C97A' : '3px solid transparent',
              }}
            >
              {label}
            </Link>
          );
        })}

        {/* Theme toggle row — mobile */}
        <div style={{ padding: '12px 24px', borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 8 }}>
          <ThemeToggle />
        </div>

        {/* Auth block */}
        <div style={{
          padding:   '16px 24px 0',
          marginTop: 0,
          borderTop: '1px solid rgba(255,255,255,0.08)',
        }}>
          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width:          36,
                height:         36,
                borderRadius:   '50%',
                background:     '#34C97A',
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'center',
                flexShrink:     0,
              }}>
                <span style={{
                  fontFamily: 'var(--font-dm-sans)',
                  fontSize:   14,
                  fontWeight: 600,
                  color:      '#0D2B4E',
                }}>
                  {userInitial}
                </span>
              </div>
              <span style={{
                fontFamily:   'var(--font-dm-sans)',
                fontSize:     13,
                color:        '#CBD5E1',
                overflow:     'hidden',
                textOverflow: 'ellipsis',
                whiteSpace:   'nowrap',
              }}>
                {user.email}
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Link
                href="/sign-in"
                onClick={() => setMenuOpen(false)}
                style={{
                  display:        'block',
                  textAlign:      'center',
                  fontFamily:     'var(--font-dm-sans)',
                  fontSize:       15,
                  fontWeight:     500,
                  color:          '#CBD5E1',
                  textDecoration: 'none',
                  padding:        '12px 16px',
                  borderRadius:   10,
                  border:         '1px solid rgba(255,255,255,0.15)',
                }}
              >
                Sign In
              </Link>
              <Link
                href="/sign-up"
                onClick={() => setMenuOpen(false)}
                style={{
                  display:        'block',
                  textAlign:      'center',
                  fontFamily:     'var(--font-dm-sans)',
                  fontSize:       15,
                  fontWeight:     600,
                  color:          '#0D2B4E',
                  background:     '#34C97A',
                  textDecoration: 'none',
                  padding:        '12px 16px',
                  borderRadius:   10,
                }}
              >
                Get Started
              </Link>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
