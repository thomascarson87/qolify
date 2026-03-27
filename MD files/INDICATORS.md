# Qolify — Composite Indicators

All 15 composite indicators. Each indicator combines data from multiple pillars to produce a novel insight that no individual data point could provide alone.

---

## Overview

| # | Indicator | Tier | Type | Primary value to user |
|---|---|---|---|---|
| 1 | True Affordability Score | 1 | Within-pillar | Real monthly cost vs raw price |
| 2 | Structural Liability Index | 1 | Within-pillar | Hidden derrama risk |
| 3 | Digital Viability Score | 1 | Within-pillar | Remote work feasibility |
| 4 | Health Security Score | 1 | Within-pillar | Healthcare access quality |
| 5 | Education Opportunity Score | 1 | Within-pillar | School optionality |
| 6 | Neighbourhood Transition Index | 2 | Cross-pillar | Gentrification momentum |
| 7 | Community Stability Score | 2 | Cross-pillar | Settled vs transient neighbourhood |
| 8 | Climate & Solar Score | 2 | Cross-pillar | Liveability, energy cost, damp risk, solar quality |
| 9 | Infrastructure Arbitrage Score | 2 | Cross-pillar | Future value not yet priced |
| 10 | Motivated Seller Index | 2 | Cross-pillar | Negotiation leverage |
| 11 | Rental Trap Index | 2 | Cross-pillar | Buy vs rent monthly delta |
| 12 | Expat Liveability Score | 2 | Cross-pillar | International buyer suitability |
| 13 | Price Velocity Signal | 3 | Temporal | Rate + direction of price change |
| 14 | Gentrification Confirmation | 3 | Temporal | Early vs late stage signal |
| 15 | Seasonal Distortion Filter | 3 | Temporal | Price adjusted for season |

**Tier 1:** No historical data needed. Available from day one.
**Tier 2:** Benefits from zone history. Confidence improves over time. Show with confidence level.
**Tier 3:** Requires accumulated `property_price_history` and `zone_metrics_history`. Available after sufficient accumulation (minimum 4 price observations for Indicators 13+14, 12 months for 15).

---

## Tier 1 — Within-Pillar Composites

### Indicator 1 — True Affordability Score

**What it tells the user:** Not what the property costs to buy, but what it costs to live in every month.

**Inputs:**
- `properties.price_asking` — asking price
- Regional ITP rate (from reference table) — transfer tax
- Estimated IBI (annual property tax) — derived from municipio + area_sqm
- **Climate-adjusted energy cost** — derived from `climate_data.hdd_annual`, `climate_data.cdd_annual`, `building_orientation.aspect`, `solar_radiation.ghi_annual_kwh_m2`, `epc_rating`, `area_sqm`, and current energy tariff rates (see below — replaces crude EPC-only estimate)
- Estimated comunidad fee — derived from `build_year` + `area_sqm`
- ICO eligibility (boolean) — affects deposit and therefore mortgage amount
- Current ECB base rate + typical Spanish bank spread (reference constant, updated quarterly)
- Local median income — from INE by municipio

**Formula:**
```
monthly_mortgage  = calc_mortgage(price_asking - deposit, rate=ecb+spread, years=30)
monthly_ibi       = lookup_ibi_estimate(municipio, area_sqm) / 12
monthly_comunidad = estimate_comunidad(build_year, area_sqm) / 12

# Climate-adjusted energy cost (replaces crude EPC-only estimate)
# Heating
u_value         = epc_to_u_value(epc_rating)        # W/m²K heat loss coefficient
heating_kwh     = hdd_annual × area_sqm × u_value × 0.024  # HDD × area × loss × hrs/day
# Solar orientation adjustment — south-facing reduces heating demand
solar_factor    = orientation_to_solar_gain(aspect, ghi_annual_kwh_m2)
heating_kwh    *= (1 - solar_factor)
heating_cost    = heating_kwh × gas_price_kwh

# Cooling
cooling_kwh     = cdd_annual × area_sqm × cooling_factor(epc_rating) × 0.024
cooling_cost    = cooling_kwh × electricity_price_kwh

energy_monthly  = (heating_cost + cooling_cost) / 12

total_monthly_cost = monthly_mortgage + monthly_ibi + energy_monthly + monthly_comunidad

affordability_score = 100 - normalise(total_monthly_cost / local_income_monthly,
                                      national_min, national_max)
```

**Reference values (updated quarterly in `eco_constants`):**
- `gas_price_kwh`: current Spanish regulated gas tariff
- `electricity_price_kwh`: current PVPC electricity tariff
- `epc_to_u_value`: A=0.3, B=0.5, C=0.7, D=1.0, E=1.4, F=1.8, G=2.3 (W/m²K)
- `orientation_to_solar_gain`: S=0.15, SW/SE=0.10, E/W=0.05, NE/NW=0.02, N=0.0

**Output:**
- `true_affordability_score`: 0-100 (higher = more affordable relative to local income)
- `true_affordability_monthly_eur`: integer (absolute monthly cost in EUR)
- `confidence`: 'high' (all inputs available from static data)

**Alert triggers:**
- Amber: monthly cost > 40% of local median income
- Red: monthly cost > 50% of local median income

---

### Indicator 2 — Structural Liability Index

**What it tells the user:** The probability that the buyer will face a large unexpected repair levy (derrama) within 5 years of purchase.

**Inputs:**
- `properties.build_year` or `catastro_year_built`
- `ite_status.status` for matching ref_catastral or address
- `properties.epc_rating`
- Years since last major building permit (estimated from `ite_status.inspection_date` or Catastro data)

**Formula:**
```
age_score    = normalise(2026 - build_year, min=0, max=80)  # older = higher risk
ite_score    = { 'passed': 0, 'pending': 60, 'failed': 100, None: 40 }
epc_score    = { 'A': 0, 'B': 10, 'C': 20, 'D': 40, 'E': 65, 'F': 80, 'G': 100 }
permit_score = normalise(years_since_last_permit, min=0, max=30)

sli = (age_score * 0.30) + (ite_score * 0.40) + (epc_score * 0.20) + (permit_score * 0.10)
```

**Output:**
- `structural_liability_index`: 0-100 (higher = higher derrama risk)
- `structural_liability_est_eur`: estimated liability exposure in EUR (rough band: 0 / €2k-5k / €5k-15k / €15k+)
- `confidence`: 'high' if ITE data available, 'medium' if estimated from age/EPC only

**Alert triggers:**
- Amber: score > 55 (ITE due soon, or older building with poor EPC)
- Red: score > 75 (ITE failed or pending, or very old building with no recent works)

---

### Indicator 3 — Digital Viability Score

**What it tells the user:** Whether this property actually supports reliable remote work, beyond what "has fibre" means on paper.

**Inputs:**
- `fibre_coverage.coverage_type` for property coordinates: FTTP / FTTC / HFC / none
- `fibre_coverage.max_speed_mbps`
- nPerf crowdsourced speed factor for `codigo_postal` (where available)
- Count of coworking spaces within 2km (`amenities` table, `category = 'coworking'`)

**Formula:**
```
fibre_score  = { 'FTTP': 100, 'FTTC': 60, 'HFC': 45, 'none': 0 }
speed_factor = lookup_nperf_factor(codigo_postal) or 1.0  # 0.5–1.0 adjustment
cowork_bonus = min(coworking_count * 8, 20)

digital_viability = (fibre_score * speed_factor) + cowork_bonus
```

**Output:**
- `digital_viability_score`: 0-100
- `fibre_type`: string ('FTTP' etc)
- `coworking_count_2km`: integer
- `confidence`: 'high'

---

### Indicator 4 — Health Security Score

**What it tells the user:** Practical access to healthcare — not just proximity, but the right type at the right time.

**Inputs:**
- Distance to nearest GP (centro de salud) — PostGIS query on `health_centres` WHERE tipo = 'centro_salud'
- Distance to nearest 24h emergency — PostGIS query WHERE is_24h = TRUE
- Pharmacy count within 500m — PostGIS count on `amenities` WHERE category = 'pharmacy'

**Formula:**
```
gp_score    = distance_to_score(gp_dist_m, optimal=300, max=3000)
er_score    = distance_to_score(er_dist_m, optimal=1000, max=8000)
pharm_score = min(pharmacy_count * 25, 100)

health_security = (gp_score * 0.40) + (er_score * 0.40) + (pharm_score * 0.20)

# distance_to_score: 100 at optimal, linear decay to 0 at max
```

**Output:**
- `health_security_score`: 0-100
- `nearest_gp_m`: integer
- `nearest_er_m`: integer
- `pharmacy_count_500m`: integer
- `confidence`: 'high'

---

### Indicator 5 — Education Opportunity Score

**What it tells the user:** Not just "is there a school nearby" but how much educational choice a family actually has.

**Inputs:**
- Schools within 1km by type — PostGIS query on `schools`
- Whether property is within a school catchment zone — PostGIS intersection with `school_catchments`
- `schools.rating_score` where available (regional data)
- School count by etapa (infantil, primaria, secundaria)

**Formula:**
```
public_score     = min(public_schools_1km * 20, 60)
concertado_score = min(concertado_1km * 15, 30)
private_score    = min(private_1km * 10, 20)
catchment_bonus  = 15 if in_catchment else 0
rating_bonus     = avg_rating_score * 5 if ratings available else 0

edu_score = min(public_score + concertado_score + private_score + catchment_bonus + rating_bonus, 100)
```

**Output:**
- `education_opportunity_score`: 0-100
- `in_catchment`: boolean
- `school_count_1km`: integer
- `school_breakdown`: { public: n, concertado: n, private: n }
- `confidence`: 'high' where catchment data available, 'medium' otherwise

---

## Tier 2 — Cross-Pillar Composites

### Indicator 6 — Neighbourhood Transition Index (NTI)

**What it tells the user:** Whether this neighbourhood is on an upward trajectory that the market hasn't fully priced yet — or whether the momentum is already exhausted.

**Inputs (from `zone_metrics_history` for `codigo_postal`, 24 months):**
- Specialty amenity arrival rate — new cafes, coworking, yoga studios in `amenity_history`
- Building permit acceleration — `building_permits_30d` trend
- VUT application trend — `vut_applications_30d` trend
- DOM compression rate — `median_dom` trend (falling DOM = rising demand)
- Crime trend direction — `crime_stats.trend_12m`

**Formula:**
```
amenity_velocity = calc_arrival_rate(amenity_history, codigo_postal, months=24)  # z-scored
permit_accel     = calc_trend(zone_hist['building_permits_30d'], months=12)
vut_trend        = calc_trend(zone_hist['vut_applications_30d'], months=12)
dom_compression  = calc_trend(zone_hist['median_dom'], months=6, invert=True)  # falling DOM = positive
crime_trend      = -1 * crime_stats.trend_12m / 20  # negative trend (improving) = positive signal

nti_raw = (amenity_velocity * 0.30) + (permit_accel * 0.25) +
          (dom_compression * 0.20) + (crime_trend * 0.15) + (vut_trend * 0.10)

nti_score = zscore_nationally(nti_raw) * 100  # range approx -100 to +100
```

**Signal classification:**
```
if nti_score > 40 AND price_velocity_pct_12m < 5:  → 'prime_buy'
if nti_score > 40 AND price_velocity_pct_12m >= 8: → 'too_late'
if nti_score < -20:                                 → 'risk'
else:                                               → 'stable'
```

**Output:**
- `neighbourhood_transition_index`: -100 to +100
- `nti_signal`: 'prime_buy' | 'too_late' | 'stable' | 'risk'
- `confidence`: 'high' (24m zone data), 'medium' (12m), 'low' (<6m), 'insufficient_data' (<4 data points)

**Alert triggers:**
- Green: signal = 'prime_buy'
- Red: signal = 'risk'

---

### Indicator 7 — Community Stability Score

**What it tells the user:** Whether this is a place where people stay, know their neighbours, and form a real community — vs a transient, tourist-saturated zone.

**Inputs:**
- VUT density % — `vut_licences` count / estimated total units in postcode zone
- DOM stability — variance in `median_dom` over 12 months (stable DOM = stable community)
- Local commerce longevity — average age of amenities in `amenity_history` within 500m
- Noise level — from `noise_zones` at property coordinates

**Formula:**
```
vut_score      = 100 - min(vut_density_pct * 2, 100)  # 0% VUT = 100, 50%+ = 0
dom_stability  = 100 - normalise(dom_variance_12m, national_min, national_max)
commerce_age   = normalise(avg_amenity_age_months, min=0, max=60)
noise_score    = 100 - normalise(noise_db, min=35, max=75)

community_stability = (vut_score * 0.40) + (dom_stability * 0.20) +
                      (commerce_age * 0.20) + (noise_score * 0.20)
```

**Output:**
- `community_stability_score`: 0-100
- `vut_density_pct`: decimal
- `confidence`: 'high' if VUT + noise data available, 'medium' otherwise

---

### Indicator 8 — Climate & Solar Score

**What it tells the user:** A complete picture of the climate this property sits in — how much sun it gets, how much it will cost to heat and cool, how its physical orientation affects liveability and damp risk, and how the long-term physical risks (flood, fire, extreme heat) affect its value as a 30-year asset.

This is the most geographically variable indicator in the platform. A 3-bed apartment in Burgos and a 3-bed apartment in Fuengirola at the same price represent profoundly different climate realities — different annual energy bills, different winter quality of life, different structural risk profiles. This indicator makes that visible.

**Sub-components:**

#### 8a — Annual Sunshine Hours & Distribution

**Inputs:** `climate_data.sunshine_hours_monthly[12]` for property's municipio (from AEMET climate normals)

```
sunshine_annual    = sum(climate_data.sunshine_hours_monthly)
sunshine_score     = normalise(sunshine_annual, min=1700, max=3100)
# 1700 = Galicia coast (lowest in Spain), 3100 = Almería (highest)

winter_sunshine    = mean(sunshine_hours_monthly[Nov, Dec, Jan, Feb])
winter_score       = normalise(winter_sunshine, min=2.0, max=6.5)
# Winter hours matter disproportionately for quality of life
```

**Display:** 12-month bar chart (daily hours per month). Two callouts: darkest month and brightest month. National percentile ranking. "Top X% nationally" label.

---

#### 8b — Heating Degree Days (HDD) & Winter Thermal Comfort

**Inputs:** `climate_data.hdd_annual` (AEMET 30-year normal, base 15.5°C)

```
# HDD range in Spain: ~150 (Canarias coast) to ~3000 (inland Castilla mountains)
# Madrid ~1700, Málaga ~250, Bilbao ~1400, Sevilla ~600, Burgos ~2400

hdd_score = normalise(hdd_annual, min=0, max=3000, invert=True)
# Higher HDD = lower score (more heating needed = worse for liveability/cost)
```

**Used in:** True Affordability Score (Indicator 1) heating cost calculation. Also displayed as a standalone sub-score here.

**Display:** Single figure with context — "250 HDD — Very mild winters. Only 15% of locations in Spain have milder winters."

---

#### 8c — Cooling Degree Days (CDD) & Summer Thermal Comfort

**Inputs:** `climate_data.cdd_annual` (AEMET 30-year normal, base 22°C)

```
# CDD range: ~0 (northern coast, Pyrenees) to ~1500+ (Sevilla interior)
# Sevilla ~1400, Madrid ~600, Barcelona ~450, Bilbao ~50

# CDD is not simply "higher = worse" — moderate CDD is expected in Spain
# Very high CDD with poor EPC is the risk signal
cdd_adjusted = cdd_annual × epc_penalty(epc_rating)
# epc_penalty: A=0.3, B=0.5, C=0.7, D=1.0, E=1.4, F=1.8, G=2.3

cdd_score = normalise(cdd_adjusted, min=0, max=2000, invert=True)
```

---

#### 8d — Building Solar Orientation

**Inputs:** `building_orientation.aspect` (from Catastro footprint geometry or explicit Catastro field)

```
# Aspect: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW'
# In Spain, south-facing is optimal for: winter solar gain, natural light, damp prevention

orientation_score = {
    'S':  100,   # Optimal — direct winter sun, maximum passive heating
    'SE': 88,    # Very good — morning sun, good winter gain
    'SW': 85,    # Very good — afternoon sun, good winter gain
    'E':  65,    # Moderate — morning sun only, less winter benefit
    'W':  60,    # Moderate — afternoon sun only
    'NE': 35,    # Poor — limited direct sun, cold mornings
    'NW': 30,    # Poor — limited direct sun, cold afternoons
    'N':  10,    # Unfavourable — no direct sun in winter, damp risk elevated
    None: 50     # Unknown — neutral score, flagged as 'data not available'
}

solar_gain_kwh = ghi_annual_kwh_m2 × facade_area_m2 × orientation_capture_factor
```

**Display:** Compass rose SVG with orientation marked. Plain-English: "South-facing — receives direct winter sun from approximately 10am to 4pm. Estimated passive solar heating benefit: 10–15%, reducing heating costs."

**Alert triggers:**
- Amber: aspect = 'N' in a high-rainfall, high-humidity municipio (elevated damp risk compound)

---

#### 8e — Damp Risk Index (sub-indicator)

**What it tells the user:** Whether this specific property, in this specific orientation, in this specific climate, has an elevated risk of damp and mould — one of the most common and damaging hidden problems in Spanish properties.

**Inputs:**
- `climate_data.rainfall_annual_mm` — AEMET annual precipitation normal
- `climate_data.humidity_annual_pct` — AEMET relative humidity normal
- `building_orientation.aspect`
- `properties.build_year` or `catastro_year_built`
- `properties.epc_rating`
- `properties.floor` — ground/basement floors have elevated damp risk

```
rainfall_score  = normalise(annual_rainfall_mm, min=200, max=2000)
humidity_score  = normalise(annual_humidity_pct, min=40, max=90)
orientation_pen = { 'N': 1.0, 'NE': 0.8, 'NW': 0.8, 'E': 0.5,
                    'W': 0.5, 'SE': 0.2, 'SW': 0.2, 'S': 0.0, None: 0.4 }
age_pen         = normalise(2026 - (build_year or 1980), min=0, max=80)
epc_pen         = { 'A': 0, 'B': 0.1, 'C': 0.2, 'D': 0.4,
                    'E': 0.6, 'F': 0.8, 'G': 1.0, None: 0.4 }
floor_pen       = 0.2 if (floor is not None and floor <= 0) else 0.0

damp_risk = ((rainfall_score  * 0.25) +
             (humidity_score  * 0.20) +
             (orientation_pen * 0.25) +
             (age_pen         * 0.15) +
             (epc_pen         * 0.10) +
             (floor_pen       * 0.05)) * 100
```

**Output:**
- `damp_risk_index`: 0–100 (higher = higher risk)
- `confidence`: 'high' if orientation data available, 'medium' if estimated from parcel geometry

**Alert triggers:**
- Amber: damp_risk > 55 — *"This property's orientation and local climate suggest elevated damp risk. Request a professional damp survey before proceeding."*
- Red: damp_risk > 75 — *"High damp risk flagged. North-facing orientation, high annual humidity, and older construction are a known combination for structural moisture problems in this region."*

---

#### 8f — Extreme Heat Days & Future Climate Risk

**Inputs:**
- `climate_data.days_above_35c_annual` — AEMET current climate normal
- `climate_data.days_above_35c_trend` — trend vs. 1990–2010 baseline (from ERA5 reanalysis)
- Flood risk level from `flood_zones`
- Fire risk from GIS data
- AQI 12-month trend from MITECO

```
heat_risk    = normalise(days_above_35c_annual, min=0, max=80)
heat_trend   = normalise(days_above_35c_trend, min=-5, max=+30)  # days change vs baseline
flood_score  = { None: 100, 'T500': 75, 'T100': 35, 'T10': 0 }
fire_score   = { 'none': 100, 'low': 80, 'medium': 50, 'high': 15 }
aqi_score    = normalise(aqi_annual_avg, min=0, max=150, invert=True)

# Long-term physical risk composite
physical_risk = 100 - ((heat_risk * 0.30) + (heat_trend * 0.20) +
                        ((100 - flood_score) * 0.30) +
                        ((100 - fire_score) * 0.15) +
                        ((100 - aqi_score) * 0.05))
```

**Display:** "Average of 34 days above 35°C per year — trending up (was 18 days/year in 2000–2010)." For retirees and families, this is a significant quality-of-life and health signal, shown with a trend arrow.

---

#### Composite Climate & Solar Score

```
climate_solar_score = (
    (sunshine_score    * 0.20) +   # annual sun hours, normalised
    (winter_score      * 0.15) +   # winter sunshine — key for quality of life
    (hdd_score         * 0.15) +   # heating demand (inverted — lower HDD = better)
    (cdd_score         * 0.10) +   # cooling demand (inverted, adjusted for EPC)
    (orientation_score * 0.15) +   # building solar aspect
    ((100-damp_risk)   * 0.15) +   # damp risk (inverted — lower risk = better)
    (physical_risk     * 0.10)     # flood, fire, extreme heat, AQI
)
```

**Outputs:**
- `climate_solar_score`: 0–100 overall composite
- `sunshine_hours_annual`: integer (e.g., 2847)
- `sunshine_hours_monthly`: array[12] of floats
- `hdd_annual`: integer
- `cdd_annual`: integer
- `building_aspect`: string ('S', 'SW', 'N' etc)
- `damp_risk_index`: 0–100
- `days_above_35c_annual`: integer
- `days_above_35c_trend`: float (change vs baseline)
- `heating_cost_annual_eur`: integer (derived — also feeds Indicator 1)
- `cooling_cost_annual_eur`: integer (derived — also feeds Indicator 1)
- `confidence`: 'high' if AEMET + orientation data available, 'medium' if ERA5 gap-fill used

**Alert triggers:**
- Green: sunshine_hours_annual > 2,600 AND hdd_annual < 500 — *"Exceptional climate — among the sunniest, mildest locations in Spain"*
- Amber: damp_risk_index > 55 — damp survey recommended
- Amber: days_above_35c_annual > 50 — *"Significant summer heat. Good building insulation and cooling are important here."*
- Red: damp_risk_index > 75 — high damp risk
- Red: flood zone T10 or T100 (carried from 8f)

**Geographic context — Spain's climate range (for normalisation reference):**

| Zone | Example | Sun hrs | HDD | CDD | Rainfall |
|---|---|---|---|---|---|
| Atlantic Northwest | A Coruña | 1,750 | 1,200 | 80 | 1,050mm |
| Cantabrian | Bilbao | 1,850 | 1,400 | 100 | 1,200mm |
| Interior Meseta | Burgos | 2,100 | 2,400 | 250 | 550mm |
| Mediterranean Coast | Barcelona | 2,550 | 900 | 450 | 580mm |
| Madrid Capital | Madrid | 2,800 | 1,700 | 600 | 430mm |
| Andalusian Interior | Sevilla | 2,900 | 600 | 1,400 | 540mm |
| Costa del Sol | Málaga | 2,950 | 250 | 850 | 480mm |
| Southeast Arid | Almería | 3,100 | 150 | 1,100 | 220mm |

---

### Indicator 9 — Infrastructure Arbitrage Score

**What it tells the user:** Whether future approved infrastructure near this property is not yet priced into the asking price — a genuine opportunity to buy before the market catches up.

**Inputs:**
- Approved infrastructure projects within 2km — `infrastructure_projects` WHERE status IN ('approved', 'under_construction')
- Property price vs municipal average — from `zone_metrics_history`
- DOM velocity — how quickly properties are selling in this zone vs national average

**Formula:**
```
project_score = sum(project_weight(p) for p in nearby_projects)
# project_weight: metro_station=40, ave_station=35, park=15, school=20, hospital=25

price_discount = max(0, (zone_median_sqm - prop.price_per_sqm) / zone_median_sqm * 100)
dom_lag        = max(0, zone_median_dom - national_median_dom)  # positive = slow market

arbitrage = min((project_score * 0.50) + (price_discount * 0.30) + (dom_lag * 0.20), 100)
```

**Output:**
- `infrastructure_arbitrage_score`: 0-100
- `nearby_projects`: list of project names + types within 2km
- `confidence`: 'high' if infrastructure data populated, 'low' if using manual seed only

**Alert triggers:**
- Green: score > 65 (strong arbitrage opportunity)

---

### Indicator 10 — Motivated Seller Index

**What it tells the user:** How negotiable this seller is likely to be, based on objective listing behaviour signals.

**Inputs:**
- `days_on_market` vs `zone_metrics_history.median_dom` for `codigo_postal`
- Price reduction count — from `property_price_history` (count of observations where price decreased)
- Relist count — number of times listing appeared after a gap in `property_price_history`
- `seller_type` — particular (private) vs agency vs bank
- Catastro gap direction — is asking price below Catastro value?

**Formula:**
```
dom_ratio      = min((prop.days_on_market / zone_median_dom) * 30, 30)
reduction_pts  = min(price_reduction_count * 12, 30)
relist_pts     = min(relist_count * 8, 20)
seller_pts     = { 'particular': 15, 'bank': 12, 'agency': 0 }
catastro_pts   = 10 if negotiation_gap_pct < 0 else 0  # below catastro = motivated

msi = min(dom_ratio + reduction_pts + relist_pts + seller_pts + catastro_pts, 100)
```

**Output:**
- `motivated_seller_index`: 0-100
- `days_on_market`: integer
- `price_reduction_count`: integer
- `seller_type`: string
- `confidence`: 'high' if 4+ price history observations, 'medium' if 1-3, 'low' if none

**Alert triggers:**
- Green: score > 65 (high negotiation leverage)

---

### Indicator 11 — Rental Trap Index

**What it tells the user:** Whether it is currently cheaper to buy this property (with an ICO mortgage) than to rent an equivalent one in the same postcode — the most powerful call to action for a fence-sitting first-time buyer.

**Inputs:**
- `rental_benchmarks.median_rent_sqm` for `codigo_postal` — from Idealista rental scrape
- `properties.price_asking`
- ICO eligibility (boolean) — affects deposit and monthly mortgage
- Current ECB + spread mortgage rate

**Formula:**
```
rental_equiv    = rental_benchmark_sqm * prop.area_sqm
mortgage_monthly = calc_mortgage(
    principal = price_asking * (0.05 if ico_eligible else 0.20),
    deposit   = price_asking * (0.95 if ico_eligible else 0.80),
    rate      = ecb_rate + bank_spread,
    years     = 30
)
monthly_delta   = rental_equiv - mortgage_monthly  # positive = buying cheaper
```

**Output:**
- `rental_trap_index`: 0-100 (normalised from monthly_delta)
- `rental_trap_monthly_delta_eur`: integer (positive = buying saves money vs renting)
- `rental_benchmark_monthly_eur`: integer (equivalent rental cost)
- `confidence`: 'high' if rental benchmark data available for postcode, 'medium' if municipio-level only

**Display logic:** If `rental_trap_monthly_delta_eur` > 0, show: "Buying here saves you approximately €X/month vs renting an equivalent property." If negative, show: "Renting is currently €X/month cheaper than buying here."

---

### Indicator 12 — Expat Liveability Score

**What it tells the user:** How well a location supports the practical life of an international buyer or long-term expat.

**Inputs:**
- International amenity density within 2km — `amenities` categories: international schools, expat bars, English-speaking services (OSM tags)
- Distance to nearest airport — static airport coordinate table
- AENA flight frequency for nearest airport
- VUT density % — high VUT = active international community (useful signal for nomads)

**Formula:**
```
intl_score    = min(intl_amenity_count * 6, 30)
airport_score = distance_to_score(airport_dist_km, optimal=20, max=90) * 0.25
flight_score  = normalise(weekly_flights, min=0, max=500) * 0.25
community_score = min(vut_density_pct / 2, 20)

expat_score = intl_score + airport_score + flight_score + community_score
```

**Output:**
- `expat_liveability_score`: 0-100
- `nearest_airport_km`: decimal
- `confidence`: 'high'

---

## Tier 3 — Temporal Indicators

> These indicators require accumulated data from `property_price_history` and `zone_metrics_history`.
> Show as "Not yet available" with explanation when data is insufficient.
> Minimum for Indicators 13+14: 4+ price observations. Minimum for 15: 12 months zone history.

---

### Indicator 13 — Price Velocity Signal

**What it tells the user:** Not what the price is — but how fast it's moving, and whether that movement is accelerating or decelerating.

**Inputs:**
- `property_price_history` for `source_url` — full price observation history
- `zone_metrics_history.median_price_sqm` trend for `codigo_postal`
- `zone_metrics_history.median_dom` trend

**Formula:**
```
pv_3m  = (latest_price - price_3m_ago) / price_3m_ago * 100
pv_12m = (latest_price - price_12m_ago) / price_12m_ago * 100
dom_v  = (median_dom_now - median_dom_6m_ago) / median_dom_6m_ago * 100  # negative = compressing

price_velocity_score = normalise(pv_12m, min=-20, max=20)  # 0 = flat, 100 = +20%/year
```

**Output:**
- `price_velocity_score`: 0-100
- `price_velocity_pct_3m`: decimal
- `price_velocity_pct_12m`: decimal
- `dom_velocity`: decimal (negative = DOM compressing = rising demand)
- `confidence`: 'high' if 12m history, 'medium' if 6m, 'low' if <6m

---

### Indicator 14 — Gentrification Confirmation

**What it tells the user:** Whether the neighbourhood transition momentum (NTI) is in its early stage — when prices have not yet risen to reflect quality improvement — or its late stage, when the opportunity has passed.

**Inputs:**
- `neighbourhood_transition_index` (Indicator 6)
- `price_velocity_pct_12m` (Indicator 13)
- Number of months of `zone_metrics_history` available

**Formula:**
```
if months_of_data < 4:
    signal = 'insufficient_data'
elif nti > 40 and price_velocity_pct_12m < 5:
    signal = 'early_stage'    # momentum present, price not yet moving
elif nti > 40 and price_velocity_pct_12m >= 8:
    signal = 'late_stage'     # momentum present and price already rising fast
elif nti < -20:
    signal = 'none'           # declining neighbourhood
else:
    signal = 'none'           # stable, no strong signal
```

**Output:**
- `gentrification_confirmation`: 'early_stage' | 'late_stage' | 'none' | 'insufficient_data'
- `confidence`: derived from months of data available

**Alert triggers:**
- Green: 'early_stage' (strongest buy signal in the platform)
- Amber: 'late_stage' (may have missed the best entry point)

---

### Indicator 15 — Seasonal Distortion Filter

**What it tells the user:** Whether the current asking price is inflated or deflated by seasonal market patterns — particularly relevant in coastal Spanish markets where August prices can be 10-20% above February prices for the same property.

**Inputs:**
- `zone_metrics_history.median_price_sqm` by month for `codigo_postal` (requires 12+ months)
- `properties.price_per_sqm`
- Current calendar month

**Formula:**
```
seasonal_baseline = zone_hist[current_month]['median_price_sqm']  # 12-month rolling average for this month
seasonal_distortion = (prop.price_per_sqm - seasonal_baseline) / seasonal_baseline * 100
# Positive = above seasonal norm (may be inflated)
# Negative = below seasonal norm (potential seasonal opportunity)
```

**Output:**
- `seasonal_distortion_pct`: decimal (positive = above norm, negative = below norm)
- `seasonal_baseline_sqm`: decimal (the expected price for this month)
- `confidence`: 'high' if 12m+ zone history, 'insufficient_data' if <12m

**Display logic:** Show as "+X% above seasonal norm for [month]" or "X% below seasonal norm — could represent seasonal buying opportunity."

---

## Calculating Indicators in Code

All indicator logic lives in `lib/indicators/`. One file per indicator:

```
lib/indicators/
├── index.ts                    — runAllIndicators(propData, mode) → AllIndicators
├── tier1/
│   ├── trueAffordability.ts
│   ├── structuralLiability.ts
│   ├── digitalViability.ts
│   ├── healthSecurity.ts
│   └── educationOpportunity.ts
├── tier2/
│   ├── neighbourhoodTransition.ts
│   ├── communityStability.ts
│   ├── climateResilience.ts
│   ├── infrastructureArbitrage.ts
│   ├── motivatedSeller.ts
│   ├── rentalTrap.ts
│   └── expatLiveability.ts
└── tier3/
    ├── priceVelocity.ts
    ├── gentrificationConfirmation.ts
    └── seasonalDistortion.ts
```

Each indicator function signature:
```typescript
async function calcIndicatorName(
  prop: PropertyData,
  zoneHistory?: ZoneMetricsRow[],
  priceHistory?: PriceHistoryRow[]
): Promise<IndicatorResult>

type IndicatorResult = {
  score: number | null         // 0-100 or null if insufficient data
  confidence: 'high' | 'medium' | 'low' | 'insufficient_data'
  // indicator-specific fields
  [key: string]: any
}
```
