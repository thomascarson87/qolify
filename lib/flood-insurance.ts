/**
 * lib/flood-insurance.ts — CHI-417
 *
 * Maps SNCZI flood-zone membership to plain-English guidance on the Spanish
 * insurance implications. Used by FloodIntelligenceCard in the DNA Report.
 *
 * Background — how flood cover works in Spain:
 *   Every home insurance policy sold in Spain includes a mandatory surcharge
 *   paid to the Consorcio de Compensación de Seguros (CCS). The CCS covers
 *   extraordinary risks — including flooding — and pays claims regardless of
 *   the insurer's own exclusions.
 *
 *   In practice this means:
 *   - The CCS will ALWAYS pay a flood claim if the property is insured,
 *     irrespective of the SNCZI flood zone.
 *   - The base premium from the insurer, however, responds to flood risk:
 *     insurers either load the premium on T10/T100 properties or, at the
 *     extreme, decline to write the policy at all. A declined policy means
 *     the mortgage lender will reject the application.
 *
 * We therefore present two distinct facts per band:
 *   1. CCS surcharge — flat, not risk-based, but worth knowing it exists
 *   2. Insurer premium impact + availability risk — the variable the buyer
 *      actually controls
 *
 * The function returns one block per band so the FloodIntelligenceCard can
 * render structured rows without re-deriving copy.
 */

import type { FloodZoneMembership } from './consequence-statements';

export interface FloodInsuranceImpact {
  /** Traffic-light severity for the impact block's left border. */
  signal: 'green' | 'amber' | 'red' | 'neutral';
  /** One-line headline stating the insurance implication plainly. */
  headline: string;
  /** Two sentences — first the premium/availability effect, then the CCS note. */
  body: string;
  /** Optional recommended action — only present when there is meaningful risk. */
  action?: string;
}

export function floodInsuranceImpact(
  membership: FloodZoneMembership,
): FloodInsuranceImpact {
  // The CCS sentence is near-identical across bands — factored out to avoid
  // drift if wording changes. It must always mention "mandatory" so the user
  // understands this is not an optional add-on.
  const ccsNote =
    'All Spanish home-insurance policies include a mandatory Consorcio de Compensación de Seguros (CCS) surcharge that covers extraordinary flood events once the base policy is in force.';

  switch (membership) {
    case 'in_t10':
      return {
        signal: 'red',
        headline: 'Insurance is materially harder and more expensive here.',
        body: `Private insurers commonly load premiums by 30–100% on T10 addresses or decline new policies outright — a declined policy will block a mortgage. ${ccsNote}`,
        action: 'Get two written insurance quotes before making an offer — not just one — so you can confirm cover is actually available.',
      };

    case 'in_t100':
      return {
        signal: 'amber',
        headline: 'Insurance is available but will carry a flood loading.',
        body: `Expect moderate premium loading (typically 10–25%) and occasional requirement for a flood-resilience survey before cover is offered. ${ccsNote}`,
        action: 'Request a written insurance quote early in the process to confirm the exact loading before exchanging contracts.',
      };

    case 'in_t500':
      return {
        signal: 'neutral',
        headline: 'Minimal effect on standard home-insurance pricing.',
        body: `T500 exposure rarely changes private insurer premiums in a material way today, though it is worth keeping in view as climate models shift. ${ccsNote}`,
      };

    case 'none':
      return {
        signal: 'green',
        headline: 'No flood loading expected on your home-insurance premium.',
        body: `Private insurers treat this coordinate as standard flood risk for pricing. ${ccsNote}`,
      };
  }
}
