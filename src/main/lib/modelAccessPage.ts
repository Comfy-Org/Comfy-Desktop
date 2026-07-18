import { BrowserWindow } from 'electron'
import type { Event, Session, WebContents } from 'electron'
import { findEntryByComfySender } from '../host/registry'

const HUGGING_FACE_HOST = 'huggingface.co'
const HUGGING_FACE_AUTH_PATHS = ['/login', '/join', '/password_reset']
const accessWindowsBySender = new WeakMap<WebContents, Map<string, BrowserWindow>>()
const securedSessions = new WeakSet<Session>()
const accessPageContents = new WeakSet<WebContents>()

function parseHuggingFaceUrl(url: string): URL | null {
  try {
    const parsed = new URL(url)
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname.toLowerCase() !== HUGGING_FACE_HOST ||
      parsed.port !== ''
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function modelRepositoryPath(url: URL): string | null {
  const [owner, repository] = url.pathname.split('/').filter(Boolean)
  if (!owner || !repository || owner === 'spaces') return null
  return `/${owner}/${repository}`
}

function modelRepositoryPathFromUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const parsed = parseHuggingFaceUrl(url)
  return parsed ? modelRepositoryPath(parsed) : null
}

export function isModelAccessPageUrl(url: unknown): url is string {
  return modelRepositoryPathFromUrl(url) !== null
}

function isNavigationAborted(error: unknown): boolean {
  return error instanceof Error && error.message.includes('ERR_ABORTED')
}

function isHuggingFaceOrigin(origin: string | undefined): boolean {
  if (!origin) return false
  const parsed = parseHuggingFaceUrl(origin)
  return parsed?.origin === `https://${HUGGING_FACE_HOST}`
}

function isAllowedNavigation(url: string, repositoryPath: string): boolean {
  const parsed = parseHuggingFaceUrl(url)
  if (!parsed) return false

  const path = parsed.pathname
  return (
    path === '/' ||
    path === repositoryPath ||
    path.startsWith(`${repositoryPath}/`) ||
    HUGGING_FACE_AUTH_PATHS.some((authPath) => path === authPath || path.startsWith(`${authPath}/`))
  )
}

function secureSession(session: Session, contents: WebContents): void {
  accessPageContents.add(contents)
  if (securedSessions.has(session)) return

  session.setPermissionCheckHandler(
    (requestingContents, _permission, requestingOrigin, details) => {
      if (requestingContents && accessPageContents.has(requestingContents)) return false
      return !isHuggingFaceOrigin(requestingOrigin) && !isHuggingFaceOrigin(details.embeddingOrigin)
    }
  )
  session.setPermissionRequestHandler((requestingContents, _permission, callback) => {
    callback(requestingContents !== null && !accessPageContents.has(requestingContents))
  })
  securedSessions.add(session)
}

function guardNavigation(event: Event, url: string, repositoryPath: string): void {
  if (isAllowedNavigation(url, repositoryPath)) return
  event.preventDefault()
}

function secureAccessWindow(
  accessWindow: BrowserWindow,
  session: Session,
  repositoryPath: string
): void {
  const guard = (event: Event, url: string) => guardNavigation(event, url, repositoryPath)
  accessWindow.webContents.on('will-navigate', guard)
  accessWindow.webContents.on('will-redirect', guard)
  accessWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  secureSession(session, accessWindow.webContents)
}

async function loadAccessPage(accessWindow: BrowserWindow, url: string): Promise<boolean> {
  try {
    await accessWindow.loadURL(url)
  } catch (error) {
    return isNavigationAborted(error)
  }
  return !accessWindow.isDestroyed()
}

export async function openModelAccessPageWindow(
  sender: WebContents,
  url: unknown
): Promise<boolean> {
  const repositoryPath = modelRepositoryPathFromUrl(url)
  if (!repositoryPath || typeof url !== 'string') return false

  const parent = findEntryByComfySender(sender)?.window
  if (!parent || parent.isDestroyed()) return false

  let accessWindows = accessWindowsBySender.get(sender)
  const existing = accessWindows?.get(repositoryPath)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return true
  }
  if (!accessWindows) {
    accessWindows = new Map()
    accessWindowsBySender.set(sender, accessWindows)
  }
  accessWindows.delete(repositoryPath)

  const accessWindow = new BrowserWindow({
    parent,
    width: 1100,
    height: 800,
    minWidth: 720,
    minHeight: 560,
    title: 'Hugging Face',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      // Keep provider login and access grants available to subsequent downloads.
      session: sender.session,
      preload: undefined,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })

  accessWindows.set(repositoryPath, accessWindow)
  secureAccessWindow(accessWindow, sender.session, repositoryPath)

  const destroyWithParent = () => {
    if (!accessWindow.isDestroyed()) accessWindow.destroy()
  }
  parent.once('closed', destroyWithParent)
  accessWindow.once('closed', () => {
    accessPageContents.delete(accessWindow.webContents)
    if (accessWindows.get(repositoryPath) === accessWindow) {
      accessWindows.delete(repositoryPath)
      if (accessWindows.size === 0) accessWindowsBySender.delete(sender)
    }
    parent.removeListener('closed', destroyWithParent)
  })

  accessWindow.once('ready-to-show', () => {
    if (!accessWindow.isDestroyed()) accessWindow.show()
  })

  if (!(await loadAccessPage(accessWindow, url))) {
    if (!accessWindow.isDestroyed()) accessWindow.destroy()
    return false
  }

  return true
}
