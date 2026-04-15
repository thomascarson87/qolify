/**
 * MapWrapper — thin 'use client' shell around MapClient.
 *
 * Why this file exists:
 *   `next/dynamic` with `ssr: false` is only permitted inside Client Components
 *   (Next.js 15/16). But `metadata` export requires a Server Component.
 *   The solution: keep page.tsx as a Server Component (for metadata), and
 *   move the dynamic import here into a Client Component wrapper.
 *
 * This file has zero business logic — it only owns the dynamic import.
 */
'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';

const MapClient = dynamic(() => import('./MapClient'), { ssr: false });

const LoadingScreen = () => (
  <div className="w-full h-[calc(100vh-64px)] flex items-center justify-center bg-[#0D1B2A]">
    <p className="font-[family-name:var(--font-dm-sans)] text-[#8A9BB0] text-sm">
      Loading map…
    </p>
  </div>
);

export default function MapWrapper() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <MapClient />
    </Suspense>
  );
}
