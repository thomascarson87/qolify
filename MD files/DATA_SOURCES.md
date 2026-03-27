# Raiz — Data Sources
**Version 2.0 | Updated: March 2026**

Every data source used in Raiz. This is the reference for all ingestion scripts and scheduled jobs. See `ANNEX_WEATHER_SOLAR.md` for the full technical specification of climate and solar data ingestion.

---

## QoL Reference Data (Shared — all tiers)

These tables are loaded once and refreshed on schedule. They are the shared intelligence foundation for both Model A and Model B.

| Pillar | Dataset | Source | URL | Collection Method | Refresh Cadence | Target Table |
|---|---|---|---|---|---|---|
| Environmental | Flood zone maps | SNCZI — MITECO | https://snczi.miteco.gob.es/ | WMS/WFS GIS download → PostGIS (ogr2ogr) | Monthly | `flood_zones` |
| Environmental | Air Quality Index | MITECO Red de Calidad del Aire | https://www.miteco.gob.es/es/calidad-y-evaluacion-ambiental/temas/atmosfera-y-calidad-del-aire/ | REST API (hourly station data) | Daily | `air_quality_readings` |
| Environmental | Noise pollution maps | EEA Strategic Noise Maps | https://www.eea.europa.eu/data-and-maps/data/noise-observations-mapping-6 | Shapefile → PostGIS import | Annual | `noise_zones` |
| Environmental | Fire risk maps | MITECO / EGIF | https://www.miteco.gob.es/es/biodiversidad/estadisticas/Incendios.aspx | GIS data download | Annual | `fire_risk_zones` |
| Environmental | Green space (parks, forests) | OpenStreetMap Overpass API | https://overpass-api.de | Overpass QL (leisure=park, natural=wood) | Weekly | `amenities` |
| Environmental | Satellite greenery (NDVI) | Sentinel-2 via ESA Copernicus | https://dataspace.copernicus.eu | Copernicus API — band B8/B4 ratio | Quarterly | `ndvi_tiles` (backlog) |
| **Climate** | **Annual climate normals — sunshine, temperature, rainfall, humidity, HDD, CDD** | **AEMET Open Data** | **https://opendata.aemet.es** | **REST API → `climate_data` table by municipio** | **Annual** | **`climate_data`** |
| **Climate** | **Solar irradiance (GHI) by coordinate — monthly breakdown** | **PVGIS — JRC European Commission** | **https://re.jrc.ec.europa.eu/pvg_tools/en/tools.html** | **REST API per property coordinate — cached at 0.01° resolution** | **Per-analysis (cached)** | **`solar_radiation`** |
| **Climate** | **ERA5 climate reanalysis — gap-fill for thin AEMET coverage** | **Copernicus CDS (C3S)** | **https://cds.climate.copernicus.eu** | **CDS API — 0.25° grid; temperature, precipitation, humidity, solar** | **Annual update** | **`climate_data` (era5_gap_fill=true)** |
| **Climate** | **Building facade orientation (solar aspect)** | **Sede Electrónica del Catastro** | **https://ovc.catastro.hacienda.gob.es** | **Catastro OVC API — building footprint geometry → aspect derivation** | **Per-analysis** | **`building_orientation`** |
| **Climate** | **SIAR agroclimatic stations — high-resolution inland data** | **MAPA (Ministerio de Agricultura)** | **https://eportal.mapa.gob.es/websiar/** | **REST API — supplement AEMET for inland municipios** | **Annual** | **`climate_data` (supplement)** |
| Connectivity | Public transport GTFS | MITMA Open Data | https://www.transportes.gob.es/recursos_mfom/listado.recursos/publicaciones/opendata/gtfs/ | GTFS feed download → parse stops/routes | Monthly | `transport_stops` |
| Connectivity | Fibre / broadband coverage | CNMC / Secretaría de Telecomunicaciones | https://geoportal.mincotur.gob.es/MappingTelecos/ | GIS shapefile → PostGIS import | Quarterly | `fibre_coverage` |
| Connectivity | Airport locations + routes | AENA | https://www.aena.es/es/estadisticas.html | Static coordinate table + stats scrape | Quarterly | `airports` |
| Connectivity | AVE / Cercanías stations | ADIF / Renfe | https://www.adif.es | Scrape ADIF map + official announcements | Monthly | `transport_stops` (tipo='ave') |
| Education | School directory | Ministerio de Educación — BuscaColegio | https://www.educacion.gob.es/centros/buscarCentros.do | Scrape BuscaColegio by province | Quarterly | `schools` |
| Education | School catchment zones | Regional education ministries | e.g. https://www.madrid.org/wpad_pub/run/j/MostrarConsultaGeneral.icm | GIS boundary files — Madrid + Andalucía first | Quarterly | `school_catchments` |
| Health | Health centres + hospitals | Sanidad RESC | https://www.mscbs.gob.es/ciudadanos/prestaciones/centrosServiciosSNS/hospitales/ | REST API / scrape | Quarterly | `health_centres` |
| Health | Pharmacies | OpenStreetMap Overpass API | https://overpass-api.de (amenity=pharmacy) | Overpass QL | Weekly | `amenities` |
| Community | Third places (cafes, gyms etc) | OpenStreetMap Overpass API | https://overpass-api.de | Overpass QL (amenity=cafe, leisure=fitness_centre etc) | Weekly | `amenities` |
| Community | VUT tourist licences | Regional Tourism Registries | Andalucía: https://www.juntadeandalucia.es/turismo/registration | Scrape regional portals | Monthly | `vut_licences` |
| Community | Beach quality | ADEAC Blue Flag | https://www.adeac.es/playas-certificadas | Annual scrape | Annual | `beaches` |
| Community | Protected natural areas | MITECO Red Natura 2000 | https://www.miteco.gob.es/es/biodiversidad/temas/espacios-protegidos/red-natura-2000/ | GIS download | Annual | `protected_areas` |
| Safety | Crime statistics | Ministerio del Interior | https://estadisticasdecriminalidad.ses.mir.es/ | Monthly bulk CSV download | Monthly | `crime_stats` |
| Legal | Property tax value (Catastro) | Sede Electrónica del Catastro | https://www.sedecatastro.gob.es / https://ovc.catastro.hacienda.gob.es | REST API — OVC service (per-property lookup) | Per-analysis | `properties` / `analysis_cache` |
| Legal | ITE building inspection status | Municipal ayuntamiento portals | Madrid: https://sede.madrid.es — Barcelona: https://w30.bcn.cat | Scrape by address / ref_catastral | Weekly | `ite_status` |
| Legal | VPO status + expiry dates | Consejería de Vivienda (Regional) | e.g. https://www.juntadeandalucia.es/fomento/vivienda/ | Regional registry scraping | Monthly | `vpo_status` (Phase 4+) |
| Future Value | Urbanism / PGOU planning data | Municipal Visor Urbanístico portals | Madrid: https://planeamiento.madrid.es — Barcelona: https://w133.bcn.cat | GIS API + scrape of planning approvals | Weekly | `infrastructure_projects` |
| Future Value | Official gazette (BOE + regional) | BOE + Boletines Autonómicos | https://www.boe.es — https://www.juntadeandalucia.es/boja | NLP pipeline on PDFs (Phase 5) | Daily | `infrastructure_projects` |
| Future Value | Inheritance transfer rate | INE — Estadística de Transmisiones | https://www.ine.es/dyngs/INEbase/es/operacion.htm?c=Estadistica_C&cid=1254736171438 | Quarterly CSV download | Quarterly | `inheritance_stats` |
| Financial | Regional ITP tax rates | Agencia Tributaria + Regional Haciendas | https://www.agenciatributaria.es | Static table — scrape for updates | Quarterly | `itp_rates` |
| Financial | ICO Aval price caps | Ministerio de Vivienda (MIVAU) | https://www.mivau.gob.es/vivienda/ayudas-financiacion/ico-avales | Static scrape | Quarterly | `ico_caps` |
| Financial | INE median income by municipio | INE | https://www.ine.es | CSV download | Annual | `municipio_income` |

---

## Listing Data (Model B — On-Demand)

Single-listing extraction triggered by user URL submission.

| Source | URL Pattern | Parse.bot Schema ID | Fields Extracted |
|---|---|---|---|
| Idealista | `idealista.com/inmueble/\d+/` | `idealista_v1` | price, area_sqm, bedrooms, bathrooms, floor, address, postcode, coordinates, ref_catastral, epc_rating, seller_type, description |
| Fotocasa | `fotocasa.es/detalle/\d+` | `fotocasa_v1` | price, area_sqm, bedrooms, bathrooms, floor, address, postcode, coordinates, ref_catastral, epc_rating, seller_type |
| Pisos.com | `pisos.com/piso-[\w-]+-\d+` | `pisoscom_v1` | price, area_sqm, bedrooms, bathrooms, address, postcode |
| Habitaclia | `habitaclia.com/piso-[\w-]+-\d+` | `habitaclia_v1` | price, area_sqm, bedrooms, bathrooms, address, postcode |
| Sareb | `sareb.es/inmueble/\d+` | `sareb_v1` | price, area_sqm, bedrooms, bathrooms, address, postcode, ref_catastral |

---

## Listing Data (Model A — Bulk Scraping, Phase 4+)

Discovery via Cloudflare /crawl. Extraction via Parse.bot in batch mode. Same schemas as Model B.

| Portal | Discovery URL | Refresh | Notes |
|---|---|---|---|
| Idealista | `https://www.idealista.com/venta-viviendas/` | Every 6h | National search; use `modifiedSince` to get only changed listings |
| Fotocasa | `https://www.fotocasa.es/es/comprar/viviendas/espana/todas-las-zonas/l` | Every 6h | |
| Pisos.com | `https://www.pisos.com/pisos/venta/` | Every 6h | |
| Habitaclia | `https://www.habitaclia.com/compra/` | Every 6h | |
| Sareb | `https://www.sareb.es/es/particulares/inmuebles` | Daily | Lower frequency; bank inventory changes slowly |
| Haya Real Estate | `https://www.haya.es/inmuebles` | Daily | Bank servicer — requires headless browser |
| Solvia | `https://www.solvia.es/` | Daily | Bank servicer |
| Diglo | `https://www.diglo.com/inmuebles` | Daily | Bank servicer |
| Altamira | `https://www.altamirainmuebles.com/` | Daily | Bank servicer |

---

## Rental Data (for Rental Trap Index — Indicator 11)

| Source | URL | Method | Target |
|---|---|---|---|
| Idealista Rental | `https://www.idealista.com/alquiler-viviendas/` | Parse.bot batch scrape | `rental_benchmarks` (median rent per sqm by codigo_postal) |

---

## Reference Tables (Static / Slow-Changing)

Populated manually or via infrequent scrapes. All Indicator 1 and Indicator 8 calculations reference `eco_constants`.

| Table | Data | Update Frequency | Source |
|---|---|---|---|
| `itp_rates` | ITP transfer tax rate by Comunidad Autónoma | Quarterly | Regional Haciendas |
| `ico_caps` | ICO Aval price caps by region + income thresholds | Quarterly | MIVAU |
| `municipio_income` | Median annual income by municipio | Annual | INE |
| `airports` | Airport coordinates + IATA codes + weekly flight frequency | Annual | AENA |
| `eco_constants` | ECB base rate, bank spread, gas tariff (€/kWh), electricity PVPC tariff (€/kWh), EPC U-value coefficients, solar gain factors by orientation | Monthly (manual) | ECB + CNMC + bank survey |

---

## VUT Registry Coverage by Region

| Region | Registry URL | Coverage Status |
|---|---|---|
| Andalucía | https://www.juntadeandalucia.es/turismo/registration | Active — Phase 0 |
| Madrid | https://www.madrid.org/cs/Satellite?c=CM_Tramite_FA&cid=1354273219695 | Active — Phase 0 |
| Catalunya | https://act.gencat.cat/turisme | Active — Phase 0 |
| Valencia | https://turisme.gva.es | Active — Phase 0 |
| Baleares | https://www.caib.es | Phase 2 |
| Canarias | https://www.gobiernodecanarias.org | Phase 2 |
| País Vasco | https://www.bizkaia.eus | Phase 3 |
| Others | Various | Backlog |

---

## AEMET Station Coverage Map

AEMET operates ~1,000 synoptic and climatological stations across Spain. Coverage is dense in populated areas and thin in interior rural zones. Where no station is within 25km of a municipio centroid, ERA5 reanalysis data is used as a gap-fill (flagged in `climate_data.era5_gap_fill = true`).

SIAR agroclimatic stations (MAPA) provide supplementary coverage for agricultural zones, particularly useful for interior Castilla, Extremadura, and Aragón where AEMET coverage is thinner.

See `ANNEX_WEATHER_SOLAR.md` for full station list, gap-fill methodology, and API implementation details.

---

## Data Quality Notes

- **Catastro ref_catastral coverage:** ~65% of listings show it directly. For the rest, coordinate-based reverse lookup is used.
- **Building orientation coverage:** Catastro explicit orientation data available for ~40% of properties nationally. The remainder are derived from building footprint geometry (medium confidence). Properties with no Catastro footprint show "Unknown" orientation.
- **AEMET climate normals granularity:** Published at municipio level. Large municipios (e.g. Madrid capital, Zaragoza) may have significant intra-municipal climate variation (urban heat island, altitude differences) not captured in the municipio average.
- **PVGIS solar radiation precision:** Accurate to ±5% for annual GHI. Monthly figures are reliable. Shading from adjacent buildings is not captured — the figure represents open-sky irradiance at the coordinate.
- **HDD/CDD calculation:** Based on AEMET 30-year normals (1991–2020). Actual recent years run warmer than the normal — the CDD figures in particular will understate current cooling demand. Trend data (ERA5) is shown alongside to contextualise this.
- **ITE data coverage:** Only Madrid and Barcelona at launch. Always show "Not available in this municipality" rather than a blank.
- **School performance data:** Available in some regions. Use proximity + type as primary signal; performance data as bonus where available.
- **OSM completeness:** Excellent in cities, patchy in rural areas. Flag low-coverage areas.
- **VUT data lag:** Regional registries typically 1–3 months behind actual grants.
- **Crime stats granularity:** MIR data at municipio level only. In large cities this limits granularity. Flag in UI.
