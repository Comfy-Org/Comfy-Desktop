import { randomUUID } from 'node:crypto'
import type { WebContents, WebFrameMain } from 'electron'

import {
  buildIndexedDbInjectScript,
  FIREBASE_SESSION_INJECTION_OWNER_FIELD,
  INJECTION_OWNER_KEY,
  type InjectWriteOptions
} from './injectScript'

export { buildIndexedDbInjectScript, FIREBASE_SESSION_INJECTION_OWNER_FIELD }
export type { InjectWriteOptions }

export interface FirebaseSessionInjection {
  contents: WebContents
  frame: WebFrameMain | null
  token: string
}

let activeInjection: FirebaseSessionInjection | null = null

function setInjectionOwnerScript(token: string | null): string {
  return `globalThis[${JSON.stringify(INJECTION_OWNER_KEY)}] = ${JSON.stringify(token)}`
}

function invalidateInjection(injection: FirebaseSessionInjection): void {
  const { frame } = injection
  if (!frame || frame.isDestroyed()) return
  void frame.executeJavaScript(setInjectionOwnerScript(null)).catch(() => {})
}

function currentOrigin(contents: WebContents): string | null {
  try {
    return new URL(contents.getURL()).origin
  } catch {
    return null
  }
}

export function isFirebaseSessionInjectionRecordOwnedBy(
  record: unknown,
  ownerToken: string
): boolean {
  return (
    !!record &&
    typeof record === 'object' &&
    (record as Record<string, unknown>)[FIREBASE_SESSION_INJECTION_OWNER_FIELD] === ownerToken
  )
}

export function beginFirebaseSessionInjection(contents: WebContents): FirebaseSessionInjection {
  if (activeInjection) invalidateInjection(activeInjection)
  const injection = { contents, frame: null, token: randomUUID() }
  activeInjection = injection
  return injection
}

export function releaseFirebaseSessionInjection(injection: FirebaseSessionInjection): void {
  if (activeInjection !== injection) return
  activeInjection = null
  invalidateInjection(injection)
}

export function hasActiveFirebaseSessionInjection(): boolean {
  return activeInjection !== null
}

export async function injectFirebaseSession(
  injection: FirebaseSessionInjection,
  expectedOrigin: string,
  user: Record<string, unknown>,
  apiKey: string,
  options: InjectWriteOptions = {}
): Promise<boolean> {
  if (
    activeInjection !== injection ||
    injection.contents.isDestroyed() ||
    currentOrigin(injection.contents) !== expectedOrigin
  ) {
    return false
  }

  const frame = injection.contents.mainFrame
  injection.frame = frame
  await frame.executeJavaScript(setInjectionOwnerScript(injection.token))
  if (
    activeInjection !== injection ||
    frame.isDestroyed() ||
    injection.contents.mainFrame !== frame ||
    currentOrigin(injection.contents) !== expectedOrigin
  ) {
    invalidateInjection(injection)
    return false
  }

  const result = await frame.executeJavaScript(
    buildIndexedDbInjectScript(user, apiKey, expectedOrigin, injection.token, options),
    true
  )
  return result === true && activeInjection === injection
}
