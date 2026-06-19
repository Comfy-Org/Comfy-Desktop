import type { SurveyIdentity } from '../types/ipc'

const FEEDBACK_URL = 'https://form.typeform.com/to/VhOXmuaL'

function detectPlatform(): string {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('win')) return 'windows'
  if (ua.includes('mac')) return 'mac'
  if (ua.includes('linux')) return 'linux'
  return 'unknown'
}

function buildHiddenFields(version: string | undefined, identity: SurveyIdentity | null): string {
  const fields = new URLSearchParams()
  if (version) fields.set('ver', version)
  fields.set('platform', detectPlatform())
  if (identity?.anon_id) fields.set('anon_id', identity.anon_id)
  if (identity?.distinct_id) fields.set('distinct_id', identity.distinct_id)
  if (identity?.comfy_id) fields.set('comfy_id', identity.comfy_id)
  return fields.toString()
}

export function buildSupportUrl(version?: string, identity: SurveyIdentity | null = null): string {
  const url = new URL(FEEDBACK_URL)
  if (version) url.searchParams.set('ver', version)
  url.searchParams.set('platform', detectPlatform())
  url.hash = buildHiddenFields(version, identity)
  return url.toString()
}
