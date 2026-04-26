'use client';

/**
 * ProfilePicker — preset dropdown + 4 weight sliders.
 *
 * Stateless from the parent's perspective: parent owns `prefs` and the
 * `onChange` callback. The component reads from / writes to localStorage
 * via the helpers in lib/preferences, but only on actual user interaction.
 *
 * Slider granularity is 5pt (matches the brief). Picking a preset snaps the
 * sliders to its weights; dragging any slider switches the profile to
 * 'custom'. Weights are not auto-normalised — totals can be anything; the
 * personalised TVI calc normalises by total weight at compute time.
 */

import { useId } from 'react';
import {
  PROFILE_PRESETS,
  PILLAR_ORDER,
  PILLAR_LABEL,
  type StoredPreferences,
  type Weights,
  type ProfilePreset,
  type Pillar,
} from '@/lib/preferences';

interface Props {
  prefs:    StoredPreferences;
  onChange: (next: StoredPreferences) => void;
  /** Compact = horizontal layout for inline use on /library and /compare. */
  variant?: 'compact' | 'full';
}

export function ProfilePicker({ prefs, onChange, variant = 'compact' }: Props) {
  const selectId = useId();

  function pickPreset(preset: ProfilePreset | 'custom') {
    if (preset === 'custom') {
      onChange({ profile: 'custom', weights: prefs.weights });
      return;
    }
    onChange({ profile: preset, weights: { ...PROFILE_PRESETS[preset].weights } });
  }

  function setWeight(pillar: Pillar, value: number) {
    const next: Weights = { ...prefs.weights, [pillar]: value };
    onChange({ profile: 'custom', weights: next });
  }

  const total = PILLAR_ORDER.reduce((s, p) => s + prefs.weights[p], 0);

  return (
    <div
      style={{
        background:    'var(--surface-2)',
        borderRadius:  14,
        padding:       variant === 'full' ? 18 : 14,
        boxShadow:     '0 0 0 1px var(--border)',
        display:       'flex',
        flexDirection: 'column',
        gap:           variant === 'full' ? 14 : 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <label
          htmlFor={selectId}
          style={{
            fontFamily:    'var(--font-dm-sans)',
            fontSize:      11,
            fontWeight:    600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color:         'var(--text-light)',
          }}
        >
          Preference profile
        </label>
        <select
          id={selectId}
          value={prefs.profile}
          onChange={e => pickPreset(e.target.value as ProfilePreset | 'custom')}
          style={{
            fontFamily:   'var(--font-dm-sans)',
            fontSize:     13,
            fontWeight:   500,
            color:        'var(--text)',
            background:   'var(--background)',
            border:       'none',
            outline:      'none',
            boxShadow:    '0 0 0 1px var(--border)',
            borderRadius: 8,
            padding:      '7px 10px',
            cursor:       'pointer',
          }}
        >
          {(Object.keys(PROFILE_PRESETS) as ProfilePreset[]).map(p => (
            <option key={p} value={p}>{PROFILE_PRESETS[p].label}</option>
          ))}
          {prefs.profile === 'custom' && <option value="custom">Custom</option>}
        </select>
      </div>

      {prefs.profile !== 'custom' && (
        <p style={{
          fontFamily: 'var(--font-playfair)',
          fontStyle:  'italic',
          fontSize:   13,
          color:      'var(--text-mid)',
          margin:     0,
        }}>
          {PROFILE_PRESETS[prefs.profile].description}
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: variant === 'full' ? '1fr 1fr' : '1fr', gap: 10 }}>
        {PILLAR_ORDER.map(pillar => {
          const value = prefs.weights[pillar];
          return (
            <div key={pillar} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                fontFamily: 'var(--font-dm-sans)',
                fontSize:   11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color:      'var(--text-light)',
                width:      72,
                flexShrink: 0,
              }}>
                {PILLAR_LABEL[pillar]}
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={value}
                onChange={e => setWeight(pillar, Number(e.target.value))}
                style={{ flex: 1, accentColor: 'var(--navy-deep)', cursor: 'pointer' }}
              />
              <span style={{
                fontFamily: 'var(--font-dm-mono)',
                fontSize:   12,
                color:      'var(--text)',
                width:      28,
                textAlign:  'right',
              }}>
                {value}
              </span>
            </div>
          );
        })}
      </div>

      <p style={{
        fontFamily: 'var(--font-dm-sans)',
        fontSize:   11,
        color:      'var(--text-light)',
        margin:     0,
      }}>
        Weights total {total} — personalised TVI normalises automatically.
      </p>
    </div>
  );
}
