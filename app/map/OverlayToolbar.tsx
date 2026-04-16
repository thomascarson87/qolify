/**
 * OverlayToolbar — CHI-362
 *
 * Bottom-centred pill toolbar for the /map page.
 * Provides radio-style selection of one data overlay at a time:
 *   Flood Zones | Tourist Density | Quality of Life
 *
 * Clicking the active button again deactivates it (returns to clean basemap).
 * The parent MapClient component owns the activeOverlay state and handles the
 * actual map.setLayoutProperty() calls in a useEffect that watches it.
 *
 * Design spec (D-037 / UI_UX_BRIEF):
 *   - White pill, box-shadow, border-radius 8px, height 44px
 *   - Centred at bottom of viewport, margin-bottom 24px
 *   - DM Sans 13px, button height 32px, horizontal padding 12px
 *   - Active: Navy bg (#0D2B4E), white text, emerald bottom border
 *   - Inactive: transparent bg, Navy Mid text (#4A5D74)
 */

'use client';

export type OverlayType = 'none' | 'flood' | 'solar' | 'vut_heatmap' | 'qol_score';

interface OverlayToolbarProps {
  activeOverlay:    OverlayType;
  onOverlayChange:  (o: OverlayType) => void;
  // profile is accepted so the parent can pass it through — reserved for
  // future profile-specific overlay ordering or labelling. Unused for now.
  profile:          'families' | 'nomads' | 'retirees' | 'investors';
}

interface OverlayButton {
  key:      OverlayType;
  label:    string;
  disabled?: boolean;
  tooltip?:  string;
}

const BUTTONS: OverlayButton[] = [
  { key: 'flood',  label: 'Flood Zones'    },
  { key: 'solar',  label: 'Solar Exposure' },
  {
    key:      'vut_heatmap',
    label:    'Tourist Density',
    disabled: true,
    tooltip:  'Coming soon — data pipeline in progress',
  },
  // Quality of Life choropleth removed (D-038): Nominatim zone boundaries are
  // bounding rectangles that overlap visually and provide no geographic meaning.
  // Re-add when CartoCiudad real postcode polygons are ingested.
];

export function OverlayToolbar({
  activeOverlay,
  onOverlayChange,
}: OverlayToolbarProps) {
  function handleClick(key: OverlayType) {
    // Clicking the active button again deactivates — returns to clean basemap.
    onOverlayChange(activeOverlay === key ? 'none' : key);
  }

  return (
    <div
      style={{
        position:        'absolute',
        bottom:          24,
        left:            '50%',
        transform:       'translateX(-50%)',
        zIndex:          10,
        display:         'flex',
        alignItems:      'center',
        height:          44,
        background:      '#FFFFFF',
        borderRadius:    8,
        boxShadow:       '0 12px 40px rgba(13,43,78,0.12)',
        padding:         '0 6px',
        gap:             2,
        // Pointer events on the pill itself — map clicks pass through below it.
        pointerEvents:   'auto',
      }}
    >
      {BUTTONS.map(({ key, label, disabled, tooltip }) => {
        const isActive = !disabled && activeOverlay === key;
        return (
          <button
            key={key}
            onClick={() => !disabled && handleClick(key)}
            aria-pressed={isActive}
            aria-disabled={disabled}
            title={tooltip}
            style={{
              fontFamily:   'var(--font-dm-sans)',
              fontSize:     13,
              fontWeight:   isActive ? 600 : 400,
              height:       32,
              padding:      '0 12px',
              borderRadius: 6,
              border:       'none',
              cursor:       disabled ? 'not-allowed' : 'pointer',
              transition:   'background 0.15s, color 0.15s',
              background:   isActive ? '#0D2B4E' : 'transparent',
              color:        disabled ? '#B0C0D0' : isActive ? '#FFFFFF' : '#4A5D74',
              borderBottom: isActive ? '2px solid #34C97A' : '2px solid transparent',
              opacity:      disabled ? 0.45 : 1,
              whiteSpace:   'nowrap',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
