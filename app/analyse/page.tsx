/**
 * /analyse — redirects to the homepage.
 *
 * The homepage (/) is the primary URL-paste entry point.
 * The only valid /analyse/* route is /analyse/[jobId] — the DNA Report.
 * Accessing /analyse directly (without a jobId) is not a valid state,
 * so we redirect to / immediately.
 */
import { redirect } from 'next/navigation';

export default function AnalysePage() {
  redirect('/');
}
