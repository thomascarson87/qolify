/**
 * /library — Property Library card grid.
 *
 * Server component shell — actual list, refresh, delete and notes editing
 * are all client-side in LibraryClient (it polls /api/library).
 */
import { LibraryClient } from './LibraryClient';

export const metadata = {
  title: 'Library — Qolify',
  description: 'Your saved property analyses.',
};

export default function LibraryPage() {
  return <LibraryClient />;
}
