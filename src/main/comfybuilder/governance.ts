/**
 * Governance: the durable marker + the launch-time policy verifier.
 *
 * A governed distribution is one whose ComfyUI core was compiled with
 * `GOVERNANCE_REQUIRED = True` and a build identity / public key baked into
 * `ComfyUI/app/governance.py`. Core self-enforces from that compiled-in
 * constant regardless of anything Desktop does; everything here is a SECOND
 * layer whose only job is to turn "core refused to start, cryptically" into a
 * clear, policy-stating refusal BEFORE a process is ever spawned.
 *
 * **Governed status comes from the durable marker, never from the policy
 * file's presence.** Deriving it from whether `ComfyUI/governance/policy.signed.json`
 * exists would be self-defeating: deleting that file - the exact attack this
 * check exists to catch - would reclassify the install as non-governed and
 * launch it happily. The marker is instead written into the installation
 * record at install time (see {@link buildGovernanceMarker}), from constants
 * read out of an archive whose `archiveSha256` has already been verified.
 *
 * The trust chain is therefore: signed release -> `archiveSha256` ->
 * extracted `app/governance.py` constants -> marker in the installation
 * record -> this launch-time check. Values read at launch from an unverified
 * tree would inherit no trust at all, which is why the marker is captured
 * during install rather than re-derived here.
 */
import { createPublicKey, verify as verifySignature } from 'crypto'
import fs from 'fs'
import path from 'path'

/** Field name the marker occupies on the installation record. Todo 22 reads
 *  `activeForms` / `customNodeMode` from here to pick launch arguments. */
export const GOVERNANCE_MARKER_FIELD = 'governance'

/** Bumped when the marker's shape changes; an unknown version fails closed
 *  rather than being interpreted under today's rules. Desktop-local: the
 *  marker never leaves the installation record. */
export const GOVERNANCE_MARKER_VERSION = 1

/** The signed envelope's wire `schema`, and the payload's `schemaVersion`.
 *  Core hardcodes both as 1 (`app/governance.py`), so they are a SHARED
 *  contract and must not be derived from {@link GOVERNANCE_MARKER_VERSION} -
 *  bumping Desktop's marker shape would otherwise start rejecting every
 *  envelope core still emits, refusing launch on every governed install. */
export const GOVERNANCE_ENVELOPE_SCHEMA = 1

/** Core refuses a payload addressed to anyone else, so Desktop must too:
 *  waving one through only produces a launch that dies at startup. */
const GOVERNANCE_PAYLOAD_AUDIENCE = 'comfyui-core'

/** Custom-node governance posture, matching the signed payload exactly:
 *  null when the form is inactive, else the authored mode. */
export type CustomNodeMode = 'allowlist' | 'blocklist'

export interface GovernanceMarker {
  readonly governanceMarkerVersion: number
  readonly governed: true
  /** `GOVERNANCE_BUILD_IDENTITY` from the digest-verified archive. */
  readonly expectedBuildIdentity: string
  /** `GOVERNANCE_PUBLIC_KEY`: canonical unpadded base64url, 32 bytes. */
  readonly publicKey: string
  /** From the VERIFIED payload. Load-bearing: todo 22 forces
   *  `--enable-asset-hashing` iff `"model"` is a member. */
  readonly activeForms: readonly string[]
  /** From the VERIFIED payload. Load-bearing: todo 22 omits
   *  `--enable-manager` iff this is exactly `"allowlist"`. */
  readonly customNodeMode: CustomNodeMode | null
}

/** Archive-relative location of the signed policy envelope. */
export const GOVERNANCE_POLICY_RELATIVE = path.join('ComfyUI', 'governance', 'policy.signed.json')

/** Archive-relative location of the compiled-in governance constants. */
const GOVERNANCE_SOURCE_RELATIVE = path.join('ComfyUI', 'app', 'governance.py')

/** Absolute path of a governed install's signed policy envelope. */
export function governancePolicyPath(installPath: string): string {
  return path.join(installPath, GOVERNANCE_POLICY_RELATIVE)
}

// ---- Envelope codec ---------------------------------------------------------
//
// Byte-for-byte the same rules ComfyUI's `app/governance.py` applies, because
// the two verify the SAME envelope: canonical unpadded base64url, a 32-byte
// key, a 64-byte signature, and the `comfyui-governance-v1\0` domain separator
// prefixed to the exact transmitted payload bytes before verification. A
// looser codec here would accept envelopes core rejects, so Desktop would wave
// through a launch that then dies at startup - the opposite of this module's
// purpose.

const DOMAIN_SEPARATOR = Buffer.from('comfyui-governance-v1\0', 'utf-8')
const MAX_ENVELOPE_BYTES = 1024 * 1024
const MAX_PAYLOAD_BYTES = 512 * 1024
const MAX_ENCODED_PAYLOAD_CHARS = Math.floor((MAX_PAYLOAD_BYTES * 4 + 2) / 3)
const ENVELOPE_KEYS = ['payload', 'schema', 'signature'] as const
const BASE64URL_CHARS = /^[A-Za-z0-9_-]*$/
/** SPKI DER prefix for an Ed25519 public key; Node has no raw-key importer. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

/**
 * Decode canonical unpadded base64url, or null. "Canonical" is enforced by
 * re-encoding and comparing: without it, `AB` and `AA` both decode to one zero
 * byte, so two different envelopes would carry the same signature bytes.
 */
export function decodeBase64UrlStrict(encoded: unknown): Buffer | null {
  if (typeof encoded !== 'string' || !BASE64URL_CHARS.test(encoded)) return null
  const decoded = Buffer.from(encoded, 'base64url')
  return decoded.toString('base64url') === encoded ? decoded : null
}

/** The subset of the signed payload Desktop needs. Core owns full schema
 *  validation; re-implementing it here would be a second, drifting copy. */
export interface VerifiedGovernancePayload {
  readonly buildIdentity: string
  readonly activeForms: readonly string[]
  readonly customNodeMode: CustomNodeMode | null
  /**
   * The effective signed model digest set (`payload.models`). Exposed so the
   * ledger writer in todo 41 consults this verifier rather than
   * re-implementing signature checking against a user-writable file.
   */
  readonly models: ReadonlySet<string>
}

export type GovernanceVerifyResult =
  | { readonly ok: true; readonly payload: VerifiedGovernancePayload }
  | { readonly ok: false; readonly reason: string }

function isCustomNodeMode(raw: unknown): raw is CustomNodeMode {
  return raw === 'allowlist' || raw === 'blocklist'
}

function ed25519KeyFrom(raw: Buffer): ReturnType<typeof createPublicKey> | null {
  try {
    return createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
      format: 'der',
      type: 'spki'
    })
  } catch {
    return null
  }
}

/**
 * Verify a signed governance envelope against the marker's recorded public key
 * and build identity, returning the fields Desktop consumes.
 *
 * Structural + signature + build-identity verification only: core performs the
 * full 13-key payload validation and is the actual boundary. Every failure is
 * a plain reason string so callers can log which control tripped without the
 * refusal message leaking envelope internals to the user.
 */
export function verifyGovernanceEnvelope(
  envelopeBytes: Uint8Array,
  expected: { readonly publicKey: string; readonly buildIdentity: string }
): GovernanceVerifyResult {
  if (envelopeBytes.length > MAX_ENVELOPE_BYTES) return { ok: false, reason: 'envelope too large' }

  let envelope: unknown
  try {
    envelope = JSON.parse(Buffer.from(envelopeBytes).toString('utf-8'))
  } catch {
    return { ok: false, reason: 'envelope is not valid JSON' }
  }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { ok: false, reason: 'envelope is not an object' }
  }
  const record = envelope as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (keys.length !== ENVELOPE_KEYS.length || keys.some((k, i) => k !== ENVELOPE_KEYS[i])) {
    return { ok: false, reason: 'envelope must contain exactly schema, payload, and signature' }
  }
  if (record.schema !== GOVERNANCE_ENVELOPE_SCHEMA) {
    return { ok: false, reason: 'unsupported envelope schema' }
  }
  if (typeof record.payload !== 'string' || typeof record.signature !== 'string') {
    return { ok: false, reason: 'payload and signature must be strings' }
  }
  if (record.payload.length > MAX_ENCODED_PAYLOAD_CHARS) {
    return { ok: false, reason: 'payload exceeds maximum size' }
  }

  const payloadBytes = decodeBase64UrlStrict(record.payload)
  if (!payloadBytes) return { ok: false, reason: 'payload is not canonical unpadded base64url' }
  if (payloadBytes.length > MAX_PAYLOAD_BYTES) {
    return { ok: false, reason: 'payload exceeds maximum size' }
  }
  const signature = decodeBase64UrlStrict(record.signature)
  if (!signature) return { ok: false, reason: 'signature is not canonical unpadded base64url' }
  if (signature.length !== 64) return { ok: false, reason: 'signature must be 64 bytes' }
  const publicKeyBytes = decodeBase64UrlStrict(expected.publicKey)
  if (!publicKeyBytes)
    return { ok: false, reason: 'public key is not canonical unpadded base64url' }
  if (publicKeyBytes.length !== 32) return { ok: false, reason: 'public key must be 32 bytes' }

  const key = ed25519KeyFrom(publicKeyBytes)
  if (!key) return { ok: false, reason: 'public key is not a usable Ed25519 key' }
  // Signed over the exact transmitted payload BYTES, never a re-serialization:
  // a JSON round-trip would change the signed message.
  const signed = Buffer.concat([DOMAIN_SEPARATOR, payloadBytes])
  let signatureValid: boolean
  try {
    signatureValid = verifySignature(null, signed, key, signature)
  } catch {
    signatureValid = false
  }
  if (!signatureValid) return { ok: false, reason: 'signature verification failed' }

  let payload: unknown
  try {
    payload = JSON.parse(payloadBytes.toString('utf-8'))
  } catch {
    return { ok: false, reason: 'payload is not valid JSON' }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'payload is not an object' }
  }
  const fields = payload as Record<string, unknown>

  // Core owns full payload validation; these two are mirrored because they are
  // fixed constants rather than a schema to keep in sync, and letting either
  // through would hand the user a launch that dies at startup instead of the
  // refusal this module exists to produce.
  if (fields.schemaVersion !== GOVERNANCE_ENVELOPE_SCHEMA) {
    return { ok: false, reason: 'unsupported payload schema' }
  }
  if (fields.audience !== GOVERNANCE_PAYLOAD_AUDIENCE) {
    return { ok: false, reason: 'payload is addressed to a different audience' }
  }
  if (typeof fields.buildIdentity !== 'string') {
    return { ok: false, reason: 'payload buildIdentity must be a string' }
  }
  if (fields.buildIdentity !== expected.buildIdentity) {
    return { ok: false, reason: 'payload build identity does not match this installation' }
  }

  const activeForms = fields.activeForms
  if (!Array.isArray(activeForms) || activeForms.some((f) => typeof f !== 'string')) {
    return { ok: false, reason: 'payload activeForms must be a string list' }
  }
  const customNodeMode = fields.customNodeMode
  if (customNodeMode !== null && !isCustomNodeMode(customNodeMode)) {
    return { ok: false, reason: 'payload customNodeMode is invalid' }
  }
  const models = fields.models
  if (!Array.isArray(models) || models.some((m) => typeof m !== 'string')) {
    return { ok: false, reason: 'payload models must be a string list' }
  }

  return {
    ok: true,
    payload: {
      buildIdentity: fields.buildIdentity,
      activeForms: activeForms as string[],
      customNodeMode: customNodeMode as CustomNodeMode | null,
      models: new Set(models as string[])
    }
  }
}

/**
 * Verify the signed policy envelope that ships inside `installPath`.
 *
 * The reusable entry point: todo 41's ledger writer calls this and reads
 * `payload.models` rather than re-implementing verification against a file the
 * user can edit.
 */
export async function verifyInstalledGovernancePolicy(
  installPath: string,
  expected: { readonly publicKey: string; readonly buildIdentity: string }
): Promise<GovernanceVerifyResult> {
  let envelopeBytes: Buffer
  try {
    // Bounded read, not `readFile`: this is the one file in the tree the user
    // is expected to be able to replace, so its size is attacker-chosen. One
    // byte past the limit is enough for the size check below to reject it.
    const handle = await fs.promises.open(governancePolicyPath(installPath), 'r')
    try {
      const buffer = Buffer.alloc(MAX_ENVELOPE_BYTES + 1)
      const { bytesRead } = await handle.read(buffer, 0, MAX_ENVELOPE_BYTES + 1, 0)
      envelopeBytes = buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return {
      ok: false,
      reason:
        code === 'ENOENT' ? 'the signed policy file is missing' : `policy unreadable (${code})`
    }
  }
  return verifyGovernanceEnvelope(envelopeBytes, expected)
}

// ---- Archive constants ------------------------------------------------------

export interface ArchiveGovernanceConstants {
  readonly required: boolean
  readonly buildIdentity: string
  readonly publicKey: string
}

/** Assignments the archive rewriter patches, each of which must appear exactly
 *  once at column 0. A duplicate is a shadowing attempt, not an ambiguity to
 *  resolve by "last wins". */
const CONSTANT_NAMES = [
  'GOVERNANCE_REQUIRED',
  'GOVERNANCE_BUILD_IDENTITY',
  'GOVERNANCE_PUBLIC_KEY'
] as const

/** Max bytes of `app/governance.py` to read; the real file is a few tens of KB
 *  and an unbounded read of an attacker-supplied path is not worth allowing. */
const MAX_GOVERNANCE_SOURCE_BYTES = 2 * 1024 * 1024

/**
 * Parse the three compiled-in constants out of `app/governance.py` source.
 *
 * Deliberately literal: the rewriter emits `NAME = <literal>` at column 0, so
 * anything else (a missing constant, a second assignment shadowing the first,
 * a non-literal value) is treated as an unrecognizable build and fails closed
 * rather than being guessed at.
 */
export function parseGovernanceConstants(source: string): ArchiveGovernanceConstants | null {
  const found = new Map<string, string>()
  for (const rawLine of source.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (!line || line.startsWith(' ') || line.startsWith('\t')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const name = line.slice(0, eq).trim()
    if (!(CONSTANT_NAMES as readonly string[]).includes(name)) continue
    if (found.has(name)) return null // shadowed: fail closed
    found.set(name, line.slice(eq + 1).trim())
  }
  if (found.size !== CONSTANT_NAMES.length) return null

  const requiredRaw = found.get('GOVERNANCE_REQUIRED')!
  if (requiredRaw !== 'True' && requiredRaw !== 'False') return null
  const identity = parsePyString(found.get('GOVERNANCE_BUILD_IDENTITY')!)
  const publicKey = parsePyString(found.get('GOVERNANCE_PUBLIC_KEY')!)
  if (identity === null || publicKey === null) return null

  return { required: requiredRaw === 'True', buildIdentity: identity, publicKey }
}

/** Parse the double-quoted literal the rewriter emits. Go's `strconv.Quote`
 *  and JSON agree on every escape it can produce for these ASCII values. */
function parsePyString(raw: string): string | null {
  if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'string' ? parsed : null
  } catch {
    return null
  }
}

/**
 * Read the constants out of an EXTRACTED, digest-verified archive tree.
 *
 * The caller must only invoke this after `archiveSha256` matched: that digest
 * is the chain of custody, so values taken from the tree it produced inherit
 * its trust. Reading the same file later, from a tree the user has been able
 * to edit, would inherit none.
 *
 * Returns null for EXACTLY ONE case: the file is absent, which is a build
 * predating governance. Every other outcome - unreadable, or present but
 * unparseable - THROWS. Those two must not share the "not governed" return:
 * an unreadable governed archive would then be recorded with no marker at
 * all, which reads downstream as `absent` rather than `malformed` and hands
 * the install every relaxation that governance exists to withhold.
 */
export async function readArchiveGovernanceConstants(
  installPath: string
): Promise<ArchiveGovernanceConstants | null> {
  const sourcePath = path.join(installPath, GOVERNANCE_SOURCE_RELATIVE)
  let source: string
  try {
    const handle = await fs.promises.open(sourcePath, 'r')
    try {
      const buffer = Buffer.alloc(MAX_GOVERNANCE_SOURCE_BYTES)
      const { bytesRead } = await handle.read(buffer, 0, MAX_GOVERNANCE_SOURCE_BYTES, 0)
      source = buffer.subarray(0, bytesRead).toString('utf-8')
    } finally {
      await handle.close()
    }
  } catch (err) {
    // A build with no `app/governance.py` at all predates governance; it is
    // simply not governed, which the null return expresses.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error(
      `This build's governance constants could not be read (${(err as NodeJS.ErrnoException).code ?? 'unknown error'}). The archive is not usable; contact your administrator.`,
      { cause: err }
    )
  }
  const constants = parseGovernanceConstants(source)
  if (!constants) {
    throw new Error(
      'This build ships governance constants that could not be parsed. The archive is not usable; contact your administrator.'
    )
  }
  return constants
}

/**
 * Build the durable marker for a freshly extracted, digest-verified archive,
 * or null when the build is not governed.
 *
 * `activeForms` / `customNodeMode` are taken from the VERIFIED payload, never
 * from an unverified tree: they drive todo 22's launch-argument matrix, so a
 * defaulted or attacker-chosen value would silently restore ungoverned
 * behaviour. A governed archive whose own shipped policy does not verify is a
 * broken build - throw rather than record a half-marker, so the install fails
 * loudly instead of producing a record that reads as non-governed.
 */
export async function buildGovernanceMarker(installPath: string): Promise<GovernanceMarker | null> {
  const constants = await readArchiveGovernanceConstants(installPath)
  if (!constants || !constants.required) return null
  if (!constants.buildIdentity || !constants.publicKey) {
    throw new Error(
      'This build is marked as governed but its build identity or public key is missing. The archive is not usable; contact your administrator.'
    )
  }

  const verified = await verifyInstalledGovernancePolicy(installPath, {
    publicKey: constants.publicKey,
    buildIdentity: constants.buildIdentity
  })
  if (!verified.ok) {
    throw new Error(
      `This build is a managed installation but its signed governance policy could not be verified (${verified.reason}). The archive is not usable; contact your administrator.`
    )
  }

  return {
    governanceMarkerVersion: GOVERNANCE_MARKER_VERSION,
    governed: true,
    expectedBuildIdentity: constants.buildIdentity,
    publicKey: constants.publicKey,
    activeForms: [...verified.payload.activeForms],
    customNodeMode: verified.payload.customNodeMode
  }
}

// ---- Reading the marker back ------------------------------------------------

export type GovernanceMarkerState =
  /** No marker at all: an ordinary, ungoverned install. Never blocked. */
  | { readonly kind: 'absent' }
  | { readonly kind: 'governed'; readonly marker: GovernanceMarker }
  /** A marker exists but does not parse. Treated as governed-but-broken and
   *  refused - NEVER silently as `governed: false`. */
  | { readonly kind: 'malformed'; readonly reason: string }

/**
 * Read the marker off an installation record, failing closed.
 *
 * The asymmetry is the point: an ABSENT marker means ungoverned (and must not
 * block anything), while a PRESENT-but-unparseable marker means a governed
 * install whose record was truncated or edited, and must refuse. Collapsing
 * the two into "not governed" would make truncating the record a bypass.
 */
export function readGovernanceMarker(record: {
  readonly [key: string]: unknown
}): GovernanceMarkerState {
  const raw = record[GOVERNANCE_MARKER_FIELD]
  if (raw === undefined || raw === null) return { kind: 'absent' }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { kind: 'malformed', reason: 'the governance marker is not an object' }
  }
  const marker = raw as Record<string, unknown>

  if (marker.governanceMarkerVersion !== GOVERNANCE_MARKER_VERSION) {
    return { kind: 'malformed', reason: 'the governance marker version is unrecognized' }
  }
  if (marker.governed !== true) {
    return { kind: 'malformed', reason: 'the governance marker is incomplete' }
  }
  if (typeof marker.expectedBuildIdentity !== 'string' || !marker.expectedBuildIdentity) {
    return { kind: 'malformed', reason: 'the governance marker has no build identity' }
  }
  if (typeof marker.publicKey !== 'string' || !marker.publicKey) {
    return { kind: 'malformed', reason: 'the governance marker has no public key' }
  }
  // `activeForms` and `customNodeMode` are load-bearing for todo 22's launch
  // arguments, so a marker missing either is malformed rather than defaulted.
  const activeForms = marker.activeForms
  if (!Array.isArray(activeForms) || activeForms.some((f) => typeof f !== 'string')) {
    return { kind: 'malformed', reason: 'the governance marker has no active policy forms' }
  }
  if (!('customNodeMode' in marker)) {
    return { kind: 'malformed', reason: 'the governance marker has no custom-node mode' }
  }
  const customNodeMode = marker.customNodeMode
  if (customNodeMode !== null && !isCustomNodeMode(customNodeMode)) {
    return { kind: 'malformed', reason: 'the governance marker has an invalid custom-node mode' }
  }

  return {
    kind: 'governed',
    marker: {
      governanceMarkerVersion: GOVERNANCE_MARKER_VERSION,
      governed: true,
      expectedBuildIdentity: marker.expectedBuildIdentity,
      publicKey: marker.publicKey,
      activeForms: activeForms as string[],
      customNodeMode
    }
  }
}

// ---- The pre-launch check ---------------------------------------------------

/**
 * The refusal a user (or an agent acting for one) sees. `tdd.md` §5.5: every
 * denial states the policy explicitly, because unexplained errors get routed
 * around while stated policy gets respected. `{detail}` names which control
 * tripped without implying the user can fix it themselves.
 */
export function governanceRefusalMessage(detail: string): string {
  return (
    'This is a managed ComfyUI installation. Its signed organization policy ' +
    `could not be verified (${detail}), so ComfyUI was not started. ` +
    "Removing or modifying the policy violates your organization's policy - " +
    'contact your administrator.'
  )
}

export type GovernanceLaunchCheck = { readonly ok: true } | { readonly ok: false; message: string }

/**
 * Pre-launch gate for a governed install: the signed policy must be present
 * and verify against the marker's recorded key and build identity.
 *
 * A SECOND LAYER and a better error surface only. Core self-enforces from its
 * compiled-in constant whatever this returns, so a PASS here enables exactly
 * nothing - it merely declines to interrupt. A non-governed install is a
 * no-op.
 */
export async function checkGovernedInstallPolicy(installation: {
  readonly installPath: string
  readonly [key: string]: unknown
}): Promise<GovernanceLaunchCheck> {
  const state = readGovernanceMarker(installation)
  if (state.kind === 'absent') return { ok: true }
  if (state.kind === 'malformed')
    return { ok: false, message: governanceRefusalMessage(state.reason) }

  const verified = await verifyInstalledGovernancePolicy(installation.installPath, {
    publicKey: state.marker.publicKey,
    buildIdentity: state.marker.expectedBuildIdentity
  })
  if (!verified.ok) return { ok: false, message: governanceRefusalMessage(verified.reason) }
  return { ok: true }
}

/**
 * The effective signed model digest set for a governed install, or null when
 * the install is not governed or its policy does not verify.
 *
 * Todo 41's ledger writer consults this instead of re-implementing
 * verification: a ledger built from an unverified policy would let one edited
 * file authorize arbitrary model bytes.
 */
export async function governedModelDigests(installation: {
  readonly installPath: string
  readonly [key: string]: unknown
}): Promise<ReadonlySet<string> | null> {
  const state = readGovernanceMarker(installation)
  if (state.kind !== 'governed') return null
  const verified = await verifyInstalledGovernancePolicy(installation.installPath, {
    publicKey: state.marker.publicKey,
    buildIdentity: state.marker.expectedBuildIdentity
  })
  return verified.ok ? verified.payload.models : null
}
