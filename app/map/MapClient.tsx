/**
 * MapClient — CHI-342 (revised)
 *
 * Profile-driven layer explorer for the Qolify /map page.
 *
 * UX model:
 *  - Clean dark basemap by default — no choropleth overlay
 *  - Profile tab selection auto-loads contextually relevant amenity layers:
 *      Families   → schools (green) + health (blue)
 *      Nomads     → transport (amber)
 *      Retirees   → health (blue)
 *      Investors  → infrastructure projects (purple)
 *  - Click inside a Málaga postcode zone → highlights that single zone
 *    boundary + opens the ZoneDetailPanel on the right
 *  - Click outside all zones → nothing
 *  - Closing the panel clears the boundary
 *  - Manual layer chip toggles in the left panel for power-user overrides
 *
 * Env vars required:
 *   NEXT_PUBLIC_MAPTILER_KEY  — MapTiler API key
 *   NEXT_PUBLIC_SUPABASE_URL  — used to build zones.geojson CDN URL
 */
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as turf from '@turf/turf';
import { PinReportPanel, type PinReport } from '@/components/map/PinReportPanel';
import { OverlayToolbar, type OverlayType } from './OverlayToolbar';
import { AddressSearch } from './AddressSearch';
import { createClient  } from '@/lib/supabase/client';
import type { SavedPin } from '@/app/api/map/pin/save/route';
import { THEME_EVENT, getStoredTheme, applyTheme, type Theme } from '@/lib/theme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Profile = 'family' | 'nomad' | 'retiree' | 'investor';
type LayerType = 'schools' | 'health' | 'transport' | 'infrastructure';

interface ZoneProperties {
  codigo_postal:             string;
  zone_tvi:                  number;
  school_score_norm:         number;
  health_score_norm:         number;
  community_score_norm:      number;
  flood_risk_score:          number;
  solar_score_norm:          number;
  connectivity_score_norm:   number;
  infrastructure_score_norm: number;
  vut_density_pct:           number;
  has_t10_flood:             boolean;
  avg_ghi:                   number;
  signals:                   string[];
}

type ZonesGeoJSON = GeoJSON.FeatureCollection<GeoJSON.MultiPolygon, ZoneProperties>;

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

// ---------------------------------------------------------------------------
// Left panel — recent analyses (same shape as AnalyseClient)
// ---------------------------------------------------------------------------

interface RecentItem {
  id: string;
  url: string;
  municipio: string;
  price: number;
  tvi: number;
  analysedAt: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtEur(n: number): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}

// ---------------------------------------------------------------------------
// Profile → amenity layer mapping
// ---------------------------------------------------------------------------

const PROFILES: { key: Profile; label: string }[] = [
  { key: 'family',   label: 'Families'  },
  { key: 'nomad',    label: 'Nomads'    },
  { key: 'retiree',  label: 'Retirees'  },
  { key: 'investor', label: 'Investors' },
];

const PROFILE_LAYERS: Record<Profile, LayerType[]> = {
  family:   ['schools', 'health'],
  nomad:    ['transport'],
  retiree:  ['health'],
  investor: ['infrastructure'],
};

const ALL_LAYER_TYPES: LayerType[] = ['schools', 'health', 'transport', 'infrastructure'];

const LAYER_LABELS: Record<LayerType, string> = {
  schools:        'Schools',
  health:         'Health',
  transport:      'Transport',
  infrastructure: 'Projects',
};

const LAYER_COLORS: Record<LayerType, string> = {
  schools:        '#34C97A',
  health:         '#3B82F6',
  transport:      '#F59E0B',
  infrastructure: '#A78BFA',
};

// ---------------------------------------------------------------------------
// Selected-zone colour expression
// Reads zone_tvi from the selected feature's properties.
// zone_scores has no separate weighted_score column — zone_tvi is the
// composite score (0–100) used for choropleth colouring.
// Tight stops tuned to the Málaga city zone range (48–59).
// ---------------------------------------------------------------------------

const SELECTED_ZONE_COLOR_EXPR = [
  'interpolate', ['linear'], ['get', 'zone_tvi'],
  0,   '#0D1F35',
  30,  '#0D1F35',
  31,  '#5C0F00',
  45,  '#C94B1A',
  52,  '#D4820A',
  58,  '#2CC675',
  70,  '#00C464',
  100, '#00C464',
] as maplibregl.ExpressionSpecification;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MapClient() {
  const searchParams  = useSearchParams();
  const router        = useRouter();
  const containerRef  = useRef<HTMLDivElement>(null);
  const mapRef        = useRef<maplibregl.Map | null>(null);
  const zonesDataRef  = useRef<ZonesGeoJSON | null>(null);

  // layerFetched tracks which amenity types have been loaded from the API
  const layerFetched = useRef<Partial<Record<LayerType, boolean>>>({});

  // Lazy-load guards — overlay data is only fetched on first activation
  const floodDataLoaded   = useRef(false);
  const vutDataLoaded     = useRef(false);
  const solarDataLoaded   = useRef(false);
  // Saved-pin markers — keyed by saved pin id for easy cleanup
  const savedPinMarkers      = useRef<Map<string, maplibregl.Marker>>(new Map());
  // Last resolved address from address search — passed to PinReportPanel for save pre-fill
  const lastSearchAddressRef = useRef<string | null>(null);
  // HTML markers for ring-scoped amenity icons (school, pharmacy, bus stop etc.)
  // Keyed as an array so they can all be removed on pin clear.
  const pinAmenityMarkers = useRef<maplibregl.Marker[]>([]);
  // Coordinates of the currently active pin — used when re-fetching amenities
  // at an expanded radius (800m) without going through triggerPinAnalysis again.
  const activePinCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  // Mirror of pinPanelOpen state — read inside MapLibre event handlers
  // to avoid the stale closure problem (handlers are registered once on load).
  const pinPanelOpenRef = useRef(false);
  // Ref to dropNewPin so the contextmenu handler (stale closure) always
  // calls the latest version of the function.
  const dropNewPinRef = useRef<(lat: number, lng: number, x: number, y: number) => void>(() => {});

  // Overlay GeoJSON caches — populated when each overlay loads.
  // Used by setupSources to restore data after map.setStyle() on theme change.
  const floodGeoJsonRef = useRef<GeoJSON.FeatureCollection | null>(null);
  const vutGeoJsonRef   = useRef<GeoJSON.FeatureCollection | null>(null);
  const solarGeoJsonRef = useRef<GeoJSON.FeatureCollection | null>(null);
  // Holds the setupSources closure from the map init effect so the theme
  // change effect can call it after map.setStyle() clears all sources/layers.
  const setupSourcesRef = useRef<((z: ZonesGeoJSON | null) => void) | null>(null);

  const [profile,      setProfile]      = useState<Profile>('family');
  const [activeOverlay, setActiveOverlay] = useState<OverlayType>('none');
  // Starts empty — layers are manual-only and hidden until a pin is active (CHI-370).
  const [activeLayers, setActiveLayers] = useState<Set<LayerType>>(() => new Set<LayerType>());
  const [mapReady,     setMapReady]     = useState(false);
  const [tilesError,   setTilesError]   = useState(false);
  // Bumped after each map.setStyle() so overlay/layer effects re-run with fresh sources.
  const [styleVersion, setStyleVersion] = useState(0);

  // ---- Pin drop state -------------------------------------------------------
  // pinPopover: shows a small "Run analysis" form at the right-click location
  // pinReport:  the loaded PinReport from POST /api/map/pin
  const pinMarkerRef           = useRef<maplibregl.Marker | null>(null);
  // Guards against ctrl+click on Mac firing both contextmenu AND click,
  // which would immediately close the popover the contextmenu just opened.
  const lastContextMenuTimeRef = useRef<number>(0);
  const [pinPopover,   setPinPopover]   = useState<{ x: number; y: number; lat: number; lng: number } | null>(null);
  const [pinPrice,     setPinPrice]     = useState('');
  const [pinArea,      setPinArea]      = useState('');
  const [pinUrl,       setPinUrl]       = useState('');
  const [pinReport,    setPinReport]    = useState<PinReport | null>(null);
  const [pinLoading,   setPinLoading]   = useState(false);
  const [pinError,     setPinError]     = useState<string | null>(null);
  const [pinPanelOpen, setPinPanelOpen] = useState(false);
  // Second-pin replacement confirmation — shown when user right-clicks while pin panel is open.
  const [showPinReplaceConfirm, setShowPinReplaceConfirm] = useState(false);
  const [pendingPinCoords, setPendingPinCoords] = useState<{ lat: number; lng: number } | null>(null);
  // Street name resolved via Nominatim reverse geocode on map right-click.
  // Display-only — shown below coordinates in the pin panel header.
  const [resolvedStreet, setResolvedStreet] = useState<string | null>(null);

  const zonesUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/map-tiles/malaga/zones.geojson`;

  // ---- Left panel: Idealista URL input + recent analyses --------------------
  const [panelUrl,     setPanelUrl]     = useState('');
  const [panelLoading, setPanelLoading] = useState(false);
  const [panelError,   setPanelError]   = useState<string | null>(null);
  const [panelRecent,  setPanelRecent]  = useState<RecentItem[]>([]);

  // Derived: pin panel is the authoritative signal that a pin is active.
  const isPinActive = pinPanelOpen;

  // ------------------------------------------------------------------
  // Sync pinPanelOpen → ref so MapLibre event handlers (registered once
  // on map load with stale closures) can read the current value.
  // ------------------------------------------------------------------
  useEffect(() => { pinPanelOpenRef.current = pinPanelOpen; }, [pinPanelOpen]);

  // ------------------------------------------------------------------
  // Generic layer loader — uses existing /api/map/layer endpoint
  // Fetches for current viewport, injects into GeoJSON source.
  // ------------------------------------------------------------------
  const loadLayer = useCallback(async (type: LayerType) => {
    const map = mapRef.current;
    if (!map || layerFetched.current[type]) return;
    const b = map.getBounds();
    const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
    try {
      const res = await fetch(`/api/map/layer?type=${type}&bbox=${bbox}`);
      if (!res.ok) return;
      const data = await res.json();
      (map.getSource(`layer-${type}`) as maplibregl.GeoJSONSource | undefined)
        ?.setData(data);
      layerFetched.current[type] = true;
    } catch {
      // Non-fatal — layer stays empty until next toggle
    }
  }, []);

  // ------------------------------------------------------------------
  // fetchPinAmenities — fetches all 7 facility types in ONE request via
  // /api/map/amenities and renders them as HTML marker circles on the map.
  // One batched request replaces the 7 individual /api/map/layer calls,
  // cutting HTTP overhead significantly (CHI-370 Task 5).
  // ------------------------------------------------------------------
  const fetchPinAmenities = useCallback(async (lat: number, lng: number, radiusM = 400) => {
    // Remove any previously placed amenity markers first
    pinAmenityMarkers.current.forEach(m => m.remove());
    pinAmenityMarkers.current = [];

    const map = mapRef.current;
    if (!map) return;

    const AMENITY_CONFIG: Array<{ key: string; emoji: string }> = [
      { key: 'schools',     emoji: '🏫' },
      { key: 'health',      emoji: '🏥' },
      { key: 'pharmacy',    emoji: '💊' },
      { key: 'transport',   emoji: '🚌' },
      { key: 'supermarket', emoji: '🛒' },
      { key: 'park',        emoji: '🌳' },
      { key: 'cafe',        emoji: '☕' },
    ];

    try {
      const res = await fetch(
        `/api/map/amenities?lat=${lat}&lng=${lng}&radius=${radiusM}`
      );
      if (!res.ok) return;

      const data = await res.json() as Record<string, GeoJSON.Feature[]>;

      for (const { key, emoji } of AMENITY_CONFIG) {
        const features = data[key] ?? [];
        for (const f of features) {
          const [fLng, fLat] = (f.geometry as GeoJSON.Point).coordinates;
          const name  = (f.properties?.name  ?? '') as string;
          const distM = (f.properties?.distance_m ?? '') as string | number;

          const el = document.createElement('div');
          el.className   = `map-pin-icon map-pin-${key}`;
          el.title       = name ? `${name}${distM ? ` · ${distM}m` : ''}` : '';
          el.textContent = emoji;

          const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([fLng, fLat])
            .addTo(map);

          pinAmenityMarkers.current.push(marker);
        }
      }
    } catch {
      // Non-fatal — amenity icons are supplementary, don't block the panel
    }
  }, []);

  // ------------------------------------------------------------------
  // dropNewPin — places a pin marker + 400m ring + popover at (lat, lng).
  // Extracted from the contextmenu handler so it can be called from both
  // the initial drop and the second-pin confirm path.
  // All deps are refs or stable setters — this callback never changes.
  // ------------------------------------------------------------------
  const dropNewPin = useCallback((lat: number, lng: number, x: number, y: number) => {
    const map = mapRef.current;
    if (!map) return;

    // Replace any existing pin marker
    pinMarkerRef.current?.remove();

    const el = document.createElement('div');
    el.style.cssText = [
      'width:14px', 'height:14px', 'border-radius:50%',
      'background:#34C97A', 'border:2.5px solid #0D1B2A',
      'animation:pinPulse 1.8s infinite',
    ].join(';');
    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([lng, lat])
      .addTo(map);
    pinMarkerRef.current = marker;

    // Draw 400m walking radius ring
    const circle400m = turf.circle([lng, lat], 0.4, { steps: 64, units: 'kilometers' });
    (map.getSource('pin-radius') as maplibregl.GeoJSONSource | undefined)?.setData(circle400m);
    if (map.getLayer('pin-radius-400m')) map.setLayoutProperty('pin-radius-400m', 'visibility', 'visible');

    // Async reverse geocode — clear previous street first
    setResolvedStreet(null);
    lastSearchAddressRef.current = null;
    fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18&addressdetails=1`)
      .then(r => r.ok ? r.json() : null)
      .then((data: { address?: { road?: string; house_number?: string } } | null) => {
        if (!data?.address?.road) return;
        const parts = [data.address.road, data.address.house_number].filter(Boolean);
        const street = parts.join(', ');
        setResolvedStreet(street);
        lastSearchAddressRef.current = street;
      })
      .catch(() => { /* non-fatal — coordinates always shown */ });

    setPinPopover({ x, y, lat, lng });
    setPinPrice('');
    setPinArea('');
    setPinUrl('');
  }, [setResolvedStreet]);

  // ------------------------------------------------------------------
  // Pin panel close handler — removes marker + resets state
  // ------------------------------------------------------------------
  const handlePinClose = useCallback(() => {
    setPinPanelOpen(false);
    setPinReport(null);
    setPinError(null);
    pinMarkerRef.current?.remove();
    pinMarkerRef.current = null;
    lastSearchAddressRef.current = null;
    setResolvedStreet(null);

    // Clear the 400m proximity ring
    (mapRef.current?.getSource('pin-radius') as maplibregl.GeoJSONSource | undefined)?.setData(EMPTY_FC);
    if (mapRef.current?.getLayer('pin-radius-400m')) {
      mapRef.current.setLayoutProperty('pin-radius-400m', 'visibility', 'none');
    }

    // Remove ring-scoped amenity HTML markers
    pinAmenityMarkers.current.forEach(m => m.remove());
    pinAmenityMarkers.current = [];
    activePinCoordsRef.current = null;

    // Zoom back to city overview
    mapRef.current?.easeTo({ zoom: 12, duration: 600, padding: { right: 0, top: 0, bottom: 0, left: 0 } });
  }, []);

  // ------------------------------------------------------------------
  // triggerPinAnalysis — core analysis fetch, called from both the
  // popover "Run analysis" button AND address search selection.
  // ------------------------------------------------------------------
  const triggerPinAnalysis = useCallback(async (lat: number, lng: number) => {
    setPinPanelOpen(true);
    setPinLoading(true);
    setPinReport(null);
    setPinError(null);

    // Track active pin coords so the expand-to-800m handler can re-fetch without
    // going through the full analysis flow again.
    activePinCoordsRef.current = { lat, lng };

    // Zoom to pin — padding.right reserves space for the 420px panel + 20px margin.
    const map = mapRef.current;
    if (map) {
      map.easeTo({
        center:   [lng, lat],
        zoom:     15,
        duration: 800,
        padding:  { right: 440, top: 40, bottom: 40, left: 40 },
      });
      // Fetch ring-scoped amenity icons after zoom settles.
      // Guard prevents double-fetch if both moveend and the timeout fire.
      let amenityFetched = false;
      const doFetch = () => {
        if (!amenityFetched) { amenityFetched = true; fetchPinAmenities(lat, lng); }
      };
      map.once('moveend', doFetch);
      setTimeout(doFetch, 1000); // fallback if moveend doesn't fire
    }

    try {
      const body: Record<string, number> = { lat, lng };
      const price = parseFloat(pinPrice);
      const area  = parseFloat(pinArea);
      if (!isNaN(price) && price > 0) body.price_asking = price;
      if (!isNaN(area)  && area  > 0) body.area_sqm     = area;

      // Pre-save the Idealista URL to localStorage so the pin panel's analyse
      // button is visible immediately when the panel opens (CHI-369).
      const trimmedUrl = pinUrl.trim();
      if (trimmedUrl) {
        try {
          const key = `qolify_enrich_${lat.toFixed(5)}_${lng.toFixed(5)}`;
          const existing = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
          localStorage.setItem(key, JSON.stringify({ ...existing, idealistaUrl: trimmedUrl }));
        } catch { /* localStorage unavailable */ }
      }

      const res = await fetch('/api/map/pin', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });

      if (!res.ok) {
        const { error } = await res.json() as { error: string };
        setPinError(`Analysis failed: ${error ?? 'unknown error'}`);
      } else {
        const report = await res.json() as PinReport;
        setPinReport(report);
      }
    } catch {
      setPinError('Could not reach the analysis server. Please try again.');
    } finally {
      setPinLoading(false);
      setPinPrice('');
      setPinArea('');
      setPinUrl('');
    }
  }, [pinPrice, pinArea, pinUrl, fetchPinAmenities]);

  // ------------------------------------------------------------------
  // handlePinSubmit — closes popover then delegates to triggerPinAnalysis
  // ------------------------------------------------------------------
  const handlePinSubmit = useCallback(async (lat: number, lng: number) => {
    setPinPopover(null);
    await triggerPinAnalysis(lat, lng);
  }, [triggerPinAnalysis]);

  // ------------------------------------------------------------------
  // handleAddressSelect — called when user picks an address search result.
  // Flies to location, drops a pin marker, triggers analysis.
  // ------------------------------------------------------------------
  const handleAddressSelect = useCallback((lat: number, lng: number, placeName: string) => {
    const map = mapRef.current;
    if (!map) return;

    // Close any open popover
    setPinPopover(null);

    // Remove previous temp marker and any ring-scoped amenity icons
    pinMarkerRef.current?.remove();
    pinAmenityMarkers.current.forEach(m => m.remove());
    pinAmenityMarkers.current = [];

    // Drop a new emerald pin marker at the geocoded location
    const el = document.createElement('div');
    el.style.cssText = [
      'width:14px','height:14px','border-radius:50%',
      'background:#34C97A','border:2.5px solid #0D1B2A',
      'animation:pinPulse 1.8s infinite',
    ].join(';');
    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([lng, lat])
      .addTo(map);
    pinMarkerRef.current = marker;

    // Store place name so PinReportPanel can pre-fill the save form's address field
    lastSearchAddressRef.current = placeName;

    // Draw 400m walking radius ring
    const circle400m = turf.circle([lng, lat], 0.4, { steps: 64, units: 'kilometers' });
    (map.getSource('pin-radius') as maplibregl.GeoJSONSource | undefined)?.setData(circle400m);
    if (map.getLayer('pin-radius-400m')) map.setLayoutProperty('pin-radius-400m', 'visibility', 'visible');

    // Trigger analysis immediately — no intermediate popover.
    // triggerPinAnalysis handles the zoom (easeTo zoom:15) and amenity fetch.
    triggerPinAnalysis(lat, lng);
  }, [triggerPinAnalysis]);

  // ------------------------------------------------------------------
  // confirmNewPin — called when user confirms "Drop a new pin here?"
  // Clears the active pin without zooming out, then drops a fresh pin.
  // ------------------------------------------------------------------
  const confirmNewPin = useCallback(() => {
    if (!pendingPinCoords) return;
    const { lat, lng } = pendingPinCoords;
    setShowPinReplaceConfirm(false);
    setPendingPinCoords(null);

    // Clear active pin state (no zoom-out — we're immediately dropping a new one)
    setPinPanelOpen(false);
    setPinReport(null);
    setPinError(null);
    pinMarkerRef.current?.remove();
    pinMarkerRef.current = null;
    setResolvedStreet(null);
    lastSearchAddressRef.current = null;
    (mapRef.current?.getSource('pin-radius') as maplibregl.GeoJSONSource | undefined)?.setData(EMPTY_FC);
    if (mapRef.current?.getLayer('pin-radius-400m')) {
      mapRef.current.setLayoutProperty('pin-radius-400m', 'visibility', 'none');
    }
    pinAmenityMarkers.current.forEach(m => m.remove());
    pinAmenityMarkers.current = [];

    // Project lng/lat to pixel coords for the popover position, then drop
    const map = mapRef.current;
    if (!map) return;
    const point = map.project([lng, lat]);
    dropNewPin(lat, lng, point.x, point.y);
  }, [pendingPinCoords, dropNewPin]);

  // Sync dropNewPin → ref so the contextmenu handler (stale closure) always
  // calls the latest version. Must appear after dropNewPin is declared.
  useEffect(() => { dropNewPinRef.current = dropNewPin; }, [dropNewPin]);

  // ------------------------------------------------------------------
  // Left panel: load recent analyses from localStorage on mount
  // ------------------------------------------------------------------
  useEffect(() => {
    try {
      const stored = localStorage.getItem('qolify_recent');
      if (stored) setPanelRecent(JSON.parse(stored) as RecentItem[]);
    } catch { /* localStorage unavailable */ }
  }, []);

  // ------------------------------------------------------------------
  // Left panel: Idealista URL submit — POST /api/analyse then navigate
  // ------------------------------------------------------------------
  const handlePanelUrlSubmit = useCallback(async (submitUrl: string) => {
    if (!submitUrl.trim() || panelLoading) return;
    setPanelLoading(true);
    setPanelError(null);
    try {
      const res = await fetch('/api/analyse', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url: submitUrl.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null) as { message?: string; error?: string } | null;
        throw new Error(err?.message ?? err?.error ?? `Server error (HTTP ${res.status})`);
      }
      const data = await res.json() as { jobId?: string; cached?: boolean; id?: string };
      if (data.jobId) {
        router.push(`/analyse/${data.jobId}`);
      } else if (data.cached && data.id) {
        router.push(`/analyse/${data.id}`);
      } else {
        throw new Error('Unexpected response from server.');
      }
    } catch (err) {
      setPanelLoading(false);
      setPanelError(err instanceof Error ? err.message : 'Something went wrong.');
    }
    // Note: don't reset loading on success — page navigates away
  }, [panelLoading, router]);

  // ------------------------------------------------------------------
  // handleExpandRadius — called when the pin panel's "Expand to 800m"
  // button is clicked. Grows the ring on the map and re-fetches icons.
  // ------------------------------------------------------------------
  const handleExpandRadius = useCallback(() => {
    const pin = activePinCoordsRef.current;
    const map = mapRef.current;
    if (!pin || !map) return;

    const ring800m = turf.circle([pin.lng, pin.lat], 0.8, { steps: 64, units: 'kilometers' });
    (map.getSource('pin-radius') as maplibregl.GeoJSONSource | undefined)?.setData(ring800m);

    // Zoom out slightly so the 800m ring fits the viewport
    map.easeTo({ zoom: 14, duration: 500, padding: { right: 440, top: 40, bottom: 40, left: 40 } });

    fetchPinAmenities(pin.lat, pin.lng, 800);
  }, [fetchPinAmenities]);

  // ------------------------------------------------------------------
  // handleCollapseRadius — called when the pin panel's "Back to 400m"
  // button is clicked. Restores the ring and re-fetches icons at 400m.
  // ------------------------------------------------------------------
  const handleCollapseRadius = useCallback(() => {
    const pin = activePinCoordsRef.current;
    const map = mapRef.current;
    if (!pin || !map) return;

    const ring400m = turf.circle([pin.lng, pin.lat], 0.4, { steps: 64, units: 'kilometers' });
    (map.getSource('pin-radius') as maplibregl.GeoJSONSource | undefined)?.setData(ring400m);

    // Zoom back to street level
    map.easeTo({ zoom: 15, duration: 500, padding: { right: 440, top: 40, bottom: 40, left: 40 } });

    fetchPinAmenities(pin.lat, pin.lng, 400);
  }, [fetchPinAmenities]);

  // ------------------------------------------------------------------
  // Initialise MapLibre — runs once on mount
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Sync theme on mount so the page chrome and map tiles start in the
    // correct mode. applyTheme also dispatches THEME_EVENT, but the
    // theme-change listener below is already registered (React effects run
    // synchronously before the next paint), so MapClient will respond.
    const initialTheme: Theme = getStoredTheme();
    applyTheme(initialTheme);

    const mapStyle = initialTheme === 'dark' ? 'dataviz-dark' : 'dataviz-light';

    const map = new maplibregl.Map({
      container:          containerRef.current,
      style:              `https://api.maptiler.com/maps/${mapStyle}/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}`,
      center:             [-4.4214, 36.7213],
      zoom:               12,
      // projection is a valid MapLibre v5 option but missing from the TS types in this
      // version — cast avoids the type error while keeping the mercator workaround.
      projection:         'mercator',
      attributionControl: false,
    } as maplibregl.MapOptions);

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
    map.addControl(new maplibregl.AttributionControl({ compact: true }),     'bottom-right');

    // ------------------------------------------------------------------
    // setupSources — adds all GeoJSON sources and layers to the map.
    // Called on initial load AND after map.setStyle() on theme change.
    // On theme change, sources are restored from their cache refs so
    // any active overlays (flood, VUT, solar) remain populated.
    // ------------------------------------------------------------------
    function setupSources(zonesData: ZonesGeoJSON | null) {

      // ---- Zone boundaries source ----------------------------------------
      // Loaded for two purposes:
      //   1. Hit-testing clicks (invisible zones-hit layer)
      //   2. Selected-zone geometry lookup (zonesDataRef)
      map.addSource('zones', {
        type:      'geojson',
        data:      (zonesData ?? EMPTY_FC) as GeoJSON.FeatureCollection,
        promoteId: 'codigo_postal',
      });

      // Invisible fill used purely for queryRenderedFeatures click detection.
      // opacity 0.001 = visually invisible but MapLibre renders it to the tile
      // buffer, making features queryable.
      map.addLayer({
        id:     'zones-hit',
        type:   'fill',
        source: 'zones',
        paint:  { 'fill-opacity': 0.001 },
      });

      // ---- QoL choropleth layers (opt-in via overlay toolbar) ----------------
      // Default visibility: 'none' — activated only when QoL overlay is selected.
      // Reuses the existing zones source and SELECTED_ZONE_COLOR_EXPR colour ramp.
      map.addLayer({
        id:     'zones-fill',
        type:   'fill',
        source: 'zones',
        paint: {
          'fill-color':   SELECTED_ZONE_COLOR_EXPR,
          'fill-opacity': 0.45,
        },
        layout: { visibility: 'none' },
      });

      map.addLayer({
        id:     'zones-outline',
        type:   'line',
        source: 'zones',
        paint: {
          'line-color':   '#34C97A',
          'line-width':   0.8,
          'line-opacity': 0.4,
        },
        layout: { visibility: 'none' },
      });

      // ---- Flood zone overlay (lazy-loaded on first activation) --------------
      // Source starts empty — filled when user first selects "Flood Zones".
      // risk_level values: 'T10' | 'T100' | 'T500' (matches flood_zones schema).
      map.addSource('flood-zones', {
        type: 'geojson',
        data: EMPTY_FC,
      });

      // T500 — lowest risk, rendered first (bottom of stack)
      map.addLayer({
        id:     'flood-t500-fill',
        type:   'fill',
        source: 'flood-zones',
        filter: ['==', ['get', 'risk_level'], 'T500'],
        paint: {
          'fill-color':   '#D4820A',
          'fill-opacity': 0.10,
        },
        layout: { visibility: 'none' },
      });

      // T100 — medium risk
      map.addLayer({
        id:     'flood-t100-fill',
        type:   'fill',
        source: 'flood-zones',
        filter: ['==', ['get', 'risk_level'], 'T100'],
        paint: {
          'fill-color':   '#D4820A',
          'fill-opacity': 0.25,
        },
        layout: { visibility: 'none' },
      });

      // T10 — highest risk, rendered on top
      map.addLayer({
        id:     'flood-t10-fill',
        type:   'fill',
        source: 'flood-zones',
        filter: ['==', ['get', 'risk_level'], 'T10'],
        paint: {
          'fill-color':   '#C94B1A',
          'fill-opacity': 0.35,
        },
        layout: { visibility: 'none' },
      });

      // T100 outline
      map.addLayer({
        id:     'flood-t100-line',
        type:   'line',
        source: 'flood-zones',
        filter: ['==', ['get', 'risk_level'], 'T100'],
        paint: {
          'line-color':   '#D4820A',
          'line-opacity': 0.5,
          'line-width':   1,
        },
        layout: { visibility: 'none' },
      });

      // T10 outline — slightly thicker and more opaque to signal highest danger
      map.addLayer({
        id:     'flood-t10-line',
        type:   'line',
        source: 'flood-zones',
        filter: ['==', ['get', 'risk_level'], 'T10'],
        paint: {
          'line-color':   '#C94B1A',
          'line-opacity': 0.6,
          'line-width':   1.5,
        },
        layout: { visibility: 'none' },
      });

      // ---- VUT heatmap overlay (lazy-loaded on first activation) -------------
      // Source starts empty — filled when user first selects "Tourist Density".
      // Reuses existing vut_points endpoint in /api/map/layer.
      map.addSource('vut-points', {
        type: 'geojson',
        data: EMPTY_FC,
      });

      map.addLayer({
        id:      'vut-heatmap',
        type:    'heatmap',
        source:  'vut-points',
        maxzoom: 15,
        paint: {
          // Each VUT licence = weight 1 (no property weighting needed)
          'heatmap-weight': 1,
          // Intensity increases at higher zoom levels
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 13, 1],
          // Colour gradient: emerald (sparse) → amber → terracotta (dense)
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0,   'rgba(0,0,0,0)',
            0.2, 'rgba(52,201,122,0.25)',
            0.5, 'rgba(212,130,10,0.50)',
            0.8, 'rgba(201,75,26,0.80)',
            1,   '#C94B1A',
          ],
          // Radius: tighter at street zoom, broader at city zoom
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 10, 20, 13, 30],
          // Fade out at zoom 15+ (individual VUT pins take over at that point)
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.7, 15, 0],
        },
        layout: { visibility: 'none' },
      });

      // ---- Solar exposure overlay (lazy-loaded on first activation) --------
      // Source starts empty — filled from /api/map/overlay/solar when first activated.
      // Rendered as blurred circles interpolated by ghi_annual_kwh_m2 value.
      // Typical Málaga range: 1400–1900 kWh/m²/year.
      map.addSource('solar-radiation', {
        type: 'geojson',
        data: EMPTY_FC,
      });

      map.addLayer({
        id:     'solar-circles',
        type:   'circle',
        source: 'solar-radiation',
        paint: {
          'circle-color': [
            'interpolate', ['linear'], ['get', 'ghi'],
            1200, '#1A2535',
            1450, '#8B4E00',
            1600, '#D4820A',
            1750, '#E8A020',
            1900, '#FFB830',
          ],
          // Radius increases with zoom so circles tile seamlessly at city scale
          'circle-radius': ['interpolate', ['linear'], ['zoom'],
            9,  14,
            11, 22,
            13, 38,
          ],
          'circle-blur':   1.2,
          'circle-opacity': 0.7,
        },
        layout: { visibility: 'none' },
      });

      // ---- Pin proximity ring (400m walking radius) ----------------------
      // Source starts empty — filled with a turf.circle when a pin is dropped.
      // Line layer uses a dashed emerald stroke; only visible at zoom ≥ 12.
      map.addSource('pin-radius', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({
        id:     'pin-radius-400m',
        type:   'line',
        source: 'pin-radius',
        minzoom: 12,
        paint: {
          'line-color':     '#34C97A',
          'line-opacity':   0.35,
          'line-width':     1.5,
          'line-dasharray': [3, 3],
        },
        layout: { visibility: 'none' },
      });

      // ---- Amenity sources (all start empty, loaded on demand) -----------

      // Schools (green)
      map.addSource('layer-schools', {
        type:           'geojson',
        data:           EMPTY_FC,
        cluster:        true,
        clusterMaxZoom: 12,
        clusterRadius:  50,
      });
      addAmenityLayers(map, 'schools', LAYER_COLORS.schools);

      // Health centres (blue)
      map.addSource('layer-health', {
        type:           'geojson',
        data:           EMPTY_FC,
        cluster:        true,
        clusterMaxZoom: 12,
        clusterRadius:  50,
      });
      addAmenityLayers(map, 'health', LAYER_COLORS.health);

      // Transport stops (amber)
      map.addSource('layer-transport', {
        type:           'geojson',
        data:           EMPTY_FC,
        cluster:        true,
        clusterMaxZoom: 12,
        clusterRadius:  50,
      });
      addAmenityLayers(map, 'transport', LAYER_COLORS.transport);

      // Infrastructure projects (purple) — no clustering, these are few
      map.addSource('layer-infrastructure', {
        type: 'geojson',
        data: EMPTY_FC,
      });
      // Single pin layer (no clusters)
      map.addLayer({
        id:      'infrastructure-cluster',       // reuse naming pattern (kept hidden)
        type:    'circle',
        source:  'layer-infrastructure',
        minzoom: 8,
        maxzoom: 22,
        paint: {
          'circle-color':   LAYER_COLORS.infrastructure,
          'circle-radius':  10,
          'circle-opacity': 0,                   // invisible placeholder
        },
        layout: { visibility: 'none' },
      });
      map.addLayer({
        id:      'infrastructure-cluster-count',
        type:    'symbol',
        source:  'layer-infrastructure',
        minzoom: 8,
        maxzoom: 22,
        layout:  { visibility: 'none' },
      });
      map.addLayer({
        id:      'infrastructure-pins',
        type:    'circle',
        source:  'layer-infrastructure',
        minzoom: 8,
        maxzoom: 22,
        paint: {
          'circle-color':        '#FFFFFF',
          'circle-radius':       9,
          'circle-stroke-color': LAYER_COLORS.infrastructure,
          'circle-stroke-width': 2.5,
          'circle-opacity':      0.9,
        },
        layout: { visibility: 'none' },
      });

      // ---- Restore cached overlay data after theme-triggered setStyle ------
      // On initial load these refs are null — overlays haven't been fetched.
      // On subsequent setStyle calls they hold previously loaded GeoJSON so
      // active overlays stay populated without requiring user re-activation.
      if (floodGeoJsonRef.current) {
        (map.getSource('flood-zones') as maplibregl.GeoJSONSource | undefined)
          ?.setData(floodGeoJsonRef.current);
        floodDataLoaded.current = true;
      }
      if (vutGeoJsonRef.current) {
        (map.getSource('vut-points') as maplibregl.GeoJSONSource | undefined)
          ?.setData(vutGeoJsonRef.current);
        vutDataLoaded.current = true;
      }
      if (solarGeoJsonRef.current) {
        (map.getSource('solar-radiation') as maplibregl.GeoJSONSource | undefined)
          ?.setData(solarGeoJsonRef.current);
        solarDataLoaded.current = true;
      }

      // Restore pin proximity ring if a pin was active when the style swapped.
      const activePin = activePinCoordsRef.current;
      if (activePin && pinPanelOpenRef.current) {
        const ring = turf.circle(
          [activePin.lng, activePin.lat], 0.4, { steps: 64, units: 'kilometers' }
        );
        (map.getSource('pin-radius') as maplibregl.GeoJSONSource | undefined)
          ?.setData(ring);
        try { map.setLayoutProperty('pin-radius-400m', 'visibility', 'visible'); } catch { /* ok */ }
      }
    } // ← end setupSources

    // Store in ref so the theme-change effect can call it after setStyle.
    setupSourcesRef.current = setupSources;

    // ---- Map event handlers (registered once — survive setStyle calls) ----

    // Right-click: show pin popover at cursor location
    map.on('contextmenu', e => {
      e.preventDefault();
      lastContextMenuTimeRef.current = Date.now();
      const { lat, lng } = e.lngLat;
      const { x, y }     = e.point;

      // If a pin panel is already open, show confirmation instead of
      // immediately replacing it. Read via ref to avoid stale closure.
      if (pinPanelOpenRef.current) {
        setPendingPinCoords({ lat, lng });
        setShowPinReplaceConfirm(true);
        return;
      }

      dropNewPinRef.current(lat, lng, x, y);
    });

    // Close popover on left-click elsewhere — guarded against ctrl+click
    // on Mac which fires both contextmenu and click in quick succession.
    map.on('click', () => {
      if (Date.now() - lastContextMenuTimeRef.current < 200) return;
      setPinPopover(null);
    });

    // ---- Initial load: fetch zones GeoJSON then set up all sources/layers ----
    map.on('load', async () => {
      let zonesData: ZonesGeoJSON | null = null;
      try {
        const res = await fetch(zonesUrl);
        if (!res.ok) throw new Error(`zones.geojson HTTP ${res.status}`);
        zonesData = await res.json();
        zonesDataRef.current = zonesData;
      } catch {
        setTilesError(true);
      }

      setupSources(zonesData);
      setMapReady(true);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------
  // Day/Night theme toggle — listens for the THEME_EVENT dispatched by
  // applyTheme() and swaps the MapLibre tile style between dataviz-dark
  // and dataviz-light. After setStyle clears all sources/layers, the
  // map.once('style.load') callback restores them via setupSourcesRef,
  // then bumps styleVersion so overlay/layer effects re-run.
  // ------------------------------------------------------------------
  useEffect(() => {
    const handleThemeChange = (e: Event) => {
      const theme = (e as CustomEvent<Theme>).detail;
      const map = mapRef.current;
      if (!map) return;

      // Reset amenity-layer fetch guards so data re-loads into the new
      // style's sources after setStyle clears all prior GeoJSON.
      layerFetched.current = {};

      const key      = process.env.NEXT_PUBLIC_MAPTILER_KEY;
      const tileName = theme === 'dark' ? 'dataviz-dark' : 'dataviz-light';
      map.setStyle(`https://api.maptiler.com/maps/${tileName}/style.json?key=${key}`);

      // setStyle wipes all sources/layers — restore them on the next style.load.
      map.once('style.load', () => {
        setupSourcesRef.current?.(zonesDataRef.current);
        // Bump version so overlay + amenity layer effects re-run with fresh sources.
        setStyleVersion(v => v + 1);
      });
    };

    document.addEventListener(THEME_EVENT, handleThemeChange as EventListener);
    return () => document.removeEventListener(THEME_EVENT, handleThemeChange as EventListener);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------
  // Profile switch → reset layer fetch cache so layers reload if toggled.
  // Layers are NOT auto-activated — the map stays clean until a pin is
  // dropped (CHI-370). Profile selection updates the report panel view only.
  // ------------------------------------------------------------------
  useEffect(() => {
    layerFetched.current = {};
  }, [profile]);

  // ------------------------------------------------------------------
  // Show/hide amenity layers when activeLayers or pinPanelOpen changes.
  // Layers are hidden when no pin is active — the map stays clean before
  // a pin is dropped (CHI-370). Users can toggle chips when pin is active.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!mapReady) return;
    ALL_LAYER_TYPES.forEach(type => {
      // Only show a layer when it's toggled on AND a pin is currently active
      const vis = (activeLayers.has(type) && pinPanelOpen) ? 'visible' : 'none';
      ['cluster', 'cluster-count', 'pins'].forEach(suffix => {
        try {
          mapRef.current?.setLayoutProperty(`${type}-${suffix}`, 'visibility', vis);
        } catch {
          // layer may not exist yet on first render
        }
      });
      if (activeLayers.has(type) && pinPanelOpen) loadLayer(type);
    });
  // styleVersion re-runs this after a setStyle call clears the sources.
  }, [activeLayers, mapReady, loadLayer, pinPanelOpen, styleVersion]);

  // ------------------------------------------------------------------
  // Overlay toolbar — show/hide overlay layers when activeOverlay changes.
  // Guards against running before the map is ready.
  // Also handles lazy-loading flood zone and VUT data on first activation.
  // ------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    // Helper — only call setLayoutProperty if the layer exists
    function setVis(layerId: string, vis: 'visible' | 'none') {
      if (map!.getLayer(layerId)) {
        map!.setLayoutProperty(layerId, 'visibility', vis);
      }
    }

    // Reset all overlay layers to hidden first
    ['zones-fill', 'zones-outline'].forEach(id => setVis(id, 'none'));
    ['flood-t500-fill', 'flood-t100-fill', 'flood-t10-fill',
     'flood-t100-line', 'flood-t10-line'].forEach(id => setVis(id, 'none'));
    setVis('vut-heatmap', 'none');
    setVis('solar-circles', 'none');

    // Then activate the selected overlay
    if (activeOverlay === 'qol_score') {
      setVis('zones-fill',    'visible');
      setVis('zones-outline', 'visible');

    } else if (activeOverlay === 'solar') {
      // Solar exposure: PVGIS point circles, lazy-loaded on first activation
      setVis('solar-circles', 'visible');

      if (!solarDataLoaded.current) {
        const b = map.getBounds();
        const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
        fetch(`/api/map/overlay/solar?bbox=${bbox}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data) {
              solarGeoJsonRef.current = data; // cache for post-setStyle restore
              (map.getSource('solar-radiation') as maplibregl.GeoJSONSource | undefined)
                ?.setData(data);
              solarDataLoaded.current = true;
            }
          })
          .catch(() => {/* non-fatal — circles render empty */});
      }

    } else if (activeOverlay === 'flood') {
      setVis('flood-t500-fill', 'visible');
      setVis('flood-t100-fill', 'visible');
      setVis('flood-t10-fill',  'visible');
      setVis('flood-t100-line', 'visible');
      setVis('flood-t10-line',  'visible');

      // Lazy-load flood GeoJSON on first activation
      if (!floodDataLoaded.current) {
        const b = map.getBounds();
        const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
        fetch(`/api/map/overlay/flood?bbox=${bbox}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data) {
              floodGeoJsonRef.current = data; // cache for post-setStyle restore
              (map.getSource('flood-zones') as maplibregl.GeoJSONSource | undefined)
                ?.setData(data);
              floodDataLoaded.current = true;
            }
          })
          .catch(() => {/* non-fatal — layers remain empty */});
      }

    } else if (activeOverlay === 'vut_heatmap') {
      setVis('vut-heatmap', 'visible');

      // Lazy-load VUT points on first activation
      if (!vutDataLoaded.current) {
        const b = map.getBounds();
        const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
        fetch(`/api/map/layer?type=vut_points&bbox=${bbox}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data) {
              vutGeoJsonRef.current = data; // cache for post-setStyle restore
              (map.getSource('vut-points') as maplibregl.GeoJSONSource | undefined)
                ?.setData(data);
              vutDataLoaded.current = true;
            }
          })
          .catch(() => {/* non-fatal — heatmap renders empty until next activation */});
      }
    }
    // 'none' case: all layers already hidden above — nothing more to do
    // styleVersion re-runs this after a setStyle call resets visibility.
  }, [activeOverlay, mapReady, styleVersion]);

  // ------------------------------------------------------------------
  // Saved pins — load on map ready if user is authenticated.
  // Renders each saved pin as a gold diamond marker on the map.
  // Clicking a saved pin marker re-runs the analysis for that coordinate.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;

    async function loadSavedPins() {
      // Check auth — only attempt if user is signed in
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      try {
        const res = await fetch('/api/map/pin/save');
        if (!res.ok) return;
        const pins = await res.json() as SavedPin[];

        pins.forEach(pin => {
          // Skip if marker already exists (e.g. re-render)
          if (savedPinMarkers.current.has(pin.id)) return;

          // Gold diamond marker
          const el = document.createElement('div');
          el.title = pin.name;
          el.style.cssText = [
            'width:12px', 'height:12px',
            'background:#D4820A',
            'border:2px solid #0D1B2A',
            'border-radius:2px',
            'transform:rotate(45deg)',
            'cursor:pointer',
            'box-shadow:0 0 0 2px rgba(212,130,10,0.3)',
          ].join(';');

          const marker = new maplibregl.Marker({ element: el })
            .setLngLat([pin.lng, pin.lat])
            .addTo(map!);

          // Click: place temp marker at this location and re-run analysis
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            // Replace temp marker
            pinMarkerRef.current?.remove();
            const tempEl = document.createElement('div');
            tempEl.style.cssText = [
              'width:14px','height:14px','border-radius:50%',
              'background:#34C97A','border:2.5px solid #0D1B2A',
              'animation:pinPulse 1.8s infinite',
            ].join(';');
            const tempMarker = new maplibregl.Marker({ element: tempEl })
              .setLngLat([pin.lng, pin.lat])
              .addTo(map!);
            pinMarkerRef.current = tempMarker;
            lastSearchAddressRef.current = pin.address ?? null;
            // Draw 400m ring for the restored saved pin
            const c = turf.circle([pin.lng, pin.lat], 0.4, { steps: 64, units: 'kilometers' });
            (map!.getSource('pin-radius') as maplibregl.GeoJSONSource | undefined)?.setData(c);
            if (map!.getLayer('pin-radius-400m')) map!.setLayoutProperty('pin-radius-400m', 'visibility', 'visible');
            triggerPinAnalysis(pin.lat, pin.lng);
          });

          savedPinMarkers.current.set(pin.id, marker);
        });
      } catch {
        // Non-fatal — saved pins just won't render
      }
    }

    loadSavedPins();
  // triggerPinAnalysis is stable (useCallback). Run once on mapReady.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  // ------------------------------------------------------------------
  // URL param auto-trigger — if the page was opened with ?lat=&lng=&name=
  // (e.g. from the landing page address search), fly to the location and
  // trigger a pin analysis once the map is ready.
  // Runs only once per map load — a ref guards against double-firing.
  // ------------------------------------------------------------------
  const urlParamFiredRef = useRef(false);
  useEffect(() => {
    if (!mapReady || urlParamFiredRef.current) return;
    const lat  = parseFloat(searchParams.get('lat')  ?? '');
    const lng  = parseFloat(searchParams.get('lng')  ?? '');
    const name = searchParams.get('name') ?? undefined;
    if (!isNaN(lat) && !isNaN(lng)) {
      urlParamFiredRef.current = true;
      lastSearchAddressRef.current = name ?? null;
      handleAddressSelect(lat, lng, name ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    }
  // handleAddressSelect is stable (useCallback with no deps that change after mount)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  // Activate a map layer by ID — wired to onActivateLayer callbacks in panels.
  // For amenity types ('schools','health','transport','infrastructure') we simply
  // add to activeLayers; the useEffect watching that state calls setLayoutProperty
  // on all three sub-layers AND calls loadLayer to fetch data — both in one place.
  // For any future special layers (flood-zones, vut-individual), we check the layer
  // exists with map.getLayer() before calling setLayoutProperty to avoid MapLibre's
  // console.error on non-existent layers (it logs before throwing).
  const handleActivateLayer = useCallback((layerId: string) => {
    const ltMap: Record<string, LayerType> = {
      schools:        'schools',
      health:         'health',
      transport:      'transport',
      infrastructure: 'infrastructure',
    };
    const layerType = ltMap[layerId];
    if (layerType) {
      // Delegate entirely to the activeLayers useEffect which handles
      // both setLayoutProperty and loadLayer.
      setActiveLayers(prev => {
        const next = new Set(prev);
        next.add(layerType);
        return next;
      });
      return;
    }
    // Special layers (e.g. flood-zones) — only set if layer actually exists
    const map = mapRef.current;
    if (map && map.getLayer(layerId)) {
      try { map.setLayoutProperty(layerId, 'visibility', 'visible'); } catch { /* ok */ }
    }
  }, []);

  return (
    <div
      className="relative w-full h-[calc(100vh-64px)] overflow-hidden flex flex-col"
      style={{ background: 'var(--map-chrome-bg)' }}
    >

      {/* ---- Left panel + map canvas ---- */}
      <div className="relative flex flex-1 overflow-hidden">

        {/* ---- Left panel ---- */}
        <aside
          className="relative z-10 shrink-0 flex flex-col gap-5 p-4 overflow-y-auto border-r"
          style={{
            width:          340,
            background:     'var(--map-panel-bg)',
            borderColor:    'var(--map-chrome-border)',
            backdropFilter: 'blur(24px)',
          }}
        >
          {/* Address search — primary entry point for pin drops */}
          <section>
            <AddressSearch onSelect={handleAddressSelect} />
          </section>

          {/* Idealista URL input — analyse a specific listing */}
          <section>
            <p className="font-[family-name:var(--font-dm-sans)] text-[10px] uppercase tracking-widest text-[#8A9BB0] mb-2">
              Analyse a listing
            </p>
            <form
              onSubmit={e => { e.preventDefault(); handlePanelUrlSubmit(panelUrl); }}
              style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
            >
              <input
                type="text"
                value={panelUrl}
                onChange={e => setPanelUrl(e.target.value)}
                placeholder="idealista.com/inmueble/…"
                disabled={panelLoading}
                style={{
                  width:        '100%', boxSizing: 'border-box',
                  background:   '#0A1825',
                  border:       '1px solid #1E3050',
                  borderRadius: 8,
                  padding:      '8px 10px',
                  fontFamily:   'var(--font-dm-sans)',
                  fontSize:     12,
                  color:        '#FFFFFF',
                  outline:      'none',
                  opacity:      panelLoading ? 0.6 : 1,
                }}
                onFocus={e  => (e.target.style.borderColor = '#34C97A')}
                onBlur={e   => (e.target.style.borderColor = '#1E3050')}
              />
              <button
                type="submit"
                disabled={panelLoading || !panelUrl.trim()}
                style={{
                  background:   panelLoading ? '#1E3050' : '#0D2B4E',
                  color:        '#34C97A',
                  border:       '1px solid #1E3050',
                  borderRadius: 8,
                  padding:      '7px 0',
                  fontFamily:   'var(--font-dm-sans)',
                  fontSize:     12,
                  fontWeight:   600,
                  cursor:       panelLoading || !panelUrl.trim() ? 'not-allowed' : 'pointer',
                  opacity:      panelLoading || !panelUrl.trim() ? 0.5 : 1,
                  transition:   'opacity 150ms',
                }}
              >
                {panelLoading ? 'Starting analysis…' : 'Analyse →'}
              </button>
              {panelError && (
                <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, color: '#F5A07A', marginTop: 2 }}>
                  {panelError}
                </p>
              )}
            </form>
          </section>

          {/* Recent analyses — last 5 from localStorage */}
          {panelRecent.length > 0 && (
            <section>
              <p className="font-[family-name:var(--font-dm-sans)] text-[10px] uppercase tracking-widest text-[#8A9BB0] mb-2">
                Recent
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {panelRecent.slice(0, 5).map(item => (
                  <button
                    key={item.id}
                    onClick={() => handlePanelUrlSubmit(item.url)}
                    disabled={panelLoading}
                    style={{
                      background:   '#0A1825',
                      border:       '1px solid #1E3050',
                      borderRadius: 8,
                      padding:      '8px 10px',
                      cursor:       panelLoading ? 'not-allowed' : 'pointer',
                      display:      'flex',
                      alignItems:   'center',
                      justifyContent: 'space-between',
                      gap:          8,
                      textAlign:    'left',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#C5D5E8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 1 }}>
                        {item.municipio}
                      </p>
                      <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 10, color: '#4A6080' }}>
                        {fmtEur(item.price)} · {timeAgo(item.analysedAt)}
                      </p>
                    </div>
                    <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 12, fontWeight: 600, color: '#34C97A', flexShrink: 0 }}>
                      {item.tvi}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Profile tabs */}
          <section>
            <p className="font-[family-name:var(--font-dm-sans)] text-[10px] uppercase tracking-widest text-[#8A9BB0] mb-2">
              Profile
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {PROFILES.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setProfile(key)}
                  className={`text-sm py-1.5 rounded-md font-[family-name:var(--font-dm-sans)] transition-colors ${
                    profile === key
                      ? 'bg-[#34C97A] text-[#0D1B2A] font-semibold'
                      : 'bg-[#1E3050] text-[#8A9BB0] hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          {/* Layer chips — disabled until a pin is active (CHI-370) */}
          <section>
            <p className="font-[family-name:var(--font-dm-sans)] text-[10px] uppercase tracking-widest text-[#8A9BB0] mb-2">
              Layers
            </p>
            <div className="flex flex-wrap gap-1.5">
              {ALL_LAYER_TYPES.map(type => (
                <LayerChip
                  key={type}
                  label={LAYER_LABELS[type]}
                  active={activeLayers.has(type)}
                  color={LAYER_COLORS[type]}
                  disabled={!isPinActive}
                  onToggle={() => {
                    setActiveLayers(prev => {
                      const next = new Set(prev);
                      if (next.has(type)) {
                        next.delete(type);
                      } else {
                        next.add(type);
                      }
                      return next;
                    });
                  }}
                />
              ))}
            </div>
            {/* Invitation prompt — only shown when no pin is active */}
            {!isPinActive && (
              <p className="font-[family-name:var(--font-dm-sans)] text-xs text-[#4A6080] mt-4 leading-relaxed">
                Right-click anywhere on the map to drop an intelligence pin and explore local amenities.
              </p>
            )}
          </section>

        </aside>

        {/* ---- MapLibre GL canvas ---- */}
        <div ref={containerRef} className="flex-1 h-full relative">
          {/* Overlay toolbar — bottom-centred, only shown once map is ready */}
          {mapReady && (
            <OverlayToolbar
              activeOverlay={activeOverlay}
              onOverlayChange={setActiveOverlay}
              profile={
                profile === 'family'   ? 'families'  :
                profile === 'nomad'    ? 'nomads'     :
                profile === 'retiree'  ? 'retirees'   :
                                         'investors'
              }
            />
          )}
        </div>

        {/* ---- Pin report panel — slide-in from right ---- */}
        <PinReportPanel
          report={pinReport}
          loading={pinLoading}
          error={pinError}
          isOpen={pinPanelOpen}
          profile={profile}
          resolvedAddress={resolvedStreet ?? lastSearchAddressRef.current ?? undefined}
          onClose={handlePinClose}
          onActivateLayer={handleActivateLayer}
          onExpandRadius={handleExpandRadius}
          onCollapseRadius={handleCollapseRadius}
        />

        {/* ---- Right-click pin popover ---- */}
        {pinPopover && (
          <div
            style={{
              position:      'absolute',
              left:          Math.min(pinPopover.x + 12, window.innerWidth - 280),
              top:           Math.max(pinPopover.y - 80, 8),
              zIndex:        30,
              background:    '#0D1B2A',
              border:        '1px solid #34C97A',
              borderRadius:  10,
              padding:       '12px 14px',
              width:         290,
              boxShadow:     '0 8px 32px rgba(0,0,0,0.5)',
            }}
            // Stop map click event from closing the popover immediately
            onClick={e => e.stopPropagation()}
          >
            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, fontWeight: 600, color: '#34C97A', marginBottom: 8 }}>
              📍 Drop an intelligence pin here
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
              <input
                type="number"
                placeholder="Asking price (€) — optional"
                value={pinPrice}
                onChange={e => setPinPrice(e.target.value)}
                style={{
                  fontFamily: 'var(--font-dm-sans)', fontSize: 12,
                  background: '#1E3050', border: '1px solid #2A4060', borderRadius: 6,
                  color: '#FFFFFF', padding: '6px 10px', width: '100%',
                  outline: 'none',
                }}
              />
              <input
                type="number"
                placeholder="Area (m²) — optional"
                value={pinArea}
                onChange={e => setPinArea(e.target.value)}
                style={{
                  fontFamily: 'var(--font-dm-sans)', fontSize: 12,
                  background: '#1E3050', border: '1px solid #2A4060', borderRadius: 6,
                  color: '#FFFFFF', padding: '6px 10px', width: '100%',
                  outline: 'none',
                }}
              />
              <input
                type="url"
                placeholder="Idealista URL — optional"
                value={pinUrl}
                onChange={e => setPinUrl(e.target.value)}
                style={{
                  fontFamily: 'var(--font-dm-sans)', fontSize: 12,
                  background: '#1E3050',
                  border: `1px solid ${pinUrl.trim() ? '#34C97A' : '#2A4060'}`,
                  borderRadius: 6,
                  color: '#FFFFFF', padding: '6px 10px', width: '100%',
                  outline: 'none',
                  transition: 'border-color 0.15s',
                }}
              />
            </div>
            {pinUrl.trim() && (
              <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 10, color: '#34C97A', marginBottom: 6 }}>
                ✓ DNA analysis ready — Run analysis to launch
              </p>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => handlePinSubmit(pinPopover.lat, pinPopover.lng)}
                style={{
                  flex: 1, fontFamily: 'var(--font-dm-sans)', fontSize: 12, fontWeight: 600,
                  background: '#34C97A', color: '#0D1B2A', border: 'none',
                  borderRadius: 6, padding: '7px 0', cursor: 'pointer',
                }}
              >
                Run analysis
              </button>
              <button
                onClick={() => { setPinPopover(null); pinMarkerRef.current?.remove(); pinMarkerRef.current = null; }}
                style={{
                  fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#8A9BB0',
                  background: 'transparent', border: '1px solid #2A4060',
                  borderRadius: 6, padding: '7px 10px', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ---- Second-pin replacement confirmation pill ---- */}
        {showPinReplaceConfirm && (
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2
                          bg-[#0D2B4E] text-white px-4 py-2 rounded-full
                          text-sm flex gap-3 items-center shadow-lg z-20
                          font-[family-name:var(--font-dm-sans)] border border-[#1E4070]">
            <span className="text-[#8A9BB0]">Drop a new pin here?</span>
            <button
              onClick={confirmNewPin}
              className="text-[#34C97A] font-semibold hover:text-[#5ADFAA] transition-colors"
            >
              Yes
            </button>
            <button
              onClick={() => { setShowPinReplaceConfirm(false); setPendingPinCoords(null); }}
              className="text-[#4A6080] hover:text-[#8A9BB0] transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {/* ---- Warning: zones tile not yet uploaded ---- */}
        {tilesError && (
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-20 bg-[#C94B1A] text-white text-xs font-[family-name:var(--font-dm-sans)] px-5 py-2 rounded-full shadow-lg whitespace-nowrap">
            Zone tile not found — upload zones.geojson to Supabase Storage (map-tiles/malaga/)
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper: register cluster + count + pin layers for an amenity type
// ---------------------------------------------------------------------------

function addAmenityLayers(
  map:   maplibregl.Map,
  type:  LayerType,
  color: string,
) {
  // Cluster bubble (zoom 8–13)
  map.addLayer({
    id:      `${type}-cluster`,
    type:    'circle',
    source:  `layer-${type}`,
    minzoom: 8,
    maxzoom: 13,
    filter:  ['has', 'point_count'],
    paint: {
      'circle-color':   color,
      'circle-radius':  18,
      'circle-opacity': 0.85,
    },
    layout: { visibility: 'none' },
  });

  // Count label on clusters
  map.addLayer({
    id:      `${type}-cluster-count`,
    type:    'symbol',
    source:  `layer-${type}`,
    minzoom: 8,
    maxzoom: 13,
    filter:  ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-size':  12,
      visibility:   'none',
    },
    paint: { 'text-color': '#0D1B2A' },
  });

  // Individual pins (zoom 13+)
  map.addLayer({
    id:      `${type}-pins`,
    type:    'circle',
    source:  `layer-${type}`,
    minzoom: 13,
    maxzoom: 22,
    filter:  ['!', ['has', 'point_count']],
    paint: {
      'circle-color':        '#FFFFFF',
      'circle-radius':       8,
      'circle-stroke-color': color,
      'circle-stroke-width': 2,
      'circle-opacity':      0.95,
    },
    layout: { visibility: 'none' },
  });
}

// ---------------------------------------------------------------------------
// Sub-component: layer chip toggle
// ---------------------------------------------------------------------------

function LayerChip({
  label, active, color, onToggle, disabled,
}: {
  label:     string;
  active:    boolean;
  color:     string;
  onToggle:  () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={disabled ? undefined : onToggle}
      disabled={disabled}
      aria-pressed={active}
      title={disabled ? 'Drop a pin to see local amenities' : undefined}
      style={
        disabled
          ? { border: '1px solid #1E3050', color: '#2A3A50', background: 'transparent' }
          : active
            ? { border: `1px solid ${color}`, color, background: `${color}18` }
            : { border: '1px solid #1E3050', color: '#4A6080', background: 'transparent' }
      }
      className={`font-[family-name:var(--font-dm-sans)] text-xs px-3 py-1 rounded-full transition-colors ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      {label}
    </button>
  );
}
