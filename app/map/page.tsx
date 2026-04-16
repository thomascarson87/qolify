/**
 * /map — Zone Intelligence Explorer
 *
 * Server Component: exports metadata (requires Server Component in Next.js 15+).
 * Delegates rendering to MapWrapper, which is a Client Component that can use
 * `next/dynamic` with `ssr: false` (not permitted in Server Components).
 */
import type { Metadata } from 'next';
import MapWrapper from './MapWrapper';

export const metadata: Metadata = {
  title: 'Zone Map — Qolify',
  description:
    'Explore Málaga by neighbourhood. Schools, flood risk, solar, transport and VUT density — before you ever paste a property URL.',
};

export default function MapPage() {
  return <MapWrapper />;
}
