/**
 * /compare — Side-by-side comparison of 2–4 saved properties.
 *
 * Server component shell. The actual table, weight sliders, and personalised
 * TVI recalc are all client-side in CompareClient. IDs are passed via the
 * `?ids=a,b,c` query string from /library.
 *
 * The Suspense boundary is required by Next.js when a client component uses
 * useSearchParams() — without it the build fails with a CSR-bailout error.
 */
import { Suspense } from 'react';
import { CompareClient } from './CompareClient';

export const metadata = {
  title:       'Compare — Qolify',
  description: 'Side-by-side comparison of saved property analyses.',
};

export default function ComparePage() {
  return (
    <Suspense fallback={null}>
      <CompareClient />
    </Suspense>
  );
}
