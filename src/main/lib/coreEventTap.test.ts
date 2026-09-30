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

const { createCoreEventTap, COMFY_EVENT_LINE } = await import('./coreEventTap')
const { COMFY_EVENT_CONTRACTS } = await import('./coreEventContracts')
const telemetry = await import('./telemetry')

// A byte-identical copy of ComfyUI's `tests-unit/diagnostics_test/fixtures/core_event_lines.txt`.
const FIXTURE_PATH = path.resolve('src/main/lib/__fixtures__/core-event-lines.txt')

type LogfmtValue = boolean | number | string

function comfyLine(event: string, fields: Readonly<Record<string, LogfmtValue>>): string {
  const tail = Object.entries(fields)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ')
  return `[comfy-event] ${event}${tail ? ` ${tail}` : ''}\n`
}

const timing = (fields: Readonly<Record<string, LogfmtValue>>): string =>
  comfyLine('perf.timing', fields)

describe('coreEventTap', () => {
  let captured: Array<{ event: string; ctx: Record<string, unknown> }>

  const baseOpts = {
    installationId: 'inst-1',
    variant: 'desktop',
    release: '1.1.3',
    coreBetaFlags: []
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

  const events = (): string[] => captured.map((c) => c.event)

  describe('the comfy-event line grammar', () => {
    it('splits namespace, event and logfmt tail', () => {
      const m = '[comfy-event] perf.timing duration_ms=5 op=startup.db'.match(COMFY_EVENT_LINE)
      expect(m?.slice(1)).toEqual(['perf', 'timing', ' duration_ms=5 op=startup.db'])
    })

    it('requires exactly two event segments', () => {
      expect('[comfy-event] timing op=a.b'.match(COMFY_EVENT_LINE)).toBeNull()
      expect('[comfy-event] perf.timing.extra op=a.b'.match(COMFY_EVENT_LINE)).toBeNull()
    })

    it('accepts digits in field names, unlike the assets grammar', () => {
      const tap = createCoreEventTap(baseOpts)
      tap.ingest(timing({ op: 'server.http', p95_ms: 2400 }), 'stdout')
      tap.ingest('[assets-event] seeder.scan_started p95_ms=1\n', 'stdout')
      expect(events()).toEqual(['comfy.desktop.comfyui.perf.timing'])
      expect(captured[0]!.ctx).toMatchObject({ op: 'server.http', p95_ms: 2400 })
    })

    it('forwards a level-prefixed line as the bundled build logs it', () => {
      const tap = createCoreEventTap(baseOpts)
      tap.ingest(`[INFO] ${timing({ duration_ms: 3, op: 'startup.db' })}`, 'stderr')
      expect(events()).toEqual(['comfy.desktop.comfyui.perf.timing'])
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

    // Desktop-side lines for the fields and events core has not shipped yet.
    const desktopLines = [
      '[comfy-event] perf.timing count=42 max_ms=3120 op=server.http p50_ms=12 p95_ms=2400 route_family=queue scan_state=fast slow_count=7 t_window_ms=40000',
      '[comfy-event] startup.db_init_failed errno_name=none exc_class=sqlite3.OperationalError exc_fp=0a1b2c3d4e5f exc_line=512 exc_site=app.database.db.init_db reason=db_locked winerror=-1'
    ]

    it.each([...lines, ...desktopLines])('forwards every field of %s', (line) => {
      const tap = createCoreEventTap(baseOpts)
      tap.ingest(`${line}\n`, 'stdout')
      tap.flushSummary()
      const [, namespace, event, tail] = line.match(COMFY_EVENT_LINE)!
      expect(events()).toEqual([`comfy.desktop.comfyui.${namespace}.${event}`])
      const keys = tail!
        .trim()
        .split(' ')
        .map((pair) => pair.split('=')[0])
      expect(Object.keys(captured[0]!.ctx)).toEqual(expect.arrayContaining(keys))
    })
  })

  describe('namespaces', () => {
    it('knows exactly the closed core namespace set, without assets', () => {
      expect([...COMFY_EVENT_CONTRACTS.keys()].sort()).toEqual(
        ['execution', 'models', 'nodes', 'perf', 'server', 'startup'].sort()
      )
    })

    it('keeps assets on its own tag only', () => {
      const tap = createCoreEventTap(baseOpts)
      tap.ingest(comfyLine('assets.enabled', {}), 'stdout')
      tap.ingest('[assets-event] assets.enabled\n', 'stdout')
      expect(events()).toEqual(['comfy.desktop.comfyui.assets.assets.enabled'])
    })

    it('counts an unknown namespace without naming it', () => {
      const tap = createCoreEventTap(baseOpts)
      tap.ingest(comfyLine('secretns.thing', { count: 1 }), 'stdout')
      tap.ingest(comfyLine('assets.enabled', {}), 'stdout')
      tap.flushSummary()
      expect(events()).toEqual(['comfy.desktop.comfyui.core_event.unknown_namespace_dropped'])
      expect(captured[0]!.ctx).toMatchObject({ count: 2 })
      expect(JSON.stringify(captured[0]!.ctx)).not.toContain('secretns')
    })

    it('counts unknown events per namespace, never naming them', () => {
      const tap = createCoreEventTap(baseOpts)
      tap.ingest(comfyLine('execution.node_failed', { reason: 'oom' }), 'stdout')
      tap.ingest(comfyLine('execution.node_failed', { reason: 'oom' }), 'stdout')
      tap.ingest(comfyLine('perf.exploded', {}), 'stdout')
      tap.ingest('[assets-event] seeder.exploded\n', 'stdout')
      expect(captured).toHaveLength(0)
      tap.flushSummary()
      expect(captured.map((c) => [c.event, c.ctx.count])).toEqual([
        ['comfy.desktop.comfyui.execution.unknown_events_dropped', 2],
        ['comfy.desktop.comfyui.perf.unknown_events_dropped', 1],
        ['comfy.desktop.comfyui.assets.unknown_events_dropped', 1]
      ])
      expect(JSON.stringify(captured)).not.toContain('node_failed')
    })

    it('cannot have a counter forged by a crafted line', () => {
      const tap = createCoreEventTap(baseOpts)
      tap.ingest(comfyLine('perf.cardinality_overflow', { count: 999 }), 'stdout')
      tap.ingest(comfyLine('core_event.unknown_namespace_dropped', { count: 999 }), 'stdout')
      tap.flushSummary()
      expect(captured.map((c) => c.ctx.count)).toEqual([1, 1])
    })
  })

  describe('safety tiers', () => {
    it('CLOSED: omits and counts a well-shaped unknown enum value', () => {
      const tap = createCoreEventTap(baseOpts)
      tap.ingest(
        timing({ op: 'server.http', route_family: 'brand_new', scan_state: 'idle' }),
        'stdout'
      )
      expect(captured[0]!.ctx).toMatchObject({ op: 'server.http', scan_state: 'idle' })
      expect(captured[0]!.ctx).not.toHaveProperty('route_family')
      tap.flushSummary()
      expect(captured[1]!.event).toBe('comfy.desktop.comfyui.perf.unknown_enum_values_omitted')
      expect(captured[1]!.ctx).toMatchObject({ count: 1 })
    })

    it('CLOSED: rejects an enum value that is not even enum-shaped', () => {
      const tap = createCoreEventTap(baseOpts)
      tap.ingest(timing({ op: 'server.http', route_family: '/api/prompt' }), 'stdout')
      tap.ingest(timing({ op: 'server.http', route_family: 'Queue' }), 'stdout')
      expect(captured).toHaveLength(0)
    })

    it('CLOSED: takes booleans as booleans only', () => {
      const tap = createCoreEventTap(baseOpts)
      tap.ingest(timing({ assets_enabled: true, op: 'startup.db' }), 'stdout')
      tap.ingest(timing({ assets_enabled: 1, op: 'startup.db' }), 'stdout')
      expect(captured).toHaveLength(1)
      expect(captured[0]!.ctx.assets_enabled).toBe(true)
    })

    it.each([
      ['a path', 'C/Users/me'],
      ['a single segment', 'startup'],
      ['uppercase', 'Startup.db'],
      ['five segments', 'a.b.c.d.e'],
      ['a number', '12']
    ])('SHAPE-CHECKED OPEN: rejects an op that is %s', (_label, op) => {
      const tap = createCoreEventTap(baseOpts)
      tap.ingest(timing({ duration_ms: 1, op }), 'stdout')
      expect(captured).toHaveLength(0)
    })

    it('SHAPE-CHECKED OPEN: checks versions and dotted names', () => {
      const tap = createCoreEventTap(baseOpts)
      tap.ingest(comfyLine('startup.environment', { torch_version: '2.8.0+cu128' }), 'stdout')
      tap.ingest(comfyLine('startup.environment', { torch_version: 'nightly' }), 'stdout')
      tap.ingest(timing({ node_class: 'comfy.samplers.KSampler', op: 'execution.node' }), 'stdout')
      tap.ingest(timing({ node_class: 'my node', op: 'execution.node' }), 'stdout')
      expect(captured.map((c) => c.ctx.torch_version ?? c.ctx.node_class)).toEqual([
        '2.8.0+cu128',
        'comfy.samplers.KSampler'
      ])
    })

    it.each([
      ['negative', -1],
      ['fractional', '1.5'],
      ['unsafe', '9007199254740993'],
      ['text', 'fast']
    ])('FIXED NUMERIC: rejects a %s duration', (_label, duration_ms) => {
      const tap = createCoreEventTap(baseOpts)
      tap.ingest(timing({ duration_ms, op: 'startup.db' }), 'stdout')
      expect(captured).toHaveLength(0)
    })

    it('FIXED NUMERIC: allows only the winerror sentinel below zero', () => {
      const tap = createCoreEventTap(baseOpts)
      tap.ingest(comfyLine('startup.db_init_failed', { reason: 'db_io', winerror: -1 }), 'stdout')
      tap.ingest(comfyLine('startup.db_init_failed', { reason: 'db_io', winerror: -2 }), 'stdout')
      expect(captured.map((c) => c.ctx.winerror)).toEqual([-1])
    })

    it('keeps an all-digit fingerprint a string', () => {
      const tap = createCoreEventTap(baseOpts)
      tap.ingest(
        comfyLine('startup.db_init_failed', { exc_fp: '012345678901', reason: 'db_io' }),
        'stdout'
      )
      expect(captured[0]!.ctx.exc_fp).toBe('012345678901')
    })

    it('omits an unknown field rather than rejecting the line', () => {
      const tap = createCoreEventTap(baseOpts)
      tap.ingest(timing({ future_field2: 'x', op: 'startup.db' }), 'stdout')
      expect(captured[0]!.ctx).not.toHaveProperty('future_field2')
    })

    it.each(['installation_id', 'release', '__proto__', 'constructor'])(
      'rejects a line carrying %s',
      (key) => {
        const tap = createCoreEventTap(baseOpts)
        tap.ingest(`[comfy-event] perf.timing ${key}=x op=startup.db\n`, 'stdout')
        expect(captured).toHaveLength(0)
      }
    )

    it('rejects a repeated field', () => {
      const tap = createCoreEventTap(baseOpts)
      tap.ingest('[comfy-event] perf.timing op=startup.db op=startup.db\n', 'stdout')
      expect(captured).toHaveLength(0)
    })

    it('merges the base context last', () => {
      const tap = createCoreEventTap(baseOpts)
      tap.ingest(timing({ op: 'startup.db' }), 'stdout')
      expect(captured[0]!.ctx).toMatchObject({ installation_id: 'inst-1', release: '1.1.3' })
    })
  })

  describe('rate caps and novelty-first admission', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-09-24T10:00:00Z'))
    })

    it('gives perf a 120 per hour budget', () => {
      const tap = createCoreEventTap(baseOpts)
      for (let i = 0; i < 130; i++)
        tap.ingest(timing({ duration_ms: i, op: 'startup.db' }), 'stdout')
      expect(captured).toHaveLength(120)
    })

    it('admits a new op/outcome after the budget is spent, once per window', () => {
      const tap = createCoreEventTap(baseOpts)
      for (let i = 0; i < 130; i++)
        tap.ingest(timing({ duration_ms: i, op: 'startup.db' }), 'stdout')
      tap.ingest(timing({ op: 'startup.db', outcome: 'error' }), 'stdout')
      tap.ingest(timing({ op: 'startup.db', outcome: 'error' }), 'stdout')
      tap.ingest(timing({ op: 'startup.listening' }), 'stdout')
      expect(captured.slice(120).map((c) => [c.ctx.op, c.ctx.outcome])).toEqual([
        ['startup.db', 'error'],
        ['startup.listening', undefined]
      ])

      vi.advanceTimersByTime(60 * 60_000)
      tap.ingest(timing({ op: 'startup.db', outcome: 'error' }), 'stdout')
      expect(captured).toHaveLength(123)
    })

    it('keys failures on site, reason and fingerprint', () => {
      const tap = createCoreEventTap(baseOpts)
      const failed = (fields: Record<string, LogfmtValue>): string =>
        comfyLine('startup.db_init_failed', fields)
      for (let i = 0; i < 70; i++) tap.ingest(failed({ exc_line: i, reason: 'db_io' }), 'stdout')
      expect(captured).toHaveLength(60)
      tap.ingest(failed({ exc_fp: 'aaaaaaaaaaaa', reason: 'db_io' }), 'stdout')
      tap.ingest(failed({ reason: 'db_locked' }), 'stdout')
      tap.ingest(failed({ reason: 'db_locked' }), 'stdout')
      expect(captured).toHaveLength(62)
    })

    it('holds distinct keys that arrive first to the cap', () => {
      const tap = createCoreEventTap(baseOpts)
      for (let i = 0; i < 200; i++) {
        tap.ingest(timing({ op: `startup.mark_${i}` }), 'stdout')
      }
      // 64 novel keys, then plain cap: 120 in total.
      expect(captured).toHaveLength(120)
      tap.ingest(timing({ op: 'startup.brand_new' }), 'stdout')
      expect(captured).toHaveLength(120)
    })

    it('overshoots the cap by at most 63 novel keys after repeats spend it', () => {
      const tap = createCoreEventTap(baseOpts)
      for (let i = 0; i < 130; i++) tap.ingest(timing({ op: 'startup.db' }), 'stdout')
      for (let i = 0; i < 100; i++) {
        tap.ingest(timing({ op: `startup.mark_${i}` }), 'stdout')
      }
      expect(captured).toHaveLength(120 + 63)
    })
  })

  describe('distinct-value guard', () => {
    it('replaces the 65th distinct open-tier value with overflow and counts it', () => {
      const tap = createCoreEventTap(baseOpts)
      for (let i = 0; i < 66; i++) tap.ingest(timing({ op: `startup.mark_${i}` }), 'stdout')
      tap.ingest(timing({ op: 'startup.mark_3' }), 'stdout')
      const ops = captured.map((c) => c.ctx.op)
      expect(ops.slice(0, 64)).toEqual(Array.from({ length: 64 }, (_, i) => `startup.mark_${i}`))
      expect(ops.slice(64)).toEqual(['overflow', 'overflow', 'startup.mark_3'])

      tap.flushSummary()
      expect(captured.at(-1)!.event).toBe('comfy.desktop.comfyui.perf.cardinality_overflow')
      expect(captured.at(-1)!.ctx).toMatchObject({ count: 2 })
    })

    it('guards each field separately and survives beginBoot', () => {
      const tap = createCoreEventTap(baseOpts)
      for (let i = 0; i < 64; i++) tap.ingest(timing({ op: `startup.mark_${i}` }), 'stdout')
      tap.beginBoot()
      tap.ingest(timing({ model_class: 'comfy.model_base.SDXL', op: 'startup.late' }), 'stdout')
      expect(captured.at(-1)!.ctx).toMatchObject({
        model_class: 'comfy.model_base.SDXL',
        op: 'overflow'
      })
    })

    it('leaves CLOSED and numeric fields alone', () => {
      const tap = createCoreEventTap(baseOpts)
      for (let i = 0; i < 70; i++) {
        tap.ingest(timing({ duration_ms: i, op: 'startup.db', outcome: 'ok' }), 'stdout')
      }
      expect(captured.at(-1)!.ctx).toMatchObject({ duration_ms: 69, outcome: 'ok' })
    })
  })

  describe('no-throw contract', () => {
    it('contains a telemetry.emit failure on a comfy-event line', () => {
      vi.spyOn(telemetry, 'emit').mockImplementation(() => {
        throw new Error('posthog exploded')
      })
      const tap = createCoreEventTap(baseOpts)
      expect(() => tap.ingest(timing({ op: 'startup.db' }), 'stdout')).not.toThrow()
      tap.ingest(comfyLine('nope.nope', {}), 'stdout')
      expect(() => tap.flushSummary()).not.toThrow()
    })
  })
})
