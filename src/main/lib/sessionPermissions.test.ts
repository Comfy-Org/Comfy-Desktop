import type { Session, WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  app: { isPackaged: false },
  shell: { openExternal: vi.fn((_url: string) => Promise.resolve()) }
}))

vi.mock('electron', () => electron)

import { guardPermissionRequests, withholdPermissionsFrom } from './sessionPermissions'

type PermissionRequest = (
  contents: WebContents | null,
  permission: string,
  callback: (granted: boolean) => void,
  details?: { externalURL?: string }
) => void

function guardedSession(): { session: Session; handlersSet: () => number; ask: PermissionRequest } {
  const setPermissionRequestHandler = vi.fn()
  const session = { setPermissionRequestHandler } as unknown as Session
  guardPermissionRequests(session)
  return {
    session,
    handlersSet: () => setPermissionRequestHandler.mock.calls.length,
    ask: setPermissionRequestHandler.mock.calls[0]![0] as PermissionRequest
  }
}

const page = (): WebContents => ({}) as WebContents
const handedToTheOs = (): string[] => electron.shell.openExternal.mock.calls.map(([url]) => url)

function answerTo(
  ask: PermissionRequest,
  contents: WebContents | null,
  permission: string,
  externalURL?: string
): boolean | undefined {
  const callback = vi.fn<(granted: boolean) => void>()
  ask(contents, permission, callback, externalURL === undefined ? {} : { externalURL })
  return callback.mock.calls[0]?.[0]
}

beforeEach(() => {
  electron.shell.openExternal.mockClear()
})

describe('permission requests from pages in a guarded session', () => {
  it.each([
    'search-ms:query=invoice',
    'smb://attacker.example/share',
    'vscode://file/etc/passwd',
    'file:///etc/passwd'
  ])('a link to %j is refused and nothing reaches the OS', (externalURL) => {
    const { ask } = guardedSession()

    expect(answerTo(ask, page(), 'openExternal', externalURL)).toBe(false)
    expect(handedToTheOs()).toEqual([])
  })

  it('a mail link is refused to the page and opened by the app instead', () => {
    const { ask } = guardedSession()

    expect(answerTo(ask, page(), 'openExternal', 'mailto:hello@comfy.org')).toBe(false)
    expect(handedToTheOs()).toEqual(['mailto:hello@comfy.org'])
  })

  it('an ordinary page keeps its other permissions', () => {
    const { ask } = guardedSession()

    expect(answerTo(ask, page(), 'media')).toBe(true)
    expect(answerTo(ask, page(), 'clipboard-read')).toBe(true)
  })

  it('a page whose permissions are withheld gets nothing, mail links included', () => {
    const { ask } = guardedSession()
    const withheld = page()
    withholdPermissionsFrom(withheld)

    expect(answerTo(ask, withheld, 'media')).toBe(false)
    expect(answerTo(ask, withheld, 'openExternal', 'mailto:hello@comfy.org')).toBe(false)
    expect(answerTo(ask, null, 'notifications')).toBe(false)
    expect(handedToTheOs()).toEqual([])
  })

  it('a session is guarded once however often it is asked for', () => {
    const { session, handlersSet } = guardedSession()

    guardPermissionRequests(session)

    expect(handlersSet()).toBe(1)
  })
})
