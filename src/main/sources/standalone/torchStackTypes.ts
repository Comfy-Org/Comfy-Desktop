/**
 * A PyTorch "stack" is the exact torch/torchvision/torchaudio tuple plus the
 * backend runtime deps that ship with it, tied to a variant (backend + OS +
 * arch) and a Python version. Stack identity is separate from acquisition:
 * `TorchStackSource` says where a stack can be re-acquired, while the version
 * tuple says what it is. Only stacks resolvable in the main-side catalog are
 * "managed" (restorable); anything else is "observed" (informational only).
 */

/** Where a managed stack can be re-acquired. Only trusted, typed sources —
 *  never a raw URL from the renderer or a snapshot. `pytorch-index` / `pypi`
 *  are reserved for the index-recipe follow-up; the catalog currently only
 *  produces `comfy-bundle` entries. */
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
 *  manual installs, custom indexes, unknown provenance. Never auto-restored. */
export interface ObservedTorchStack {
  kind: 'observed'
  torchVersion: string | null
  observedAt: string
}

export type SnapshotTorchStack =
  | { kind: 'managed'; ref: ManagedTorchStackRef }
  | ObservedTorchStack

/** `lastVerifiedTorchStack` as persisted on the installation record: the
 *  managed ref plus the bundle download info needed to re-acquire it without
 *  a catalog fetch (repair path, offline restores). */
export interface PersistedTorchStack extends ManagedTorchStackRef {
  bundle: {
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

export interface InstalledTorchTuple {
  torch: string | null
  torchvision: string | null
  torchaudio: string | null
}

/** Full-tuple stack identity check: every package the stack declares must be
 *  installed at the same public version. Comparing torch alone is not enough —
 *  two stacks can share a torch version but differ in torchvision/torchaudio. */
export function torchTupleMatches(expected: TorchStackPackages, installed: InstalledTorchTuple): boolean {
  for (const pkg of ['torch', 'torchvision', 'torchaudio'] as const) {
    const want = expected[pkg]
    if (!want) continue
    const have = installed[pkg]
    if (!have || publicVersion(have) !== publicVersion(want)) return false
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
