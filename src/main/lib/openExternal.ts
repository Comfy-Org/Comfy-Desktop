import { app, shell } from 'electron'
import { recordShellOpenExternal } from './e2eOverrides'
import type { AgentApp } from '../../types/ipc'

const OPENABLE_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:'])

interface AgentAppLink {
  protocol: string
  host: string
  pathname: string
  promptParam: string
}

const AGENT_APP_LINKS: Readonly<Record<AgentApp, AgentAppLink>> = {
  claude: { protocol: 'claude:', host: 'code', pathname: '/new', promptParam: 'q' },
  codex: { protocol: 'codex:', host: 'new', pathname: '', promptParam: 'prompt' }
}

const AGENT_APP_LINKS_BY_PROTOCOL: ReadonlyMap<string, AgentAppLink> = new Map(
  Object.values(AGENT_APP_LINKS).map((link) => [link.protocol, link])
)

export const LONGEST_AGENT_APP_LINK = 2048

export function isAgentApp(candidate: unknown): candidate is AgentApp {
  return typeof candidate === 'string' && Object.hasOwn(AGENT_APP_LINKS, candidate)
}

const LONGEST_LOGGED_SCHEME = 16

function parsedUrl(candidate: unknown): URL | null {
  if (typeof candidate !== 'string') return null
  try {
    return new URL(candidate)
  } catch {
    return null
  }
}

function openableHref(candidate: unknown): string | null {
  const url = parsedUrl(candidate)
  return url && OPENABLE_PROTOCOLS.has(url.protocol) ? url.href : null
}

function agentAppHref(candidate: unknown): string | null {
  const url = parsedUrl(candidate)
  const link = url && AGENT_APP_LINKS_BY_PROTOCOL.get(url.protocol)
  if (!url || !link) return null
  if (url.host !== link.host || url.pathname !== link.pathname) return null
  if (url.username !== '' || url.password !== '' || url.hash !== '') return null
  const params = [...url.searchParams]
  if (params.length !== 1) return null
  const [name, prompt] = params[0]!
  if (name !== link.promptParam) return null
  return `${url.protocol}//${link.host}${link.pathname}?${link.promptParam}=${encodeURIComponent(prompt)}`
}

function warnOfRefusedLink(candidate: unknown): void {
  const protocol = parsedUrl(candidate)?.protocol ?? 'no scheme'
  const scheme = protocol.length <= LONGEST_LOGGED_SCHEME ? protocol : 'long scheme'
  console.warn(`Refused to hand the OS a link (${scheme}).`)
}

async function handToTheOs(href: string): Promise<void> {
  if (process.env['E2E'] === '1' && !app.isPackaged) {
    recordShellOpenExternal(href)
    return
  }
  await shell.openExternal(href)
}

export function isOpenableExternalUrl(candidate: unknown): candidate is string {
  return openableHref(candidate) !== null
}

export async function openExternalUrl(candidate: string): Promise<void> {
  const href = openableHref(candidate)
  if (href === null) {
    warnOfRefusedLink(candidate)
    throw new Error('Refused to open a link that is not http, https or mailto.')
  }
  await handToTheOs(href)
}

export function tryOpenExternalUrl(candidate: unknown): Promise<boolean> {
  if (typeof candidate !== 'string') return Promise.resolve(false)
  return openExternalUrl(candidate).then(
    () => true,
    () => false
  )
}

export function tryOpenExternalUrlOrAgentApp(candidate: unknown): Promise<boolean> {
  const href = agentAppHref(candidate)
  if (href === null) return tryOpenExternalUrl(candidate)
  return handToTheOs(href).then(
    () => true,
    () => false
  )
}

const LONE_SURROGATES = /([\uD800-\uDBFF][\uDC00-\uDFFF])|[\uD800-\uDFFF]/g

function wellFormed(text: string): string {
  return text.replace(LONE_SURROGATES, (_, pair?: string) => pair ?? '\uFFFD')
}

export async function openAgentApp(app: AgentApp, prompt: string): Promise<void> {
  const link = AGENT_APP_LINKS[app]
  const encodedPrompt = encodeURIComponent(wellFormed(prompt))
  const href = `${link.protocol}//${link.host}${link.pathname}?${link.promptParam}=${encodedPrompt}`
  if (href.length > LONGEST_AGENT_APP_LINK) {
    throw new RangeError('The prompt is too long to hand to the agent app.')
  }
  await handToTheOs(href)
}
