export const DEFAULT_POSTHOG_API_KEY = 'phc_iKfK86id4xVYws9LybMje0h44eGtfwFgRPIBehmy8rO'

export const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'

export function isPostHogFlagDisabled(value: string | undefined): boolean {
  return ['0', 'false', 'off', 'no', 'disabled'].includes((value || '').trim().toLowerCase())
}

export function isPostHogFlagEnabled(value: string | undefined): boolean {
  return ['1', 'true', 'on', 'yes', 'enabled'].includes((value || '').trim().toLowerCase())
}
