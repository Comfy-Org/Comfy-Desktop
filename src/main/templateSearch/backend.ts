import { createDecisionApiBackend, decisionEndpoint } from './decisionApi'
import { createFakeBackend } from './fakeBackend'
import type { FetchLike, TemplateSearchBackend } from './types'

export const TEMPLATE_SEARCH_ENV = 'COMFY_DESKTOP_TEMPLATE_SEARCH'

export function templateSearchBackendFor(
  setting: string | undefined,
  fetch: FetchLike
): TemplateSearchBackend {
  const endpoint = setting ? decisionEndpoint(setting.trim()) : null
  return endpoint ? createDecisionApiBackend(endpoint, fetch) : createFakeBackend()
}
