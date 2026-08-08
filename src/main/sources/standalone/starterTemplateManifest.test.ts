import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as FsModule from 'fs'

const getOpsFlagPayload = vi.fn()
const capture = vi.fn()
vi.mock('../../lib/telemetry', () => ({
  getOpsFlagPayload: (...args: unknown[]) => getOpsFlagPayload(...args),
  capture: (...args: unknown[]) => capture(...args)
}))

const readFileSync = vi.fn()
const writeFileSafe = vi.fn()
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof FsModule>()
  const patched = { ...actual, readFileSync: (...a: unknown[]) => readFileSync(...a) }
  return { ...patched, default: patched }
})
vi.mock('../../lib/safe-file', () => ({ writeFileSafe: (...a: unknown[]) => writeFileSafe(...a) }))
vi.mock('../../lib/paths', () => ({ dataDir: () => '/tmp/does-not-exist' }))

import {
  parseStarterTemplateManifest,
  initStarterTemplates,
  getStarterTemplatesAsync,
  STARTER_TEMPLATES_FLAG_KEY,
  _resetForTest
} from './starterTemplateManifest'
import { CURATED_TEMPLATES } from './curatedTemplates'

function doc(templates: unknown[]): Record<string, unknown> {
  return { schemaVersion: 1, templates }
}

const VALID_IMAGE = { id: 'image_one', modality: 'image' }

function entriesOf(raw: unknown): { id: string; modality: string }[] {
  const parsed = parseStarterTemplateManifest(raw)
  return (parsed ?? []).map((e) => ({ id: e.id, modality: e.modality }))
}

beforeEach(() => {
  _resetForTest()
  getOpsFlagPayload.mockReset()
  capture.mockReset()
  readFileSync.mockReset()
  writeFileSafe.mockReset()
  readFileSync.mockImplementation(() => {
    throw new Error('ENOENT')
  })
})

describe('payload parsing', () => {
  it('parses the escaped-JSON-string form production actually returns', () => {
    const raw = JSON.stringify(doc([VALID_IMAGE]))
    expect(entriesOf(raw), 'the escaped-string shape production returns').toEqual([
      { id: 'image_one', modality: 'image' }
    ])
  })

  it('parses the already-parsed object form', () => {
    expect(entriesOf(doc([VALID_IMAGE]))).toEqual([{ id: 'image_one', modality: 'image' }])
  })

  it('returns null (not a throw) when the string is not valid JSON', () => {
    expect(parseStarterTemplateManifest('{"schemaVersion":1,')).toBeNull()
    expect(parseStarterTemplateManifest('not json at all')).toBeNull()
  })

  it.each([[[]], ['"a string"'], [42], [null], [undefined], [true]])(
    'rejects a non-object root: %s',
    (root) => {
      expect(parseStarterTemplateManifest(root)).toBeNull()
    }
  )

  it.each([[undefined], [2], ['1'], [null], [0]])(
    'rejects schemaVersion %s wholesale',
    (schemaVersion) => {
      expect(parseStarterTemplateManifest({ schemaVersion, templates: [VALID_IMAGE] })).toBeNull()
    }
  )

  it.each([[undefined], [{}], ['nope'], [42]])('rejects templates: %s', (templates) => {
    expect(parseStarterTemplateManifest({ schemaVersion: 1, templates })).toBeNull()
  })

  it('accepts an explicitly empty list as valid-but-empty', () => {
    expect(parseStarterTemplateManifest(doc([])), 'a deliberate clear is not garbage').toEqual([])
  })

  it('ignores unknown top-level and per-entry fields', () => {
    const raw = {
      schemaVersion: 1,
      futureField: { nested: true },
      templates: [{ ...VALID_IMAGE, somethingNew: 'ignored', anotherOne: 5 }]
    }
    expect(entriesOf(raw)).toEqual([{ id: 'image_one', modality: 'image' }])
  })

  it('accepts but ignores minComfyUIVersion', () => {
    const parsed = parseStarterTemplateManifest(
      doc([{ ...VALID_IMAGE, minComfyUIVersion: '0.24.0' }])
    )
    expect(parsed).toHaveLength(1)
    expect(parsed![0], 'accepted for forward compat, never acted on').not.toHaveProperty(
      'minComfyUIVersion'
    )
  })

  it('handles a very large payload without hanging', () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ id: `image_${i}`, modality: 'image' }))
    expect(parseStarterTemplateManifest(doc(many))).toHaveLength(1000)
  })
})

describe('per-entry validation drops individually', () => {
  it.each([
    ['missing id', { modality: 'image' }],
    ['non-string id', { id: 42, modality: 'image' }],
    ['empty id', { id: '', modality: 'image' }],
    ['path traversal', { id: '../../etc/passwd', modality: 'image' }],
    ['slash', { id: 'a/b', modality: 'image' }],
    ['backslash', { id: 'a\\b', modality: 'image' }],
    ['space', { id: 'foo bar', modality: 'image' }],
    ['query', { id: 'foo?x=1', modality: 'image' }],
    ['skip sentinel', { id: 'none', modality: 'image' }],
    ['missing modality', { id: 'image_one' }],
    ['wrong case', { id: 'image_one', modality: 'Image' }],
    ['unknown modality', { id: 'image_one', modality: 'text' }],
    ['null entry', null],
    ['non-object entry', 'a string'],
    [
      'recommended + apiNode',
      { id: 'image_one', modality: 'image', recommended: true, apiNode: true }
    ]
  ])('drops %s while keeping a valid sibling', (_label, bad) => {
    const parsed = parseStarterTemplateManifest(doc([bad, { id: 'image_ok', modality: 'image' }]))
    expect(parsed).toHaveLength(1)
    expect(parsed![0]!.id).toBe('image_ok')
  })

  it('does not treat a truthy non-boolean as recommended', () => {
    const parsed = parseStarterTemplateManifest(
      doc([{ id: 'image_one', modality: 'image', recommended: 'yes' }])
    )
    expect(parsed).toHaveLength(1)
    expect(parsed![0]!.recommended).toBeUndefined()
  })

  it.each([[-1], [Number.NaN], [Number.POSITIVE_INFINITY], ['1000']])(
    'rejects a bad snapshot sizeBytes (%s) without dropping the entry',
    (sizeBytes) => {
      const parsed = parseStarterTemplateManifest(
        doc([
          {
            id: 'image_one',
            modality: 'image',
            snapshot: { title: 'T', description: 'D', sizeBytes, mediaSubtype: 'webp' }
          }
        ])
      )
      expect(parsed).toHaveLength(1)
      expect(parsed![0]!.snapshot).toBeUndefined()
    }
  )

  it('rejects snapshot strings carrying control characters', () => {
    const parsed = parseStarterTemplateManifest(
      doc([
        {
          id: 'image_one',
          modality: 'image',
          snapshot: {
            title: 'bad\u0007title',
            description: 'D',
            sizeBytes: 1,
            mediaSubtype: 'webp'
          }
        }
      ])
    )
    expect(parsed![0]!.snapshot).toBeUndefined()
  })

  it('caps absurdly long snapshot strings', () => {
    const parsed = parseStarterTemplateManifest(
      doc([
        {
          id: 'image_one',
          modality: 'image',
          snapshot: {
            title: 'x'.repeat(50_000),
            description: 'D',
            sizeBytes: 1,
            mediaSubtype: 'webp'
          }
        }
      ])
    )
    expect(parsed![0]!.snapshot).toBeUndefined()
  })

  it('keeps 3 good entries when 1 of 4 is malformed', () => {
    const parsed = parseStarterTemplateManifest(
      doc([
        { id: 'image_a', modality: 'image' },
        { id: 'image_b', modality: 'image' },
        { id: '../nope', modality: 'image' },
        { id: 'image_d', modality: 'image' }
      ])
    )
    expect(
      parsed!.map((e) => e.id),
      'one bad row must not take its siblings down'
    ).toEqual(['image_a', 'image_b', 'image_d'])
  })

  it('yields an empty modality rather than rejecting the document', () => {
    const parsed = parseStarterTemplateManifest(
      doc([
        { id: '../a', modality: 'image' },
        { id: 'video_ok', modality: 'video' }
      ])
    )
    expect(parsed!.map((e) => e.id)).toEqual(['video_ok'])
  })

  it('accepts a well-formed snapshot and preserves it', () => {
    const snapshot = { title: 'T', description: 'D', sizeBytes: 10, mediaSubtype: 'webp' }
    const parsed = parseStarterTemplateManifest(doc([{ ...VALID_IMAGE, snapshot }]))
    expect(parsed![0]!.snapshot).toEqual(snapshot)
  })

  it('preserves availability window fields when ISO-8601', () => {
    const parsed = parseStarterTemplateManifest(
      doc([{ ...VALID_IMAGE, availableFrom: '2026-01-01T00:00:00Z' }])
    )
    expect(parsed![0]!.availableFrom).toBe('2026-01-01T00:00:00Z')
  })

  it.each([['not-a-date'], [42], ['2026-13-45']])(
    'drops a malformed availability date (%s) without dropping the entry',
    (availableFrom) => {
      const parsed = parseStarterTemplateManifest(doc([{ ...VALID_IMAGE, availableFrom }]))
      expect(parsed).toHaveLength(1)
      expect(parsed![0]!.availableFrom).toBeUndefined()
    }
  )
})

describe('recommended / apiNode invariants at parse time', () => {
  it('keeps only the first recommended per modality', () => {
    const parsed = parseStarterTemplateManifest(
      doc([
        { id: 'image_a', modality: 'image', recommended: true },
        { id: 'image_b', modality: 'image', recommended: true },
        { id: 'video_a', modality: 'video', recommended: true }
      ])
    )
    expect(parsed!.filter((e) => e.recommended).map((e) => e.id)).toEqual(['image_a', 'video_a'])
  })

  it('never marks an apiNode entry as recommended', () => {
    const parsed = parseStarterTemplateManifest(
      doc([
        { id: 'api_x', modality: 'image', apiNode: true },
        { id: 'image_b', modality: 'image', recommended: true }
      ])
    )
    for (const entry of parsed!) {
      if (entry.apiNode) expect(entry.recommended).toBeFalsy()
    }
  })
})

describe('flag plumbing and fallback layers', () => {
  it('reads the desktop_starter_templates flag key', async () => {
    getOpsFlagPayload.mockResolvedValue(JSON.stringify(doc([VALID_IMAGE])))
    await initStarterTemplates({ distinctId: 'anon' })
    expect(STARTER_TEMPLATES_FLAG_KEY).toBe('desktop_starter_templates')
    expect(getOpsFlagPayload).toHaveBeenCalledWith(
      STARTER_TEMPLATES_FLAG_KEY,
      'anon',
      expect.any(Number)
    )
  })

  it('falls back to the baked-in list when the flag is absent', async () => {
    getOpsFlagPayload.mockResolvedValue(undefined)
    await initStarterTemplates({ distinctId: 'anon' })
    expect(await getStarterTemplatesAsync()).toEqual(CURATED_TEMPLATES)
  })

  it('falls back when the payload is wholly unusable', async () => {
    getOpsFlagPayload.mockResolvedValue('{ broken json')
    await initStarterTemplates({ distinctId: 'anon' })
    expect(await getStarterTemplatesAsync()).toEqual(CURATED_TEMPLATES)
  })

  it('falls back when the fetch rejects, without throwing', async () => {
    getOpsFlagPayload.mockRejectedValue(new Error('network'))
    await expect(initStarterTemplates({ distinctId: 'anon' })).resolves.toBeUndefined()
    expect(await getStarterTemplatesAsync()).toEqual(CURATED_TEMPLATES)
  })

  it('serves the payload list when the flag resolves', async () => {
    getOpsFlagPayload.mockResolvedValue(JSON.stringify(doc([VALID_IMAGE])))
    await initStarterTemplates({ distinctId: 'anon' })
    expect((await getStarterTemplatesAsync()).map((e) => e.id)).toEqual(['image_one'])
  })

  it('awaits the in-flight boot fetch rather than racing to the fallback', async () => {
    let release: (v: unknown) => void = () => {}
    getOpsFlagPayload.mockReturnValue(
      new Promise((r) => {
        release = r
      })
    )
    void initStarterTemplates({ distinctId: 'anon' })
    const pending = getStarterTemplatesAsync()
    release(JSON.stringify(doc([VALID_IMAGE])))
    expect((await pending).map((e) => e.id)).toEqual(['image_one'])
  })

  it('is idempotent within a process — one fetch regardless of callers', async () => {
    getOpsFlagPayload.mockResolvedValue(JSON.stringify(doc([VALID_IMAGE])))
    await Promise.all([
      initStarterTemplates({ distinctId: 'anon' }),
      initStarterTemplates({ distinctId: 'anon' })
    ])
    expect(getOpsFlagPayload).toHaveBeenCalledTimes(1)
  })

  it('serves a warm disk cache when the fetch fails', async () => {
    readFileSync.mockReturnValue(JSON.stringify(doc([{ id: 'cached_one', modality: 'image' }])))
    getOpsFlagPayload.mockResolvedValue(undefined)
    await initStarterTemplates({ distinctId: 'anon' })
    expect((await getStarterTemplatesAsync()).map((e) => e.id)).toEqual(['cached_one'])
  })

  it.each([
    ['corrupt JSON', '{ not json'],
    ['wrong schemaVersion', JSON.stringify({ schemaVersion: 99, templates: [VALID_IMAGE] })],
    ['tampered shape', JSON.stringify({ templates: 'nope' })]
  ])('%s in the disk cache is discarded', async (_label, contents) => {
    readFileSync.mockReturnValue(contents)
    getOpsFlagPayload.mockResolvedValue(undefined)
    await initStarterTemplates({ distinctId: 'anon' })
    expect(await getStarterTemplatesAsync()).toEqual(CURATED_TEMPLATES)
  })

  it('writes the disk cache after a successful parse', async () => {
    getOpsFlagPayload.mockResolvedValue(JSON.stringify(doc([VALID_IMAGE])))
    await initStarterTemplates({ distinctId: 'anon' })
    expect(writeFileSafe).toHaveBeenCalledTimes(1)
    const [, written] = writeFileSafe.mock.calls[0] as [string, string]
    expect(JSON.parse(written).templates[0].id).toBe('image_one')
  })

  it('survives a failing disk-cache write', async () => {
    writeFileSafe.mockImplementation(() => {
      throw new Error('EROFS')
    })
    getOpsFlagPayload.mockResolvedValue(JSON.stringify(doc([VALID_IMAGE])))
    await initStarterTemplates({ distinctId: 'anon' })
    expect((await getStarterTemplatesAsync()).map((e) => e.id)).toEqual(['image_one'])
  })

  it('captures no telemetry event while reading the payload', async () => {
    getOpsFlagPayload.mockResolvedValue(JSON.stringify(doc([VALID_IMAGE])))
    await initStarterTemplates({ distinctId: 'anon' })
    await getStarterTemplatesAsync()
    expect(capture, 'consent safety rests on this path never capturing').not.toHaveBeenCalled()
  })
})

describe('a known id must agree with its baked-in modality', () => {
  it('drops a baked-in id filed under the wrong tab', () => {
    const parsed = parseStarterTemplateManifest(
      doc([
        { id: 'image_z_image_turbo', modality: 'video' },
        { id: 'sdxlturbo_example', modality: 'image' }
      ])
    )
    expect(
      parsed!.map((e) => e.id),
      'a known id under the wrong tab is dropped'
    ).toEqual(['sdxlturbo_example'])
  })

  it('keeps every baked-in id under its own modality', () => {
    const parsed = parseStarterTemplateManifest(
      doc(CURATED_TEMPLATES.map((t) => ({ id: t.id, modality: t.modality })))
    )
    expect(parsed).toHaveLength(CURATED_TEMPLATES.length)
  })

  it('leaves an unknown id free to claim any modality', () => {
    const parsed = parseStarterTemplateManifest(
      doc([{ id: 'brand_new_template', modality: 'video' }])
    )
    expect(
      parsed!.map((e) => e.modality),
      'unknown ids may claim any modality'
    ).toEqual(['video'])
  })
})
