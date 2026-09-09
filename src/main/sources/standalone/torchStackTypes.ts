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
 *  from the validated remote manifest (in-app fallback, see
 *  `torchIndexManifest.ts`) and are pip-applied from the trusted index the
 *  tuple's local tag names. `amd-multi-arch-index` entries pip-apply from
 *  AMD's TheRock multi-arch index (a hardcoded constant, never a manifest
 *  URL), which serves the Windows ROCm wheels pytorch.org does not. */
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

export type SnapshotTorchStack = { kind: 'managed'; ref: ManagedTorchStackRef } | ObservedTorchStack

/** Exact-version tuple of an observed snapshot record (local tags kept). */
export function observedTuple(s: ObservedTorchStack): TorchStackPackages {
  return {
    torch: s.torchVersion ?? '',
    ...(s.torchvisionVersion ? { torchvision: s.torchvisionVersion } : {}),
    ...(s.torchaudioVersion ? { torchaudio: s.torchaudioVersion } : {})
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
const TORCH_NIGHTLY_INDEX_BASE = 'https://download.pytorch.org/whl/nightly'
/** AMD's TheRock multi-arch pip index: the ONLY trusted source of Windows
 *  ROCm wheels (also serves Linux). Hardcoded - the remote manifest names
 *  the mechanism via `kind`, never a URL. */
export const AMD_MULTI_ARCH_INDEX_URL = 'https://repo.amd.com/rocm/whl-multi-arch/'

/** PEP 440 dev release (`2.13.0.dev20260720+cu132`): a nightly build, served
 *  by the `whl/nightly/<tag>` index namespace, never the stable one. Covers
 *  the accepted PEP 440 spellings (`.dev20260720`, bare `.dev`, compact
 *  `dev1`) while requiring a digit or separator before `dev` so labels
 *  merely containing those letters are not misclassified. Dated
 *  nightlies are purged from the index after roughly 60 days, so these
 *  tuples are reacquirable only within that window - after it, pip fails
 *  cleanly and the tuple degrades to the non-reacquirable path. */
export function isDevVersion(v: string): boolean {
  return /(\d|[._-])dev\d*$/i.test(publicVersion(v))
}

/** pip index that serves a torch build, derived from its local tag: the
 *  pytorch.org index for `cu*`/`rocm*`/`xpu`/`cpu` builds, default PyPI
 *  (null) for untagged builds (mac/MPS and PyPI-default wheels). Nightly
 *  (dev) versions map to the same tag under the nightly namespace; untagged
 *  nightlies (mac) live under `nightly/cpu`. Returns
 *  null for tags no trusted index serves: custom builds, and `rocm*` on
 *  Windows (pytorch.org publishes no Windows ROCm wheels — those builds
 *  come from AMD's own channels). */
export function torchIndexUrlFor(packages: TorchStackPackages): string | null {
  const dev = isDevVersion(packages.torch)
  const base = dev ? TORCH_NIGHTLY_INDEX_BASE : TORCH_INDEX_BASE
  const tag = torchLocalTag(packages.torch)
  if (!tag) {
    if (!dev) return null // stable untagged: default PyPI
    // pytorch.org leaves the local tag off nightly/cpu wheels only for
    // macOS; an untagged dev build anywhere else has no trusted provenance.
    return process.platform === 'darwin' ? `${TORCH_NIGHTLY_INDEX_BASE}/cpu` : null
  }
  if (tag.startsWith('rocm') && process.platform === 'win32') return null
  if (/^(cu\d+|rocm[\d.]+|xpu|cpu)$/.test(tag)) return `${base}/${tag}`
  // Unknown local tag (custom build) — no index we can trust to serve it.
  return null
}

/** Whether a pip re-acquisition can actually honour the tuple: untagged
 *  stable versions resolve from PyPI, everything else needs
 *  `torchIndexUrlFor` to name a trusted index that serves it. */
export function torchTupleReacquirable(packages: TorchStackPackages): boolean {
  if (torchIndexUrlFor(packages) !== null) return true
  // Untagged stable versions fall back to default PyPI; PyPI carries no
  // dev builds, so untagged nightlies get no such fallback.
  return torchLocalTag(packages.torch) === '' && !isDevVersion(packages.torch)
}

/** Whether an `amd-multi-arch-index` source coherently names its tuple: a
 *  rocm tag that every present component's build actually carries, on
 *  stable versions (the manifest mints only fully-tagged stable AMD
 *  tuples). Anything else fails closed - AMD's index serves many ROCm
 *  versions, so a mismatched or untagged component would otherwise
 *  resolve to a different build under this identity. */
function amdSourceServes(source: { indexTag: string }, packages: TorchStackPackages): boolean {
  if (!/^rocm[0-9.]+$/.test(source.indexTag)) return false
  for (const version of [packages.torch, packages.torchvision, packages.torchaudio]) {
    if (version === undefined) continue
    if (torchLocalTag(version) !== source.indexTag || isDevVersion(version)) return false
  }
  return true
}

/** Full validation for an untrusted (persisted / imported) value claiming
 *  to be an `amd-multi-arch-index` source: exactly the shape the app
 *  persists ({kind, indexTag} and nothing else - the index URL is a
 *  hardcoded constant, so a URL-bearing field must never look legitimate),
 *  coherent with the tuple it is attached to (`amdSourceServes`), and
 *  named by the stackId the app would mint for that tag + tuple (so a
 *  ref cannot carry an AMD source under a foreign identity). Shared by
 *  the persisted-ref and snapshot validators so repair and restore trust
 *  identical shapes. */
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

/** Source-aware trusted index for a pip apply: a coherent
 *  `amd-multi-arch-index` source names AMD's hardcoded index (the
 *  tag-derived pytorch.org lookup correctly refuses `rocm*` on Windows, so
 *  the source kind must lift it); every other source derives from the
 *  local tag as before. */
export function torchIndexUrlForSource(
  source: TorchStackSource | null,
  packages: TorchStackPackages
): string | null {
  if (source?.kind === 'amd-multi-arch-index') {
    return amdSourceServes(source, packages) ? AMD_MULTI_ARCH_INDEX_URL : null
  }
  return torchIndexUrlFor(packages)
}

/** Source-aware reacquirability: like `torchTupleReacquirable`, but a
 *  managed ref whose source is AMD's multi-arch index is servable exactly
 *  when that source coherently names the tuple (the tag-derived check
 *  would wrongly reject it on Windows). */
export function torchTupleReacquirableFrom(
  source: TorchStackSource | null,
  packages: TorchStackPackages
): boolean {
  if (source?.kind === 'amd-multi-arch-index')
    return torchIndexUrlForSource(source, packages) !== null
  return torchTupleReacquirable(packages)
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

const AMD_INDEX_STACK_ID_RE = /^amd-index:([A-Za-z0-9._-]+):([A-Za-z0-9._-]+)$/

/** Parse an `amd-index` stackId (AMD multi-arch entries) into its index tag
 *  and public torch version; null when malformed. */
export function parseAmdIndexStackId(
  stackId: string
): { indexTag: string; version: string } | null {
  const m = stackId.match(AMD_INDEX_STACK_ID_RE)
  if (!m) return null
  return { indexTag: m[1]!, version: m[2]! }
}

/** stackId for an AMD multi-arch entry. Its own namespace: a pytorch.org
 *  entry with the same tag + torch version is a different stack (different
 *  index, different wheels) and must never share an id with it. */
export function makeAmdIndexStackId(indexTag: string, torchVersion: string): string {
  return `amd-index:${indexTag}:${publicVersion(torchVersion)}`
}

/** Parse any index-served (manifest-resolved, pip-applied) stackId,
 *  regardless of which index serves it. */
export function parseAnyIndexStackId(
  stackId: string
): { indexTag: string; version: string } | null {
  return parseIndexStackId(stackId) ?? parseAmdIndexStackId(stackId)
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
