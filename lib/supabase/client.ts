/**
 * Supabase browser client.
 * Use this in Client Components ('use client') where you need to query Supabase
 * from the browser (e.g. auth state, user-specific reads).
 */
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
