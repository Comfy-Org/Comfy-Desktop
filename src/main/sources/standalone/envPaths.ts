import fs from 'fs'
import path from 'path'
import { getActiveVenvDir } from '../../lib/pythonEnv'
import type { InstalledTorchTuple } from './torchStackTypes'
import type { InstallationRecord } from '../../installations'
export {
  getUvPath,
  getActivePythonPath,
  getActiveUvPath,
  getVenvDir,
  getVenvPythonPath
} from '../../lib/pythonEnv'
export const MANIFEST_FILE = 'manifest.json'
export const DEFAULT_LAUNCH_ARGS = '--enable-manager'

const VARIANT_LABELS: Record<string, string> = {
  nvidia: 'NVIDIA',
  'intel-xpu': 'Intel Arc (XPU)',
  amd: 'AMD',
  cpu: 'CPU',
  mps: 'Apple Silicon (MPS)'
}

export const PLATFORM_PREFIX: Record<string, string> = {
  win32: 'win-',
  darwin: 'mac-',
  linux: 'linux-'
}

/** Vendor-id prefix that hides a bundle from desktop builds older than this
 *  one: their install wizards list only `win-`/`mac-`/`linux-` ids, so a
 *  pre-release bundle such as `beta-win-nvidia-arm64` never reaches users
 *  whose app cannot run it. The platform prefix follows it. */
export const BETA_PREFIX = 'beta-'

export function isBetaVariant(variantId: string): boolean {
  return variantId.startsWith(BETA_PREFIX)
}

export function stripPlatform(variantId: string): string {
  return variantId.replace(/^(?:beta-)?(win|mac|linux)-/, '')
}

/** Vendor-id suffix naming an architecture-specific ARM64 bundle
 *  (`win-nvidia-arm64`, or a future `linux-nvidia-arm64`). macOS bundles are
 *  ARM64 without a suffix (`mac-mps`). */
export const ARM64_SUFFIX = '-arm64'

/** True for a vendor id that names a native ARM64 bundle. */
export function isArm64Variant(variantId: string): boolean {
  return variantId.endsWith(ARM64_SUFFIX)
}

/** The accelerator base a vendor id serves (`nvidia`, `cpu`, `mps`, …) with
 *  both the platform prefix and any architecture suffix removed, so a
 *  `win-nvidia-arm64` bundle is recognised as an NVIDIA variant. */
export function variantAccel(variantId: string): string {
  const stripped = stripPlatform(variantId)
  return isArm64Variant(stripped) ? stripped.slice(0, -ARM64_SUFFIX.length) : stripped
}

/**
 * True when a vendor id's architecture matches the running app. A native
 * ARM64 app (NVIDIA RTX Spark) must only see `-arm64` bundles, whose Python
 * and torch wheels are `win_arm64`; an x64 app must never see them - an
 * ARM64 interpreter cannot run under x64, and an x64 app on an ARM64 machine
 * runs under Prism emulation, where the x64 bundle is the one that works.
 * `process.arch` reports the app binary's architecture, which is exactly the
 * architecture the bundle has to match. macOS is the exception: its only
 * supported architecture is ARM64 and its bundle remains unsuffixed. Linux
 * currently publishes only unsuffixed x64 bundles, so an ARM64 Linux app must
 * reject them until `-arm64` bundles are available.
 */
export function variantMatchesHostArch(variantId: string): boolean {
  const isArm64 = isArm64Variant(variantId)
  if (process.platform === 'darwin') return !isArm64
  if (process.arch === 'arm64') return isArm64
  if (process.arch === 'x64') return !isArm64
  return false
}

/** True when a vendor id targets the running platform, with or without the
 *  `beta-` prefix (`win-nvidia` and `beta-win-nvidia-arm64` on Windows). */
export function variantMatchesHostPlatform(variantId: string): boolean {
  const prefix = PLATFORM_PREFIX[process.platform]
  if (!prefix) return false
  const id = isBetaVariant(variantId) ? variantId.slice(BETA_PREFIX.length) : variantId
  return id.startsWith(prefix)
}

/** Platform and architecture both match: the only bundles this app can run. */
export function variantMatchesHost(variantId: string): boolean {
  return variantMatchesHostPlatform(variantId) && variantMatchesHostArch(variantId)
}

export function getVariantLabel(variantId: string): string {
  const label = baseVariantLabel(stripPlatform(variantId))
  return isBetaVariant(variantId) ? `${label} Beta` : label
}

function baseVariantLabel(stripped: string): string {
  if (VARIANT_LABELS[stripped]) return VARIANT_LABELS[stripped]!
  for (const [key, label] of Object.entries(VARIANT_LABELS)) {
    if (stripped === key || stripped.startsWith(key + '-')) {
      const suffix = stripped.slice(key.length + 1)
      return suffix ? `${label} (${suffix.toUpperCase()})` : label
    }
  }
  return stripped
}

export function findSitePackages(envRoot: string): string | null {
  if (process.platform === 'win32') {
    return path.join(envRoot, 'Lib', 'site-packages')
  }
  const libDir = path.join(envRoot, 'lib')
  try {
    const pyDir = fs.readdirSync(libDir).find((d) => d.startsWith('python'))
    if (pyDir) return path.join(libDir, pyDir, 'site-packages')
  } catch {}
  return null
}

/**
 * Resolve the installed PyTorch version by reading the `torch-<version>.dist-info`
 * directory left in the venv's site-packages. Synchronous and cheap; returns null
 * when the venv, site-packages, or torch package can't be found.
 */
export function getTorchVersion(installation: InstallationRecord): string | null {
  return getInstalledTorchTuple(installation).torch
}

/**
 * Read the installed torch/torchvision/torchaudio versions from the venv's
 * `.dist-info` directories in one pass. Synchronous and cheap; each field is
 * null when the venv, site-packages, or that package can't be found.
 */
export function getInstalledTorchTuple(installation: InstallationRecord): InstalledTorchTuple {
  const tuple: InstalledTorchTuple = { torch: null, torchvision: null, torchaudio: null }
  const sitePackages = findSitePackages(getActiveVenvDir(installation))
  if (!sitePackages) return tuple
  try {
    for (const entry of fs.readdirSync(sitePackages)) {
      const match = entry.match(/^(torch|torchvision|torchaudio)-(.+?)\.dist-info$/i)
      if (match) {
        const [, pkg, version] = match
        tuple[pkg!.toLowerCase() as keyof InstalledTorchTuple] = version!
      }
    }
  } catch {}
  return tuple
}

export function getMasterPythonPath(installPath: string): string {
  if (process.platform === 'win32') {
    return path.join(installPath, 'standalone-env', 'python.exe')
  }
  return path.join(installPath, 'standalone-env', 'bin', 'python3')
}

const COMFY_ENVIRONMENT_FILE = '.comfy_environment'
const COMFY_ENVIRONMENT_VALUE = 'local-desktop2-standalone'
const COMFY_ENVIRONMENT_CONTENT = COMFY_ENVIRONMENT_VALUE + '\n'

/**
 * Write the `.comfy_environment` marker consumed by ComfyUI core so partner-node
 * API requests carry the `Comfy-Env: local-desktop2-standalone` header. Idempotent;
 * skips silently when the dir is missing. Errors are swallowed: this marker is
 * non-critical and must never break launch.
 */
export async function writeComfyEnvironment(comfyUIDir: string): Promise<void> {
  if (!fs.existsSync(comfyUIDir)) return
  const filePath = path.join(comfyUIDir, COMFY_ENVIRONMENT_FILE)
  try {
    const existing = await fs.promises.readFile(filePath, 'utf-8')
    if (existing === COMFY_ENVIRONMENT_CONTENT) return
  } catch {
    // File missing or unreadable — fall through to write.
  }
  try {
    await fs.promises.writeFile(filePath, COMFY_ENVIRONMENT_CONTENT, 'utf-8')
  } catch (err) {
    console.warn('Failed to write .comfy_environment:', err)
  }
}

export function recommendVariant(variantId: string, gpu: string | undefined): boolean {
  const stripped = stripPlatform(variantId)
  if (!gpu) return stripped === 'cpu'
  if (gpu === 'nvidia') return stripped === 'nvidia' || stripped.startsWith('nvidia-')
  if (gpu === 'amd') return stripped === 'amd' || stripped.startsWith('amd-')
  if (gpu === 'mps') return stripped === 'mps' || stripped.startsWith('mps-')
  if (gpu === 'intel') return stripped === 'intel-xpu' || stripped.startsWith('intel-xpu-')
  return false
}
