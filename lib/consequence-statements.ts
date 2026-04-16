/**
 * lib/consequence-statements.ts — CHI-352
 *
 * Maps database field values to plain-English ConsequenceStatement objects.
 *
 * This is the core of the visualisation grammar (DATA_VIS_GRAMMAR.md D-033):
 * score rings are never the sole output for binary/categorical data. Every
 * such field must produce a consequence statement — a fact + its practical
 * implication + an optional recommended action.
 *
 * Tone-of-voice rules (UI_UX_BRIEF.md §6):
 *   - Plain language, written for an intelligent non-expert
 *   - One finding per sentence — never pack two insights together
 *   - Active voice — "This building failed" not "A failure was recorded"
 *   - Acknowledge uncertainty — "estimated", "typically", "probabilistic"
 *   - No jargon without explanation (e.g. SNCZI always followed by its
 *     plain-English name)
 *
 * Exports:
 *   ConsequenceStatement — the shared output type
 *   iteConsequence()     — ITE inspection status
 *   floodConsequence()   — flood zone pin membership
 *   fibreConsequence()   — broadband coverage type
 *   orientationConsequence() — building aspect / solar orientation
 *   epcConsequence()     — energy performance certificate rating
 *   vutConsequence()     — VUT (tourist rental) count within 200m
 *   ntiConsequence()     — neighbourhood transition indicator signal
 */

// ---------------------------------------------------------------------------
// Shared type
// ---------------------------------------------------------------------------

export interface ConsequenceStatement {
  /** Traffic-light signal used for border and background tint. */
  signal: 'green' | 'amber' | 'red' | 'neutral';
  /** Bold lead sentence — states the fact plainly. */
  title: string;
  /** One sentence — the practical implication for the buyer. */
  body: string;
  /** Specific action the buyer should take (optional). */
  action?: string;
  /** Data source and approximate freshness (optional). */
  source?: string;
}

// ---------------------------------------------------------------------------
// 1. ITE inspection status
// ---------------------------------------------------------------------------

export type IteStatus =
  | 'passed'
  | 'failed'
  | 'pending'
  | 'not_required'
  | 'unavailable';

/**
 * Returns a consequence statement for an ITE (Inspección Técnica de Edificios)
 * inspection result.
 *
 * @param status  The ite_status.status value from the database.
 * @param year    Optional year the inspection was carried out, for context.
 */
export function iteConsequence(
  status: IteStatus,
  year?: number,
): ConsequenceStatement {
  const yearSuffix = year ? ` in ${year}` : '';

  switch (status) {
    case 'passed':
      return {
        signal: 'green',
        title: `This building passed its structural inspection${yearSuffix}.`,
        body: 'A passed ITE means the building met the minimum structural and safety standards at the time of inspection.',
        source: 'Ayuntamiento ITE register.',
      };

    case 'failed':
      return {
        signal: 'red',
        title: `This building failed its last structural inspection${yearSuffix}.`,
        body: 'Buildings with a failed ITE typically face compulsory community levy works within 2–3 years — costs are shared between all owners.',
        action: 'Request the full ITE inspection report from the seller before signing anything.',
        source: 'Ayuntamiento ITE register.',
      };

    case 'pending':
      return {
        signal: 'amber',
        title: 'A structural inspection is currently in progress for this building.',
        body: 'The outcome is unknown until the inspection is finalised — a failed result would trigger compulsory works and a community levy.',
        action: 'Ask the seller for the inspection timeline and whether any provisional findings have been shared.',
        source: 'Ayuntamiento ITE register.',
      };

    case 'not_required':
      return {
        signal: 'neutral',
        title: 'This building is not currently required to have an ITE inspection.',
        body: 'ITE inspections are mandatory from age 30–50 depending on the municipality. Newer buildings fall outside the requirement window.',
      };

    case 'unavailable':
      return {
        signal: 'neutral',
        title: 'No ITE inspection record found for this building.',
        body: 'This may mean the building is too new, the record is not digitised, or the inspection has not yet been carried out.',
        action: 'Ask the seller directly or contact the local Ayuntamiento to confirm the building\'s inspection status.',
      };
  }
}

// ---------------------------------------------------------------------------
// 2. Flood zone pin membership
// ---------------------------------------------------------------------------

export type FloodZoneMembership = 'in_t10' | 'in_t100' | 'in_t500' | 'none';

/**
 * Returns a consequence statement for point-in-polygon flood zone membership.
 * This is a binary result for a specific coordinate — never a zone aggregate.
 *
 * Per D-035: flood zone membership is always binary, always first in pin
 * report, and always rendered as a Consequence Statement (never a score).
 *
 * @param membership  The flood zone classification for this coordinate.
 * @param sourceDate  Optional date of the SNCZI dataset used (e.g. "March 2026").
 */
export function floodConsequence(
  membership: FloodZoneMembership,
  sourceDate?: string,
): ConsequenceStatement {
  const source = `SNCZI (Spain's national flood mapping authority)${sourceDate ? `, updated ${sourceDate}` : ''}.`;

  switch (membership) {
    case 'in_t10':
      return {
        signal: 'red',
        title: 'This address is inside the 1-in-10-year flood zone.',
        body: 'T10 is the highest flood risk designation in Spain. Mortgage insurance will be significantly more expensive — some insurers will decline cover entirely.',
        action: 'Verify insurance availability and cost with your mortgage broker before exchanging contracts.',
        source,
      };

    case 'in_t100':
      return {
        signal: 'amber',
        title: 'This address is inside the 1-in-100-year flood zone.',
        body: 'Lower risk than T10 but still relevant to insurance costs and long-term climate risk as extreme rainfall events increase in frequency.',
        action: 'Check flood insurance costs and confirm the building has adequate drainage with the seller.',
        source,
      };

    case 'in_t500':
      return {
        signal: 'neutral',
        title: 'This address falls within the 1-in-500-year flood zone.',
        body: 'T500 designation carries low near-term flood probability. It is worth noting for long-term climate risk assessments but is unlikely to affect current insurance costs.',
        source,
      };

    case 'none':
      return {
        signal: 'green',
        title: 'No flood risk at this address.',
        body: 'This coordinate does not fall within SNCZI T10, T100, or T500 flood zone boundaries.',
        source,
      };
  }
}

// ---------------------------------------------------------------------------
// 3. Fibre broadband coverage type
// ---------------------------------------------------------------------------

export type FibreCoverageType = 'FTTP' | 'FTTC' | 'HFC' | 'none';

/**
 * Returns a consequence statement for the broadband coverage type at a
 * specific address.
 *
 * @param type        The fibre_coverage.coverage_type value.
 * @param sourceYear  Optional year of the CNMC dataset (e.g. "2025").
 */
export function fibreConsequence(
  type: FibreCoverageType,
  sourceYear?: string,
): ConsequenceStatement {
  const source = `CNMC broadband coverage data${sourceYear ? `, ${sourceYear}` : ''}. Verify with your chosen provider before committing.`;

  switch (type) {
    case 'FTTP':
      return {
        signal: 'green',
        title: 'Full-fibre (FTTP) confirmed at this address.',
        body: 'FTTP delivers symmetrical speeds up to 1Gbps — adequate for remote work, video calls, and multiple simultaneous users.',
        source,
      };

    case 'FTTC':
      return {
        signal: 'amber',
        title: 'Fibre-to-the-cabinet (FTTC) is the best available option here.',
        body: 'FTTC download speeds are typically 30–80Mbps but upload speeds are limited — this may be a constraint for video calls or large file transfers.',
        action: 'Check with the provider whether full-fibre (FTTP) is on their upgrade roadmap for this area.',
        source,
      };

    case 'HFC':
      return {
        signal: 'amber',
        title: 'Cable broadband (HFC) is available at this address.',
        body: 'HFC networks share bandwidth between neighbours — speeds can be slower during peak hours in densely occupied areas.',
        action: 'Ask current residents about real-world speeds before relying on advertised figures.',
        source,
      };

    case 'none':
      return {
        signal: 'red',
        title: 'No fixed broadband coverage confirmed at this address.',
        body: 'Mobile broadband or satellite internet may be the only viable options — check current availability with local providers.',
        action: 'If remote work is a requirement, test mobile signal strength at the property before proceeding.',
        source,
      };
  }
}

// ---------------------------------------------------------------------------
// 4. Building orientation / aspect
// ---------------------------------------------------------------------------

/**
 * Compass aspects from the Catastro building orientation data.
 * S / SE / SW are solar-optimal; N / NE / NW are worst.
 */
export type BuildingAspect = 'N' | 'NE' | 'NW' | 'E' | 'W' | 'S' | 'SE' | 'SW';

/**
 * Returns a consequence statement for a building's primary aspect (orientation).
 *
 * @param aspect  The cardinal or intercardinal facing direction.
 */
export function orientationConsequence(
  aspect: BuildingAspect,
): ConsequenceStatement {
  if (aspect === 'S' || aspect === 'SE' || aspect === 'SW') {
    return {
      signal: 'green',
      title: `This building faces ${aspect} — an optimal solar orientation.`,
      body: 'South-facing properties receive maximum direct sunlight, reducing heating costs in winter and making solar panels significantly more productive.',
    };
  }

  if (aspect === 'E' || aspect === 'W') {
    return {
      signal: 'amber',
      title: `This building faces ${aspect}.`,
      body: 'East and west-facing properties receive good morning or afternoon sun, but miss peak midday solar exposure compared with south-facing buildings.',
    };
  }

  // N / NE / NW
  return {
    signal: 'red',
    title: `This building faces ${aspect} — limited solar exposure.`,
    body: 'North-facing properties receive little direct sunlight. Combined with high humidity or rainfall, this increases the probability of damp and raises heating costs year-round.',
    action: 'Commission a professional damp and thermal survey before exchanging contracts.',
  };
}

// ---------------------------------------------------------------------------
// 5. EPC energy performance certificate rating
// ---------------------------------------------------------------------------

export type EpcRating = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

/**
 * Returns a consequence statement for a property's EPC energy rating.
 *
 * @param rating            The EPC band (A–G).
 * @param heatingCostEur    Optional estimated annual heating cost for context.
 * @param coolingCostEur    Optional estimated annual cooling cost for context.
 */
export function epcConsequence(
  rating: EpcRating,
  heatingCostEur?: number,
  coolingCostEur?: number,
): ConsequenceStatement {
  const costLine = (heatingCostEur != null && coolingCostEur != null)
    ? ` Estimated energy cost: ~€${(heatingCostEur + coolingCostEur).toLocaleString('es-ES')}/year (heating €${heatingCostEur.toLocaleString('es-ES')} + cooling €${coolingCostEur.toLocaleString('es-ES')}).`
    : '';

  if (rating === 'A' || rating === 'B') {
    return {
      signal: 'green',
      title: `Energy certificate rating: ${rating} — highly efficient.`,
      body: `This is one of the most energy-efficient ratings available.${costLine} Running costs are well below average for this property type.`,
    };
  }

  if (rating === 'C' || rating === 'D') {
    return {
      signal: 'amber',
      title: `Energy certificate rating: ${rating} — moderate efficiency.`,
      body: `Mid-range efficiency — higher than E–G but with room for improvement.${costLine} Upgrading insulation or glazing could move this to a C or above.`,
      action: rating === 'D'
        ? 'Ask the seller for any existing improvement quotes — a C-rated certificate could raise resale value.'
        : undefined,
    };
  }

  // E / F / G
  return {
    signal: 'red',
    title: `Energy certificate rating: ${rating} — poor efficiency.`,
    body: `Low-efficiency properties carry significantly higher energy bills year-round.${costLine} EU regulations are tightening minimum EPC standards, which may affect resale and rental value.`,
    action: 'Request an energy improvement survey to understand upgrade costs before making an offer.',
  };
}

// ---------------------------------------------------------------------------
// 6. VUT (tourist rental licence) count within 200m
// ---------------------------------------------------------------------------

/**
 * Returns a consequence statement for the number of active VUT (Vivienda de
 * Uso Turístico) licences within 200m of a pin.
 *
 * @param count  Total active VUT licences within 200m.
 */
export function vutConsequence(count: number): ConsequenceStatement {
  if (count <= 3) {
    return {
      signal: 'green',
      title: `${count} active tourist rental licence${count === 1 ? '' : 's'} within 200m.`,
      body: 'Very low short-term rental presence — this area has a predominantly residential character.',
    };
  }

  if (count <= 10) {
    return {
      signal: 'amber',
      title: `${count} active tourist rental licences within 200m.`,
      body: 'A moderate level of tourist rentals is present in the immediate area — worth investigating whether any are in this specific building.',
      action: 'Check how many units in this building hold VUT licences through the Junta de Andalucía register.',
    };
  }

  // 11+
  return {
    signal: 'red',
    title: `${count} active tourist rental licences within 200m.`,
    body: 'High tourist rental density reduces residential community character — expect frequent neighbour turnover, communal area noise, and reduced long-term cohesion.',
    action: 'Check how many units in this specific building hold VUT licences before proceeding.',
  };
}

// ---------------------------------------------------------------------------
// 7. NTI (Neighbourhood Transition Indicator) signal
// ---------------------------------------------------------------------------

export type NtiSignal = 'prime_buy' | 'stable' | 'too_late' | 'risk';

/**
 * Returns a consequence statement for a postcode's NTI signal.
 *
 * @param signal  The nti_signal value for this postcode from zone_scores.
 */
export function ntiConsequence(signal: NtiSignal): ConsequenceStatement {
  switch (signal) {
    case 'prime_buy':
      return {
        signal: 'green',
        title: 'This area is showing early gentrification signals.',
        body: 'Improving amenity mix, rising permit activity, and falling days on market suggest price appreciation is likely before broader market recognition catches up.',
      };

    case 'stable':
      return {
        signal: 'neutral',
        title: 'No strong transition signals in this postcode.',
        body: 'The area is showing neither early gentrification nor decline indicators — typical of an established residential zone.',
      };

    case 'too_late':
      return {
        signal: 'amber',
        title: 'This area is already well-recognised by the market.',
        body: 'Quality is high but the opportunity to buy ahead of price discovery may have passed — current values already reflect the area\'s reputation.',
      };

    case 'risk':
      return {
        signal: 'red',
        title: 'This area is showing early decline signals.',
        body: 'Rising VUT applications, an upward crime trend, and falling permit activity suggest the residential character of this postcode may be deteriorating.',
        action: 'Review zone trends carefully and consider whether a longer hold period is acceptable given the risk profile.',
      };
  }
}
