/**
 * Cross-process PostHog defaults, shared by renderer and main so the key/host live in one place.
 * The API key is a public write-only ingest key (safe to embed). Override via VITE_POSTHOG_API_KEY / POSTHOG_API_KEY.
 */

export const DEFAULT_POSTHOG_API_KEY = 'phc_iKfK86id4xVYws9LybMje0h44eGtfwFgRPIBehmy8rO'

export const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'

export function isPostHogFlagDisabled(value: string | undefined): boolean {
  return ['0', 'false', 'off'].includes((value || '').trim().toLowerCase())
}

/** Opt-in counterpart: unset means off, rather than `isPostHogFlagDisabled`'s unset means on. */
export function isPostHogFlagEnabled(value: string | undefined): boolean {
  return ['1', 'true', 'on'].includes((value || '').trim().toLowerCase())
}
