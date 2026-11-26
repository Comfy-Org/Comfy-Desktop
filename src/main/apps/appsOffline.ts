import type { Session } from 'electron'

import type { AppsLocation } from '../../shared/appsLocation'
import { appsListUrl, savedListBody } from './appsCatalog'
import { currentAppsLocation } from './appsConfig'

const answeringSessions = new WeakMap<Session, string[]>()

function keepsCopy(request: Request, location: AppsLocation): boolean {
  if (request.method !== 'GET' || request.headers.has('range')) return false
  try {
    return new URL(request.url).origin === location.origin
  } catch {
    return false
  }
}

function isListRequest(request: Request, location: AppsLocation): boolean {
  const url = new URL(request.url)
  return `${url.origin}${url.pathname}` === appsListUrl(location)
}

function passOn(appsSession: Session, request: Request): Promise<Response> {
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body !== null
  return appsSession.fetch(request.url, {
    method: request.method,
    headers: request.headers,
    ...(hasBody ? { body: request.body, duplex: 'half' } : {}),
    bypassCustomProtocolHandlers: true
  } as RequestInit)
}

export async function answerFromKeptCopy(
  appsSession: Session,
  request: Request
): Promise<Response> {
  const location = currentAppsLocation()
  if (!keepsCopy(request, location)) return passOn(appsSession, request)
  if (isListRequest(request, location)) {
    const saved = await savedListBody(appsListUrl(location))
    if (saved !== null) {
      return new Response(saved, { headers: { 'content-type': 'application/json; charset=utf-8' } })
    }
  }
  return appsSession.fetch(request.url, {
    cache: 'force-cache',
    redirect: 'error',
    bypassCustomProtocolHandlers: true
  })
}

export function answersFromKeptCopies(appsSession: Session): boolean {
  return answeringSessions.has(appsSession)
}

export function startAnsweringFromKeptCopies(appsSession: Session, location: AppsLocation): void {
  if (answeringSessions.has(appsSession)) return
  const schemes = [...new Set(['https', new URL(location.origin).protocol.slice(0, -1)])]
  for (const scheme of schemes) {
    appsSession.protocol.handle(scheme, (request) => answerFromKeptCopy(appsSession, request))
  }
  answeringSessions.set(appsSession, schemes)
}

export function stopAnsweringFromKeptCopies(appsSession: Session): void {
  const schemes = answeringSessions.get(appsSession)
  if (!schemes) return
  for (const scheme of schemes) appsSession.protocol.unhandle(scheme)
  answeringSessions.delete(appsSession)
}
