import type {
  ComfyDesktop2BillingHandoff,
  ComfyDesktop2BillingHandoffReceiver
} from '../../types/comfyDesktopBridge'
import { CLOUD_CONFIG } from './config'

const TIMEOUT_MS = 15_000

export interface BillingHandoffRequest {
  workspaceId: string
  receiver: ComfyDesktop2BillingHandoffReceiver
  clientVersion: string
}

export interface IssueBillingHandoffOptions {
  apiBase?: string
  timeoutMs?: number
}

type IssuedHandoff = Extract<ComfyDesktop2BillingHandoff, { status: 'issued' }>
type RefusedHandoff = Extract<ComfyDesktop2BillingHandoff, { status: 'refused' }>

function stringField(body: unknown, key: string): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const value: unknown = (body as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

function issuedFrom(body: unknown): IssuedHandoff | null {
  const entryUrl = stringField(body, 'entry_url')
  if (entryUrl === undefined || !URL.canParse(entryUrl)) return null
  return new URL(entryUrl).protocol === 'https:' ? { status: 'issued', entryUrl } : null
}

function refusedFrom(body: unknown): RefusedHandoff {
  const code = stringField(body, 'code')
  const message = stringField(body, 'message')
  return {
    status: 'refused',
    ...(code === undefined ? {} : { code }),
    ...(message === undefined ? {} : { message })
  }
}

export async function issueBillingHandoff(
  accessToken: string,
  { workspaceId, receiver, clientVersion }: BillingHandoffRequest,
  options: IssueBillingHandoffOptions = {}
): Promise<ComfyDesktop2BillingHandoff> {
  const base = (options.apiBase ?? CLOUD_CONFIG.apiBase).replace(/\/+$/, '')
  let res: Response
  try {
    res = await fetch(`${base}/auth/handoffs`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        receiver,
        surface: 'desktop',
        client_version: clientVersion
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS)
    })
  } catch {
    return { status: 'refused' }
  }
  if (res.status === 401) return { status: 'sign_in_again' }
  const body: unknown = await res.json().catch(() => null)
  if (res.ok) return issuedFrom(body) ?? { status: 'refused' }
  return refusedFrom(body)
}
