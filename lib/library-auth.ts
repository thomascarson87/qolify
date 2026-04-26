/**
 * Resolve the user id to use for Property Library operations.
 *
 * Until full auth is wired up, Qolify is single-user (Thomas only). This
 * helper returns the authenticated Supabase user id if a session cookie
 * is present, otherwise falls back to DEV_USER_ID from the environment.
 *
 * When real auth lands, removing the env fallback (or guarding it behind
 * NODE_ENV !== 'production') is the only change needed in the routes.
 */
import { createClient } from '@/lib/supabase/server';

export async function getEffectiveUserId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) return user.id;
  } catch {
    // Cookie/session lookup may fail in some contexts (e.g. cron). Fall
    // through to the env fallback rather than blocking the request.
  }

  const dev = process.env.DEV_USER_ID;
  return dev && dev.length > 0 ? dev : null;
}
