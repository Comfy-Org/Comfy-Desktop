/** Normalize a manifest hash for comparison: strip an optional `sha256:` prefix,
 * trim, and lowercase. Returns an empty string when there is no usable hash.
 *
 * Archive-install only (`archiveSha256`). The MODEL path is algorithm-tagged -
 * use {@link selectModelDigest} / {@link makeDigest} there. */
export function normalizeSha256(raw: string | undefined): string {
  return (
    raw
      ?.replace(/^sha256:/i, '')
      .trim()
      .toLowerCase() ?? ''
  )
}

export function isValidSha256(raw: string | undefined): boolean {
  return HEX_32_BYTES.test(normalizeSha256(raw))
}

// ---- Algorithm-tagged digests (the model path) ------------------------------
//
// Both algorithms below emit 32 bytes, so a BARE hex string cannot say which
// one produced it. That ambiguity is not academic on the model path: staged
// bytes carry their expected digest in a durable sidecar, and a bare-hex
// identity would let a partially downloaded file verified under one algorithm
// be resumed against the other whenever the two hex strings coincide. Every
// integrity value on the model path is therefore a tagged `{algo, value}`,
// and `digestKey` - which ALWAYS includes the algorithm - is the only
// identity two digests may be compared by.

/** Digest algorithms Desktop can verify a model with. BLAKE3 is preferred when
 *  the distribution was sealed with one; SHA-256 stays fully supported because
 *  manifests sealed before BLAKE3 sealing carry only `Sha256`, are never
 *  re-cut, and are never backfilled. */
export type DigestAlgorithm = 'blake3' | 'sha256'

/** An integrity value tagged with the algorithm that produced it. */
export interface Digest {
  readonly algo: DigestAlgorithm
  readonly value: string
}

/** Preference order: a manifest carrying both is verified with BLAKE3. */
export const DIGEST_ALGORITHMS: readonly DigestAlgorithm[] = ['blake3', 'sha256']

const HEX_32_BYTES = /^[a-f0-9]{64}$/

export function isDigestAlgorithm(raw: unknown): raw is DigestAlgorithm {
  return typeof raw === 'string' && (DIGEST_ALGORITHMS as readonly string[]).includes(raw)
}

/**
 * Normalize a hash for `algo`: trim, lowercase, and strip an optional
 * `<algo>:` prefix. A value labelled with a DIFFERENT known algorithm yields
 * an empty string rather than being silently re-tagged - a mislabelled
 * manifest must fail closed, not become the wrong algorithm's expectation.
 */
export function normalizeDigestHex(raw: string | undefined, algo: DigestAlgorithm): string {
  const trimmed = raw?.trim().toLowerCase() ?? ''
  if (!trimmed) return ''
  const prefix = `${algo}:`
  if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length).trim()
  if (DIGEST_ALGORITHMS.some((a) => trimmed.startsWith(`${a}:`))) return ''
  return trimmed
}

/** Tag a raw manifest hash with its algorithm, or null when it is not a valid
 *  32-byte lowercase-hex value for that algorithm. */
export function makeDigest(raw: string | undefined, algo: DigestAlgorithm): Digest | null {
  const value = normalizeDigestHex(raw, algo)
  return HEX_32_BYTES.test(value) ? { algo, value } : null
}

export function isValidDigest(digest: Digest | null | undefined): digest is Digest {
  return !!digest && isDigestAlgorithm(digest.algo) && HEX_32_BYTES.test(digest.value)
}

/**
 * The identity key for a digest, `<algo>:<hex>`. **The algorithm is part of
 * the key.** A BLAKE3 value and a SHA-256 value with identical hex are
 * different content expectations and must never compare equal - the resume
 * identity, the join guard, and final verification all key off this.
 * Returns undefined for anything not a valid digest, so an invalid value can
 * never accidentally equal another.
 */
export function digestKey(digest: Digest | null | undefined): string | undefined {
  return isValidDigest(digest) ? `${digest.algo}:${digest.value}` : undefined
}

/** True only when both sides are valid digests of the SAME algorithm with the
 *  same value. Two invalid/absent digests are never "equal". */
export function digestsEqual(a: Digest | null | undefined, b: Digest | null | undefined): boolean {
  const keyA = digestKey(a)
  return keyA !== undefined && keyA === digestKey(b)
}

/** Parse a persisted `<algo>:<hex>` reference back into a tagged digest. */
export function parseDigestKey(raw: string | undefined): Digest | null {
  const trimmed = raw?.trim().toLowerCase() ?? ''
  const sep = trimmed.indexOf(':')
  if (sep < 0) return null
  const algo = trimmed.slice(0, sep)
  return isDigestAlgorithm(algo) ? makeDigest(trimmed.slice(sep + 1), algo) : null
}

/** Re-tag an untrusted persisted/serialized value as a digest, or null. Used
 *  when reading a sidecar written by another process. */
export function coerceDigest(raw: unknown): Digest | null {
  if (!raw || typeof raw !== 'object') return null
  const { algo, value } = raw as { algo?: unknown; value?: unknown }
  if (!isDigestAlgorithm(algo) || typeof value !== 'string') return null
  return makeDigest(value, algo)
}

/**
 * The digest a manifest model is verified with: BLAKE3 when the build was
 * sealed with one, otherwise the SHA-256 that older sealed manifests carry.
 * Returns null when neither is a usable 32-byte hex value.
 *
 * A null is NOT on its own a licence to stage unverified: pair it with
 * {@link declaresModelIntegrity} to tell "sealed without a hash" apart from
 * "declared a hash that is not usable".
 */
export function selectModelDigest(
  source: { blake3?: string; sha256?: string } | null | undefined
): Digest | null {
  if (!source) return null
  return makeDigest(source.blake3, 'blake3') ?? makeDigest(source.sha256, 'sha256')
}

/**
 * Whether the manifest declared ANY integrity value, regardless of whether it
 * parses.
 *
 * This is the difference between two failures that must not be conflated. A
 * model sealed with no hash at all is something the build API knowingly emits
 * for public model sources; a model whose declared hash is malformed is a
 * broken or tampered manifest. Only the first is ever a candidate for being
 * staged unverified, and then only on a non-governed install.
 */
export function declaresModelIntegrity(
  source: { blake3?: string; sha256?: string } | null | undefined
): boolean {
  return Boolean(source?.blake3?.trim() || source?.sha256?.trim())
}

export function isSecureDownloadUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol === 'https:') return true
    return url.protocol === 'http:' && ['127.0.0.1', '::1', 'localhost'].includes(url.hostname)
  } catch {
    return false
  }
}
