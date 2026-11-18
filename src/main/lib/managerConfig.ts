import fs from 'fs'
import path from 'path'

const MANAGER_MIRROR_CHANNEL_URL = 'https://cdn.jsdelivr.net/gh/ltdrdata/ComfyUI-Manager@main'

export const MANAGER_SECURITY_LEVELS = ['strong', 'normal', 'normal-', 'weak'] as const
export type ManagerSecurityLevel = (typeof MANAGER_SECURITY_LEVELS)[number]

export const DEFAULT_MANAGER_SECURITY_LEVEL: ManagerSecurityLevel = 'normal'

export function isManagerSecurityLevel(value: unknown): value is ManagerSecurityLevel {
  return typeof value === 'string' && (MANAGER_SECURITY_LEVELS as readonly string[]).includes(value)
}

export const MANAGER_NETWORK_MODES = ['public', 'private', 'offline', 'personal_cloud'] as const
export type ManagerNetworkMode = (typeof MANAGER_NETWORK_MODES)[number]

export const DEFAULT_MANAGER_NETWORK_MODE: ManagerNetworkMode = 'public'

export function isManagerNetworkMode(value: unknown): value is ManagerNetworkMode {
  return typeof value === 'string' && (MANAGER_NETWORK_MODES as readonly string[]).includes(value)
}

function modernConfigPath(installPath: string): string {
  return path.join(installPath, 'ComfyUI', 'user', '__manager', 'config.ini')
}

function legacyConfigPath(installPath: string): string {
  return path.join(installPath, 'ComfyUI', 'user', 'default', 'ComfyUI-Manager', 'config.ini')
}

function buildManagerConfig(opts: {
  useChineseMirrors: boolean
  securityLevel: ManagerSecurityLevel
  networkMode: ManagerNetworkMode
}): string {
  const lines = ['[default]']
  if (opts.useChineseMirrors) {
    lines.push(`channel_url = ${MANAGER_MIRROR_CHANNEL_URL}`)
    lines.push('bypass_ssl = true')
  }
  lines.push(`security_level = ${opts.securityLevel}`)
  lines.push(`network_mode = ${opts.networkMode}`)
  return lines.join('\n') + '\n'
}

function withDefaultOption(content: string, key: string, value: string): string {
  const line = `${key} = ${value}`
  const stripCR = (l: string) => (l.endsWith('\r') ? l.slice(0, -1) : l)
  const headerName = (l: string): string | null => {
    const m = /^[ \t]*\[([^\]]+)\]/.exec(stripCR(l))
    return m ? m[1]! : null
  }
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
  const optionPattern = new RegExp(`^[ \\t]*${escapedKey}[ \\t]*[=:]`, 'i')
  const isOptionKey = (l: string) => optionPattern.test(l)
  const isContinuation = (l: string) => /^[ \t]+\S/.test(stripCR(l))

  const lines = content.split('\n')
  let inDefault = false
  let firstDefaultHeader = -1
  let replaced = false
  for (let i = 0; i < lines.length; i++) {
    const current = lines[i] ?? ''
    const section = headerName(current)
    if (section !== null) {
      inDefault = section === 'default'
      if (inDefault && firstDefaultHeader === -1) firstDefaultHeader = i
      continue
    }
    if (!inDefault || !isOptionKey(current)) continue
    let contEnd = i + 1
    while (contEnd < lines.length && isContinuation(lines[contEnd] ?? '')) contEnd++
    if (!replaced) {
      lines[i] = line + (current.endsWith('\r') ? '\r' : '')
      replaced = true
      lines.splice(i + 1, contEnd - (i + 1))
    } else {
      lines.splice(i, contEnd - i)
      i--
    }
  }
  if (!replaced) {
    if (firstDefaultHeader === -1) {
      const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : ''
      return `${content}${separator}[default]\n${line}\n`
    }
    lines.splice(
      firstDefaultHeader + 1,
      0,
      line + ((lines[firstDefaultHeader] ?? '').endsWith('\r') ? '\r' : '')
    )
  }
  return lines.join('\n')
}

async function reconcileDefaultOptions(
  file: string,
  options: Record<string, string>
): Promise<void> {
  const current = await fs.promises.readFile(file, 'utf-8')
  let updated = current
  for (const [key, value] of Object.entries(options)) {
    updated = withDefaultOption(updated, key, value)
  }
  if (updated !== current) {
    await fs.promises.writeFile(file, updated, 'utf-8')
  }
}

export async function ensureManagerConfig(
  installPath: string,
  opts: {
    useChineseMirrors: boolean
    securityLevel?: ManagerSecurityLevel
    networkMode?: ManagerNetworkMode
  } = {
    useChineseMirrors: false
  }
): Promise<void> {
  const securityLevel = isManagerSecurityLevel(opts.securityLevel) ? opts.securityLevel : undefined
  const networkMode = isManagerNetworkMode(opts.networkMode) ? opts.networkMode : undefined
  const target = modernConfigPath(installPath)
  const legacy = legacyConfigPath(installPath)

  const requested: Record<string, string> = {}
  if (securityLevel) requested['security_level'] = securityLevel
  if (networkMode) requested['network_mode'] = networkMode
  const hasRequested = Object.keys(requested).length > 0

  if (fs.existsSync(target)) {
    if (hasRequested) await reconcileDefaultOptions(target, requested)
    return
  }

  if (fs.existsSync(legacy)) {
    if (hasRequested) await reconcileDefaultOptions(legacy, requested)
    return
  }

  if (!opts.useChineseMirrors && !hasRequested) return
  const content = buildManagerConfig({
    useChineseMirrors: opts.useChineseMirrors,
    securityLevel: securityLevel ?? DEFAULT_MANAGER_SECURITY_LEVEL,
    networkMode: networkMode ?? DEFAULT_MANAGER_NETWORK_MODE
  })
  try {
    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    await fs.promises.writeFile(target, content, { flag: 'wx', encoding: 'utf-8' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return
    throw err
  }
}

export const _internals = {
  MANAGER_MIRROR_CHANNEL_URL,
  buildManagerConfig,
  withDefaultOption,
  modernConfigPath,
  legacyConfigPath
}
