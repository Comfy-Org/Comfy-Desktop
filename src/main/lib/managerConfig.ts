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

function isManagerSecurityLevel(value: unknown): value is ManagerSecurityLevel {
  return (
    typeof value === 'string' && (MANAGER_SECURITY_LEVELS as readonly string[]).includes(value)
  )
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

// Build the full config body for a fresh install. Mirror keys are included only
// when the user opted into the China-mirror flow; security_level is always set.
function buildManagerConfig(opts: {
  useChineseMirrors: boolean
  securityLevel: ManagerSecurityLevel
}): string {
  const lines = ['[default]']
  if (opts.useChineseMirrors) {
    lines.push(`channel_url = ${MANAGER_MIRROR_CHANNEL_URL}`)
    lines.push('bypass_ssl = true')
    lines.push('network_mode = public')
  }
  lines.push(`security_level = ${opts.securityLevel}`)
  return lines.join('\n') + '\n'
}

// Set `security_level` inside an existing config's [default] section (the only
// section Manager reads it from), preserving every other key the user (or
// Manager) wrote. A same-named key in another section is left alone. Returns
// the original string unchanged when the value already matches, so we avoid
// pointless rewrites.
function withSecurityLevel(content: string, level: ManagerSecurityLevel): string {
  const line = `security_level = ${level}`
  const isHeader = (l: string) => /^[ \t]*\[[^\]]*\][ \t]*\r?$/.test(l)
  const isDefaultHeader = (l: string) => /^[ \t]*\[default\][ \t]*\r?$/.test(l)
  const isSecurityKey = (l: string) => /^[ \t]*security_level[ \t]*=/.test(l)

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
  for (let i = start + 1; i < end; i++) {
    const current = lines[i] ?? ''
    if (isSecurityKey(current)) {
      lines[i] = line + (current.endsWith('\r') ? '\r' : '')
      return lines.join('\n')
    }
  }
  lines.splice(start + 1, 0, line + ((lines[start] ?? '').endsWith('\r') ? '\r' : ''))
  return lines.join('\n')
}

// Rewrite `file` so its [default] security_level matches `level`, skipping the
// write when nothing changes.
async function reconcileSecurityLevel(file: string, level: ManagerSecurityLevel): Promise<void> {
  const current = await fs.promises.readFile(file, 'utf-8')
  const updated = withSecurityLevel(current, level)
  if (updated !== current) {
    await fs.promises.writeFile(file, updated, 'utf-8')
  }
}

/**
 * Reconcile ComfyUI-Manager's config.ini with Desktop settings before launch.
 *
 * - Modern config exists: it is the file Manager actually reads, so update its
 *   `security_level` when the user picked one - even when a stale legacy file
 *   is also present. Users who never chose a level keep full control.
 * - Legacy config only: update the legacy file in place. Creating the modern
 *   config here would silently suppress Manager's `migrate_legacy_config` flow
 *   and lose the user's other legacy options; editing content does not trip it.
 * - Fresh install (neither file): writes a new config carrying the chosen
 *   `security_level` (and the China-mirror keys when opted in). Writes nothing
 *   when neither a mirror nor an explicit security level is requested,
 *   preserving the prior no-seed behavior.
 */
export async function ensureManagerConfig(
  installPath: string,
  opts: { useChineseMirrors: boolean; securityLevel?: ManagerSecurityLevel } = {
    useChineseMirrors: false
  }
): Promise<void> {
  const securityLevel = isManagerSecurityLevel(opts.securityLevel)
    ? opts.securityLevel
    : undefined
  const target = modernConfigPath(installPath)
  const legacy = legacyConfigPath(installPath)

  if (fs.existsSync(target)) {
    if (securityLevel) await reconcileSecurityLevel(target, securityLevel)
    return
  }

  if (fs.existsSync(legacy)) {
    if (securityLevel) await reconcileSecurityLevel(legacy, securityLevel)
    return
  }

  if (!opts.useChineseMirrors && !securityLevel) return
  const content = buildManagerConfig({
    useChineseMirrors: opts.useChineseMirrors,
    securityLevel: securityLevel ?? DEFAULT_MANAGER_SECURITY_LEVEL
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
  withSecurityLevel,
  modernConfigPath,
  legacyConfigPath,
}
