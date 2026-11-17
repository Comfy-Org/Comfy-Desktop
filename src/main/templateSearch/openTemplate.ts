import { reportTemplateLoaded } from './searchTelemetry'

export const CLAIM_WINDOW_MS = 60_000

interface PendingOpen {
  templateId: string
  queuedAt: number
  claimed: boolean
  searchId: string | null
}

const pending = new Map<string, PendingOpen>()

export function buildTemplateDeeplink(comfyUrl: string, templateId: string): string {
  try {
    const url = new URL(comfyUrl)
    url.searchParams.set('template', templateId)
    url.searchParams.set('source', 'default')
    return url.toString()
  } catch {
    return comfyUrl
  }
}

export function queueTemplateOpen(
  installationId: string,
  templateId: string,
  now = Date.now(),
  searchId: string | null = null
): void {
  pending.set(installationId, { templateId, queuedAt: now, claimed: false, searchId })
}

export function claimTemplateOpen(installationId: string, now = Date.now()): void {
  const open = pending.get(installationId)
  if (!open || open.claimed) return
  if (now - open.queuedAt <= CLAIM_WINDOW_MS) open.claimed = true
  else pending.delete(installationId)
}

export function dropTemplateOpen(installationId: string): void {
  pending.delete(installationId)
}

export function takeLaunchUrl(installationId: string, comfyUrl: string, now = Date.now()): string {
  const open = pending.get(installationId)
  if (!open?.claimed) return comfyUrl
  pending.delete(installationId)
  reportTemplateLoaded({
    searchId: open.searchId,
    templateId: open.templateId,
    buildStarted: true,
    pickToLoadMs: now - open.queuedAt
  })
  return buildTemplateDeeplink(comfyUrl, open.templateId)
}
