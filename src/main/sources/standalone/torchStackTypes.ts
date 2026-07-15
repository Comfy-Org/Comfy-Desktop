/**
 * A PyTorch "stack" is the exact torch/torchvision/torchaudio tuple plus the
 * backend runtime deps that ship with it, tied to a variant (backend + OS +
 * arch) and a Python version. Stack identity is separate from acquisition:
 * `TorchStackSource` says where a stack can be re-acquired, while the version
 * tuple says what it is. Only stacks resolvable in the main-side catalog are
 * "managed" (restorable); anything else is "observed" (informational only).
 */

/** Where a managed stack can be re-acquired. Only trusted, typed sources —
 *  never a raw URL from the renderer or a snapshot. `comfy-bundle` entries
 *  come from the R2 release catalog; `pytorch-index` / `pypi` entries come
 *  from the curated in-app manifest (see `torchIndexManifest.ts`) and are
 *  pip-applied from the trusted index the tuple's local tag names. */
export type TorchStackSource =
  | { kind: 'comfy-bundle'; variant: string; bundleTag: string }
  | { kind: 'pytorch-index'; backend: 'cuda' | 'xpu' | 'rocm' | 'cpu'; indexTag: string }
  | { kind: 'pypi'; backend: 'mps' }

export interface TorchStackPackages {
  torch: string
  torchvision?: string
  torchaudio?: string
}

/** Exact identity of a catalog-backed stack. Persisted on the installation
 *  record as `lastVerifiedTorchStack` and in snapshots as the managed arm of
 *  `SnapshotTorchStack`. */
export interface ManagedTorchStackRef {
  /** Opaque catalog ID, e.g. `comfy-bundle:win-nvidia:v0.4.2-env3`. The
   *  renderer round-trips this and nothing else; main re-resolves it. */
  stackId: string
  /** Full vendor variant id (e.g. `win-nvidia`) — encodes backend + OS. */
  variant: string
  /** Python version the stack was built for (e.g. `3.12.9`). */
  pythonVersion: string
  packages: TorchStackPackages
  source: TorchStackSource
}

/** Snapshot-time record of a stack that doesn't match any catalog entry —
 *  manual installs, custom indexes, unknown provenance. The versions keep
 *  their local tags (`2.4.1+cu121`) so a pip-managed (adopted) install can
 *  re-acquire the exact builds from the right index; bundle-managed installs
 *  never auto-restore an observed stack. */
export interface ObservedTorchStack {
  kind: 'observed'
  torchVersion: string | null
  torchvisionVersion?: string | null
  torchaudioVersion?: string | null
  observedAt: string
}

export type SnapshotTorchStack =
  | { kind: 'managed'; ref: ManagedTorchStackRef }
  | ObservedTorchStack

/** Exact-version tuple of an observed snapshot record (local tags kept). */
export function observedTuple(s: ObservedTorchStack): TorchStackPackages {
  return {
    torch: s.torchVersion ?? '',
    ...(s.torchvisionVersion ? { torchvision: s.torchvisionVersion } : {}),
    ...(s.torchaudioVersion ? { torchaudio: s.torchaudioVersion } : {}),
  }
}

/** Whether the observed record was written with the full-tuple fields (null
 *  means "recorded as absent"; missing means a pre-tuple or partial record,
 *  which stays note-only — both fields must be present to restore). */
export function hasFullObservedTuple(s: ObservedTorchStack): boolean {
  return s.torchvisionVersion !== undefined && s.torchaudioVersion !== undefined
}

/** `lastVerifiedTorchStack` as persisted on the installation record: the
 *  managed ref plus, for `comfy-bundle` stacks, the bundle download info
 *  needed to re-acquire it without a catalog fetch (repair path, offline
 *  restores). Index-served stacks (`pytorch-index` / `pypi`) carry no bundle
 *  — they re-acquire via pip from the index their local tag names. */
export interface PersistedTorchStack extends ManagedTorchStackRef {
  bundle?: {
    url: string
    filename: string
    size: number
  }
}

/** Strip a PEP 440 local tag: dist-info versions can carry one the R2
 *  metadata omits (e.g. `2.10.0+cu128` vs `2.10.0`). All stack version
 *  comparisons go through this so verification, reconciliation, and snapshot
 *  classification can never disagree about what "same version" means. */
export function publicVersion(v: string): string {
  return v.includes('+') ? v.slice(0, v.indexOf('+')) : v
}

/** PEP 440 local tag of a version string, lowercased: `2.10.0+cu130` →
 *  `cu130`; empty string when the version carries none. */
export function torchLocalTag(v: string | null | undefined): string {
  if (!v || !v.includes('+')) return ''
  return v.slice(v.indexOf('+') + 1).toLowerCase()
}

/** Version equality for stack identity: when BOTH sides carry a local tag the
 *  tags must match too (`2.10.0+cu128` and `2.10.0+cu130` are different
 *  builds, not the same version); when either side omits the tag, compare
 *  public versions only (one side may legitimately lack it — e.g. older R2
 *  metadata or PyPI/mac builds). */
export function stackVersionMatches(a: string, b: string): boolean {
  if (publicVersion(a) !== publicVersion(b)) return false
  const ta = torchLocalTag(a)
  const tb = torchLocalTag(b)
  return !ta || !tb || ta === tb
}

const TORCH_INDEX_BASE = 'https://download.pytorch.org/whl'

/** pip index that serves a torch build, derived from its local tag: the
 *  pytorch.org index for `cu*`/`rocm*`/`xpu`/`cpu` builds, default PyPI
 *  (null) for untagged builds (mac/MPS and PyPI-default wheels). Returns
 *  null for tags no trusted index serves: custom builds, and `rocm*` on
 *  Windows (pytorch.org publishes no Windows ROCm wheels — those builds
 *  come from AMD's own channels). */
export function torchIndexUrlFor(packages: TorchStackPackages): string | null {
  const tag = torchLocalTag(packages.torch)
  if (!tag) return null
  if (tag.startsWith('rocm') && process.platform === 'win32') return null
  if (/^(cu\d+|rocm[\d.]+|xpu|cpu)$/.test(tag)) return `${TORCH_INDEX_BASE}/${tag}`
  // Unknown local tag (custom build) — no index we can trust to serve it.
  return null
}

/** Whether a pip re-acquisition can actually honour the tuple: untagged
 *  versions resolve from PyPI, tagged ones need `torchIndexUrlFor` to name
 *  a trusted index that serves them. */
export function torchTupleReacquirable(packages: TorchStackPackages): boolean {
  return torchLocalTag(packages.torch) === '' || torchIndexUrlFor(packages) !== null
}

/** Accelerator-evidence variant base expected for a torch build, judged by
 *  its local tag — used to verify a pip-installed stack the same way bundle
 *  variants are verified ('nvidia' → cuda evidence, etc.). Null means no
 *  accelerator assertion (cpu, mps, unknown). */
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

/** Full-tuple stack identity check, symmetric: every package the stack
 *  declares must be installed at the same version (tag-aware, see
 *  `stackVersionMatches`), and a torch-family package installed but NOT
 *  declared by the stack is a mismatch too. Comparing torch alone is not
 *  enough — two stacks can share a torch version but differ in
 *  torchvision/torchaudio. */
export function torchTupleMatches(expected: TorchStackPackages, installed: InstalledTorchTuple): boolean {
  for (const pkg of ['torch', 'torchvision', 'torchaudio'] as const) {
    const want = expected[pkg]
    const have = installed[pkg]
    if (!want !== !have) return false
    if (want && have && !stackVersionMatches(have, want)) return false
  }
  return true
}

/** Symmetric exact-tuple equality for metadata drift checks: both sides must
 *  declare the same packages at the same versions (tag-aware). A package
 *  present on one side but omitted on the other is drift, not a match —
 *  unlike `torchTupleMatches`, which only checks the packages `expected`
 *  declares. */
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

/** Parse a `comfy-bundle` stackId into its variant and bundle tag; null when
 *  malformed. The character allowlist keeps IDs safe for path/URL use. */
export function parseBundleStackId(stackId: string): { variant: string; bundleTag: string } | null {
  const m = stackId.match(STACK_ID_RE)
  if (!m) return null
  return { variant: m[1]!, bundleTag: m[2]! }
}

export function makeBundleStackId(variant: string, bundleTag: string): string {
  return `comfy-bundle:${variant}:${bundleTag}`
}

const INDEX_STACK_ID_RE = /^pytorch-index:([A-Za-z0-9._-]+):([A-Za-z0-9._-]+)$/

/** Parse a `pytorch-index` stackId into its index tag and public torch
 *  version; null when malformed. `pypi` is the tag for untagged (default
 *  PyPI) tuples. The character allowlist keeps IDs safe for path/URL use. */
export function parseIndexStackId(stackId: string): { indexTag: string; version: string } | null {
  const m = stackId.match(INDEX_STACK_ID_RE)
  if (!m) return null
  return { indexTag: m[1]!, version: m[2]! }
}

/** stackId for an index-served stack, keyed by index tag + public torch
 *  version (one build per version per index, so the pair is unique). */
export function makeIndexStackId(indexTag: string, torchVersion: string): string {
  return `pytorch-index:${indexTag}:${publicVersion(torchVersion)}`
}

/** Whether a stack is applied via pip rather than a bundle graft. Bundle
 *  stacks still pip-apply on adopted installs; index stacks pip-apply
 *  everywhere (they have no bundle artifact at all). */
export function stackAppliesViaPip(source: TorchStackSource, adopted: boolean): boolean {
  return adopted || source.kind !== 'comfy-bundle'
}

/** Python compatibility for in-place stack switching: same major.minor.
 *  A different minor means a different ABI → different venv → new install. */
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
