export type TorchStackSource =
  | { kind: 'comfy-bundle'; variant: string; bundleTag: string }
  | { kind: 'pytorch-index'; backend: 'cuda' | 'xpu' | 'rocm' | 'cpu'; indexTag: string }
  | { kind: 'amd-multi-arch-index'; indexTag: string }
  | { kind: 'pypi'; backend: 'mps' }

export interface TorchStackPackages {
  torch: string
  torchvision?: string
  torchaudio?: string
}

export interface ManagedTorchStackRef {
  stackId: string
  variant: string
  pythonVersion: string
  packages: TorchStackPackages
  source: TorchStackSource
}

export interface ObservedTorchStack {
  kind: 'observed'
  torchVersion: string | null
  torchvisionVersion?: string | null
  torchaudioVersion?: string | null
  observedAt: string
}

export type SnapshotTorchStack = { kind: 'managed'; ref: ManagedTorchStackRef } | ObservedTorchStack

export function observedTuple(s: ObservedTorchStack): TorchStackPackages {
  return {
    torch: s.torchVersion ?? '',
    ...(s.torchvisionVersion ? { torchvision: s.torchvisionVersion } : {}),
    ...(s.torchaudioVersion ? { torchaudio: s.torchaudioVersion } : {})
  }
}

export function hasFullObservedTuple(s: ObservedTorchStack): boolean {
  return s.torchvisionVersion !== undefined && s.torchaudioVersion !== undefined
}

export interface PersistedTorchStack extends ManagedTorchStackRef {
  bundle?: {
    url: string
    filename: string
    size: number
  }
}

export function publicVersion(v: string): string {
  return v.includes('+') ? v.slice(0, v.indexOf('+')) : v
}

export function torchLocalTag(v: string | null | undefined): string {
  if (!v || !v.includes('+')) return ''
  return v.slice(v.indexOf('+') + 1).toLowerCase()
}

export function stackVersionMatches(a: string, b: string): boolean {
  if (publicVersion(a) !== publicVersion(b)) return false
  const ta = torchLocalTag(a)
  const tb = torchLocalTag(b)
  return !ta || !tb || ta === tb
}

const TORCH_INDEX_BASE = 'https://download.pytorch.org/whl'
const TORCH_NIGHTLY_INDEX_BASE = 'https://download.pytorch.org/whl/nightly'
export const AMD_MULTI_ARCH_INDEX_URL = 'https://repo.amd.com/rocm/whl-multi-arch/'

export function isDevVersion(v: string): boolean {
  return /(\d|[._-])dev\d*$/i.test(publicVersion(v))
}

export function torchIndexUrlFor(packages: TorchStackPackages): string | null {
  const dev = isDevVersion(packages.torch)
  const base = dev ? TORCH_NIGHTLY_INDEX_BASE : TORCH_INDEX_BASE
  const tag = torchLocalTag(packages.torch)
  if (!tag) {
    if (!dev) return null
    return process.platform === 'darwin' ? `${TORCH_NIGHTLY_INDEX_BASE}/cpu` : null
  }
  if (tag.startsWith('rocm') && process.platform === 'win32') return null
  if (/^(cu\d+|rocm[\d.]+|xpu|cpu)$/.test(tag)) return `${base}/${tag}`
  return null
}

export function torchTupleReacquirable(packages: TorchStackPackages): boolean {
  if (torchIndexUrlFor(packages) !== null) return true
  return torchLocalTag(packages.torch) === '' && !isDevVersion(packages.torch)
}

function amdSourceServes(source: { indexTag: string }, packages: TorchStackPackages): boolean {
  if (!/^rocm[0-9.]+$/.test(source.indexTag)) return false
  for (const version of [packages.torch, packages.torchvision, packages.torchaudio]) {
    if (version === undefined) continue
    if (torchLocalTag(version) !== source.indexTag || isDevVersion(version)) return false
  }
  return true
}

export function isValidAmdMultiArchSource(
  source: object,
  packages: TorchStackPackages,
  stackId: string
): boolean {
  const src = source as Record<string, unknown>
  if (typeof src.indexTag !== 'string') return false
  if (Object.keys(src).some((k) => k !== 'kind' && k !== 'indexTag')) return false
  if (stackId !== makeAmdIndexStackId(src.indexTag, packages.torch)) return false
  return amdSourceServes({ indexTag: src.indexTag }, packages)
}

export function torchIndexUrlForSource(
  source: TorchStackSource | null,
  packages: TorchStackPackages
): string | null {
  if (source?.kind === 'amd-multi-arch-index') {
    return amdSourceServes(source, packages) ? AMD_MULTI_ARCH_INDEX_URL : null
  }
  return torchIndexUrlFor(packages)
}

export function torchTupleReacquirableFrom(
  source: TorchStackSource | null,
  packages: TorchStackPackages
): boolean {
  if (source?.kind === 'amd-multi-arch-index')
    return torchIndexUrlForSource(source, packages) !== null
  return torchTupleReacquirable(packages)
}

export function accelBaseForTag(tag: string): string | null {
  if (tag.startsWith('cu')) return 'nvidia'
  if (tag.startsWith('rocm')) return 'amd'
  if (tag === 'xpu') return 'intel-xpu'
  return null
}

export interface InstalledTorchTuple {
  torch: string | null
  torchvision: string | null
  torchaudio: string | null
}

export function torchTupleMatches(
  expected: TorchStackPackages,
  installed: InstalledTorchTuple
): boolean {
  for (const pkg of ['torch', 'torchvision', 'torchaudio'] as const) {
    const want = expected[pkg]
    const have = installed[pkg]
    if (!want !== !have) return false
    if (want && have && !stackVersionMatches(have, want)) return false
  }
  return true
}

export function torchPackageTuplesEqual(a: TorchStackPackages, b: TorchStackPackages): boolean {
  for (const pkg of ['torch', 'torchvision', 'torchaudio'] as const) {
    const av = a[pkg]
    const bv = b[pkg]
    if (!av !== !bv) return false
    if (av && bv && !stackVersionMatches(av, bv)) return false
  }
  return true
}

const STACK_ID_RE = /^comfy-bundle:([A-Za-z0-9._-]+):([A-Za-z0-9._-]+)$/

export function parseBundleStackId(stackId: string): { variant: string; bundleTag: string } | null {
  const m = stackId.match(STACK_ID_RE)
  if (!m) return null
  return { variant: m[1]!, bundleTag: m[2]! }
}

export function makeBundleStackId(variant: string, bundleTag: string): string {
  return `comfy-bundle:${variant}:${bundleTag}`
}

const INDEX_STACK_ID_RE = /^pytorch-index:([A-Za-z0-9._-]+):([A-Za-z0-9._-]+)$/

export function parseIndexStackId(stackId: string): { indexTag: string; version: string } | null {
  const m = stackId.match(INDEX_STACK_ID_RE)
  if (!m) return null
  return { indexTag: m[1]!, version: m[2]! }
}

export function makeIndexStackId(indexTag: string, torchVersion: string): string {
  return `pytorch-index:${indexTag}:${publicVersion(torchVersion)}`
}

const AMD_INDEX_STACK_ID_RE = /^amd-index:([A-Za-z0-9._-]+):([A-Za-z0-9._-]+)$/

export function parseAmdIndexStackId(
  stackId: string
): { indexTag: string; version: string } | null {
  const m = stackId.match(AMD_INDEX_STACK_ID_RE)
  if (!m) return null
  return { indexTag: m[1]!, version: m[2]! }
}

export function makeAmdIndexStackId(indexTag: string, torchVersion: string): string {
  return `amd-index:${indexTag}:${publicVersion(torchVersion)}`
}

export function parseAnyIndexStackId(
  stackId: string
): { indexTag: string; version: string } | null {
  return parseIndexStackId(stackId) ?? parseAmdIndexStackId(stackId)
}

export function stackAppliesViaPip(source: TorchStackSource, adopted: boolean): boolean {
  return adopted || source.kind !== 'comfy-bundle'
}

export function pythonAbiCompatible(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  const abi = (v: string): string | null => {
    const m = v.match(/^(\d+)\.(\d+)/)
    return m ? `${m[1]}.${m[2]}` : null
  }
  const aa = abi(a)
  const bb = abi(b)
  return aa !== null && aa === bb
}
