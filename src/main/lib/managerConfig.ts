import fs from 'fs'
import path from 'path'

// jsdelivr's GitHub CDN serves arbitrary github paths via /gh/<owner>/<repo>@<ref>/<file>
// and is reachable from regions where raw.githubusercontent.com fails. Mirrors the
// same content shape ComfyUI-Manager expects.
const MANAGER_MIRROR_CHANNEL_URL = 'https://cdn.jsdelivr.net/gh/ltdrdata/ComfyUI-Manager@main'

// ComfyUI-Manager's `security_level` values (most → least restrictive). These
// must match the strings Manager reads from config.ini's [default] section;
// `normal-` is the relaxed-on-localhost level. Manager has no API to change
// this — it is read once at startup — so Desktop owns it via config.ini.
export const MANAGER_SECURITY_LEVELS = ['strong', 'normal', 'normal-', 'weak'] as const
export type ManagerSecurityLevel = (typeof MANAGER_SECURITY_LEVELS)[number]

// Manager's own default when the key is absent. Pinned explicitly so the seeded
// config never relies on Manager's implicit fallback.
export const DEFAULT_MANAGER_SECURITY_LEVEL: ManagerSecurityLevel = 'normal'

export function isManagerSecurityLevel(value: unknown): value is ManagerSecurityLevel {
  return (
    typeof value === 'string' && (MANAGER_SECURITY_LEVELS as readonly string[]).includes(value)
  )
}

// Manager v4's `network_mode` values. `personal_cloud` relaxes the
// network-position rule: with a non-loopback --listen, middle+-risk actions
// (e.g. installing node packs) are denied at EVERY security_level unless the
// mode is personal_cloud. Like security_level, Manager reads this once at
// startup from config.ini's [default] section.
export const MANAGER_NETWORK_MODES = ['public', 'private', 'offline', 'personal_cloud'] as const
export type ManagerNetworkMode = (typeof MANAGER_NETWORK_MODES)[number]

// Manager's own default when the key is absent.
export const DEFAULT_MANAGER_NETWORK_MODE: ManagerNetworkMode = 'public'

export function isManagerNetworkMode(value: unknown): value is ManagerNetworkMode {
  return typeof value === 'string' && (MANAGER_NETWORK_MODES as readonly string[]).includes(value)
}

// Modern ComfyUI's system-user-api path. Desktop ships a modern bundle so this
// is the target for fresh installs.
function modernConfigPath(installPath: string): string {
  return path.join(installPath, 'ComfyUI', 'user', '__manager', 'config.ini')
}

// Pre-system-user-api path. An adopted/migrated install may have one of these
// already; pre-seeding the modern path while this exists would trigger
// Manager's `migrate_legacy_config` flow (pip install + dir rename) silently.
function legacyConfigPath(installPath: string): string {
  return path.join(installPath, 'ComfyUI', 'user', 'default', 'ComfyUI-Manager', 'config.ini')
}

// Build the full config body for a fresh install. Mirror keys are included
// only when the user opted into the China-mirror flow; security_level and
// network_mode are always set.
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

// Set one `key = value` option inside an existing config's [default] section
// (the only section Manager reads Desktop-owned options from), preserving
// every other key the user (or Manager) wrote. A same-named key in another
// section is left alone. Returns the original string unchanged when the value
// already matches, so we avoid pointless rewrites.
//
// Case rules mirror Python's configparser, which Manager uses: section names
// are case-sensitive (Manager indexes config['default'], so `[Default]` is a
// different, unread section), while option keys are case-insensitive
// (optionxform lowercases them, so `Security_Level` IS security_level).
// Case-variant duplicates are collapsed to one canonical line - Manager's
// migration path parses with strict=True, where such duplicates raise.
function withDefaultOption(content: string, key: string, value: string): string {
  const line = `${key} = ${value}`
  const isHeader = (l: string) => /^[ \t]*\[[^\]]*\][ \t]*\r?$/.test(l)
  const isDefaultHeader = (l: string) => /^[ \t]*\[default\][ \t]*\r?$/.test(l)
  // configparser accepts both `=` and `:` delimiters - a hand-written
  // `key: value` line must be replaced, not shadowed by an inserted `=`
  // line (Manager parses with strict=False, where the later line wins).
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
  const optionPattern = new RegExp(`^[ \\t]*${escapedKey}[ \\t]*[=:]`, 'i')
  const isOptionKey = (l: string) => optionPattern.test(l)

  const lines = content.split('\n')
  const start = lines.findIndex(isDefaultHeader)
  if (start === -1) {
    const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : ''
    return `${content}${separator}[default]\n${line}\n`
  }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (isHeader(lines[i] ?? '')) {
      end = i
      break
    }
  }
  let replaced = false
  for (let i = start + 1; i < end; i++) {
    const current = lines[i] ?? ''
    if (!isOptionKey(current)) continue
    if (!replaced) {
      lines[i] = line + (current.endsWith('\r') ? '\r' : '')
      replaced = true
    } else {
      lines.splice(i, 1)
      i--
      end--
    }
  }
  if (!replaced) {
    lines.splice(start + 1, 0, line + ((lines[start] ?? '').endsWith('\r') ? '\r' : ''))
  }
  return lines.join('\n')
}

// Rewrite `file` so each given [default] option matches the requested value,
// skipping the write when nothing changes. One read + at most one write even
// when several options are reconciled.
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

/**
 * Reconcile ComfyUI-Manager's config.ini with Desktop settings before launch.
 *
 * - Modern config exists: it is the file Manager actually reads, so update its
 *   `security_level` / `network_mode` when the user picked one - even when a
 *   stale legacy file is also present. Users who never chose keep full control.
 * - Legacy config only: update the legacy file in place. Creating the modern
 *   config here would silently suppress Manager's `migrate_legacy_config` flow
 *   and lose the user's other legacy options; editing content does not trip it.
 * - Fresh install (neither file): writes a new config carrying the chosen
 *   `security_level` / `network_mode` (and the China-mirror keys when opted
 *   in). Writes nothing when neither a mirror nor an explicit Manager option
 *   is requested, preserving the prior no-seed behavior.
 */
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
  const securityLevel = isManagerSecurityLevel(opts.securityLevel)
    ? opts.securityLevel
    : undefined
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
    // 'wx' is atomic create-if-not-exists. A parallel writer wins, we no-op
    // (the EEXIST is the success signal).
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
  legacyConfigPath,
}
