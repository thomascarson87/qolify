-- ============================================================
-- 003_seed_reference_data.sql
-- Qolify — Static reference data seed
-- ITP rates, ICO caps, eco_constants, Spanish airports
-- Update manually when rates change (quarterly / annually)
-- Last updated: March 2026
-- ============================================================

-- ============================================================
-- ITP RATES (Impuesto de Transmisiones Patrimoniales)
-- Transfer tax rates by Comunidad Autónoma — March 2026
-- ============================================================
INSERT INTO itp_rates (comunidad_autonoma, standard_rate_pct, reduced_rate_pct, reduced_conditions) VALUES
  ('Andalucía',             7.0,  3.5, 'Primary residence, price ≤ €150,000 OR buyer ≤ 35 years'),
  ('Aragón',                8.0,  5.0, 'Primary residence, price ≤ €100,000'),
  ('Asturias',             10.0,  8.0, 'Primary residence, price ≤ €135,000'),
  ('Baleares',              8.0,  4.0, 'Primary residence, price ≤ €270,151'),
  ('Canarias',              6.5,  4.0, 'Primary residence'),
  ('Cantabria',             9.0,  5.0, 'Primary residence, price ≤ €120,000'),
  ('Castilla-La Mancha',    9.0,  6.0, 'Primary residence'),
  ('Castilla y León',       8.0,  4.0, 'Primary residence, price ≤ €135,000'),
  ('Cataluña',             10.0,  5.0, 'Primary residence, buyer ≤ 33 years OR large family'),
  ('Extremadura',           8.0,  7.0, 'Primary residence'),
  ('Galicia',              10.0,  6.0, 'Primary residence, price ≤ €150,000'),
  ('La Rioja',              7.0,  5.0, 'Primary residence, price ≤ €150,000'),
  ('Madrid',                6.0,  4.0, 'Primary residence, price ≤ €250,000, buyer ≤ 35 years'),
  ('Murcia',                8.0,  3.0, 'Primary residence, price ≤ €150,000'),
  ('Navarra',               6.0,  5.0, 'Primary residence'),
  ('País Vasco',            7.0,  2.5, 'Young buyer ≤ 35 years, primary residence'),
  ('Valencia',             10.0,  8.0, 'Primary residence');

-- ============================================================
-- ICO GUARANTEE CAPS (2024/2025 programme)
-- Young buyer guarantee (up to 20% ICO state-backed guarantee)
-- Max age 35; some CAs have extended to 50 for families
-- ============================================================
INSERT INTO ico_caps (comunidad_autonoma, max_price_eur, max_age, max_income_eur, guarantee_pct, valid_from) VALUES
  ('Andalucía',          300000, 35, 37800, 20.00, '2024-01-01'),
  ('Aragón',             300000, 35, 37800, 20.00, '2024-01-01'),
  ('Asturias',           300000, 35, 37800, 20.00, '2024-01-01'),
  ('Baleares',           300000, 35, 37800, 20.00, '2024-01-01'),
  ('Canarias',           300000, 35, 37800, 20.00, '2024-01-01'),
  ('Cantabria',          300000, 35, 37800, 20.00, '2024-01-01'),
  ('Castilla-La Mancha', 300000, 35, 37800, 20.00, '2024-01-01'),
  ('Castilla y León',    300000, 35, 37800, 20.00, '2024-01-01'),
  ('Cataluña',           300000, 35, 37800, 20.00, '2024-01-01'),
  ('Extremadura',        300000, 35, 37800, 20.00, '2024-01-01'),
  ('Galicia',            300000, 35, 37800, 20.00, '2024-01-01'),
  ('La Rioja',           300000, 35, 37800, 20.00, '2024-01-01'),
  ('Madrid',             300000, 35, 37800, 20.00, '2024-01-01'),
  ('Murcia',             300000, 35, 37800, 20.00, '2024-01-01'),
  ('Navarra',            300000, 35, 37800, 20.00, '2024-01-01'),
  ('País Vasco',         300000, 35, 37800, 20.00, '2024-01-01'),
  ('Valencia',           300000, 35, 37800, 20.00, '2024-01-01');

-- ============================================================
-- ECO_CONSTANTS — Energy tariffs, EPC U-values, solar gain factors
-- Used by Indicator 1 (True Affordability) and Indicator 8 (Climate & Solar)
-- Update when ECB rates, energy tariffs, or building regs change
-- ============================================================
INSERT INTO eco_constants (
  ecb_base_rate_pct,
  typical_bank_spread_pct,
  euribor_12m_pct,
  gas_price_kwh_eur,
  electricity_pvpc_kwh_eur,
  u_value_epc_a,
  u_value_epc_b,
  u_value_epc_c,
  u_value_epc_d,
  u_value_epc_e,
  u_value_epc_f,
  u_value_epc_g,
  solar_gain_s,
  solar_gain_se_sw,
  solar_gain_e_w,
  solar_gain_ne_nw,
  solar_gain_n,
  valid_from,
  notes
) VALUES (
  3.400,   -- ECB base rate March 2026
  1.200,   -- typical Spanish bank spread
  3.180,   -- Euribor 12m March 2026
  0.07200, -- gas €/kWh (regulated tariff TUR)
  0.18500, -- electricity PVPC avg €/kWh
  0.300,   -- EPC A U-value W/m²K
  0.500,   -- EPC B
  0.700,   -- EPC C
  1.000,   -- EPC D
  1.400,   -- EPC E
  1.800,   -- EPC F
  2.300,   -- EPC G
  0.150,   -- solar gain fraction, south-facing
  0.100,   -- SE/SW
  0.050,   -- E/W
  0.020,   -- NE/NW
  0.000,   -- north-facing
  '2026-03-01',
  'March 2026 baseline. ECB rate from March 2026 meeting. Euribor 12m market rate. Gas/PVPC from CNMC published tariffs.'
);

-- ============================================================
-- AIRPORTS (Spain commercial airports — AENA network)
-- For Expat Liveability Score (Indicator 12)
-- ============================================================
INSERT INTO airports (nombre, iata_code, lat, lng, weekly_flights) VALUES
  ('Madrid-Barajas Adolfo Suárez', 'MAD', 40.4719, -3.5626, 5800),
  ('Barcelona-El Prat',            'BCN', 41.2971,  2.0785, 4200),
  ('Málaga-Costa del Sol',         'AGP', 36.6749, -4.4991, 1800),
  ('Palma de Mallorca',            'PMI', 39.5517,  2.7388, 2100),
  ('Alicante-Elche',               'ALC', 38.2822, -0.5582, 1200),
  ('Gran Canaria',                 'LPA', 27.9319, -15.3866, 900),
  ('Tenerife Sur',                 'TFS', 28.0445, -16.5725, 950),
  ('Valencia',                     'VLC', 39.4893, -0.4816,  700),
  ('Sevilla',                      'SVQ', 37.4180, -5.8931,  600),
  ('Bilbao',                       'BIO', 43.3011, -2.9106,  450),
  ('Ibiza',                        'IBZ', 38.8728,  1.3731,  480),
  ('Fuerteventura',                'FUE', 28.4527, -13.8638, 420),
  ('Lanzarote',                    'ACE', 28.9455, -13.6052, 400),
  ('Santiago de Compostela',       'SCQ', 42.8963, -8.4151,  300),
  ('Asturias',                     'OVD', 43.5636, -6.0346,  200),
  ('Zaragoza',                     'ZAZ', 41.6662, -1.0415,  150),
  ('Almería',                      'LEI', 36.8439, -2.3701,  120),
  ('Jerez de la Frontera',         'XRY', 36.7446, -6.0601,  100),
  ('Murcia-Corvera',               'RMU', 37.8030, -1.1253,  130),
  ('Menorca',                      'MAH', 39.8626,  4.2186,  200),
  ('Tenerife Norte',               'TFN', 28.4827, -16.3415, 320),
  ('Reus',                         'REU', 41.1474,  1.1672,  80),
  ('Vigo',                         'VGO', 42.2318, -8.6277,  120),
  ('Valladolid',                   'VLL', 41.7061, -4.8519,  60),
  ('San Sebastián',                'EAS', 43.3565, -1.7906,  50);

-- Update geom column from lat/lng for all airports
UPDATE airports SET geom = ST_SetSRID(ST_MakePoint(lng, lat), 4326)::GEOGRAPHY;
