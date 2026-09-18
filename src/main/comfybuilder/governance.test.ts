// @vitest-environment node
import { createHash, generateKeyPairSync, sign as signBytes } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/download', () => ({ download: vi.fn() }))
vi.mock('../lib/extract', () => ({ extractNested: vi.fn() }))

import { download } from '../lib/download'
import { extractNested } from '../lib/extract'
import {
  GOVERNANCE_MARKER_FIELD,
  buildGovernanceMarker,
  checkGovernedInstallPolicy,
  decodeBase64UrlStrict,
  governancePolicyPath,
  governedModelDigests,
  parseGovernanceConstants,
  readGovernanceMarker,
  verifyGovernanceEnvelope,
  verifyInstalledGovernancePolicy
} from './governance'
import type { GovernanceMarker } from './governance'
import { installArtifact } from './install'
import type { Artifact } from './types'

const DOMAIN_SEPARATOR = Buffer.from('comfyui-governance-v1\0', 'utf-8')
const BUILD_IDENTITY = 'build-7|release-3|artifact-9|linux/nvidia/cu124|sha256:abcd'
const MODEL_DIGESTS = [`blake3:${'1'.repeat(64)}`, `blake3:${'2'.repeat(64)}`]

/** The three constants Builder's archive rewriter patches, in the exact
 *  `NAME = <literal>` shape `finalizearchive/rewrite.go` emits. */
function governanceSource(
  values: { required: boolean; buildIdentity: string; publicKey: string } | null
): string {
  const required = values ? (values.required ? 'True' : 'False') : 'False'
  const identity = JSON.stringify(values?.buildIdentity ?? '')
  const key = JSON.stringify(values?.publicKey ?? '')
  return [
    'import json',
    '',
    `GOVERNANCE_REQUIRED = ${required}`,
    `GOVERNANCE_BUILD_IDENTITY = ${identity}`,
    `GOVERNANCE_PUBLIC_KEY = ${key}`,
    'GOVERNANCE_MIN_POLICY_GENERATION = 0',
    ''
  ].join('\n')
}

function base64url(raw: Buffer): string {
  return raw.toString('base64url')
}

interface Signer {
  readonly publicKey: string
  readonly privateKey: KeyObject
}

function makeSigner(): Signer {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12)
  return { publicKey: base64url(Buffer.from(raw)), privateKey }
}

/** A full 13-key payload, matching what `manifestsign.Build` emits, so the
 *  verifier is exercised against the real wire shape rather than a stub. */
function makePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    audience: 'comfyui-core',
    versionId: 'version-42',
    buildIdentity: BUILD_IDENTITY,
    sourcesDigest: `sha256:${'a'.repeat(64)}`,
    policyGeneration: 3,
    activeForms: ['customNode', 'model'],
    customNodeMode: 'allowlist',
    packs: [],
    deniedPacks: [],
    disabledNodes: [],
    disabledPartnerNodes: [],
    models: MODEL_DIGESTS,
    ...overrides
  }
}

function makeEnvelope(signer: Signer, payload: Record<string, unknown>): string {
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf-8')
  const signature = signBytes(
    null,
    Buffer.concat([DOMAIN_SEPARATOR, payloadBytes]),
    signer.privateKey
  )
  return JSON.stringify({
    schema: 1,
    payload: base64url(payloadBytes),
    signature: base64url(signature)
  })
}

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-governance-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
  vi.clearAllMocks()
})

/** Lay down the two files a governed archive ships: the patched constants and
 *  the signed policy envelope. */
function writeInstallTree(
  installPath: string,
  opts: {
    constants?: { required: boolean; buildIdentity: string; publicKey: string } | null
    source?: string
    envelope?: string | null
  }
): void {
  fs.mkdirSync(path.join(installPath, 'venv'), { recursive: true })
  fs.mkdirSync(path.join(installPath, 'ComfyUI', 'app'), { recursive: true })
  fs.writeFileSync(
    path.join(installPath, 'ComfyUI', 'app', 'governance.py'),
    opts.source ?? governanceSource(opts.constants ?? null)
  )
  if (opts.envelope != null) {
    const policy = governancePolicyPath(installPath)
    fs.mkdirSync(path.dirname(policy), { recursive: true })
    fs.writeFileSync(policy, opts.envelope)
  }
}

describe('verifyGovernanceEnvelope', () => {
  it('accepts a well-formed envelope and exposes payload.models for the ledger writer', () => {
    const signer = makeSigner()
    const envelope = makeEnvelope(signer, makePayload())

    const result = verifyGovernanceEnvelope(Buffer.from(envelope, 'utf-8'), {
      publicKey: signer.publicKey,
      buildIdentity: BUILD_IDENTITY
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payload.activeForms).toEqual(['customNode', 'model'])
    expect(result.payload.customNodeMode).toBe('allowlist')
    expect([...result.payload.models].sort()).toEqual([...MODEL_DIGESTS].sort())
  })

  it('rejects an envelope whose signature has one flipped byte', () => {
    const signer = makeSigner()
    const parsed = JSON.parse(makeEnvelope(signer, makePayload())) as Record<string, string>
    const signature = Buffer.from(parsed.signature!, 'base64url')
    signature[0] = signature[0]! ^ 0x01
    const tampered = JSON.stringify({ ...parsed, signature: base64url(signature) })

    const result = verifyGovernanceEnvelope(Buffer.from(tampered, 'utf-8'), {
      publicKey: signer.publicKey,
      buildIdentity: BUILD_IDENTITY
    })

    expect(result).toMatchObject({ ok: false })
  })

  it('rejects a payload re-signed under a different key', () => {
    const signer = makeSigner()
    const attacker = makeSigner()
    const envelope = makeEnvelope(attacker, makePayload())

    expect(
      verifyGovernanceEnvelope(Buffer.from(envelope, 'utf-8'), {
        publicKey: signer.publicKey,
        buildIdentity: BUILD_IDENTITY
      })
    ).toMatchObject({ ok: false })
  })

  it('rejects a validly signed envelope for a different build identity', () => {
    const signer = makeSigner()
    const envelope = makeEnvelope(signer, makePayload({ buildIdentity: 'some-other-build' }))

    expect(
      verifyGovernanceEnvelope(Buffer.from(envelope, 'utf-8'), {
        publicKey: signer.publicKey,
        buildIdentity: BUILD_IDENTITY
      })
    ).toMatchObject({ ok: false })
  })

  // Core rejects both of these outright, so passing one through would replace
  // Desktop's stated refusal with a launch that dies at ComfyUI startup.
  it.each([
    ['a payload for another audience', { audience: 'somebody-else' }],
    ['a payload with no audience', { audience: undefined }],
    ['a payload with an unsupported schemaVersion', { schemaVersion: 2 }],
    ['a payload with a non-numeric schemaVersion', { schemaVersion: '1' }]
  ])('rejects %s', (_name, overrides) => {
    const signer = makeSigner()
    const envelope = makeEnvelope(signer, makePayload(overrides))

    expect(
      verifyGovernanceEnvelope(Buffer.from(envelope, 'utf-8'), {
        publicKey: signer.publicKey,
        buildIdentity: BUILD_IDENTITY
      })
    ).toMatchObject({ ok: false })
  })

  it.each([
    ['an extra envelope key', (e: Record<string, unknown>) => ({ ...e, extra: 1 })],
    ['a missing signature', ({ signature: _drop, ...rest }: Record<string, unknown>) => rest],
    ['a non-1 schema', (e: Record<string, unknown>) => ({ ...e, schema: 2 })],
    ['a padded payload', (e: Record<string, unknown>) => ({ ...e, payload: `${e.payload}=` })],
    [
      'a standard-alphabet signature',
      (e: Record<string, unknown>) => ({
        ...e,
        signature: Buffer.from(e.signature as string, 'base64url').toString('base64')
      })
    ]
  ])('rejects %s', (_name, mutate) => {
    const signer = makeSigner()
    const parsed = JSON.parse(makeEnvelope(signer, makePayload())) as Record<string, unknown>

    expect(
      verifyGovernanceEnvelope(Buffer.from(JSON.stringify(mutate(parsed)), 'utf-8'), {
        publicKey: signer.publicKey,
        buildIdentity: BUILD_IDENTITY
      })
    ).toMatchObject({ ok: false })
  })

  it.each([
    ['a 31-byte key', base64url(Buffer.alloc(31))],
    ['a padded key', `${base64url(Buffer.alloc(32))}=`],
    ['an empty key', '']
  ])('rejects %s recorded in the marker', (_name, publicKey) => {
    const signer = makeSigner()
    const envelope = makeEnvelope(signer, makePayload())

    expect(
      verifyGovernanceEnvelope(Buffer.from(envelope, 'utf-8'), {
        publicKey,
        buildIdentity: BUILD_IDENTITY
      })
    ).toMatchObject({ ok: false })
  })
})

describe('decodeBase64UrlStrict', () => {
  it('rejects non-canonical encodings that decode to the same bytes', () => {
    // `AA` and `AB` both decode to a single zero byte under a lenient decoder;
    // accepting both would let two distinct envelopes share one signature.
    expect(decodeBase64UrlStrict('AA')?.length).toBe(1)
    expect(decodeBase64UrlStrict('AB')).toBeNull()
    expect(decodeBase64UrlStrict('A')).toBeNull()
    expect(decodeBase64UrlStrict('++//')).toBeNull()
  })
})

describe('parseGovernanceConstants', () => {
  it('reads the patched constants the archive rewriter emits', () => {
    const parsed = parseGovernanceConstants(
      governanceSource({ required: true, buildIdentity: BUILD_IDENTITY, publicKey: 'key-value' })
    )
    expect(parsed).toEqual({
      required: true,
      buildIdentity: BUILD_IDENTITY,
      publicKey: 'key-value'
    })
  })

  it('reads stock (ungoverned) defaults as not required', () => {
    expect(parseGovernanceConstants(governanceSource(null))).toMatchObject({ required: false })
  })

  it.each([
    [
      'a shadowing second assignment',
      `${governanceSource({ required: true, buildIdentity: 'a', publicKey: 'b' })}\nGOVERNANCE_REQUIRED = False\n`
    ],
    [
      'a missing constant',
      governanceSource({ required: true, buildIdentity: 'a', publicKey: 'b' }).replace(
        /^GOVERNANCE_PUBLIC_KEY.*$/m,
        ''
      )
    ],
    [
      'a non-literal value',
      governanceSource({ required: true, buildIdentity: 'a', publicKey: 'b' }).replace(
        /^GOVERNANCE_PUBLIC_KEY.*$/m,
        'GOVERNANCE_PUBLIC_KEY = os.environ["KEY"]'
      )
    ],
    [
      'a non-boolean required flag',
      governanceSource({ required: true, buildIdentity: 'a', publicKey: 'b' }).replace(
        'GOVERNANCE_REQUIRED = True',
        'GOVERNANCE_REQUIRED = 1'
      )
    ]
  ])('fails closed on %s', (_name, source) => {
    expect(parseGovernanceConstants(source)).toBeNull()
  })
})

describe('buildGovernanceMarker', () => {
  it('takes the identity and key from the archive and the forms from the VERIFIED payload', async () => {
    const signer = makeSigner()
    const installPath = path.join(root, 'governed')
    writeInstallTree(installPath, {
      constants: { required: true, buildIdentity: BUILD_IDENTITY, publicKey: signer.publicKey },
      envelope: makeEnvelope(
        signer,
        makePayload({ activeForms: ['customNode', 'nodeId'], customNodeMode: 'blocklist' })
      )
    })

    const marker = await buildGovernanceMarker(installPath)

    expect(marker).toEqual({
      governanceMarkerVersion: 1,
      governed: true,
      expectedBuildIdentity: BUILD_IDENTITY,
      publicKey: signer.publicKey,
      activeForms: ['customNode', 'nodeId'],
      customNodeMode: 'blocklist'
    })
  })

  it('records customNodeMode null when the custom-node form is inactive', async () => {
    const signer = makeSigner()
    const installPath = path.join(root, 'model-only')
    writeInstallTree(installPath, {
      constants: { required: true, buildIdentity: BUILD_IDENTITY, publicKey: signer.publicKey },
      envelope: makeEnvelope(signer, makePayload({ activeForms: ['model'], customNodeMode: null }))
    })

    expect(await buildGovernanceMarker(installPath)).toMatchObject({
      activeForms: ['model'],
      customNodeMode: null
    })
  })

  it('returns no marker for an ungoverned archive', async () => {
    const installPath = path.join(root, 'ungoverned')
    writeInstallTree(installPath, { constants: null, envelope: null })
    expect(await buildGovernanceMarker(installPath)).toBeNull()
  })

  it('refuses a governed archive whose own shipped policy does not verify', async () => {
    const signer = makeSigner()
    const attacker = makeSigner()
    const installPath = path.join(root, 'broken-policy')
    writeInstallTree(installPath, {
      constants: { required: true, buildIdentity: BUILD_IDENTITY, publicKey: signer.publicKey },
      envelope: makeEnvelope(attacker, makePayload())
    })

    await expect(buildGovernanceMarker(installPath)).rejects.toThrow(/managed installation/i)
  })

  it('refuses a governed archive that ships no policy at all', async () => {
    const signer = makeSigner()
    const installPath = path.join(root, 'no-policy')
    writeInstallTree(installPath, {
      constants: { required: true, buildIdentity: BUILD_IDENTITY, publicKey: signer.publicKey },
      envelope: null
    })

    await expect(buildGovernanceMarker(installPath)).rejects.toThrow(/managed installation/i)
  })

  // An unparseable governance.py must NOT return null: null is recorded as no
  // marker at all, which reads downstream as `absent` (an ordinary install)
  // rather than `malformed`, handing the install the relaxations governance
  // exists to withhold.
  it('refuses an archive whose governance constants do not parse', async () => {
    const installPath = path.join(root, 'unparseable-constants')
    writeInstallTree(installPath, {
      source: 'GOVERNANCE_REQUIRED = True\nGOVERNANCE_REQUIRED = False\n',
      envelope: null
    })

    await expect(buildGovernanceMarker(installPath)).rejects.toThrow(/could not be parsed/i)
  })

  it('refuses an archive whose governance constants cannot be read', async () => {
    const installPath = path.join(root, 'unreadable-constants')
    writeInstallTree(installPath, { constants: null, envelope: null })
    // A directory where the file belongs: open() fails with EISDIR, which is
    // "unreadable", not "absent".
    const sourcePath = path.join(installPath, 'ComfyUI', 'app', 'governance.py')
    fs.rmSync(sourcePath, { force: true })
    fs.mkdirSync(sourcePath, { recursive: true })

    await expect(buildGovernanceMarker(installPath)).rejects.toThrow(/could not be read/i)
  })

  it('still reports an archive with no governance.py at all as ungoverned', async () => {
    const installPath = path.join(root, 'pre-governance')
    fs.mkdirSync(path.join(installPath, 'ComfyUI', 'app'), { recursive: true })

    expect(await buildGovernanceMarker(installPath)).toBeNull()
  })
})

describe('installArtifact governance marker', () => {
  const ARCHIVE_BYTES = Buffer.from('archive-payload-bytes')
  const ARCHIVE_SHA = createHash('sha256').update(ARCHIVE_BYTES).digest('hex')

  function stubTransport(installPath: string, tree: () => void): void {
    vi.mocked(download).mockImplementation(async (_url, dest) => {
      fs.writeFileSync(dest, ARCHIVE_BYTES)
      return dest
    })
    vi.mocked(extractNested).mockImplementation(async () => {
      fs.mkdirSync(installPath, { recursive: true })
      tree()
    })
  }

  const client = { resolveDownloadUrl: vi.fn(async () => 'https://example.test/a.tar.gz') }
  const artifact = (archiveSha256: string): Artifact => ({
    id: 'a1',
    os: 'linux',
    gpu: 'cpu',
    accelVariant: 'cpu',
    status: 'ready',
    archiveSha256
  })

  it('writes a marker whose fields equal the archive constants and the verified payload exactly', async () => {
    const signer = makeSigner()
    const installPath = path.join(root, 'install-governed')
    stubTransport(installPath, () =>
      writeInstallTree(installPath, {
        constants: { required: true, buildIdentity: BUILD_IDENTITY, publicKey: signer.publicKey },
        envelope: makeEnvelope(
          signer,
          makePayload({ activeForms: ['customNode', 'model'], customNodeMode: 'allowlist' })
        )
      })
    )

    const result = await installArtifact({
      artifact: artifact(ARCHIVE_SHA),
      client,
      installPath,
      cacheDir: path.join(root, 'cache')
    })

    expect(result.governance?.expectedBuildIdentity).toBe(BUILD_IDENTITY)
    expect(result.governance?.publicKey).toBe(signer.publicKey)
    expect(result.governance?.activeForms).toEqual(['customNode', 'model'])
    expect(result.governance?.customNodeMode).toBe('allowlist')
  })

  it('leaves a non-governed archive unmarked', async () => {
    const installPath = path.join(root, 'install-plain')
    stubTransport(installPath, () => writeInstallTree(installPath, { constants: null }))

    const result = await installArtifact({
      artifact: artifact(ARCHIVE_SHA),
      client,
      installPath,
      cacheDir: path.join(root, 'cache')
    })

    expect(result.governance).toBeNull()
  })

  it('writes NO marker when the archive fails its ArchiveSha256 check', async () => {
    const signer = makeSigner()
    const installPath = path.join(root, 'install-badsum')
    stubTransport(installPath, () =>
      writeInstallTree(installPath, {
        constants: { required: true, buildIdentity: BUILD_IDENTITY, publicKey: signer.publicKey },
        envelope: makeEnvelope(signer, makePayload())
      })
    )

    await expect(
      installArtifact({
        artifact: artifact('f'.repeat(64)),
        client,
        installPath,
        cacheDir: path.join(root, 'cache')
      })
    ).rejects.toMatchObject({ kind: 'checksum-mismatch' })

    // Nothing was extracted, so no constants were ever read: the marker cannot
    // exist because the digest that would make it trustworthy never matched.
    expect(extractNested).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(installPath, 'ComfyUI'))).toBe(false)
  })
})

describe('readGovernanceMarker', () => {
  const valid: GovernanceMarker = {
    governanceMarkerVersion: 1,
    governed: true,
    expectedBuildIdentity: BUILD_IDENTITY,
    publicKey: base64url(Buffer.alloc(32, 7)),
    activeForms: ['model'],
    customNodeMode: null
  }

  it('reads a complete marker as governed', () => {
    expect(readGovernanceMarker({ [GOVERNANCE_MARKER_FIELD]: valid })).toEqual({
      kind: 'governed',
      marker: valid
    })
  })

  it('reads an absent marker as ungoverned rather than blocking', () => {
    expect(readGovernanceMarker({})).toEqual({ kind: 'absent' })
    expect(readGovernanceMarker({ [GOVERNANCE_MARKER_FIELD]: undefined })).toEqual({
      kind: 'absent'
    })
  })

  it.each([
    ['no activeForms', { ...valid, activeForms: undefined }],
    ['no customNodeMode', { ...valid, customNodeMode: undefined }],
    ['a bogus customNodeMode', { ...valid, customNodeMode: 'anything' }],
    ['non-string activeForms', { ...valid, activeForms: [1, 2] }],
    ['no publicKey', { ...valid, publicKey: '' }],
    ['no build identity', { ...valid, expectedBuildIdentity: '' }],
    ['an unknown marker version', { ...valid, governanceMarkerVersion: 2 }],
    ['governed explicitly false', { ...valid, governed: false }],
    ['only the version (a torn write)', { governanceMarkerVersion: 1 }],
    ['a non-object', 'governed']
  ])('fails closed on a marker with %s, never as ungoverned', (_name, marker) => {
    const state = readGovernanceMarker({ [GOVERNANCE_MARKER_FIELD]: marker })
    expect(state.kind).toBe('malformed')
  })
})

describe('checkGovernedInstallPolicy', () => {
  function governedInstall(
    name: string,
    opts: { signer: Signer; envelope?: string | null; payload?: Record<string, unknown> }
  ): { installPath: string; [key: string]: unknown } {
    const installPath = path.join(root, name)
    const envelope =
      opts.envelope === undefined
        ? makeEnvelope(opts.signer, opts.payload ?? makePayload())
        : opts.envelope
    writeInstallTree(installPath, {
      constants: {
        required: true,
        buildIdentity: BUILD_IDENTITY,
        publicKey: opts.signer.publicKey
      },
      envelope
    })
    return {
      installPath,
      [GOVERNANCE_MARKER_FIELD]: {
        governanceMarkerVersion: 1,
        governed: true,
        expectedBuildIdentity: BUILD_IDENTITY,
        publicKey: opts.signer.publicKey,
        activeForms: ['customNode', 'model'],
        customNodeMode: 'allowlist'
      }
    }
  }

  it('is a no-op for an install with no marker', async () => {
    const installPath = path.join(root, 'plain')
    writeInstallTree(installPath, { constants: null })
    expect(await checkGovernedInstallPolicy({ installPath })).toEqual({ ok: true })
  })

  it('passes a governed install whose envelope verifies', async () => {
    const signer = makeSigner()
    expect(await checkGovernedInstallPolicy(governedInstall('ok', { signer }))).toEqual({
      ok: true
    })
  })

  it('rejects an oversized policy without reading beyond the envelope limit', async () => {
    const signer = makeSigner()
    const install = governedInstall('oversized', { signer })
    fs.writeFileSync(governancePolicyPath(install.installPath), Buffer.alloc(1024 * 1024 + 2, 0x20))

    await expect(
      verifyInstalledGovernancePolicy(install.installPath, {
        publicKey: signer.publicKey,
        buildIdentity: BUILD_IDENTITY
      })
    ).resolves.toEqual({ ok: false, reason: 'envelope too large' })
  })

  it('refuses when the envelope was deleted, stating the policy', async () => {
    const signer = makeSigner()
    const install = governedInstall('deleted', { signer })
    fs.rmSync(governancePolicyPath(install.installPath))

    const result = await checkGovernedInstallPolicy(install)

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('managed ComfyUI installation')
    expect(result.ok === false && result.message).toContain('contact your administrator')
  })

  it('refuses when one signature byte is flipped', async () => {
    const signer = makeSigner()
    const install = governedInstall('tampered', { signer })
    const policy = governancePolicyPath(install.installPath)
    const parsed = JSON.parse(fs.readFileSync(policy, 'utf-8')) as Record<string, string>
    const signature = Buffer.from(parsed.signature!, 'base64url')
    signature[7] = signature[7]! ^ 0x01
    fs.writeFileSync(policy, JSON.stringify({ ...parsed, signature: base64url(signature) }))

    expect(await checkGovernedInstallPolicy(install)).toMatchObject({ ok: false })
  })

  it('refuses a marker that is present but malformed', async () => {
    const signer = makeSigner()
    const install = governedInstall('malformed', { signer })
    const result = await checkGovernedInstallPolicy({
      ...install,
      [GOVERNANCE_MARKER_FIELD]: { governanceMarkerVersion: 1, governed: true }
    })
    expect(result).toMatchObject({ ok: false })
  })
})

describe('governedModelDigests', () => {
  it('exposes the verified payload model set for the ledger writer', async () => {
    const signer = makeSigner()
    const installPath = path.join(root, 'digests')
    writeInstallTree(installPath, {
      constants: { required: true, buildIdentity: BUILD_IDENTITY, publicKey: signer.publicKey },
      envelope: makeEnvelope(signer, makePayload())
    })

    const digests = await governedModelDigests({
      installPath,
      [GOVERNANCE_MARKER_FIELD]: {
        governanceMarkerVersion: 1,
        governed: true,
        expectedBuildIdentity: BUILD_IDENTITY,
        publicKey: signer.publicKey,
        activeForms: ['model'],
        customNodeMode: null
      }
    })

    expect(digests && [...digests].sort()).toEqual([...MODEL_DIGESTS].sort())
  })

  it('returns null for an ungoverned install', async () => {
    expect(await governedModelDigests({ installPath: root })).toBeNull()
  })
})
