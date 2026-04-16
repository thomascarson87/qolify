'use client';

/**
 * AddressSearch — CHI-362 / D-039
 *
 * Address geocoding search for the /map left panel.
 * Uses the MapTiler Geocoding API (same key as the basemap — no additional
 * API keys or server routes required).
 *
 * Behaviour:
 *  - Debounced 300ms input — fires only after the user pauses typing
 *  - Results biased to Málaga city centre (proximity param)
 *  - On select: calls onSelect(lat, lng, placeName) so MapClient can
 *    fly to the location, drop a pin marker, and trigger analysis
 *  - Keyboard accessible: arrow keys navigate results, Enter selects
 *
 * Design: DM Sans, Navy palette — matches the rest of the left panel.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

interface GeocodingFeature {
  place_name: string;
  text:       string;
  geometry:   { coordinates: [number, number] }; // [lng, lat]
}

interface AddressSearchProps {
  /** Called when the user selects a geocoding result. */
  onSelect: (lat: number, lng: number, placeName: string) => void;
}

// MapTiler geocoding endpoint — client-side call, NEXT_PUBLIC key is safe.
const MAPTILER_GEOCODE_URL = 'https://api.maptiler.com/geocoding';
// Bias results toward Málaga city centre
const MALAGA_PROXIMITY = '-4.4214,36.7213';

export function AddressSearch({ onSelect }: AddressSearchProps) {
  const [query,       setQuery]       = useState('');
  const [results,     setResults]     = useState<GeocodingFeature[]>([]);
  const [open,        setOpen]        = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading,     setLoading]     = useState(false);

  const inputRef    = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch geocoding results — debounced
  const fetchResults = useCallback(async (q: string) => {
    const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
    if (!key || q.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const url = `${MAPTILER_GEOCODE_URL}/${encodeURIComponent(q)}.json` +
        `?key=${key}&country=es&proximity=${MALAGA_PROXIMITY}&limit=5&types=address,poi,place`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const features: GeocodingFeature[] = data.features ?? [];
      setResults(features);
      setOpen(features.length > 0);
      setActiveIndex(-1);
    } catch {
      // Non-fatal — user can still type; silent fail
      setResults([]);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce input changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(() => fetchResults(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, fetchResults]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleSelect(feature: GeocodingFeature) {
    const [lng, lat] = feature.geometry.coordinates;
    setQuery(feature.place_name);
    setOpen(false);
    setResults([]);
    onSelect(lat, lng, feature.place_name);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || !results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      handleSelect(results[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  // Extract a short secondary context line from the place_name
  function getSecondaryText(feature: GeocodingFeature): string {
    const parts = feature.place_name.split(',');
    // Skip the primary text (first part) and join the rest briefly
    return parts.slice(1, 3).join(',').trim();
  }

  return (
    <div style={{ position: 'relative' }}>
      {/* Search input */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        {/* Search icon */}
        <svg
          width="13" height="13" viewBox="0 0 16 16" fill="none"
          style={{ position: 'absolute', left: 10, color: '#4A6080', pointerEvents: 'none', flexShrink: 0 }}
        >
          <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search an address…"
          aria-label="Search address"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          autoComplete="off"
          style={{
            width:        '100%',
            boxSizing:    'border-box',
            background:   '#0F2035',
            border:       '1px solid #1E3050',
            borderRadius: 8,
            padding:      '8px 10px 8px 30px',
            fontFamily:   'var(--font-dm-sans)',
            fontSize:     13,
            color:        '#FFFFFF',
            outline:      'none',
            transition:   'border-color 0.15s',
          }}
          onMouseEnter={e => ((e.target as HTMLInputElement).style.borderColor = '#2A4060')}
          onMouseLeave={e => {
            if (document.activeElement !== e.target)
              (e.target as HTMLInputElement).style.borderColor = '#1E3050';
          }}
          onFocusCapture={e => ((e.target as HTMLInputElement).style.borderColor = '#34C97A')}
          onBlurCapture={e  => ((e.target as HTMLInputElement).style.borderColor = '#1E3050')}
        />

        {/* Loading spinner */}
        {loading && (
          <div
            style={{
              position:  'absolute',
              right:     10,
              width:     12,
              height:    12,
              border:    '1.5px solid #1E3050',
              borderTop: '1.5px solid #34C97A',
              borderRadius: '50%',
              animation: 'spin 0.7s linear infinite',
            }}
          />
        )}
      </div>

      {/* Results dropdown */}
      {open && results.length > 0 && (
        <div
          ref={dropdownRef}
          role="listbox"
          aria-label="Address suggestions"
          style={{
            position:     'absolute',
            top:          'calc(100% + 4px)',
            left:         0,
            right:        0,
            background:   '#0D1B2A',
            border:       '1px solid #1E3050',
            borderRadius: 8,
            boxShadow:    '0 8px 24px rgba(0,0,0,0.4)',
            zIndex:       100,
            overflow:     'hidden',
            maxHeight:    220,
            overflowY:    'auto',
          }}
        >
          {results.map((feature, i) => (
            <button
              key={i}
              role="option"
              aria-selected={activeIndex === i}
              onMouseDown={e => {
                e.preventDefault(); // Prevent input blur before click registers
                handleSelect(feature);
              }}
              onMouseEnter={() => setActiveIndex(i)}
              style={{
                display:    'block',
                width:      '100%',
                textAlign:  'left',
                border:     'none',
                padding:    '9px 12px',
                cursor:     'pointer',
                background: activeIndex === i ? '#1E3050' : 'transparent',
                transition: 'background 0.1s',
                borderBottom: i < results.length - 1 ? '1px solid #0F2035' : 'none',
              }}
            >
              {/* Pin icon */}
              <span style={{ fontSize: 11, marginRight: 6, opacity: 0.5 }}>📍</span>
              <span style={{
                fontFamily: 'var(--font-dm-sans)', fontSize: 13,
                color: '#FFFFFF', display: 'block',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {feature.text}
              </span>
              {getSecondaryText(feature) && (
                <span style={{
                  fontFamily: 'var(--font-dm-sans)', fontSize: 11,
                  color: '#4A6080', display: 'block',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  marginTop: 1,
                }}>
                  {getSecondaryText(feature)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Spinner keyframe — injected once */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
