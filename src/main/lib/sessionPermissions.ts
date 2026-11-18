import type { Session, WebContents } from 'electron'
import { tryOpenExternalUrl } from './openExternal'

const guardedSessions = new WeakSet<Session>()
const pagesWithoutPermissions = new WeakSet<WebContents>()

export function withholdPermissionsFrom(contents: WebContents): void {
  pagesWithoutPermissions.add(contents)
}

export function restorePermissionsTo(contents: WebContents): void {
  pagesWithoutPermissions.delete(contents)
}

export function hasPermissionsWithheld(contents: WebContents): boolean {
  return pagesWithoutPermissions.has(contents)
}

export function guardPermissionRequests(session: Session): void {
  if (guardedSessions.has(session)) return
  guardedSessions.add(session)
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (!contents || pagesWithoutPermissions.has(contents)) {
      callback(false)
      return
    }
    if (permission !== 'openExternal') {
      callback(true)
      return
    }
    callback(false)
    if ('externalURL' in details) void tryOpenExternalUrl(details.externalURL)
  })
}
