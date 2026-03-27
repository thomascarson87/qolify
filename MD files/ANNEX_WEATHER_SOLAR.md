# Raiz — Annex: Weather, Solar & Orientation Data
**Technical Specification | March 2026**

This annex covers the complete technical implementation of weather, solar, and building orientation data within Raiz. It is the reference document for all ingestion scripts, API integrations, and calculation logic related to Indicator 8 (Climate & Solar Score) and the climate-adjusted energy cost calculation in Indicator 1 (True Affordability Score).

See also: `INDICATORS.md` (Indicator 1 and Indicator 8 formulas), `SCHEMA.md` (tables: `climate_data`, `solar_radiation`, `building_orientation`, `eco_constants`), `DATA_SOURCES.md` (source registry).

---

## 1. Why Climate Data Matters for Property Intelligence

Spain has one of the most climatically diverse territories in Europe — a range matched by few other countries of comparable size.

| Metric | Lowest in Spain | Highest in Spain | Difference |
|---|---|---|---|
| Annual sunshine hours | ~1,700 (Galicia coast) | ~3,100 (Almería) | 82% more sun |
| Heating Degree Days | ~150 (Canarias coast) | ~2,400 (Burgos) | 16× difference in heating demand |
| Cooling Degree Days | ~0 (San Sebastián) | ~1,500 (Sevilla interior) | Infinite practical range |
| Annual rainfall | ~220mm (SE Almería) | ~2,000mm (NW Galicia) | 9× wetter |
| Days above 35°C/yr | 0 (northern coast) | ~80 (Sevilla/Córdoba interior) | — |

A buyer making a location decision without understanding these differences is operating with a fundamental blind spot. A 3-bed property in Burgos and a 3-bed property in Fuengirola at the same asking price represent entirely different lives — and entirely different annual energy bills, structural risk profiles, and quality-of-life realities.

Within a single city, building orientation compounds this: a north-facing apartment in a high-humidity city like Bilbao has meaningfully higher damp risk than a south-facing one 50 metres away in the same building.

---

## 2. Data Sources

### 2.1 AEMET Open Data API (Primary Climate Source)

**What it provides:** The official Spanish national meteorological agency's climate normals — 30-year statistical averages (1991–2020) for every weather station in Spain. This is the authoritative source for all climate figures in Raiz.

**API endpoint:** `https://opendata.aemet.es/openapi/api/`

**Authentication:** Free API key registration at https://opendata.aemet.es/centrodedescargas/inicio

**Key endpoints used:**

```
GET /api/climatologias/normales/estacion/{idema}
→ 30-year climate normals for a specific station ID
→ Returns: monthly temperature, precipitation, sunshine hours, humidity, wind

GET /api/valores/climatologicos/normales
→ All stations in a province/region
→ Returns: array of station records

GET /api/observacion/convencional/todas
→ Current observations across all stations (for real-time AQI cross-reference)
```

**Variables ingested:**
- `ss` — insolación/sunshine hours per month (hours)
- `tm` — mean monthly temperature (°C)
- `tmax` — mean monthly maximum temperature (°C)
- `tmin` — mean monthly minimum temperature (°C)
- `p` — total monthly precipitation (mm)
- `hr` — mean monthly relative humidity (%)
- `w` — mean wind speed (km/h)

**Rate limits:** 1 request/second. No daily limit documented but scrape conservatively (1 request per 2 seconds).

**Ingestion script logic:**
```python
# scripts/ingest_climate_aemet.py

import requests
import time

AEMET_BASE = "https://opendata.aemet.es/openapi/api"
API_KEY    = os.environ["AEMET_API_KEY"]

def fetch_station_normals(station_id: str) -> dict:
    """Fetch 30-year climate normals for a station."""
    url = f"{AEMET_BASE}/climatologias/normales/estacion/{station_id}"
    r = requests.get(url, params={"api_key": API_KEY})
    data_url = r.json()["datos"]          # AEMET returns a redirect URL
    time.sleep(1)
    return requests.get(data_url).json()  # Actual data at redirect URL

def calc_hdd(monthly_temps: list[float], base: float = 15.5) -> int:
    """Heating Degree Days from monthly mean temperatures."""
    # Approximate from monthly means: HDD = sum(max(0, base - tm) * days_in_month)
    days = [31,28,31,30,31,30,31,31,30,31,30,31]
    return int(sum(max(0, base - t) * d for t, d in zip(monthly_temps, days)))

def calc_cdd(monthly_temps: list[float], base: float = 22.0) -> int:
    """Cooling Degree Days from monthly mean temperatures."""
    days = [31,28,31,30,31,30,31,31,30,31,30,31]
    return int(sum(max(0, t - base) * d for t, d in zip(monthly_temps, days)))

def calc_sunshine_annual(monthly_sunshine: list[float]) -> int:
    return int(sum(monthly_sunshine))

def upsert_climate_data(municipio_code: str, station_id: str, normals: dict):
    """Write processed climate normals to Supabase climate_data table."""
    monthly_temps = [normals[f"tm_{m}"] for m in range(1,13)]
    monthly_sun   = [normals.get(f"ss_{m}", 0.0) for m in range(1,13)]
    monthly_rain  = [normals.get(f"p_{m}", 0.0) for m in range(1,13)]
    monthly_hum   = [normals.get(f"hr_{m}", 0.0) for m in range(1,13)]

    record = {
        "municipio_code":        municipio_code,
        "aemet_station_id":      station_id,
        "sunshine_hours_annual": calc_sunshine_annual(monthly_sun),
        **{f"sunshine_hours_{['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'][i]}":
           round(monthly_sun[i] / [31,28,31,30,31,30,31,31,30,31,30,31][i], 1)
           for i in range(12)},
        "hdd_annual":            calc_hdd(monthly_temps),
        "cdd_annual":            calc_cdd(monthly_temps),
        "temp_mean_annual_c":    round(sum(monthly_temps) / 12, 1),
        "temp_mean_jan_c":       monthly_temps[0],
        "temp_mean_jul_c":       monthly_temps[6],
        "rainfall_annual_mm":    int(sum(monthly_rain)),
        "rainfall_jan_mm":       int(monthly_rain[0]),
        "rainfall_jul_mm":       int(monthly_rain[6]),
        "humidity_annual_pct":   round(sum(monthly_hum) / 12, 1),
        "humidity_winter_pct":   round(sum([monthly_hum[i] for i in [0,1,2,9,10,11]]) / 6, 1),
        "era5_gap_fill":         False,
        "data_year_from":        1991,
        "data_year_to":          2020,
    }
    supabase.table("climate_data").upsert(record, on_conflict="municipio_code").execute()
```

**Station-to-municipio mapping:**
AEMET stations are not one-to-one with municipios. For each municipio centroid (lat/lng from INE), find the nearest AEMET station within 25km using PostGIS:

```sql
-- Find nearest AEMET station for each municipio
SELECT m.municipio_code, s.station_id,
       ST_Distance(m.geom::geography, s.geom::geography) as distance_m
FROM municipios m
CROSS JOIN LATERAL (
  SELECT station_id, geom
  FROM aemet_stations
  WHERE ST_DWithin(m.geom::geography, geom::geography, 25000)
  ORDER BY m.geom <-> geom
  LIMIT 1
) s;
```

Where no AEMET station is within 25km → use ERA5 (see Section 2.3).

---

### 2.2 PVGIS JRC REST API (Solar Irradiance — Per Property)

**What it provides:** Monthly Global Horizontal Irradiance (GHI) in kWh/m² for any coordinate in Europe. Originally designed for photovoltaic yield calculation; the underlying solar radiation data is directly applicable to passive solar gain calculations.

**API endpoint:** `https://re.jrc.ec.europa.eu/api/v5_2/seriescalc`

**Authentication:** None required. Open access.

**Key parameters:**
```
lat     = property latitude
lon     = property longitude
outputformat = json
startyear = 2005
endyear   = 2020
pvcalculation = 0   # we want radiation data, not PV output
```

**Response fields used:**
- `G(h)` — Global Horizontal Irradiance (W/m²) — convert to monthly kWh/m²

**Ingestion logic (per-analysis, cached):**

```python
# lib/indicators/pvgis.py

import requests
from functools import lru_cache

PVGIS_BASE = "https://re.jrc.ec.europa.eu/api/v5_2"

def get_solar_radiation(lat: float, lng: float) -> dict:
    """
    Fetch monthly GHI for a coordinate from PVGIS.
    Rounds to 0.01° for cache efficiency (~1km resolution).
    """
    lat_r = round(lat, 2)
    lng_r = round(lng, 2)

    # Check Supabase cache first
    cached = supabase.table("solar_radiation") \
        .select("*") \
        .eq("lat", lat_r) \
        .eq("lng", lng_r) \
        .execute()

    if cached.data:
        return cached.data[0]

    # Fetch from PVGIS
    r = requests.get(f"{PVGIS_BASE}/seriescalc", params={
        "lat": lat_r, "lon": lng_r,
        "outputformat": "json",
        "startyear": 2005, "endyear": 2020,
        "pvcalculation": 0,
        "components": 1
    })
    data = r.json()

    # Aggregate hourly to monthly kWh/m²
    monthly_ghi = aggregate_hourly_to_monthly_kwh(data["outputs"]["hourly"])

    record = {
        "lat": lat_r, "lng": lng_r,
        "ghi_annual_kwh_m2": round(sum(monthly_ghi), 1),
        **{f"ghi_{m}": round(v, 1)
           for m, v in zip(["jan","feb","mar","apr","may","jun",
                             "jul","aug","sep","oct","nov","dec"], monthly_ghi)},
        "pvgis_version": "PVGIS-5"
    }

    supabase.table("solar_radiation").insert(record).execute()
    return record

def calc_solar_gain_kwh(ghi_annual: float, aspect: str,
                         facade_area_m2: float = 15.0) -> float:
    """
    Estimate annual passive solar heat gain through main facade.
    facade_area_m2: typical window area of main facade (default 15m²).
    """
    capture_factors = {
        'S': 0.15, 'SW': 0.10, 'SE': 0.10,
        'E': 0.05, 'W': 0.05,
        'NE': 0.02, 'NW': 0.02,
        'N': 0.00, None: 0.05   # unknown: neutral estimate
    }
    factor = capture_factors.get(aspect, 0.05)
    return ghi_annual * facade_area_m2 * factor  # kWh/year
```

---

### 2.3 ERA5 Copernicus Reanalysis (Gap-Fill)

**What it provides:** Gridded global climate reanalysis at 0.25° resolution (~28km) going back to 1940. Used where no AEMET station is within 25km of a municipio centroid.

**Access:** Copernicus Climate Data Store (CDS) API.
- Registration: https://cds.climate.copernicus.eu
- Python client: `pip install cdsapi`

**Variables requested:**
```python
import cdsapi
c = cdsapi.Client()

c.retrieve("reanalysis-era5-single-levels-monthly-means", {
    "product_type": "monthly_averaged_reanalysis",
    "variable": [
        "2m_temperature",
        "total_precipitation",
        "surface_net_solar_radiation",
        "2m_dewpoint_temperature",  # → relative humidity
    ],
    "year": [str(y) for y in range(1991, 2021)],
    "month": [f"{m:02d}" for m in range(1, 13)],
    "time": "00:00",
    "format": "netcdf"
}, "era5_climate_normals.nc")
```

**Post-processing:** Average over 1991–2020 to produce 30-year normals matching AEMET's reference period. Convert dewpoint to relative humidity using Magnus formula.

**Flag in database:** All `climate_data` rows sourced from ERA5 have `era5_gap_fill = TRUE`. This is shown in the UI as "Climate data based on regional modelling — local conditions may vary."

---

### 2.4 Catastro Building Orientation (Facade Aspect)

**What it provides:** The cardinal direction of a building's main facade — the key input to solar gain calculation and damp risk assessment.

**Two derivation methods:**

#### Method A — Explicit Catastro Field (where available)
The Catastro OVC API returns building attributes including, for some properties, an explicit `orientacion` field. This is available for approximately 40% of properties nationally, with higher coverage in newer buildings.

```python
# In the Catastro enrichment step:
catastro_data = fetch_catastro_ovc(ref_catastral)
if "orientacion" in catastro_data:
    aspect = catastro_data["orientacion"]  # e.g. "S", "NE", "SW"
    source = "catastro_explicit"
    confidence = "high"
```

#### Method B — Footprint Geometry Derivation (fallback, ~60% of properties)
The Catastro also provides building footprint polygons (GeoJSON). The main facade can be derived from the longest edge of the footprint polygon that faces a public street.

```python
import shapely
from shapely.geometry import shape
import math

def derive_aspect_from_footprint(footprint_geojson: dict,
                                  street_geojson: dict = None) -> tuple[str, str]:
    """
    Derive facade orientation from building footprint.
    Returns (aspect: str, confidence: str)
    """
    polygon = shape(footprint_geojson)
    coords  = list(polygon.exterior.coords)

    # Get all edges
    edges = [(coords[i], coords[i+1]) for i in range(len(coords)-1)]

    # Find longest edge (most likely main facade)
    def edge_length(e): return math.hypot(e[1][0]-e[0][0], e[1][1]-e[0][1])
    def edge_bearing(e):
        dx = e[1][0] - e[0][0]
        dy = e[1][1] - e[0][1]
        return (math.degrees(math.atan2(dx, dy)) + 360) % 360

    longest = max(edges, key=edge_length)
    bearing = edge_bearing(longest)

    # The facade normal is perpendicular to the edge
    facade_bearing = (bearing + 90) % 360

    # Convert bearing to cardinal
    directions = ['N','NE','E','SE','S','SW','W','NW']
    idx = int((facade_bearing + 22.5) / 45) % 8
    aspect = directions[idx]

    # Lower confidence if no street adjacency confirmed
    confidence = "medium" if street_geojson else "low"
    return aspect, confidence
```

**Storage:**
```python
supabase.table("building_orientation").upsert({
    "ref_catastral": ref_catastral,
    "aspect":        aspect,
    "aspect_degrees": int(facade_bearing),
    "source":        source,      # 'catastro_explicit' | 'footprint_derived'
    "confidence":    confidence   # 'high' | 'medium' | 'low'
}, on_conflict="ref_catastral").execute()
```

---

## 3. Indicator 8 Calculation — Full Implementation

### 3.1 Sub-component: HDD/CDD Energy Cost

```python
def calc_climate_energy_costs(
    hdd: int,
    cdd: int,
    area_sqm: int,
    epc_rating: str,
    aspect: str,
    ghi_annual_kwh_m2: float,
    gas_price: float,       # €/kWh — from eco_constants
    elec_price: float       # €/kWh — from eco_constants
) -> dict:
    """
    Climate-adjusted annual energy cost estimate.
    Returns heating_eur, cooling_eur, total_eur.
    """
    # U-values from eco_constants table
    u_values = {'A': 0.3, 'B': 0.5, 'C': 0.7, 'D': 1.0,
                'E': 1.4, 'F': 1.8, 'G': 2.3}
    u = u_values.get(epc_rating, 1.0)

    # Heating: HDD × area × U-value × 24hrs → kWh
    heating_kwh_raw = hdd * area_sqm * u * 0.024

    # Solar gain reduction (kWh saved by passive solar)
    solar_gain = calc_solar_gain_kwh(ghi_annual_kwh_m2, aspect,
                                      facade_area_m2=area_sqm * 0.12)
    heating_kwh = max(0, heating_kwh_raw - solar_gain)
    heating_eur = round(heating_kwh * gas_price)

    # Cooling: CDD × area × cooling factor × 24hrs → kWh
    cooling_factors = {'A': 0.3, 'B': 0.5, 'C': 0.7, 'D': 1.0,
                       'E': 1.3, 'F': 1.6, 'G': 2.0}
    cf = cooling_factors.get(epc_rating, 1.0)
    cooling_kwh = cdd * area_sqm * cf * 0.024
    cooling_eur = round(cooling_kwh * elec_price)

    return {
        "heating_kwh":    round(heating_kwh),
        "heating_eur":    heating_eur,
        "cooling_kwh":    round(cooling_kwh),
        "cooling_eur":    cooling_eur,
        "total_energy_eur": heating_eur + cooling_eur
    }
```

### 3.2 Sub-component: Damp Risk Index

```python
def calc_damp_risk(
    rainfall_mm: int,
    humidity_pct: float,
    aspect: str,
    build_year: int,
    epc_rating: str,
    floor: int
) -> float:
    """Returns damp risk score 0-100. Higher = higher risk."""

    def norm(val, lo, hi):
        return max(0, min(1, (val - lo) / (hi - lo)))

    rainfall_score  = norm(rainfall_mm, 200, 2000)
    humidity_score  = norm(humidity_pct, 40, 90)

    orientation_pen = {
        'N': 1.0, 'NE': 0.8, 'NW': 0.8,
        'E': 0.5, 'W': 0.5,
        'SE': 0.2, 'SW': 0.2, 'S': 0.0, None: 0.4
    }.get(aspect, 0.4)

    age_pen   = norm(2026 - (build_year or 1980), 0, 80)
    epc_pen   = {'A': 0.0, 'B': 0.1, 'C': 0.2, 'D': 0.4,
                 'E': 0.6, 'F': 0.8, 'G': 1.0}.get(epc_rating, 0.4)
    floor_pen = 0.2 if (floor is not None and floor <= 0) else 0.0

    score = (
        (rainfall_score  * 0.25) +
        (humidity_score  * 0.20) +
        (orientation_pen * 0.25) +
        (age_pen         * 0.15) +
        (epc_pen         * 0.10) +
        (floor_pen       * 0.05)
    ) * 100

    return round(score, 1)
```

### 3.3 Composite Climate & Solar Score

```python
def calc_climate_solar_score(
    sunshine_annual: int,
    sunshine_winter_avg: float,   # avg daily hours Oct-Mar
    hdd: int,
    cdd_adjusted: float,          # CDD × EPC penalty
    aspect: str,
    damp_risk: float,
    days_above_35c: int,
    days_above_35c_trend: float,
    flood_risk_level: str,
    fire_risk_level: str,
    aqi_annual_avg: float
) -> float:
    """Returns composite Climate & Solar Score 0-100."""

    def norm(val, lo, hi, invert=False):
        s = max(0, min(1, (val - lo) / (hi - lo)))
        return (1 - s) if invert else s

    sunshine_score     = norm(sunshine_annual, 1700, 3100)
    winter_score       = norm(sunshine_winter_avg, 2.0, 6.5)
    hdd_score          = norm(hdd, 0, 3000, invert=True)
    cdd_score          = norm(cdd_adjusted, 0, 2000, invert=True)

    orientation_scores = {
        'S': 1.00, 'SE': 0.88, 'SW': 0.85, 'E': 0.65,
        'W': 0.60, 'NE': 0.35, 'NW': 0.30, 'N': 0.10, None: 0.50
    }
    orientation_score  = orientation_scores.get(aspect, 0.50)

    damp_score         = 1 - (damp_risk / 100)

    heat_risk          = norm(days_above_35c, 0, 80)
    heat_trend         = norm(days_above_35c_trend, -5, 30)
    flood_s            = {'none': 1.0, 'T500': 0.75, 'T100': 0.35, 'T10': 0.0}.get(flood_risk_level, 1.0)
    fire_s             = {'none': 1.0, 'low': 0.8, 'medium': 0.5, 'high': 0.15}.get(fire_risk_level, 1.0)
    aqi_s              = norm(aqi_annual_avg, 0, 150, invert=True)
    physical_risk_score = flood_s * 0.40 + fire_s * 0.25 + (1-heat_risk) * 0.20 + (1-heat_trend) * 0.10 + aqi_s * 0.05

    composite = (
        (sunshine_score    * 0.20) +
        (winter_score      * 0.15) +
        (hdd_score         * 0.15) +
        (cdd_score         * 0.10) +
        (orientation_score * 0.15) +
        (damp_score        * 0.15) +
        (physical_risk_score * 0.10)
    ) * 100

    return round(composite, 1)
```

---

## 4. Scheduled Jobs and Cadence

| Job | Script | Trigger | Cadence |
|---|---|---|---|
| AEMET climate normals ingestion | `scripts/ingest_climate_aemet.py` | Manual + annual cron | Annual (AEMET updates normals every 10 years; check for updates annually) |
| ERA5 gap-fill for thin AEMET zones | `scripts/ingest_climate_era5.py` | Runs after AEMET ingestion for unmatched municipios | Annual |
| PVGIS solar radiation cache | `lib/indicators/pvgis.py` | Per-analysis, lazily cached | Per new property coordinate (cached indefinitely at 0.01° resolution) |
| Catastro building orientation | `lib/indicators/orientation.py` | Per-analysis, cached per ref_catastral | Per new property |
| eco_constants update | Manual update in Supabase dashboard | Monthly check | Monthly — gas/electricity tariffs change quarterly or more often |
| Extreme heat trend update | `scripts/update_heat_trends.py` | Annual | Annual — ERA5 provides recent-decade averages |

---

## 5. Spain Climate Reference Data

The table below serves as a sanity-check reference for the ingestion pipeline and for manual validation of indicator outputs. All figures are 30-year normals (1991–2020) from AEMET unless noted.

| City | Sun hrs/yr | HDD | CDD | Rainfall mm | Humidity % | Hot days (35°C+) |
|---|---|---|---|---|---|---|
| A Coruña | 1,750 | 1,180 | 40 | 1,000 | 79 | 0 |
| Bilbao | 1,850 | 1,380 | 80 | 1,190 | 76 | 2 |
| San Sebastián | 1,800 | 1,450 | 60 | 1,420 | 77 | 1 |
| Santander | 1,770 | 1,300 | 50 | 1,180 | 75 | 0 |
| Oviedo | 1,680 | 1,600 | 50 | 950 | 80 | 0 |
| Burgos | 2,150 | 2,380 | 200 | 560 | 72 | 5 |
| Valladolid | 2,580 | 2,000 | 310 | 450 | 65 | 15 |
| Salamanca | 2,600 | 1,950 | 290 | 400 | 60 | 14 |
| Madrid | 2,800 | 1,700 | 600 | 430 | 57 | 22 |
| Toledo | 2,850 | 1,500 | 800 | 370 | 55 | 35 |
| Zaragoza | 2,850 | 1,400 | 600 | 310 | 60 | 28 |
| Barcelona | 2,550 | 870 | 430 | 580 | 67 | 8 |
| Valencia | 2,800 | 550 | 750 | 450 | 64 | 20 |
| Alicante | 2,950 | 380 | 850 | 280 | 64 | 25 |
| Murcia | 3,000 | 350 | 1,000 | 280 | 60 | 40 |
| Sevilla | 2,900 | 590 | 1,390 | 540 | 58 | 55 |
| Córdoba | 2,900 | 650 | 1,200 | 580 | 57 | 52 |
| Granada | 2,950 | 1,100 | 900 | 380 | 56 | 30 |
| Málaga | 2,950 | 250 | 820 | 480 | 63 | 30 |
| Almería | 3,100 | 150 | 980 | 220 | 62 | 28 |
| Cádiz | 3,000 | 280 | 500 | 580 | 70 | 10 |
| Las Palmas (GC) | 2,900 | 80 | 200 | 160 | 68 | 5 |
| Santa Cruz Tenerife | 2,800 | 60 | 250 | 200 | 66 | 8 |

---

## 6. Validation Protocol

Before Indicator 8 is shipped, validate the following against real properties in the test set:

1. **Sunshine hours accuracy:** Query `climate_data` for Málaga municipio. Confirm `sunshine_hours_annual` is between 2,800 and 3,100. Repeat for Bilbao (should be 1,700–2,000).

2. **HDD accuracy:** Burgos should show HDD > 2,000. Málaga should show HDD < 300. Any value outside these ranges indicates an AEMET ingestion error.

3. **Energy cost sanity check:** For a 90m² Piso D-rated property:
   - Málaga (HDD~250): heating cost should be approximately €300–500/yr
   - Burgos (HDD~2400): heating cost should be approximately €2,000–3,500/yr
   - The Burgos/Málaga ratio should be approximately 5–7×

4. **Orientation compass:** Manually verify a known south-facing building's `building_orientation.aspect` = 'S'. Check a known north-facing building = 'N'. Test with a ref_catastral from Catastro directly.

5. **Damp risk:** A north-facing, pre-1970 apartment in Bilbao (rainfall ~1,200mm, humidity ~76%) should score damp_risk > 70. A south-facing 2010 apartment in Almería (rainfall ~220mm) should score < 20.

6. **Composite score:** Almería should score Climate & Solar Score > 85. A Coruña should score < 40. Madrid should score 55–70.

---

## 7. Limitations and Transparency Rules

These limitations must be surfaced in the UI, not hidden.

| Limitation | UI treatment |
|---|---|
| AEMET normals are 1991–2020; recent years are warmer than the baseline | Show note: "Climate figures based on 1991–2020 averages. Recent years run warmer — extreme heat trend shown separately." |
| Building orientation not available for all properties | Show "Orientation: Not available — neutral estimate used" in energy calculation footnote |
| ERA5 gap-fill used for thin-coverage municipio | Show "Climate data based on regional modelling — local conditions may vary" |
| PVGIS does not account for building-specific shading | Show "Solar figure assumes open-sky exposure. Shading from adjacent buildings not captured." |
| HDD/CDD from monthly averages (not daily data) | Show "Energy estimates use monthly climate averages. Actual costs will vary." |
| Damp risk is a probabilistic indicator, not a survey | Show "This is a risk indicator, not a confirmed finding. It does not replace a professional damp survey." |
