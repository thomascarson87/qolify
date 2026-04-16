/**
 * /map/report/community/[postcode] — Stub
 *
 * Community Intelligence report — full build deferred to Phase 2.
 * Shows a "coming soon" page with back navigation.
 */

import { ThemeToggle } from '@/components/report/ThemeToggle';

interface Props {
  params:      Promise<{ postcode: string }>;
  searchParams: Promise<{ lat?: string; lng?: string }>;
}

export default async function CommunityReportStub({ params, searchParams }: Props) {
  const { postcode } = await params;
  const sp = await searchParams;

  const backUrl = sp.lat && sp.lng
    ? `/map?lat=${sp.lat}&lng=${sp.lng}&pin=true`
    : '/map';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)', color: 'var(--text)', fontFamily: 'var(--font-dm-sans)' }}>
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', height: 52, borderBottom: '1px solid rgba(0,0,0,0.07)',
        background: 'var(--surface-2)',
      }}>
        <a href={backUrl} style={{ fontSize: 13, color: '#8A9BB0', textDecoration: 'none' }}>
          ← Back to map
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <ThemeToggle />
          <span style={{ fontFamily: 'var(--font-playfair)', fontSize: 18, fontWeight: 600 }}>Qolify</span>
        </div>
      </nav>
      <main style={{ maxWidth: 560, margin: '80px auto', padding: '0 24px', textAlign: 'center' }}>
        <p style={{ fontSize: 11, letterSpacing: '0.12em', color: '#8A9BB0', textTransform: 'uppercase', marginBottom: 12 }}>
          Community Intelligence
        </p>
        <h1 style={{ fontFamily: 'var(--font-playfair)', fontSize: 28, fontWeight: 700, marginBottom: 12 }}>
          Postcode {postcode}
        </h1>
        <p style={{ fontSize: 14, color: '#8A9BB0', lineHeight: 1.7, marginBottom: 32 }}>
          The full neighbourhood report — including VUT density trends, NTI transition signals,
          and 10-year outlook — is coming soon.
        </p>
        <a href={backUrl} style={{
          display: 'inline-block', background: 'var(--surface-2)',
          border: '1px solid rgba(0,0,0,0.1)', color: '#4A5D74',
          fontWeight: 600, fontSize: 14, padding: '10px 22px',
          borderRadius: 8, textDecoration: 'none',
        }}>
          Back to map →
        </a>
      </main>
    </div>
  );
}
