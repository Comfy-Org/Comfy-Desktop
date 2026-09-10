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

const { createAssetsTap, ASSETS_EVENT_LINE, ALLOWED_EVENTS, ALLOWED_FIELD_NAMES } =
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
  'scanner.stat_failed'
]

const COUNTER_FIELDS = [
  'elapsed_ms',
  'created',
  'enriched',
  'skipped',
  'hash_failed',
  'enrich_failed',
  'permission_denied',
  'count'
]

type LogfmtValue = boolean | number | string

const FIELD_VALUES: Array<{ field: string; value: LogfmtValue }> = [
  { field: 'root', value: 'models' },
  { field: 'phase', value: 'none' },
  { field: 'stage', value: 'finalize' },
  { field: 'site', value: 'discovery' },
  ...COUNTER_FIELDS.map((field) => ({
    field,
    value: 7
  })),
  { field: 'error_type', value: 'ValueError' },
  { field: 'hashing_enabled', value: true }
]

const BASE_CONTEXT_KEYS = ['installation_id', 'variant', 'release', 'core_beta_flags']

function taggedLine(event: string, fields: Readonly<Record<string, LogfmtValue>>): string {
  const tail = Object.entries(fields)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${typeof value === 'boolean' ? String(value) : value}`)
    .join(' ')
  return `[assets-event] ${event}${tail ? ` ${tail}` : ''}\n`
}

/**
 * Makes the `phase` membership lookup throw. Set membership keeps prototype
 * keys safe, so the per-line fault isolation needs its own throw to be proven.
 * Undone by the `vi.restoreAllMocks()` in `afterEach`.
 */
function withExplodingPhaseLookup(): void {
  const fieldNames = new Set(ALLOWED_FIELD_NAMES)
  vi.spyOn(ALLOWED_FIELD_NAMES, 'has').mockImplementation((key) => {
    if (key === 'phase') throw new Error('field lookup exploded')
    return fieldNames.has(key)
  })
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

    it('exposes a field-name allowlist that is exactly PR C ALLOWED_FIELDS', () => {
      expect([...ALLOWED_FIELD_NAMES].sort()).toEqual(
        [
          'root',
          'phase',
          'stage',
          'site',
          ...COUNTER_FIELDS,
          'error_type',
          'hashing_enabled'
        ].sort()
      )
    })

    it('matches the event and logfmt tail as separate parts', () => {
      const m = '[assets-event] seeder.scan_started phase=fast'.match(ASSETS_EVENT_LINE)
      expect(m?.[1]).toBe('seeder.scan_started')
      expect(m?.[2]).toBe(' phase=fast')
    })
  })

  describe('the shared fixture file', () => {
    const raw = fs.readFileSync(FIXTURE_PATH, 'utf8')
    const lines = raw.split('\n').filter((line) => line.length > 0)
    const fixtureCases = [
      {
        line: lines[0]!,
        event: 'seeder.scan_completed',
        fields: {
          created: 12,
          elapsed_ms: 8123,
          enrich_failed: 0,
          enriched: 4,
          hash_failed: 2,
          permission_denied: 0,
          phase: 'fast',
          root: 'models',
          skipped: 3
        }
      },
      {
        line: lines[1]!,
        event: 'seeder.scan_started',
        fields: { phase: 'enrich' }
      },
      {
        line: lines[2]!,
        event: 'scanner.stat_failed',
        fields: { error_type: 'PermissionError', site: 'discovery' }
      }
    ]

    it('holds three newline-terminated lines with no CRLF', () => {
      expect(lines).toHaveLength(3)
      expect(raw.endsWith('\n')).toBe(true)
      expect(raw).not.toContain('\r')
    })

    it.each(fixtureCases)('parses and emits $line', ({ line, event, fields }) => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(`${line}\n`, 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.event).toBe(`comfy.desktop.comfyui.assets.${event}`)
      expect(captured[0]!.ctx).toMatchObject(fields)
    })

    it('rejects a fixture line mutated to carry a path-ish root', () => {
      const mutated = lines[0]!.replace('root=models', 'root=models/checkpoints')
      const tap = createAssetsTap(baseOpts)
      tap.ingest(`${mutated}\n`, 'stdout')
      expect(captured).toHaveLength(0)
    })
  })

  describe('accepted lines', () => {
    it('coerces an integer field to a number', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_completed created=12\n', 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx.created).toBe(12)
    })

    it('coerces a boolean field to a boolean', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] assets.enabled hashing_enabled=false\n', 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx.hashing_enabled).toBe(false)
    })

    it('keeps a string field as a string', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_started phase=fast\n', 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx.phase).toBe('fast')
    })

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

    it('accepts scanner.stat_failed carrying error_type and site', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(
        taggedLine('scanner.stat_failed', { error_type: 'PermissionError', site: 'discovery' }),
        'stdout'
      )
      expect(captured).toHaveLength(1)
      expect(captured[0]!.event).toBe('comfy.desktop.comfyui.assets.scanner.stat_failed')
      expect(captured[0]!.ctx).toMatchObject({ error_type: 'PermissionError', site: 'discovery' })
    })

    it('accepts an event carrying no fields at all', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] scanner.hash_discarded_modified\n', 'stdout')
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
    it('rejects duplicate fields', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_started phase=fast phase=enrich\n', 'stdout')
      expect(captured).toHaveLength(0)
    })

    it('ignores untagged lines and scanner warnings that carry paths', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('Total VRAM 24576 MB, total RAM 65461 MB\n', 'stdout')
      tap.ingest(
        '[WARNING] Failed to hash /home/simon/models/sd_xl_base_1.0.safetensors: [Errno 13] Permission denied\n',
        'stderr'
      )
      tap.ingest('[assets-event]seeder.scan_started phase=fast\n', 'stdout')
      tap.ingest('prefix [assets-event] seeder.scan_started phase=fast\n', 'stdout')
      tap.ingest('[assets-event] seeder.scan_started phase=fast trailing\n', 'stdout')
      expect(captured).toHaveLength(0)
    })

    it('rejects an event name outside the allowlist', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('seeder.scan_exploded', { phase: 'fast' }), 'stdout')
      tap.ingest(taggedLine('evil.exfiltrate', { count: 1 }), 'stdout')
      expect(captured).toHaveLength(0)
    })

    it('reports dropped unknown events as a bare count, never their names', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('seeder.scan_exploded', { phase: 'fast' }), 'stdout')
      tap.ingest(taggedLine('evil.exfiltrate', { count: 1 }), 'stdout')
      expect(captured).toHaveLength(0)

      tap.flushSummary()
      expect(captured).toHaveLength(1)
      expect(captured[0]!.event).toBe('comfy.desktop.comfyui.assets.unknown_events_dropped')
      expect(captured[0]!.ctx).toMatchObject({ count: 2 })
      expect(JSON.stringify(captured[0]!.ctx)).not.toContain('exfiltrate')
      expect(JSON.stringify(captured[0]!.ctx)).not.toContain('scan_exploded')
    })

    it('cannot have its dropped-event counter forged by a crafted line', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('unknown_events_dropped', { count: 999 }), 'stdout')
      expect(captured).toHaveLength(0)

      tap.flushSummary()
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject({ count: 1 })
    })

    it('stays silent on flush when no unknown event was seen', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('seeder.scan_started', { phase: 'fast' }), 'stdout')
      captured.length = 0
      tap.flushSummary()
      expect(captured).toHaveLength(0)
    })

    it('does not re-report the same dropped events on a second flush', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('seeder.scan_exploded', {}), 'stdout')
      tap.flushSummary()
      expect(captured).toHaveLength(1)
      captured.length = 0
      tap.flushSummary()
      expect(captured).toHaveLength(0)
    })

    it('drops an unknown field but keeps the event and its known fields', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(
        taggedLine('seeder.scan_completed', { phase: 'fast', file_path: 'model' }),
        'stdout'
      )
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject({ phase: 'fast' })
      expect(captured[0]!.ctx).not.toHaveProperty('file_path')
    })

    it('rejects a field name inherited from the allowlist\u2019s prototype', () => {
      // `constructor` is the one prototype key that clears the lowercase-only
      // FIELD_NAME filter and, against an object literal, resolves up the
      // prototype chain to a truthy *callable* returning a truthy value — so
      // the field sails through the allowlist gate and ships to PostHog.
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_started constructor=x\n', 'stdout')
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
      expect([...ALLOWED_FIELD_NAMES].filter((key) => BASE_CONTEXT_KEYS.includes(key))).toEqual([])
    })

    it('rejects a base-context collision the field allowlist would otherwise admit', () => {
      // The two vocabularies are disjoint today, so the collision guard is only
      // reachable once they overlap. Simulate that future to prove the guard —
      // not the field allowlist — is what rejects a context-spoofing line.
      // Routed through a local copy rather than written into the exported
      // vocabulary, which every other test in this file shares.
      const widened = new Set(ALLOWED_FIELD_NAMES)
      widened.add('installation_id')
      const lookup = vi
        .spyOn(ALLOWED_FIELD_NAMES, 'has')
        .mockImplementation((key) => widened.has(key))
      try {
        const tap = createAssetsTap(baseOpts)
        tap.ingest(taggedLine('seeder.scan_started', { installation_id: 'spoofed' }), 'stdout')
        expect(captured).toHaveLength(0)
      } finally {
        lookup.mockRestore()
      }
    })

    it('rejects keys with uppercase, digits or dashes before the allowlist is consulted', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_started Phase=fast\n', 'stdout')
      tap.ingest('[assets-event] seeder.scan_started phase2=fast\n', 'stdout')
      tap.ingest('[assets-event] seeder.scan_started phase-x=fast\n', 'stdout')
      expect(captured).toHaveLength(0)
    })

    it('rejects a value containing a forbidden string character', () => {
      const tap = createAssetsTap(baseOpts)
      for (const value of [
        'FileNotFoundError: /home/x/model.safetensors',
        '/home/x',
        'C:\\models',
        'a\\b',
        'two words',
        'phase=fast',
        'Type"Error'
      ]) {
        tap.ingest(taggedLine('seeder.scan_failed', { error_type: value }), 'stdout')
      }
      expect(captured).toHaveLength(0)
    })

    it('rejects an oversized string value', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('seeder.scan_failed', { error_type: 'E'.repeat(65) }), 'stdout')
      expect(captured).toHaveLength(0)
      tap.ingest(taggedLine('seeder.scan_failed', { error_type: 'E'.repeat(64) }), 'stdout')
      expect(captured).toHaveLength(1)
    })

    it('rejects oversized or path-bearing phase values through structural checks', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('seeder.scan_started', { phase: 'P'.repeat(65) }), 'stdout')
      tap.ingest(taggedLine('seeder.scan_started', { phase: 'fast/path' }), 'stdout')
      expect(captured).toHaveLength(0)
    })

    it('keeps a non-integer numeric-looking value as a string', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_completed count=1e400\n', 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx.count).toBe('1e400')
    })

    it('rejects the whole line when only one of several fields is bad', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(
        taggedLine('seeder.scan_completed', {
          phase: 'fast',
          root: 'models',
          created: 'twelve/path'
        }),
        'stdout'
      )
      expect(captured).toHaveLength(0)
    })
  })

  describe('field-name and structural validation', () => {
    it.each(FIELD_VALUES)('accepts a structurally safe $field value', ({ field, value }) => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('seeder.scan_completed', { [field]: value }), 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx[field]).toEqual(value)
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
      tap.ingest(taggedLine('seeder.scan_failed', { error_type: 'ValueError' }), 'stdout')
      expect(captured.filter((c) => c.event.endsWith('seeder.scan_started'))).toHaveLength(60)
      expect(captured.filter((c) => c.event.endsWith('seeder.scan_failed'))).toHaveLength(1)
    })
  })

  describe('stream buffering', () => {
    it('handles a line split across chunk boundaries', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_com', 'stdout')
      tap.ingest('pleted created=12 ', 'stdout')
      tap.ingest('phase=fast\n', 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject({ created: 12, phase: 'fast' })
    })

    it('keeps stdout and stderr partial lines from splicing together', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_started ', 'stdout')
      tap.ingest('unrelated stderr noise\n', 'stderr')
      tap.ingest('phase=fast\n', 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject({ phase: 'fast' })
    })

    it('flushes a trailing unterminated line on flushSummary', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_started phase=full', 'stdout')
      expect(captured).toHaveLength(0)
      tap.flushSummary()
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject({ phase: 'full' })
    })

    it('drops an oversized unterminated line and keeps the stream working', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_started phase=fast ', 'stdout')
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
      tap.ingest('phase=fast\n', 'stdout')
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
    it('contains a malformed newline-terminated logfmt line', () => {
      const tap = createAssetsTap(baseOpts)
      expect(() => tap.ingest('[assets-event] seeder.scan_started phase\n', 'stdout')).not.toThrow()
      tap.ingest(taggedLine('seeder.scan_started', { phase: 'fast' }), 'stdout')
      expect(captured).toHaveLength(1)
    })

    it('contains malformed buffered logfmt hit by flushSummary', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_started phase=', 'stdout')
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

      tap.ingest('[assets-event] seeder.scan_started phase=enrich', 'stdout')
      expect(() => tap.flushSummary()).not.toThrow()

      expect(captured).toHaveLength(0)
      tap.ingest(taggedLine('seeder.scan_started', { phase: 'full' }), 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject({ phase: 'full' })
    })

    it('keeps processing later lines in the same chunk after a bad one', () => {
      const tap = createAssetsTap(baseOpts)
      const chunk = [
        '[assets-event] seeder.scan_started phase',
        '[assets-event] seeder.scan_started phase=enrich',
        ''
      ].join('\n')
      tap.ingest(chunk, 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject({ phase: 'enrich' })
    })

    it('keeps processing later lines after a prototype-key field', () => {
      // Set membership rejects `__proto__` without consulting the prototype;
      // the later line must still be processed from the same chunk.
      const tap = createAssetsTap(baseOpts)
      const chunk = [
        '[assets-event] seeder.scan_started __proto__=1',
        '[assets-event] seeder.scan_started phase=enrich',
        ''
      ].join('\n')
      expect(() => tap.ingest(chunk, 'stdout')).not.toThrow()
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject({ phase: 'enrich' })
    })

    it('keeps processing later lines when field-name lookup throws', () => {
      withExplodingPhaseLookup()
      const tap = createAssetsTap(baseOpts)
      const chunk = [
        '[assets-event] seeder.scan_started phase=fast',
        '[assets-event] seeder.scan_completed count=3',
        ''
      ].join('\n')
      expect(() => tap.ingest(chunk, 'stdout')).not.toThrow()
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject({ count: 3 })
    })

    it('flushes the stderr tail even when the stdout tail throws', () => {
      withExplodingPhaseLookup()
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_started phase=fast', 'stdout')
      tap.ingest('[assets-event] seeder.scan_completed count=3', 'stderr')
      expect(() => tap.flushSummary()).not.toThrow()
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject({ count: 3 })
    })
  })
})
