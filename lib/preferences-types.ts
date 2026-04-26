/**
 * Shared types for the preferences module. Split out so client and server
 * code can import the names without pulling in the localStorage helpers.
 */

export type Pillar = 'financial' | 'lifestyle' | 'risk' | 'community';

export type ProfilePreset =
  | 'balanced'
  | 'first_time_buyer'
  | 'remote_worker'
  | 'investor'
  | 'family';
