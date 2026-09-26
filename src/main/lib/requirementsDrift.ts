import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { PYTORCH_RE } from './pip'
import { findSitePackages } from '../sources/standalone/envPaths'

/**
 * Detects when a Python environment no longer satisfies ComfyUI's
 * `requirements.txt` / `manager_requirements.txt`, without spawning Python.
 *
 * Deliberately conservative: a line is only flagged when its package is absent
 * from site-packages, or installed at a version OLDER than an `==` pin or a
 * `>=` / `~=` floor. A newer-than-pin install is never flagged (a user who
 * upgraded the frontend package keeps it), and anything this can't evaluate —
 * environment markers, URLs, options, unparseable versions — counts as
 * satisfied. Upper bounds (`<`, `<=`, `!=`) are ignored on purpose: flagging a
 * too-new install would make the repair downgrade it. The torch family is
 * skipped: the torch repair owns it.
 */

export const REQUIREMENTS_FILES = ['requirements.txt', 'manager_requirements.txt'] as const

export interface ParsedRequirement {
  /** The requirement line as written (inline comment stripped), passed verbatim to uv. */
  line: string
  /** PEP 503-normalised distribution name. */
  name: string
  /** Minimum acceptable version from `==` / `>=` / `~=`, or null for presence-only. */
  minVersion: string | null
  /** The version specifiers as written (`>=2.0.0`, `==0.5.5`, `` for none). */
  specifier: string
}

export interface UnsatisfiedRequirement extends ParsedRequirement {
  reason: 'missing' | 'outdated'
  /** Installed version when `reason` is `outdated`. */
  installed?: string
}

/** PEP 503 name normalisation: lowercase, runs of `-_.` collapse to `-`. */
export function normalizeDistName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-')
}

const REQ_LINE_RE = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(.*)$/
const SPEC_RE = /^(===|==|~=|>=|<=|!=|>|<)\s*(\S+)$/

/** Parse one requirements line; null for anything this check doesn't evaluate. */
export function parseRequirementLine(raw: string): ParsedRequirement | null {
  const line = raw.replace(/\s+#.*$/, '').trim()
  if (!line || line.startsWith('#') || line.startsWith('-')) return null
  if (line.includes(';') || line.includes('://') || line.includes(' @ ')) return null
  if (PYTORCH_RE.test(line)) return null
  const m = line.match(REQ_LINE_RE)
  if (!m) return null
  let minVersion: string | null = null
  const specs = m[2]!.trim()
  if (specs) {
    for (const part of specs.split(',')) {
      const spec = part.trim().match(SPEC_RE)
      if (!spec) return null
      const [, op, version] = spec
      if ((op === '==' || op === '>=' || op === '~=') && !version!.includes('*')) {
        // Several floors on one line: the highest binds.
        if (!minVersion || (compareReleases(version!, minVersion) ?? 0) > 0) minVersion = version!
      }
    }
  }
  return { line, name: normalizeDistName(m[1]!), minVersion, specifier: specs }
}

function releaseParts(version: string): number[] | null {
  const m = version.match(/^v?(\d+(?:\.\d+)*)/)
  return m ? m[1]!.split('.').map(Number) : null
}

/**
 * Compare the numeric release segments of two versions (`0.5.5` vs `0.10`).
 * Returns null when either can't be parsed, so the caller treats it as satisfied.
 */
export function compareReleases(a: string, b: string): number | null {
  const pa = releaseParts(a)
  const pb = releaseParts(b)
  if (!pa || !pb) return null
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

const DIST_DIR_RE = /^(.+?)-([^-]+?)(?:-py[^-]*)?\.(?:dist|egg)-info$/i
const BARE_EGG_RE = /^(.+?)\.egg-info$/i

/**
 * Installed distributions in a site-packages dir, name → version (null when
 * the metadata dir carries no version). When stale metadata leaves two
 * versions of one package, the newer wins so we never flag a false positive.
 */
export function readInstalledDists(sitePackages: string): Map<string, string | null> {
  const dists = new Map<string, string | null>()
  let entries: string[]
  try {
    entries = fs.readdirSync(sitePackages)
  } catch {
    return dists
  }
  for (const entry of entries) {
    const m = entry.match(DIST_DIR_RE)
    if (m) {
      const name = normalizeDistName(m[1]!)
      const prev = dists.get(name)
      if (!prev || (compareReleases(m[2]!, prev) ?? 0) > 0) dists.set(name, m[2]!)
      continue
    }
    const bare = entry.match(BARE_EGG_RE)
    if (bare) {
      const name = normalizeDistName(bare[1]!)
      if (!dists.has(name)) dists.set(name, null)
    }
  }
  return dists
}

/** Requirement lines from `reqText` that `installed` does not satisfy. */
export function findUnsatisfiedRequirements(
  reqText: string,
  installed: Map<string, string | null>
): UnsatisfiedRequirement[] {
  const out: UnsatisfiedRequirement[] = []
  for (const raw of reqText.split(/\r?\n/)) {
    const req = parseRequirementLine(raw)
    if (!req) continue
    if (!installed.has(req.name)) {
      out.push({ ...req, reason: 'missing' })
      continue
    }
    const version = installed.get(req.name)
    if (req.minVersion && version && (compareReleases(version, req.minVersion) ?? 0) < 0) {
      out.push({ ...req, reason: 'outdated', installed: version })
    }
  }
  return out
}

export interface RequirementsDrift {
  /** Hash of the requirement files' contents; keys the repair give-up marker. */
  reqsHash: string
  unsatisfied: UnsatisfiedRequirement[]
  /** Every requirement this check evaluated, satisfied or not. */
  requirements: ParsedRequirement[]
}

/**
 * Check a ComfyUI checkout's requirement files against a site-packages dir.
 * Returns null when there is nothing to check against (no requirements.txt,
 * or site-packages unreadable) — absence of evidence is not drift.
 */
export function detectRequirementsDrift(
  comfyuiDir: string,
  sitePackages: string | null
): RequirementsDrift | null {
  if (!sitePackages || !fs.existsSync(sitePackages)) return null
  const texts: string[] = []
  for (const file of REQUIREMENTS_FILES) {
    try {
      texts.push(fs.readFileSync(path.join(comfyuiDir, file), 'utf-8'))
    } catch {
      if (file === 'requirements.txt') return null
      texts.push('')
    }
  }
  const installed = readInstalledDists(sitePackages)
  if (installed.size === 0) return null
  const hash = createHash('sha256')
  for (const text of texts) hash.update(text).update('\0')
  const seen = new Set<string>()
  const unsatisfied: UnsatisfiedRequirement[] = []
  const requirements: ParsedRequirement[] = []
  for (const text of texts) {
    for (const raw of text.split(/\r?\n/)) {
      const req = parseRequirementLine(raw)
      if (req) requirements.push(req)
    }
    for (const req of findUnsatisfiedRequirements(text, installed)) {
      if (seen.has(req.name)) continue
      seen.add(req.name)
      unsatisfied.push(req)
    }
  }
  return { reqsHash: hash.digest('hex'), unsatisfied, requirements }
}

/** Short human-readable summary, e.g. `sqlalchemy (missing), comfy-aimdo 0.4.1 < 0.5.5`. */
export function describeUnsatisfied(unsatisfied: UnsatisfiedRequirement[]): string {
  return unsatisfied
    .map((r) =>
      r.reason === 'missing' ? `${r.name} (missing)` : `${r.name} ${r.installed} < ${r.minVersion}`
    )
    .join(', ')
}

/** Quote a path for the platform's usual shell: single quotes on POSIX (inert
 *  to `$`, backticks and backslashes), double quotes on Windows, where `"` cannot
 *  appear in a path. */
export function shellQuote(p: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? `"${p}"` : `'${p.replace(/'/g, `'\\''`)}'`
}

/** The environment root of a venv or embedded interpreter, from its python path. */
export function envRootForPython(pythonPath: string): string {
  const dir = path.dirname(pythonPath)
  const base = path.basename(dir).toLowerCase()
  return base === 'scripts' || base === 'bin' ? path.dirname(dir) : dir
}

/**
 * Launch-log warning for an environment Desktop doesn't own (git, portable):
 * names the unsatisfied requirements and the exact command to install them.
 * Null when nothing is unsatisfied or the environment can't be read.
 */
export function unmanagedRequirementsWarning(
  pythonPath: string,
  comfyuiDir: string,
  opts: { isolated?: boolean } = {}
): string | null {
  const drift = detectRequirementsDrift(comfyuiDir, findSitePackages(envRootForPython(pythonPath)))
  if (!drift || drift.unsatisfied.length === 0) return null
  const files = REQUIREMENTS_FILES.map((f) => path.join(comfyuiDir, f)).filter((f) =>
    fs.existsSync(f)
  )
  const command = [
    shellQuote(pythonPath),
    ...(opts.isolated ? ['-s'] : []),
    '-m pip install',
    ...files.map((f) => `-r ${shellQuote(f)}`)
  ].join(' ')
  return (
    `\nWARNING: this Python environment does not satisfy ComfyUI's requirements: ` +
    `${describeUnsatisfied(drift.unsatisfied)}\n` +
    `ComfyUI may fail to start. To install them, run:\n  ${command}\n`
  )
}

/**
 * The ComfyUI checkout a launch command runs: the directory of the `main.py`
 * that follows `-s`, resolved against `cwd`. Portable launches run from the
 * portable root with an absolute `ComfyUI/main.py`, so `cwd` alone is wrong.
 */
export function comfyuiDirForLaunch(cmd: { args?: string[]; cwd?: string }): string | null {
  const args = cmd.args ?? []
  const sIdx = args.indexOf('-s')
  const mainPy = sIdx !== -1 ? args[sIdx + 1] : undefined
  if (!mainPy || !cmd.cwd) return null
  return path.dirname(path.resolve(cmd.cwd, mainPy))
}
