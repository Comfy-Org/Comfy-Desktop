import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'launcher-test'),
    isPackaged: false,
    on: () => {}
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

const { createAssetsTap, ASSETS_EVENT_LINE, ALLOWED_EVENTS, ALLOWED_FIELDS } =
  await import('./assetsTap')
const telemetry = await import('./telemetry')

// Resolved against cwd (not import.meta.url, which happy-dom can mangle) — the
// same idiom ProgressModal.test.ts uses for reading a source file.
const FIXTURE_PATH = path.resolve('src/main/lib/__fixtures__/assets-event-lines.txt')

/** The core-side event names this tap is willing to forward. */
const CORE_EVENTS = [
  'assets.enabled',
  'seeder.scan_started',
  'seeder.scan_completed',
  'seeder.scan_failed',
  'seeder.scan_cancelled',
  'seeder.marked_missing',
  'seeder.batch_insert_failed',
  'scanner.hash_failed',
  'scanner.enrich_failed',
  'scanner.hash_discarded_modified',
  'scanner.fast_scan_failed',
  'scanner.temp_sync_failed',
  'scanner.mark_missing_failed',
  'ingest.register_output_failed',
  'ingest.discard_orphan_failed',
  'api.request_failed'
]

const COUNTER_FIELDS = [
  'elapsed_ms',
  'created',
  'enriched',
  'skipped',
  'marked_missing',
  'hash_failed',
  'enrich_failed',
  'permission_denied',
  'count'
]

/**
 * VALIDATOR PARITY MATRIX. Mirrors `VALID_VALUES` / the rejection cases in
 * ComfyUI `tests-unit/assets_test/test_event_log.py`; the two sides must agree
 * field for field or a core event silently stops reaching PostHog.
 */
const FIELD_MATRIX: Array<{ field: string; valid: unknown[]; invalid: unknown[] }> = [
  {
    field: 'root',
    valid: ['models', 'input', 'output', 'user', 'temp'],
    invalid: ['Models', 'checkpoints', 'models/sub', '', 1, true, null]
  },
  {
    field: 'phase',
    valid: ['fast', 'enrich', 'full'],
    invalid: ['Fast', 'partial', 'slow', 0, false, null]
  },
  {
    field: 'stage',
    valid: ['mark_missing', 'pruning', 'fast_scan', 'enrich', 'finalize'],
    invalid: ['MARK_MISSING', 'start', 'scan', 3, null]
  },
  {
    field: 'route',
    valid: [
      'get_asset_route',
      'upload_asset',
      'update_asset_route',
      'delete_asset_route',
      'add_asset_tags',
      'delete_asset_tags',
      'parse_multipart_upload'
    ],
    invalid: ['get_asset', 'GET_ASSET_ROUTE', '/api/assets/upload', 7, null]
  },
  {
    field: 'size_bucket',
    valid: ['lt_1m', 'lt_100m', 'lt_1g', 'ge_1g'],
    invalid: ['lt_10m', 'huge', 'LT_1M', 1024, null]
  },
  ...COUNTER_FIELDS.map((field) => ({
    field,
    valid: [0, 12, 8123, -1],
    invalid: [1.5, '12', true, false, null, 'many']
  })),
  {
    field: 'error_type',
    valid: ['ValueError', 'FileNotFoundError', 'OSError'],
    invalid: [
      'FileNotFoundError: /home/x/model.safetensors',
      'a/b',
      'a\\b',
      'a:b',
      'E'.repeat(65),
      12,
      true,
      null
    ]
  },
  {
    // `hashing_enabled` must reject the number 1: core checks bool BEFORE int
    // because bool subclasses int in Python, and the mirror has to be as tight.
    field: 'hashing_enabled',
    valid: [true, false],
    invalid: [1, 0, 'true', 'false', null]
  }
]

const BASE_CONTEXT_KEYS = ['installation_id', 'variant', 'release', 'core_beta_flags']

function taggedLine(event: string, fields: Record<string, unknown>): string {
  return `[assets-event] ${event} ${JSON.stringify(fields)}\n`
}

describe('assetsTap', () => {
  let captured: Array<{ event: string; ctx: Record<string, unknown> }>

  const baseOpts = {
    installationId: 'inst-1',
    variant: 'desktop',
    release: '1.0.47-rc.1',
    coreBetaFlags: ['--enable-assets']
  }

  beforeEach(() => {
    captured = []
    vi.spyOn(telemetry, 'emit').mockImplementation((event, ctx) => {
      captured.push({ event, ctx: ctx as Record<string, unknown> })
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('the shared cross-repo line grammar', () => {
    it('exposes an event allowlist that is exactly the core call-site vocabulary', () => {
      expect([...ALLOWED_EVENTS].sort()).toEqual([...CORE_EVENTS].sort())
    })

    it('exposes a field allowlist that is exactly PR C ALLOWED_FIELDS', () => {
      expect(Object.keys(ALLOWED_FIELDS).sort()).toEqual(
        [
          'root',
          'phase',
          'stage',
          'route',
          'size_bucket',
          ...COUNTER_FIELDS,
          'error_type',
          'hashing_enabled'
        ].sort()
      )
    })

    it('matches the tag, event and JSON object as three parts', () => {
      const m = '[assets-event] seeder.scan_started {"phase":"fast"}'.match(ASSETS_EVENT_LINE)
      expect(m?.[1]).toBe('seeder.scan_started')
      expect(m?.[2]).toBe('{"phase":"fast"}')
    })
  })

  describe('the shared fixture file', () => {
    const raw = fs.readFileSync(FIXTURE_PATH, 'utf8')
    const lines = raw.split('\n').filter((line) => line.length > 0)

    it('holds three newline-terminated lines with no CRLF', () => {
      expect(lines).toHaveLength(3)
      expect(raw.endsWith('\n')).toBe(true)
      expect(raw).not.toContain('\r')
    })

    it.each(lines)('parses and emits %s', (line) => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(`${line}\n`, 'stdout')
      expect(captured).toHaveLength(1)
      const event = line.match(ASSETS_EVENT_LINE)![1]!
      expect(captured[0]!.event).toBe(`comfy.desktop.comfyui.assets.${event}`)
      expect(captured[0]!.ctx).toMatchObject(JSON.parse(line.match(ASSETS_EVENT_LINE)![2]!))
    })

    it('rejects a fixture line mutated to carry a path-ish root', () => {
      const mutated = lines[0]!.replace('"root":"models"', '"root":"models/checkpoints"')
      const tap = createAssetsTap(baseOpts)
      tap.ingest(`${mutated}\n`, 'stdout')
      expect(captured).toHaveLength(0)
    })
  })

  describe('accepted lines', () => {
    it('emits one namespaced event merging the trusted base context', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('seeder.scan_completed', { root: 'models', created: 12 }), 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.event).toBe('comfy.desktop.comfyui.assets.seeder.scan_completed')
      expect(captured[0]!.ctx).toEqual({
        installation_id: 'inst-1',
        variant: 'desktop',
        release: '1.0.47-rc.1',
        core_beta_flags: ['--enable-assets'],
        root: 'models',
        created: 12
      })
    })

    it('defaults the optional base context fields', () => {
      const tap = createAssetsTap({ installationId: 'inst-2' })
      tap.ingest(taggedLine('assets.enabled', { hashing_enabled: true }), 'stdout')
      expect(captured[0]!.ctx).toEqual({
        installation_id: 'inst-2',
        variant: null,
        release: null,
        core_beta_flags: [],
        hashing_enabled: true
      })
    })

    it('handles the bundled build\u2019s [INFO] prefix and ANSI colour', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(
        `\u001b[32m[INFO]\u001b[0m ${taggedLine('seeder.scan_started', { phase: 'fast' })}`,
        'stdout'
      )
      tap.ingest(`[INFO] ${taggedLine('seeder.scan_started', { phase: 'enrich' })}`, 'stderr')
      expect(captured).toHaveLength(2)
      expect(captured[0]!.ctx).toMatchObject({ phase: 'fast' })
      expect(captured[1]!.ctx).toMatchObject({ phase: 'enrich' })
    })

    it('accepts an event carrying no fields at all', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('scanner.hash_discarded_modified', {}), 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toEqual({
        installation_id: 'inst-1',
        variant: 'desktop',
        release: '1.0.47-rc.1',
        core_beta_flags: ['--enable-assets']
      })
    })
  })

  describe('rejected lines', () => {
    it('ignores untagged lines and scanner warnings that carry paths', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('Total VRAM 24576 MB, total RAM 65461 MB\n', 'stdout')
      tap.ingest(
        '[WARNING] Failed to hash /home/simon/models/sd_xl_base_1.0.safetensors: [Errno 13] Permission denied\n',
        'stderr'
      )
      tap.ingest('[assets-event]seeder.scan_started {"phase":"fast"}\n', 'stdout')
      tap.ingest('prefix [assets-event] seeder.scan_started {"phase":"fast"}\n', 'stdout')
      tap.ingest('[assets-event] seeder.scan_started {"phase":"fast"} trailing\n', 'stdout')
      expect(captured).toHaveLength(0)
    })

    it('rejects an event name outside the allowlist', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('seeder.scan_exploded', { phase: 'fast' }), 'stdout')
      tap.ingest(taggedLine('evil.exfiltrate', { count: 1 }), 'stdout')
      expect(captured).toHaveLength(0)
    })

    it('rejects a syntactically valid but unknown field', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(
        taggedLine('seeder.scan_completed', { phase: 'fast', file_path: 'model' }),
        'stdout'
      )
      expect(captured).toHaveLength(0)
    })

    it('rejects a key colliding with an emitted base-context property', () => {
      const tap = createAssetsTap(baseOpts)
      for (const key of BASE_CONTEXT_KEYS) {
        tap.ingest(taggedLine('seeder.scan_started', { [key]: 'spoofed' }), 'stdout')
      }
      expect(captured).toHaveLength(0)

      // And the base context of a later, legitimate line is untouched.
      tap.ingest(taggedLine('seeder.scan_started', { phase: 'fast' }), 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject({
        installation_id: 'inst-1',
        variant: 'desktop',
        release: '1.0.47-rc.1',
        core_beta_flags: ['--enable-assets']
      })
    })

    it('keeps the field vocabulary disjoint from the base context', () => {
      expect(Object.keys(ALLOWED_FIELDS).filter((key) => BASE_CONTEXT_KEYS.includes(key))).toEqual(
        []
      )
    })

    it('rejects a base-context collision the field allowlist would otherwise admit', () => {
      // The two vocabularies are disjoint today, so the collision guard is only
      // reachable once they overlap. Simulate that future to prove the guard —
      // not the field allowlist — is what rejects a context-spoofing line.
      const vocabulary = ALLOWED_FIELDS as Record<string, (value: unknown) => boolean>
      vocabulary['installation_id'] = () => true
      try {
        const tap = createAssetsTap(baseOpts)
        tap.ingest(taggedLine('seeder.scan_started', { installation_id: 'spoofed' }), 'stdout')
        expect(captured).toHaveLength(0)
      } finally {
        delete vocabulary['installation_id']
      }
    })

    it('rejects keys with uppercase, digits or dashes before the allowlist is consulted', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_started {"Phase":"fast"}\n', 'stdout')
      tap.ingest('[assets-event] seeder.scan_started {"phase2":"fast"}\n', 'stdout')
      tap.ingest('[assets-event] seeder.scan_started {"phase-x":"fast"}\n', 'stdout')
      expect(captured).toHaveLength(0)
    })

    it('rejects a value containing a path separator or a colon', () => {
      const tap = createAssetsTap(baseOpts)
      for (const value of [
        'FileNotFoundError: /home/x/model.safetensors',
        '/home/x',
        'C:\\models',
        'a\\b'
      ]) {
        tap.ingest(taggedLine('api.request_failed', { error_type: value }), 'stdout')
      }
      expect(captured).toHaveLength(0)
    })

    it('rejects an oversized string value', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('api.request_failed', { error_type: 'E'.repeat(65) }), 'stdout')
      expect(captured).toHaveLength(0)
      tap.ingest(taggedLine('api.request_failed', { error_type: 'E'.repeat(64) }), 'stdout')
      expect(captured).toHaveLength(1)
    })

    it('rejects a non-object JSON payload and a nested object value', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_started {"phase":{"nested":"fast"}}\n', 'stdout')
      tap.ingest('[assets-event] seeder.scan_started {"count":[1,2]}\n', 'stdout')
      expect(captured).toHaveLength(0)
    })

    it('rejects the whole line when only one of several fields is bad', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(
        taggedLine('seeder.scan_completed', { phase: 'fast', root: 'models', created: 'twelve' }),
        'stdout'
      )
      expect(captured).toHaveLength(0)
    })
  })

  describe('validator parity matrix', () => {
    it.each(FIELD_MATRIX)('accepts every valid $field value', ({ field, valid }) => {
      const tap = createAssetsTap(baseOpts)
      for (const value of valid) {
        tap.ingest(taggedLine('seeder.scan_completed', { [field]: value }), 'stdout')
      }
      expect(captured).toHaveLength(valid.length)
      expect(captured.map((entry) => entry.ctx[field])).toEqual(valid)
    })

    it.each(FIELD_MATRIX)('rejects every invalid $field value', ({ field, invalid }) => {
      const tap = createAssetsTap(baseOpts)
      for (const value of invalid) {
        tap.ingest(taggedLine('seeder.scan_completed', { [field]: value }), 'stdout')
      }
      expect(captured).toHaveLength(0)
    })
  })

  describe('per-event rate cap', () => {
    it('caps one event at 60 per hour and resets the window after an hour', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-09-03T10:00:00Z'))
      const tap = createAssetsTap(baseOpts)
      for (let i = 0; i < 70; i++) {
        tap.ingest(taggedLine('seeder.scan_started', { phase: 'fast' }), 'stdout')
      }
      expect(captured).toHaveLength(60)

      vi.advanceTimersByTime(59 * 60_000)
      tap.ingest(taggedLine('seeder.scan_started', { phase: 'fast' }), 'stdout')
      expect(captured).toHaveLength(60)

      vi.advanceTimersByTime(60_000)
      tap.ingest(taggedLine('seeder.scan_started', { phase: 'fast' }), 'stdout')
      expect(captured).toHaveLength(61)
    })

    it('keeps the caps independent per event name', () => {
      const tap = createAssetsTap(baseOpts)
      for (let i = 0; i < 70; i++) {
        tap.ingest(taggedLine('seeder.scan_started', { phase: 'fast' }), 'stdout')
      }
      tap.ingest(taggedLine('api.request_failed', { error_type: 'ValueError' }), 'stdout')
      expect(captured.filter((c) => c.event.endsWith('seeder.scan_started'))).toHaveLength(60)
      expect(captured.filter((c) => c.event.endsWith('api.request_failed'))).toHaveLength(1)
    })
  })

  describe('stream buffering', () => {
    it('handles a line split across chunk boundaries', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_com', 'stdout')
      tap.ingest('pleted {"created":12,', 'stdout')
      tap.ingest('"phase":"fast"}\n', 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject({ created: 12, phase: 'fast' })
    })

    it('keeps stdout and stderr partial lines from splicing together', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_started ', 'stdout')
      tap.ingest('unrelated stderr noise\n', 'stderr')
      tap.ingest('{"phase":"fast"}\n', 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject({ phase: 'fast' })
    })

    it('flushes a trailing unterminated line on flushSummary', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_started {"phase":"full"}', 'stdout')
      expect(captured).toHaveLength(0)
      tap.flushSummary()
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject({ phase: 'full' })
    })

    it('drops an oversized unterminated line and keeps the stream working', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_started {"phase":"fast"} ', 'stdout')
      tap.ingest('A'.repeat(20_000), 'stdout')
      tap.ingest('B'.repeat(20_000), 'stdout')
      tap.ingest('\n', 'stdout')
      expect(captured).toHaveLength(0)
      tap.ingest(taggedLine('seeder.scan_started', { phase: 'fast' }), 'stdout')
      expect(captured).toHaveLength(1)
    })

    it('splits a chunk carrying many complete lines rather than capping them away', () => {
      const tap = createAssetsTap(baseOpts)
      const line = taggedLine('seeder.scan_started', { phase: 'fast' })
      tap.ingest(`${'A'.repeat(20_000)}\n${line.repeat(3)}`, 'stdout')
      expect(captured).toHaveLength(3)
    })
  })

  describe('beginBoot', () => {
    it('clears pending line buffers', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_started ', 'stdout')
      tap.beginBoot()
      tap.ingest('{"phase":"fast"}\n', 'stdout')
      expect(captured).toHaveLength(0)
    })

    it('does NOT reset the per-event rate buckets', () => {
      const tap = createAssetsTap(baseOpts)
      for (let i = 0; i < 60; i++) {
        tap.ingest(taggedLine('seeder.scan_started', { phase: 'fast' }), 'stdout')
      }
      tap.beginBoot()
      tap.ingest(taggedLine('seeder.scan_started', { phase: 'fast' }), 'stdout')
      expect(captured).toHaveLength(60)
    })
  })

  describe('no-throw contract', () => {
    it('contains a malformed newline-terminated JSON line', () => {
      const tap = createAssetsTap(baseOpts)
      expect(() =>
        tap.ingest('[assets-event] seeder.scan_started {"phase":"fast"\n', 'stdout')
      ).not.toThrow()
      tap.ingest(taggedLine('seeder.scan_started', { phase: 'fast' }), 'stdout')
      expect(captured).toHaveLength(1)
    })

    it('contains malformed buffered JSON hit by flushSummary', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_started {"phase":', 'stdout')
      expect(() => tap.flushSummary()).not.toThrow()
      expect(captured).toHaveLength(0)
      tap.ingest(taggedLine('seeder.scan_started', { phase: 'fast' }), 'stdout')
      expect(captured).toHaveLength(1)
    })

    it('contains a telemetry.emit failure, in ingest and in flushSummary', () => {
      let calls = 0
      vi.spyOn(telemetry, 'emit').mockImplementation((event, ctx) => {
        calls++
        if (calls <= 2) throw new Error('posthog exploded')
        captured.push({ event, ctx: ctx as Record<string, unknown> })
      })
      const tap = createAssetsTap(baseOpts)
      expect(() =>
        tap.ingest(taggedLine('seeder.scan_started', { phase: 'fast' }), 'stdout')
      ).not.toThrow()

      tap.ingest('[assets-event] seeder.scan_started {"phase":"enrich"}', 'stdout')
      expect(() => tap.flushSummary()).not.toThrow()

      expect(captured).toHaveLength(0)
      tap.ingest(taggedLine('seeder.scan_started', { phase: 'full' }), 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject({ phase: 'full' })
    })

    it('keeps processing later lines in the same chunk after a bad one', () => {
      const tap = createAssetsTap(baseOpts)
      const chunk = [
        '[assets-event] seeder.scan_started {"phase":"fast"',
        '[assets-event] seeder.scan_started {"phase":"enrich"}',
        ''
      ].join('\n')
      tap.ingest(chunk, 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject({ phase: 'enrich' })
    })
  })
})
