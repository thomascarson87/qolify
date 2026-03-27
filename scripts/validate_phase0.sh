#!/usr/bin/env bash
# =============================================================================
# CHI-327 — Phase 0 Validation Gate
# Run 3 Málaga properties through the full analysis pipeline.
#
# Prerequisites (run these ingest scripts first):
#
#   cd scripts/ingest
#
#   # Flood zones — fully automatic, pulls from SNCZI WFS
#   python ingest_flood_zones.py
#
#   # Health centres — OSM, Málaga only, fully automatic
#   python ingest_health_centres.py --provincia malaga
#
#   # Schools — OSM, Málaga only, fully automatic
#   python ingest_schools.py --provincia malaga
#
#   # Fibre coverage — Phase 0 seed (no download needed):
#   # SETELECO portal (avance.digital.gob.es) doesn't provide polygon shapefiles.
#   # This seeds a Málaga FTTP bounding box — accurate for the urban test area.
#   python seed_fibre_cities.py --city malaga
#
#   # Amenities (optional — enhances scores but not required for checklist)
#   python ingest_amenities.py --provincia malaga
#
# Usage:
#   bash scripts/validate_phase0.sh                     # hits localhost:3000
#   bash scripts/validate_phase0.sh https://your.domain # hits a deployed URL
#
# Then check each response against the checklist below.
# =============================================================================

BASE_URL="${1:-http://localhost:3000}"
PASS=0
FAIL=0

# Colours
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}  ✓ $1${NC}"; ((PASS++)); }
fail() { echo -e "${RED}  ✗ $1${NC}"; ((FAIL++)); }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }
header() { echo -e "\n${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; echo "  $1"; echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }

# =============================================================================
# Helper: run a test case and print the key outputs
# =============================================================================
run_test() {
  local label="$1"
  local payload="$2"

  header "TEST: $label"

  RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
    -X POST "$BASE_URL/api/analyse" \
    -H "Content-Type: application/json" \
    -d "$payload")

  HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS:" | cut -d: -f2)
  BODY=$(echo "$RESPONSE" | grep -v "HTTP_STATUS:")

  echo "  HTTP: $HTTP_STATUS"

  # --- Check 1: 200 status ---
  if [ "$HTTP_STATUS" = "200" ]; then
    pass "POST /api/analyse returns 200"
  else
    fail "POST /api/analyse returned $HTTP_STATUS (expected 200)"
    echo "  Response: $BODY"
    return
  fi

  # Extract fields with jq
  TVI=$(echo "$BODY" | jq '.tvi_score')
  CACHED=$(echo "$BODY" | jq '.cached')
  CACHE_ID=$(echo "$BODY" | jq -r '.id')

  echo "  tvi_score: $TVI"
  echo "  cache id:  $CACHE_ID"
  echo "  cached:    $CACHED"

  # --- Check 2: cache record written ---
  if [ "$CACHE_ID" != "null" ] && [ -n "$CACHE_ID" ]; then
    pass "analysis_cache record created (id=$CACHE_ID)"
  else
    fail "No cache record ID returned"
  fi

  # --- Check 3: Tier 1 scores ---
  echo ""
  echo "  Tier 1 scores:"
  local tier1_nulls=0
  for key in true_affordability structural_liability digital_viability health_security education_opportunity; do
    SCORE=$(echo "$BODY" | jq ".composite_indicators.${key}.score")
    CONF=$(echo "$BODY" | jq -r ".composite_indicators.${key}.confidence")
    echo "    $key: score=$SCORE confidence=$CONF"
    if [ "$SCORE" = "null" ]; then
      ((tier1_nulls++))
    fi
  done

  if [ "$tier1_nulls" = "0" ]; then
    pass "All 5 Tier 1 scores non-null"
  else
    fail "$tier1_nulls Tier 1 score(s) are null (run ingest scripts first)"
  fi

  # --- Check 4: ITP rate ---
  ITP_RATE=$(echo "$BODY" | jq '.composite_indicators.true_affordability.details.itp_rate_pct')
  ITP_COST=$(echo "$BODY" | jq '.composite_indicators.true_affordability.details.itp_total_eur')
  echo ""
  echo "  ITP: rate=${ITP_RATE}% total=€${ITP_COST}"
  if [ "$ITP_RATE" = "7" ] || [ "$ITP_RATE" = "3.5" ] || [ "$ITP_RATE" = "7.0" ] || [ "$ITP_RATE" = "3.5" ]; then
    pass "ITP rate is correct for Andalucía (7% standard / 3.5% reduced)"
  else
    fail "ITP rate unexpected: $ITP_RATE (expected 7 or 3.5 for Andalucía)"
  fi

  # --- Check 5: ICO eligibility ---
  ICO=$(echo "$BODY" | jq '.composite_indicators.true_affordability.details.ico_eligible')
  echo "  ICO eligible: $ICO"
  if [ "$ICO" = "true" ] || [ "$ICO" = "false" ]; then
    pass "ICO eligibility computed (value=$ICO)"
  else
    fail "ICO eligibility is null/undefined"
  fi

  # --- Check 6: Flood zone ---
  FLOOD=$(echo "$BODY" | jq -r '.composite_indicators.structural_liability.details.flood_risk_zone')
  echo ""
  echo "  Flood zone: $FLOOD"
  if [ "$FLOOD" != "null" ] && [ -n "$FLOOD" ]; then
    pass "Flood zone lookup returned a result ($FLOOD)"
  else
    warn "Flood zone is null — run ingest_flood_zones.py first, or property is not in a flood zone (may be correct)"
  fi

  # --- Check 7: Airport proximity (AGP) ---
  AIRPORT=$(echo "$BODY" | jq -r '.composite_indicators.expat_liveability.details.nearest_airport_iata')
  AIRPORT_KM=$(echo "$BODY" | jq '.composite_indicators.expat_liveability.details.nearest_airport_km')
  echo "  Nearest airport: $AIRPORT at ${AIRPORT_KM}km"
  if [ "$AIRPORT" = "AGP" ]; then
    pass "Nearest airport is AGP (Málaga)"
    if (( $(echo "$AIRPORT_KM < 30" | bc -l) )); then
      pass "AGP distance is plausible (${AIRPORT_KM}km < 30km)"
    else
      fail "AGP distance looks wrong: ${AIRPORT_KM}km (expected < 30km for Málaga city)"
    fi
  else
    fail "Nearest airport is $AIRPORT (expected AGP for Málaga properties)"
  fi

  # --- Check 8: Nearest school ---
  SCHOOL_COUNT=$(echo "$BODY" | jq '.composite_indicators.education_opportunity.details.school_count_1km')
  echo "  Schools within 1km: $SCHOOL_COUNT"
  if [ "$SCHOOL_COUNT" != "null" ] && [ "$SCHOOL_COUNT" != "0" ]; then
    pass "Schools found within 1km ($SCHOOL_COUNT)"
  else
    warn "No schools found within 1km — run ingest_schools.py first (or property is in a low-density area)"
  fi

  # --- Check 9: tvi_score computed ---
  if [ "$TVI" != "null" ]; then
    pass "TVI score computed ($TVI)"
  else
    fail "TVI score is null (requires at least some Tier 1 scores)"
  fi

  echo ""
  echo "  Full composite_indicators:"
  echo "$BODY" | jq '.composite_indicators | keys'
}

# =============================================================================
# Test properties (3 Málaga locations — different zones and price ranges)
# =============================================================================

# Property 1: Centro histórico / Soho — old building, high price
run_test "PROPERTY 1 — Centro Málaga (old building, EPC F)" '{
  "url": "https://www.idealista.com/inmueble/TEST001/",
  "property": {
    "lat": 36.7213,
    "lng": -4.4217,
    "price_asking": 320000,
    "area_sqm": 85,
    "comunidad_autonoma": "Andalucía",
    "municipio": "Málaga",
    "build_year": 1958,
    "epc_rating": "F",
    "bedrooms": 3,
    "floor": 3
  }
}'

# Property 2: Málaga Este — near airport, mid-range, newer build
run_test "PROPERTY 2 — Málaga Este (near AGP, newer, EPC D)" '{
  "url": "https://www.idealista.com/inmueble/TEST002/",
  "property": {
    "lat": 36.6924,
    "lng": -4.4063,
    "price_asking": 195000,
    "area_sqm": 68,
    "comunidad_autonoma": "Andalucía",
    "municipio": "Málaga",
    "build_year": 1987,
    "epc_rating": "D",
    "bedrooms": 2,
    "floor": 1
  }
}'

# Property 3: Teatinos — university district, modern, good EPC
run_test "PROPERTY 3 — Teatinos / Universidad (modern, EPC C)" '{
  "url": "https://www.idealista.com/inmueble/TEST003/",
  "property": {
    "lat": 36.7269,
    "lng": -4.4779,
    "price_asking": 245000,
    "area_sqm": 78,
    "comunidad_autonoma": "Andalucía",
    "municipio": "Málaga",
    "build_year": 2006,
    "epc_rating": "C",
    "bedrooms": 3,
    "floor": 4
  }
}'

# =============================================================================
# RLS check — verify analysis_cache is readable via Supabase anon key
# (Replace SUPABASE_URL and SUPABASE_ANON_KEY with your values from .env.local)
# =============================================================================

header "RLS CHECK — analysis_cache readable via anon key"

SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-}"

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ]; then
  warn "Set SUPABASE_URL and SUPABASE_ANON_KEY env vars to run the RLS check."
  warn "  export SUPABASE_URL=https://your-project.supabase.co"
  warn "  export SUPABASE_ANON_KEY=your-anon-key"
  warn "  (Both values are in .env.local)"
else
  RLS_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
    "$SUPABASE_URL/rest/v1/analysis_cache?select=id,tvi_score&limit=1" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY")

  if [ "$RLS_RESPONSE" = "200" ]; then
    pass "analysis_cache readable via anon key (RLS public_read policy active)"
  else
    fail "analysis_cache returned HTTP $RLS_RESPONSE with anon key (expected 200 — check RLS policy)"
  fi
fi

# =============================================================================
# Summary
# =============================================================================

header "SUMMARY"
echo -e "  ${GREEN}Passed: $PASS${NC}"
echo -e "  ${RED}Failed: $FAIL${NC}"
echo ""

if [ "$FAIL" = "0" ]; then
  echo -e "  ${GREEN}All checks passed. CHI-327 validation gate: READY FOR SIGN-OFF.${NC}"
else
  echo -e "  ${RED}$FAIL check(s) failed. Resolve issues above before M1 sign-off.${NC}"
  echo ""
  echo "  Common fixes:"
  echo "    Null Tier 1 scores    → cd scripts/ingest && python ingest_health_centres.py"
  echo "                          → python ingest_schools.py"
  echo "                          → python ingest_fibre.py"
  echo "    Null flood_risk_zone  → python ingest_flood_zones.py"
  echo "    Wrong ITP rate        → check itp_rates table (should have Andalucía row)"
  echo "    Wrong airport         → check airports table (should have AGP row)"
fi
echo ""
