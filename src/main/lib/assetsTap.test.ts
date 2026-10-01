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
const { DATADOG_GLOBAL_CONTEXT_KEYS } = await import('../../shared/datadogMirroredEvents')

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
  'scanner.stat_failed',
  'scanner.invalid_mtime',
  'scanner.watch_stat_failed',
  'scanner.watch_spec_failed',
  'scanner.watch_seed_failed',
  'scanner.failure_bucket',
  'scanner.root_unreachable',
  'scanner.walk_failed',
  'scanner.metadata_failed'
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
  { field: 'phase', value: 'fast' },
  { field: 'stage', value: 'finalize' },
  { field: 'site', value: 'discovery' },
  ...COUNTER_FIELDS.map((field) => ({
    field,
    value: 7
  })),
  { field: 'error_type', value: 'ValueError' },
  { field: 'error_kind', value: 'database_locked' },
  { field: 'hashing_enabled', value: true },
  { field: 'reason', value: 'network_unavailable' },
  { field: 'errno_name', value: 'ESTALE' },
  { field: 'winerror', value: 53 },
  { field: 'exc_fp', value: '3f9a1c0b7d2e' },
  { field: 'exc_class', value: 'sqlite3.OperationalError' },
  { field: 'exc_site', value: 'assets.scanner.enrich_asset' },
  { field: 'exc_line', value: 184 }
]

/** Fields core added with its failure classification. */
const CLASSIFICATION_FIELDS = [
  'reason',
  'errno_name',
  'winerror',
  'exc_fp',
  'exc_class',
  'exc_site',
  'exc_line'
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
          'error_kind',
          'hashing_enabled',
          ...CLASSIFICATION_FIELDS
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
      },
      {
        line: lines[3]!,
        event: 'scanner.failure_bucket',
        fields: {
          count: 5000,
          errno_name: 'ESTALE',
          exc_class: 'OSError',
          exc_fp: '3f9a1c0b7d2e',
          exc_line: 184,
          exc_site: 'assets.scanner.observe_references_on_filesystem',
          reason: 'network_unavailable',
          site: 'reference',
          winerror: -1
        }
      }
    ]

    it('holds four newline-terminated lines with no CRLF', () => {
      expect(lines).toHaveLength(4)
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

    it.each([
      ['9007199254740991', 9007199254740991],
      ['-9007199254740991', -9007199254740991]
    ])('preserves the exact safe integer token %s', (rawValue, expectedValue) => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(`[assets-event] seeder.scan_completed created=${rawValue}\n`, 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx.created).toBe(expectedValue)
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

    it('accepts scanner.invalid_mtime carrying a batch count', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('scanner.invalid_mtime', { count: 5 }), 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.event).toBe('comfy.desktop.comfyui.assets.scanner.invalid_mtime')
      expect(captured[0]!.ctx).toMatchObject({ count: 5 })
    })

    it.each([
      'scanner.watch_stat_failed',
      'scanner.watch_spec_failed',
      'scanner.watch_seed_failed'
    ])('accepts %s carrying error_type', (event) => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine(event, { error_type: 'PermissionError' }), 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.event).toBe(`comfy.desktop.comfyui.assets.${event}`)
      expect(captured[0]!.ctx).toMatchObject({ error_type: 'PermissionError' })
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

    it('reports omitted enum values as a bare count, never the values', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(
        taggedLine('scanner.stat_failed', { reason: 'quantum_flux', site: 'warp_core' }),
        'stdout'
      )
      tap.ingest(taggedLine('scanner.hash_failed', { reason: 'quantum_flux' }), 'stdout')
      // A line rejected for another reason contributes nothing.
      tap.ingest(taggedLine('scanner.hash_failed', { reason: 'new_one', root: 'cache' }), 'stdout')
      expect(captured).toHaveLength(2)

      tap.flushSummary()
      expect(captured).toHaveLength(3)
      expect(captured[2]!.event).toBe('comfy.desktop.comfyui.assets.unknown_enum_values_omitted')
      expect(captured[2]!.ctx).toMatchObject({ count: 3 })
      const serialized = JSON.stringify(captured[2]!.ctx)
      for (const value of ['quantum_flux', 'warp_core', 'new_one']) {
        expect(serialized).not.toContain(value)
      }

      tap.flushSummary()
      expect(captured).toHaveLength(3)
    })

    it('cannot forge the omitted-enum counter with a crafted line', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('unknown_enum_values_omitted', { count: 999 }), 'stdout')
      tap.flushSummary()
      expect(captured.map((c) => c.ctx.count)).toEqual([1])
      expect(captured[0]!.event).toBe('comfy.desktop.comfyui.assets.unknown_events_dropped')
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

    it('omits a key colliding with a telemetry default property but keeps the event', () => {
      // Per-event fields win telemetry's merge over its defaults, and
      // `is_packaged` fits the `is_*` convention, so without this a forged
      // `is_packaged=false` would relabel a packaged build's event.
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('seeder.scan_completed', { is_packaged: false }), 'stdout')
      for (const key of telemetry.DEFAULT_EVENT_PROPERTY_NAMES) {
        if (key === 'installation_id') continue // base context: rejects the line
        tap.ingest(taggedLine('seeder.scan_completed', { phase: 'fast', [key]: 1 }), 'stdout')
      }
      expect(captured).toHaveLength(telemetry.DEFAULT_EVENT_PROPERTY_NAMES.size)
      for (const { ctx } of captured) {
        expect(ctx.is_packaged).toBeUndefined()
        for (const key of telemetry.DEFAULT_EVENT_PROPERTY_NAMES) {
          if (key !== 'installation_id') expect(ctx).not.toHaveProperty(key)
        }
      }
    })

    it('omits a key colliding with Datadog global context but keeps the event', () => {
      // Mirrored failure events reach datadogRum.addAction, where the action's
      // context wins over the renderer's global cohort context.
      const forged = {
        telemetry_enabled: false,
        has_launched_cloud: true,
        has_legacy_install: true,
        local_installation_count: 0
      }
      for (const key of Object.keys(forged)) expect(DATADOG_GLOBAL_CONTEXT_KEYS.has(key)).toBe(true)
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('scanner.walk_failed', { root: 'input', ...forged }), 'stdout')
      tap.ingest(taggedLine('scanner.walk_failed', { renderer_role: 'panel' }), 'stdout')
      expect(captured).toHaveLength(2)
      expect(captured[0]!.ctx.root).toBe('input')
      for (const { ctx } of captured) {
        for (const key of DATADOG_GLOBAL_CONTEXT_KEYS) expect(ctx).not.toHaveProperty(key)
      }
    })

    it('rejects a repeated reserved name that fits a convention, like any repeated convention name', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(
        '[assets-event] seeder.scan_completed cpu_ms=1 is_packaged=true is_packaged=false\n',
        'stdout'
      )
      tap.ingest(
        '[assets-event] scanner.walk_failed telemetry_enabled=true telemetry_enabled=true\n',
        'stdout'
      )
      expect(captured).toHaveLength(0)
    })

    it('omits a repeated reserved name outside the conventions, like any unknown field', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_completed cpu_ms=1 platform=a platform=b\n', 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx.cpu_ms).toBe(1)
      expect(captured[0]!.ctx).not.toHaveProperty('platform')
    })

    it('keeps the field vocabulary disjoint from the telemetry defaults and Datadog context', () => {
      expect(
        [...ALLOWED_FIELD_NAMES].filter(
          (key) =>
            telemetry.DEFAULT_EVENT_PROPERTY_NAMES.has(key) || DATADOG_GLOBAL_CONTEXT_KEYS.has(key)
        )
      ).toEqual([])
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

    // The line buffer splits on LF and CRLF, so only a lone CR can reach a
    // value through ingest; LF is rejected too, for parity with core.
    it('rejects a value carrying a lone carriage return', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_failed error_type=Value\rError\n', 'stdout')
      tap.ingest('[assets-event] seeder.scan_failed error_type=\rValueError\n', 'stdout')
      expect(captured).toHaveLength(0)
    })

    it('rejects a string value carrying a control or line-separator character', () => {
      const tap = createAssetsTap(baseOpts)
      for (const value of [
        'Value\tError',
        'Value\u0000Error',
        'Value\u2028Error',
        'Value\u0085Error'
      ]) {
        tap.ingest(taggedLine('seeder.scan_failed', { error_type: value }), 'stdout')
      }
      tap.ingest(taggedLine('scanner.stat_failed', { errno_name: 'E\u2029IO' }), 'stdout')
      expect(captured).toHaveLength(0)
    })

    it('rejects an oversized string value', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('seeder.scan_failed', { error_type: 'E'.repeat(65) }), 'stdout')
      expect(captured).toHaveLength(0)
      tap.ingest(taggedLine('seeder.scan_failed', { error_type: 'E'.repeat(64) }), 'stdout')
      expect(captured).toHaveLength(1)
    })

    it('rejects oversized or path-bearing phase values outside the enum', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('seeder.scan_started', { phase: 'P'.repeat(65) }), 'stdout')
      tap.ingest(taggedLine('seeder.scan_started', { phase: 'fast/path' }), 'stdout')
      expect(captured).toHaveLength(0)
    })

    it('rejects a non-integer numeric-looking value for an integer field', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_completed count=1e400\n', 'stdout')
      expect(captured).toHaveLength(0)
    })

    it.each(['9007199254740993', '-9007199254740993'])(
      'rejects the whole line for an integer token outside exact JS transport range: %s',
      (rawValue) => {
        const tap = createAssetsTap(baseOpts)
        tap.ingest(
          `[assets-event] seeder.scan_completed created=${rawValue} phase=fast\n`,
          'stdout'
        )
        expect(captured).toHaveLength(0)
      }
    )

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
    it.each(FIELD_VALUES)('accepts a valid $field value of the right type', ({ field, value }) => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('seeder.scan_completed', { [field]: value }), 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx[field]).toEqual(value)
    })

    it.each<[string, LogfmtValue]>([
      ['root', 1],
      ['phase', true],
      ['stage', 1],
      ['site', false],
      ...COUNTER_FIELDS.map((field): [string, LogfmtValue] => [field, true]),
      ['error_type', 404],
      ['hashing_enabled', 1],
      ['reason', 1],
      ['errno_name', true],
      ['winerror', 'ERROR_BAD_NETPATH'],
      ['exc_class', 1],
      ['exc_site', false],
      ['exc_line', 'top']
    ])('rejects $0 with a value of the wrong type', (field, value) => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('seeder.scan_completed', { [field]: value }), 'stdout')
      expect(captured).toHaveLength(0)
    })

    it.each([
      ['root', 'cache'],
      ['phase', 'none'],
      ['stage', 'scan'],
      ['reason', 'Other'],
      ['reason', 'no-space'],
      ['site', `w${'x'.repeat(64)}`]
    ])('rejects invalid enum value $1 for $0', (field, value) => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('seeder.scan_completed', { [field]: value }), 'stdout')
      expect(captured).toHaveLength(0)
    })

    // A newer core may add a reason or a call site; the event must survive it.
    it.each([
      ['site', 'finalize'],
      ['reason', 'disk_on_fire']
    ])('omits the unknown %s value %s but keeps the event', (field, value) => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(
        taggedLine('scanner.stat_failed', { error_type: 'OSError', [field]: value }),
        'stdout'
      )
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject({ error_type: 'OSError' })
      expect(captured[0]!.ctx).not.toHaveProperty(field)
    })

    it('still rejects a repeated extensible enum field whose first value was omitted', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] scanner.stat_failed site=future site=hash\n', 'stdout')
      expect(captured).toHaveLength(0)
    })

    it.each([
      ['errno_name', 'WSAECONNRESET'],
      ['errno_name', 'WSASYSNOTREADY'],
      ['errno_name', 'WSAHOST_NOT_FOUND'],
      ['errno_name', 'none'],
      ['winerror', 0],
      ['winerror', 65535],
      ['exc_class', 'ext'],
      ['exc_site', 'none'],
      ['exc_line', 0],
      ['site', 'seed_observation'],
      ['site', 'watch_seed']
    ])('accepts the boundary value $1 for $0', (field, value) => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('scanner.stat_failed', { [field]: value }), 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx[field]).toBe(value)
    })

    it.each<[string, LogfmtValue]>([
      ['errno_name', 'estale'],
      ['errno_name', 'EACCES1234567890ABCDEFGHI'],
      ['errno_name', 'ENOENT.x'],
      ['errno_name', 'NONE'],
      ['winerror', -2],
      ['winerror', 65536],
      ['exc_fp', '3f9a1c0b7d2'],
      ['exc_fp', '3f9a1c0b7d2ef'],
      ['exc_fp', '3F9A1C0B7D2E'],
      ['exc_fp', '3f9a1c0b7d2g'],
      ['exc_class', '1Error'],
      ['exc_class', 'Error-Type'],
      ['exc_class', `E${'x'.repeat(64)}`],
      ['exc_site', 'assets.scanner.<locals>'],
      ['exc_line', -1]
    ])('rejects the out-of-contract value $1 for $0', (field, value) => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('scanner.stat_failed', { [field]: value }), 'stdout')
      expect(captured).toHaveLength(0)
    })

    it('accepts failure_bucket scoped to a phase and a root', () => {
      const fields = { count: 3, phase: 'enrich', reason: 'locked', root: 'models', site: 'hash' }
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('scanner.failure_bucket', fields), 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject(fields)
    })

    // One fingerprint in about 280 is all decimal digits; coercing it to a
    // number would drop every line from that failure site.
    it('keeps an all-digit exc_fp as a string', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('scanner.stat_failed', { exc_fp: '012345678901' }), 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx.exc_fp).toBe('012345678901')
    })

    // Every event core sends through its failure classifier.
    it.each([
      ...CORE_EVENTS.filter((event) => event.endsWith('_failed')),
      'scanner.root_unreachable'
    ])('accepts the full classification on %s', (event) => {
      const fields = {
        error_type: 'OSError',
        reason: 'io_error',
        errno_name: 'EIO',
        winerror: -1,
        exc_fp: 'a1b2c3d4e5f6',
        exc_class: 'OSError',
        exc_site: 'assets.scanner.enrich_asset',
        exc_line: 12
      }
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine(event, fields), 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject(fields)
    })

    it('handles numeric-looking exception names according to their parsed type', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('seeder.scan_failed', { error_type: '404' }), 'stdout')
      tap.ingest(taggedLine('seeder.scan_failed', { error_type: 'Error404' }), 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx.error_type).toBe('Error404')
    })
  })

  describe('typed-field naming conventions', () => {
    it.each<[string, LogfmtValue]>([
      ['cpu_ms', 1250],
      ['cpu_ms', 0],
      ['dir_count', 42],
      ['read_bytes', 9_007_199_254_740_991],
      ['cache_hit_pct', 0],
      ['cache_hit_pct', 100],
      ['watcher_enabled', true],
      ['watcher_enabled', false],
      ['is_network_drive', true],
      ['has_symlinks', false]
    ])('forwards the unlisted field %s=%s', (field, value) => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('seeder.scan_completed', { phase: 'fast', [field]: value }), 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject({ phase: 'fast', [field]: value })
    })

    it.each<[string, LogfmtValue]>([
      ['cpu_ms', true],
      ['cpu_ms', -1],
      ['cpu_ms', '12ms'],
      ['dir_count', -3],
      ['dir_count', false],
      ['read_bytes', 9_007_199_254_740_992],
      ['read_bytes', '1.5'],
      ['cache_hit_pct', 101],
      ['cache_hit_pct', -1],
      ['cache_hit_pct', true],
      ['watcher_enabled', 1],
      ['watcher_enabled', 'yes'],
      ['is_network_drive', 3],
      ['has_symlinks', 'true_ish']
    ])('omits %s=%s, a value of the wrong type or range, but keeps the event', (field, value) => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('seeder.scan_completed', { phase: 'fast', [field]: value }), 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject({ phase: 'fast' })
      expect(captured[0]!.ctx).not.toHaveProperty(field)
    })

    it('never forwards an unlisted string value, even under a convention name', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(
        taggedLine('seeder.scan_completed', {
          model_dir_count: 'checkpoints',
          is_path: 'models',
          last_ms: 'none'
        }),
        'stdout'
      )
      expect(captured).toHaveLength(1)
      for (const field of ['model_dir_count', 'is_path', 'last_ms']) {
        expect(captured[0]!.ctx).not.toHaveProperty(field)
      }
    })

    it('forwards at most eight convention fields per event', () => {
      const fields = Object.fromEntries(
        'abcdefghi'.split('').map((letter, index) => [`${letter}_count`, index])
      )
      const tap = createAssetsTap(baseOpts)
      // taggedLine sorts keys, so `i_count` is the ninth field on the line.
      tap.ingest(taggedLine('seeder.scan_completed', { ...fields, elapsed_ms: 5 }), 'stdout')
      expect(captured).toHaveLength(1)
      const ctx = captured[0]!.ctx
      for (const letter of 'abcdefgh') expect(ctx).toHaveProperty(`${letter}_count`)
      expect(ctx).not.toHaveProperty('i_count')
      // Allowlisted fields don't spend the convention budget.
      expect(ctx.elapsed_ms).toBe(5)
    })

    it('does not spend the cap on an omitted convention field', () => {
      const fields = Object.fromEntries(
        'abcdefgh'.split('').map((letter, index) => [`${letter}_count`, index])
      )
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('seeder.scan_completed', { ...fields, a_bad_count: -1 }), 'stdout')
      expect(captured).toHaveLength(1)
      for (const letter of 'abcdefgh') expect(captured[0]!.ctx).toHaveProperty(`${letter}_count`)
      expect(captured[0]!.ctx).not.toHaveProperty('a_bad_count')
    })

    it('accepts a 48-character name and omits a 49-character one', () => {
      const atLimit = `${'x'.repeat(42)}_bytes`
      const overLimit = `${'x'.repeat(43)}_bytes`
      expect(atLimit).toHaveLength(48)
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('seeder.scan_completed', { [atLimit]: 1, [overLimit]: 2 }), 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx[atLimit]).toBe(1)
      expect(captured[0]!.ctx).not.toHaveProperty(overLimit)
    })

    it('still rejects a repeated convention field', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_completed cpu_ms=1 cpu_ms=2\n', 'stdout')
      tap.ingest('[assets-event] seeder.scan_completed is_x=3 is_x=true\n', 'stdout')
      // Past the per-event cap too: the duplicate check runs before the cap.
      const pastCap = 'abcdefghi'.split('').map((letter) => `${letter}_count=1`)
      tap.ingest(`[assets-event] seeder.scan_completed ${pastCap.join(' ')} i_count=2\n`, 'stdout')
      expect(captured).toHaveLength(0)
    })

    it('leaves allowlisted fields that fit a convention on their own validators', () => {
      const tap = createAssetsTap(baseOpts)
      // A negative elapsed_ms passes its own (signed) validator...
      tap.ingest(taggedLine('seeder.scan_completed', { elapsed_ms: -5 }), 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx.elapsed_ms).toBe(-5)
      // ...and a wrong-typed allowlisted value still rejects the line.
      tap.ingest(taggedLine('seeder.scan_completed', { elapsed_ms: true }), 'stdout')
      tap.ingest(taggedLine('assets.enabled', { hashing_enabled: 1 }), 'stdout')
      expect(captured).toHaveLength(1)
    })

    it('still drops an unknown event that carries only convention fields', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('seeder.scan_exploded', { cpu_ms: 1, is_x: true }), 'stdout')
      expect(captured).toHaveLength(0)
      tap.flushSummary()
      expect(captured).toHaveLength(1)
      expect(captured[0]!.event).toBe('comfy.desktop.comfyui.assets.unknown_events_dropped')
      expect(captured[0]!.ctx.count).toBe(1)
    })

    it('omits a -0 under a non-negative convention', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_completed dir_count=-0 phase=fast\n', 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).not.toHaveProperty('dir_count')
    })

    it('counts fields past the per-event cap, never naming them', () => {
      const fields = Object.fromEntries(
        'abcdefghij'.split('').map((letter, index) => [`${letter}_count`, index])
      )
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('seeder.scan_completed', fields), 'stdout')
      // An invalid value past the cap is a mismatch, not an eviction.
      tap.ingest(taggedLine('seeder.scan_completed', { ...fields, z_count: -1 }), 'stdout')
      tap.flushSummary()
      expect(captured.map(({ event }) => event)).toEqual([
        'comfy.desktop.comfyui.assets.seeder.scan_completed',
        'comfy.desktop.comfyui.assets.seeder.scan_completed',
        'comfy.desktop.comfyui.assets.convention_fields_over_event_cap'
      ])
      expect(captured[2]!.ctx).toMatchObject({ count: 4 })
      expect(JSON.stringify(captured[2]!.ctx)).not.toContain('i_count')

      tap.flushSummary()
      expect(captured).toHaveLength(3)
    })

    it('does not count omissions on a rate-capped line', () => {
      const fields = Object.fromEntries(
        'abcdefghij'.split('').map((letter, index) => [`${letter}_count`, index])
      )
      const tap = createAssetsTap(baseOpts)
      for (let i = 0; i < 60; i++) tap.ingest(taggedLine('seeder.scan_started', {}), 'stdout')
      tap.ingest(taggedLine('seeder.scan_started', fields), 'stdout')
      tap.flushSummary()
      expect(captured).toHaveLength(60)
    })

    it('cannot forge the convention counters with a crafted line', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('convention_fields_over_event_cap', { count: 999 }), 'stdout')
      tap.ingest(taggedLine('convention_names_over_session_cap', { count: 999 }), 'stdout')
      tap.flushSummary()
      expect(captured.map(({ event }) => event)).toEqual([
        'comfy.desktop.comfyui.assets.unknown_events_dropped'
      ])
      expect(captured[0]!.ctx.count).toBe(2)
    })

    it('does not count omitted convention fields as unknown enum values', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('seeder.scan_completed', { cpu_ms: true }), 'stdout')
      tap.flushSummary()
      expect(captured.map(({ event }) => event)).toEqual([
        'comfy.desktop.comfyui.assets.seeder.scan_completed'
      ])
    })
  })

  describe('scan failure and performance fields', () => {
    /** Mirror of ComfyUI `ERROR_KINDS`. */
    const ERROR_KINDS = [
      'expression_tree_too_large',
      'too_many_variables',
      'database_locked',
      'disk_full',
      'disk_io',
      'unable_to_open',
      'database_corrupt',
      'permission_denied',
      'file_locked',
      'read_only',
      'other'
    ]
    /** The core events that carry `error_kind`, always next to `error_type`. */
    const ERROR_KIND_EVENTS = [
      'seeder.scan_failed',
      'scanner.fast_scan_failed',
      'scanner.temp_sync_failed',
      'scanner.mark_missing_failed',
      'scanner.stat_failed',
      'seeder.batch_insert_failed',
      'scanner.watch_stat_failed',
      'scanner.watch_seed_failed'
    ]

    it.each(ERROR_KINDS)('forwards error_kind=%s', (kind) => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(
        taggedLine('seeder.scan_failed', { error_type: 'OperationalError', error_kind: kind }),
        'stdout'
      )
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject({ error_type: 'OperationalError', error_kind: kind })
    })

    it.each(ERROR_KIND_EVENTS)('forwards error_type and error_kind on %s', (event) => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine(event, { error_type: 'OSError', error_kind: 'disk_full' }), 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.event).toBe(`comfy.desktop.comfyui.assets.${event}`)
      expect(captured[0]!.ctx).toMatchObject({ error_type: 'OSError', error_kind: 'disk_full' })
    })

    it('validates error_kind per field, so it forwards on any allowed event', () => {
      // Like reason and site: core decides which events carry it.
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('seeder.scan_completed', { error_kind: 'disk_full' }), 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx.error_kind).toBe('disk_full')
    })

    it('omits and counts a well-shaped error_kind this build does not know', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(
        taggedLine('seeder.scan_failed', { error_type: 'OSError', error_kind: 'quota_exceeded' }),
        'stdout'
      )
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx.error_type).toBe('OSError')
      expect(captured[0]!.ctx).not.toHaveProperty('error_kind')
      tap.flushSummary()
      expect(captured[1]!.event).toBe('comfy.desktop.comfyui.assets.unknown_enum_values_omitted')
      expect(captured[1]!.ctx).toMatchObject({ count: 1 })
      expect(JSON.stringify(captured[1]!.ctx)).not.toContain('quota_exceeded')
    })

    it.each(['Disk_Full', 'disk/full', 'x'.repeat(65)])(
      'rejects the line for a malformed error_kind %s',
      (kind) => {
        const tap = createAssetsTap(baseOpts)
        tap.ingest(taggedLine('seeder.scan_failed', { error_kind: kind }), 'stdout')
        expect(captured).toHaveLength(0)
      }
    )

    it('forwards the scan performance counters by the naming convention', () => {
      const perf = {
        cpu_ms: 4210,
        paused_ms: 150,
        dirs_listed_count: 312,
        files_statted_count: 9876,
        recovered_count: 3,
        missing_marked_count: 1
      }
      // Not allowlisted: they reach telemetry through the convention alone, using six of
      // scan_completed's eight per-event convention slots. Allowlist them before core adds
      // more convention fields to this event, or the later-sorting ones get evicted.
      for (const field of Object.keys(perf)) expect(ALLOWED_FIELD_NAMES.has(field)).toBe(false)
      const tap = createAssetsTap(baseOpts)
      tap.ingest(
        taggedLine('seeder.scan_completed', { ...perf, elapsed_ms: 8123, phase: 'fast' }),
        'stdout'
      )
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject({ ...perf, elapsed_ms: 8123, phase: 'fast' })
    })

    it('forwards recovered_count=0, the value that shows nothing needed recovering', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(taggedLine('seeder.scan_completed', { recovered_count: 0 }), 'stdout')
      expect(captured[0]!.ctx.recovered_count).toBe(0)
    })
  })

  describe('distinct convention names per tap', () => {
    /** `aa_count`, `ab_count`, ...: distinct, digit-free, sorted by index. */
    const nameFor = (index: number): string =>
      `${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}_count`
    const lineWith = (from: number, to: number): string =>
      taggedLine(
        'seeder.scan_completed',
        Object.fromEntries(Array.from({ length: to - from }, (_, i) => [nameFor(from + i), 1]))
      )

    it('forwards 32 distinct names, then omits and counts new ones', () => {
      const tap = createAssetsTap(baseOpts)
      for (let from = 0; from < 32; from += 8) tap.ingest(lineWith(from, from + 8), 'stdout')
      expect(captured).toHaveLength(4)
      expect(captured[3]!.ctx[nameFor(31)]).toBe(1)

      // Two new names and one already seen: only the seen one forwards.
      tap.ingest(
        taggedLine('seeder.scan_completed', {
          [nameFor(32)]: 1,
          [nameFor(33)]: 1,
          [nameFor(0)]: 7
        }),
        'stdout'
      )
      expect(captured).toHaveLength(5)
      expect(captured[4]!.ctx[nameFor(0)]).toBe(7)
      expect(captured[4]!.ctx).not.toHaveProperty(nameFor(32))
      expect(captured[4]!.ctx).not.toHaveProperty(nameFor(33))

      tap.flushSummary()
      expect(captured[5]!.event).toBe(
        'comfy.desktop.comfyui.assets.convention_names_over_session_cap'
      )
      expect(captured[5]!.ctx).toMatchObject({ count: 2 })
      expect(JSON.stringify(captured[5]!.ctx)).not.toContain(nameFor(32))
    })

    it('admits only up to the budget within a single line', () => {
      const tap = createAssetsTap(baseOpts)
      for (let from = 0; from < 24; from += 8) tap.ingest(lineWith(from, from + 8), 'stdout')
      tap.ingest(lineWith(24, 30), 'stdout')
      // Two slots left, four new names: the first two in line order win.
      tap.ingest(lineWith(30, 34), 'stdout')
      const last = captured[captured.length - 1]!.ctx
      expect(Object.keys(last).filter((k) => k.endsWith('_count'))).toEqual([
        nameFor(30),
        nameFor(31)
      ])
    })

    it('does not spend a per-event slot on a name refused by the session cap', () => {
      const tap = createAssetsTap(baseOpts)
      for (let from = 0; from < 32; from += 8) tap.ingest(lineWith(from, from + 8), 'stdout')
      // `a` sorts first: eight refused new names, then eight seen names.
      const fresh = Object.fromEntries('abcdefgh'.split('').map((l) => [`a_${l}_count`, 1]))
      const seen = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [nameFor(8 + i), 2]))
      tap.ingest(taggedLine('seeder.scan_completed', { ...fresh, ...seen }), 'stdout')
      const last = captured[captured.length - 1]!.ctx
      for (const name of Object.keys(seen)) expect(last[name]).toBe(2)
      for (const name of Object.keys(fresh)) expect(last).not.toHaveProperty(name)
    })

    it('does not spend the budget on a line that is rejected or rate-capped', () => {
      const tap = createAssetsTap(baseOpts)
      // Rejected lines: the names never reach telemetry.
      for (let i = 0; i < 40; i++) {
        tap.ingest(taggedLine('seeder.scan_completed', { [nameFor(i)]: 1, root: 'x' }), 'stdout')
      }
      // Spend scan_started's hourly budget, then offer new names on it.
      for (let i = 0; i < 60; i++) tap.ingest(taggedLine('seeder.scan_started', {}), 'stdout')
      tap.ingest(lineWith(40, 48).replace('scan_completed', 'scan_started'), 'stdout')
      expect(captured).toHaveLength(60)
      // All 32 slots are still free.
      for (let from = 100; from < 132; from += 8) tap.ingest(lineWith(from, from + 8), 'stdout')
      expect(captured).toHaveLength(64)
      expect(captured[63]!.ctx).toHaveProperty(nameFor(131))
    })

    it('keeps the budget across core restarts', () => {
      const tap = createAssetsTap(baseOpts)
      for (let from = 0; from < 32; from += 8) tap.ingest(lineWith(from, from + 8), 'stdout')
      tap.beginBoot()
      tap.ingest(lineWith(32, 33), 'stdout')
      expect(captured[captured.length - 1]!.ctx).not.toHaveProperty(nameFor(32))
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

    // Pins the accepted limitation documented on PER_EVENT_HOURLY_CAP: a
    // later scan's new classification waits for the next window.
    it('hour-samples failure_bucket, so the first failing scan wins', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-09-03T10:00:00Z'))
      const tap = createAssetsTap(baseOpts)
      const bucket = (reason: string, exc_line: number): string =>
        taggedLine('scanner.failure_bucket', { count: 1, exc_line, reason, site: 'hash' })
      for (const scan of [0, 1]) {
        for (let line = 0; line < 50; line++)
          tap.ingest(bucket('locked', scan * 50 + line), 'stdout')
      }
      expect(captured).toHaveLength(60)

      vi.advanceTimersByTime(30 * 60_000)
      tap.ingest(bucket('no_space', 0), 'stdout')
      expect(captured.some((c) => c.ctx.reason === 'no_space')).toBe(false)

      vi.advanceTimersByTime(30 * 60_000)
      tap.ingest(bucket('no_space', 0), 'stdout')
      expect(captured.at(-1)!.ctx.reason).toBe('no_space')
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
    const forgedRetainedSuffix = (): string => {
      const event = '[assets-event] seeder.scan_started phase=fast'
      return event + '\u001b[0m'.repeat(4_081) + '\u001b[31m'.repeat(3)
    }

    it('handles a line split across chunk boundaries', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_com', 'stdout')
      tap.ingest('pleted created=12 ', 'stdout')
      tap.ingest('phase=fast\n', 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject({ created: 12, phase: 'fast' })
    })

    it('parses CRLF-terminated lines, as a Windows core would emit', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_completed created=12 phase=fast\r\n', 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject({ created: 12, phase: 'fast' })
    })

    it('parses a CRLF line whose split lands between the CR and the LF', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest('[assets-event] seeder.scan_started phase=fast\r', 'stdout')
      tap.ingest('\n', 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject({ phase: 'fast' })
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

    it('does not invent an event from the retained suffix of an oversized ordinary line', () => {
      const tap = createAssetsTap(baseOpts)
      const suffix = forgedRetainedSuffix()
      expect(suffix).toHaveLength(16_384)
      tap.ingest(`${'ordinary'.repeat(3_000)}${suffix}`, 'stdout')
      tap.ingest('\n', 'stdout')
      expect(captured).toHaveLength(0)

      tap.ingest(taggedLine('seeder.scan_started', { phase: 'enrich' }), 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx).toMatchObject({ phase: 'enrich' })
    })

    it('does not flush an invented event from an oversized ordinary line suffix', () => {
      const tap = createAssetsTap(baseOpts)
      tap.ingest(`${'ordinary'.repeat(3_000)}${forgedRetainedSuffix()}`, 'stderr')
      tap.flushSummary()
      expect(captured).toHaveLength(0)
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
