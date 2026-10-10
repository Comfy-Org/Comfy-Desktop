import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'launcher-test'),
    isPackaged: true,
    on: () => {}
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

const sdkCaptures = vi.hoisted(() => [] as Array<{ event: string }>)

vi.mock('posthog-node', () => ({
  PostHog: class {
    on(): () => void {
      return () => {}
    }
    capture(call: { event: string }): void {
      sdkCaptures.push(call)
    }
    identify(): void {}
    flush(): Promise<void> {
      return Promise.resolve()
    }
    shutdown(): Promise<void> {
      return Promise.resolve()
    }
  }
}))

const {
  createAgentTap,
  parseAgentEventLine,
  AGENT_EVENT_LINE,
  ALLOWED_EVENTS,
  ALLOWED_FIELD_NAMES,
  REASONS,
  PRODUCT_EVENTS,
  PRODUCT_FIELDS,
  _resetProductEventBudgetForTest
} = await import('./agentTap')
const telemetry = await import('./telemetry')

const AGENT_EVENTS = [
  'flag_enabled',
  'package_missing',
  'install_hint',
  'agent_starting',
  'agent_waiting',
  'agent_started',
  'node_found',
  'node_fetch_started',
  'node_fetched',
  'node_fetch_failed',
  'health_check_failed',
  'agent_exited',
  'agent_error'
]

describe('agentTap', () => {
  let captured: Array<{ event: string; ctx: Record<string, unknown> }>

  const baseOpts = {
    installationId: 'inst-1',
    variant: 'desktop',
    release: '1.0.47-rc.1',
    coreBetaFlags: ['--enable-agent']
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

  function ingestLine(line: string): void {
    createAgentTap(baseOpts).ingest(`${line}\n`, 'stdout')
  }

  describe('vocabulary', () => {
    it('exposes exactly the agent event allowlist', () => {
      expect([...ALLOWED_EVENTS].sort()).toEqual([...AGENT_EVENTS].sort())
    })

    it('names no field that telemetry sets on every event itself', () => {
      for (const name of ALLOWED_FIELD_NAMES) {
        expect(
          telemetry.DEFAULT_EVENT_PROPERTY_NAMES.has(name),
          `${name} would override telemetry's own default`
        ).toBe(false)
      }
    })

    it('names no field the tap attaches to every event itself', () => {
      const tap = createAgentTap(baseOpts)
      tap.ingest('[agent-event] agent_started\n', 'stdout')
      expect(captured).toHaveLength(1)
      for (const key of Object.keys(captured[0]?.ctx ?? {})) {
        expect(ALLOWED_FIELD_NAMES.has(key), `${key} would let a line spoof the base context`).toBe(
          false
        )
      }
    })

    it('exposes exactly the agent field allowlist', () => {
      expect([...ALLOWED_FIELD_NAMES].sort()).toEqual(
        ['agent_version', 'code', 'duration_ms', 'node_version', 'reason'].sort()
      )
    })

    it('matches the event and logfmt tail as separate parts', () => {
      const m = '[agent-event] agent_started duration_ms=12'.match(AGENT_EVENT_LINE)
      expect(m?.[1]).toBe('agent_started')
      expect(m?.[2]).toBe(' duration_ms=12')
    })
  })

  describe('accepted lines', () => {
    it('emits one namespaced event merging the trusted base context', () => {
      ingestLine('[agent-event] agent_started agent_version=0.4.2 duration_ms=812')
      expect(captured).toEqual([
        {
          event: 'comfy.desktop.comfyui.agent.agent_started',
          ctx: {
            duration_ms: 812,
            agent_version: '0.4.2',
            installation_id: 'inst-1',
            variant: 'desktop',
            release: '1.0.47-rc.1',
            core_beta_flags: ['--enable-agent']
          }
        }
      ])
    })

    it('forwards agent_waiting with its elapsed duration', () => {
      ingestLine('[agent-event] agent_waiting duration_ms=60000')
      expect(captured).toEqual([
        {
          event: 'comfy.desktop.comfyui.agent.agent_waiting',
          ctx: expect.objectContaining({ duration_ms: 60000, installation_id: 'inst-1' })
        }
      ])
    })

    it('coerces integer fields to numbers, including a negative exit code', () => {
      ingestLine('[agent-event] agent_exited code=-1073741819 duration_ms=0')
      expect(captured[0]?.ctx).toMatchObject({ code: -1073741819, duration_ms: 0 })
    })

    it.each([
      '0.4.2',
      'v22.11.0',
      '1.2.0-rc.1',
      '1.2.3+build.7',
      '1.2.0-rc.1+build.5',
      '22.11',
      '1.2.3rc1',
      'v23.0.0-nightly20240814a4b1ad2b68',
      `1.0.0-${'a'.repeat(40)}`
    ])('accepts the version string %s', (version) => {
      ingestLine(`[agent-event] node_found node_version=${version}`)
      expect(captured[0]?.ctx['node_version']).toBe(version)
    })

    it('exposes exactly the agent reason set', () => {
      expect([...REASONS].sort()).toEqual(
        [
          'timeout',
          'not_found',
          'not_executable',
          'unsupported_platform',
          'spawn_failed',
          'crashed',
          'signal',
          'connection_refused',
          'http_error',
          'network_error',
          'checksum_mismatch',
          'permission_denied',
          'disabled',
          'unknown'
        ].sort()
      )
    })

    it.each([...REASONS])('accepts the reason %s', (reason) => {
      ingestLine(`[agent-event] agent_error reason=${reason}`)
      expect(captured[0]?.ctx['reason']).toBe(reason)
    })

    it.each([
      ['a reason outside the closed set', 'model_said_hi'],
      ['a path-bearing reason', '/home/user/x'],
      ['a quoted reason', '"timeout"'],
      ['a boolean reason', 'true'],
      ['an integer reason', '137']
    ])('forwards %s as unknown, keeping the line and never the raw value', (_label, raw) => {
      ingestLine(`[agent-event] node_fetch_failed duration_ms=10 reason=${raw}`)
      expect(captured).toHaveLength(1)
      expect(captured[0]?.ctx).toMatchObject({ reason: 'unknown', duration_ms: 10 })
      expect(JSON.stringify(captured[0]?.ctx)).not.toContain(raw.replace(/"/g, ''))
    })

    it('accepts an event carrying no fields at all', () => {
      ingestLine('[agent-event] flag_enabled')
      expect(captured.map((c) => c.event)).toEqual(['comfy.desktop.comfyui.agent.flag_enabled'])
    })

    it('strips the bundled build\u2019s [INFO] prefix and ANSI colour', () => {
      ingestLine('\u001b[32m[INFO] [agent-event] node_fetched duration_ms=40\u001b[0m')
      expect(captured.map((c) => c.event)).toEqual(['comfy.desktop.comfyui.agent.node_fetched'])
    })

    it('forwards a record logged while a tqdm bar is mid-line on stderr', () => {
      const tap = createAgentTap(baseOpts)
      tap.ingest('\r 50%|#####| 3/6 [00:01<00:01,  2.95it/s]', 'stderr')
      tap.ingest('[INFO] [agent-event] agent_started duration_ms=5\n', 'stderr')
      expect(
        captured.map((c) => [c.event, c.ctx['duration_ms']]),
        'a progress bar must not hide the record behind it'
      ).toEqual([['comfy.desktop.comfyui.agent.agent_started', 5]])
    })

    it('forwards the complete record after a cut-off one on the same line', () => {
      ingestLine('[agent-event] agent_exi[INFO] [agent-event] agent_started duration_ms=5')
      expect(
        captured.map((c) => c.event),
        'only the last tag starts a whole record'
      ).toEqual(['comfy.desktop.comfyui.agent.agent_started'])
    })

    it('loses a record behind a progress bar that has redrawn past the 16 KiB line buffer', () => {
      const tap = createAgentTap(baseOpts)
      const redraw = '\r 50%|#####| 3/6 [00:01<00:01,  2.95it/s]'
      tap.ingest(redraw.repeat(Math.ceil(16_384 / redraw.length) + 1), 'stderr')
      tap.ingest('[INFO] [agent-event] agent_started duration_ms=5\n', 'stderr')
      tap.ingest('[agent-event] agent_exited code=0\n', 'stderr')
      expect(
        captured.map((c) => c.event),
        'accepted limitation: an overflowing line is discarded through its newline'
      ).toEqual(['comfy.desktop.comfyui.agent.agent_exited'])
    })

    it('forwards a record redrawn after a carriage return', () => {
      ingestLine('tqdm 50%|#####|\r[agent-event] agent_exited code=108')
      expect(captured.map((c) => c.ctx['code'])).toEqual([108])
    })

    it("never forwards a record inside the agent's relayed output", () => {
      ingestLine('[INFO] [comfy-agent] {"msg":"x"} [agent-event] agent_started duration_ms=5')
      ingestLine('[comfy-agent] [INFO] [agent-event] agent_exited code=1')
      expect(captured, "core's relay prefix must keep the agent from forging a record").toEqual([])
    })

    it('ignores whitespace around the record', () => {
      ingestLine('  [agent-event] node_fetched duration_ms=40  ')
      expect(captured.map((c) => c.ctx['duration_ms'])).toEqual([40])
    })

    it('defaults the optional base context fields', () => {
      createAgentTap({ installationId: 'inst-2' }).ingest(
        '[agent-event] agent_starting\n',
        'stdout'
      )
      expect(captured[0]?.ctx).toEqual({
        installation_id: 'inst-2',
        variant: null,
        release: null,
        core_beta_flags: []
      })
    })
  })

  describe('rejected lines', () => {
    it('drops an event outside the allowlist and reports only a bare count', () => {
      const tap = createAgentTap(baseOpts)
      tap.ingest('[agent-event] prompt_submitted\n', 'stdout')
      tap.ingest('[agent-event] agent_secret_leak code=1\n', 'stdout')
      expect(captured.map((c) => c.event)).toEqual([
        'comfy.desktop.comfyui.agent.unknown_events_dropped',
        'comfy.desktop.comfyui.agent.unknown_events_dropped'
      ])
      expect(captured[0]?.ctx).toEqual({
        count: 1,
        installation_id: 'inst-1',
        variant: 'desktop',
        release: '1.0.47-rc.1',
        core_beta_flags: ['--enable-agent']
      })
      expect(JSON.stringify(captured)).not.toContain('prompt_submitted')
    })

    it('cannot have its dropped-event counter forged by a crafted line', () => {
      ingestLine('[agent-event] unknown_events_dropped count=999')
      expect(
        captured.map((c) => c.ctx['count']),
        'a line naming the report is itself an unknown event'
      ).toEqual([1])
    })

    it('ignores assets lines and untagged agent output', () => {
      const tap = createAgentTap(baseOpts)
      tap.ingest('[assets-event] assets.enabled hashing_enabled=true\n', 'stdout')
      tap.ingest('agent: loaded /home/user/models/secret.safetensors\n', 'stdout')
      tap.ingest('[comfy-agent] [agent-event] agent_started\n', 'stdout')
      expect(captured).toEqual([])
    })

    it('drops an unknown field but keeps the event and its known fields', () => {
      ingestLine('[agent-event] agent_exited code=0 prompt=hello')
      expect(captured).toHaveLength(1)
      expect(captured[0]?.ctx).not.toHaveProperty('prompt')
      expect(captured[0]?.ctx['code']).toBe(0)
    })

    it('treats a bare version field as unknown and omits it', () => {
      ingestLine('[agent-event] agent_started version=0.4.2')
      expect(captured).toHaveLength(1)
      expect(captured[0]?.ctx).not.toHaveProperty('version')
    })

    it.each([
      ['a path-bearing version', 'agent_started agent_version=../../etc/passwd'],
      ['a Windows path as a version', 'agent_started agent_version=C:\\Users\\me'],
      ['a version with free text', 'agent_started agent_version=latest'],
      ['an oversized version suffix', `agent_started agent_version=1.0.0-${'a'.repeat(41)}`],
      ['a bare integer version', 'agent_started agent_version=1'],
      ['a non-integer code', 'agent_exited code=1.5'],
      ['a string code', 'agent_exited code=segfault'],
      ['a negative duration', 'node_fetched duration_ms=-5'],
      ['an unsafe integer duration', 'node_fetched duration_ms=9007199254740993'],
      ['an unsafe integer code', 'agent_exited code=9007199254740993'],
      ['a quoted version', 'agent_started agent_version="1.0.0"'],
      ['a duplicate field', 'agent_exited code=0 code=1'],
      ['an uppercase key', 'agent_exited Code=1']
    ])('rejects the whole line for %s', (_label, body) => {
      ingestLine(`[agent-event] ${body}`)
      expect(captured).toEqual([])
    })

    it('omits a base-context or prototype key and keeps the event', () => {
      ingestLine('[agent-event] agent_exited code=1 variant=spoofed constructor=1 __proto__=x')
      expect(captured).toHaveLength(1)
      expect(captured[0]?.ctx, 'only the allowlist reaches the payload').toEqual({
        code: 1,
        installation_id: 'inst-1',
        variant: 'desktop',
        release: '1.0.47-rc.1',
        core_beta_flags: ['--enable-agent']
      })
    })

    it('rejects the whole line when only one of several fields is bad', () => {
      ingestLine('[agent-event] node_fetch_failed duration_ms=-10 reason=timeout')
      expect(captured).toEqual([])
    })
  })

  describe('parseAgentEventLine', () => {
    it('returns the event and validated fields without emitting', () => {
      expect(
        parseAgentEventLine(
          '\u001b[32m[INFO] [agent-event] agent_started duration_ms=4081 agent_version=0.4.2\u001b[0m'
        )
      ).toEqual({ event: 'agent_started', fields: { duration_ms: 4081, agent_version: '0.4.2' } })
      expect(captured).toEqual([])
    })

    it('applies the tap\u2019s reason rule and field omission', () => {
      expect(parseAgentEventLine('[agent-event] agent_error reason=brand_new extra=1')).toEqual({
        event: 'agent_error',
        fields: { reason: 'unknown' }
      })
    })

    it('returns null for every line the tap would not forward', () => {
      for (const line of [
        '[agent-event] mystery_event',
        '[agent-event] unknown_events_dropped count=3',
        '[agent-event] agent_exited code=1.5',
        '[assets-event] assets.enabled',
        '[comfy-agent] [agent-event] agent_started',
        ''
      ]) {
        expect(parseAgentEventLine(line)).toBeNull()
      }
    })
  })

  describe('rate cap', () => {
    it('caps one event at 60 per hour and resets the window after an hour', () => {
      vi.useFakeTimers()
      vi.setSystemTime(0)
      const tap = createAgentTap(baseOpts)
      tap.ingest('[agent-event] health_check_failed\n'.repeat(61), 'stdout')
      expect(captured).toHaveLength(60)
      vi.setSystemTime(60 * 60_000)
      tap.ingest('[agent-event] health_check_failed\n', 'stdout')
      expect(captured).toHaveLength(61)
    })
  })

  describe('rate window', () => {
    it('keeps the cap until a full hour has passed', () => {
      vi.useFakeTimers()
      vi.setSystemTime(0)
      const tap = createAgentTap(baseOpts)
      tap.ingest('[agent-event] health_check_failed\n'.repeat(60), 'stdout')
      vi.setSystemTime(60 * 60_000 - 1)
      tap.ingest('[agent-event] health_check_failed\n', 'stdout')
      expect(captured).toHaveLength(60)
    })

    it('caps the dropped-event report like any other event', () => {
      vi.useFakeTimers()
      vi.setSystemTime(0)
      const tap = createAgentTap(baseOpts)
      tap.ingest(
        Array.from({ length: 61 }, (_, i) => `[agent-event] mystery_${i}\n`).join(''),
        'stdout'
      )
      expect(captured, 'every unknown name shares one budget').toHaveLength(60)
      vi.setSystemTime(60 * 60_000)
      tap.ingest('[agent-event] mystery\n', 'stdout')
      expect(captured).toHaveLength(61)
    })
  })

  describe('rate cap buckets', () => {
    it('caps each event separately, and keeps the cap across beginBoot', () => {
      vi.useFakeTimers()
      vi.setSystemTime(0)
      const tap = createAgentTap(baseOpts)
      tap.ingest('[agent-event] health_check_failed\n'.repeat(60), 'stdout')
      tap.ingest('[agent-event] agent_starting\n', 'stdout')
      expect(captured).toHaveLength(61)
      tap.beginBoot()
      tap.ingest('[agent-event] health_check_failed\n', 'stdout')
      expect(captured).toHaveLength(61)
    })
  })

  describe('stream buffering', () => {
    it('handles a line split across chunk boundaries', () => {
      const tap = createAgentTap(baseOpts)
      tap.ingest('[agent-event] agent_ex', 'stdout')
      tap.ingest('ited code=3\n', 'stdout')
      expect(captured[0]?.ctx['code']).toBe(3)
    })

    it('never forwards an unterminated line', () => {
      const tap = createAgentTap(baseOpts)
      tap.ingest('[agent-event] agent_exited code=0', 'stderr')
      tap.ingest('[agent-event] agent_exited code=1', 'stdout')
      expect(captured).toEqual([])
    })

    it('buffers stdout and stderr separately', () => {
      const tap = createAgentTap(baseOpts)
      tap.ingest('[agent-event] agent_exited code=1', 'stdout')
      tap.ingest('[agent-event] agent_started\n', 'stderr')
      tap.ingest('2\n', 'stdout')
      expect(captured.map((c) => [c.event, c.ctx['code']])).toEqual([
        ['comfy.desktop.comfyui.agent.agent_started', undefined],
        ['comfy.desktop.comfyui.agent.agent_exited', 12]
      ])
    })

    it('drops a partial line from a dead process on beginBoot', () => {
      const tap = createAgentTap(baseOpts)
      tap.ingest('[agent-event] agent_exited code=0', 'stdout')
      tap.beginBoot()
      tap.ingest('\n', 'stdout')
      expect(captured, "the dead process's partial line must not complete after beginBoot").toEqual(
        []
      )
    })
  })

  describe('no-throw contract', () => {
    it('contains a telemetry.emit failure and keeps parsing later lines', () => {
      let calls = 0
      vi.spyOn(telemetry, 'emit').mockImplementation(() => {
        calls++
        if (calls === 1) throw new Error('emit exploded')
      })
      const tap = createAgentTap(baseOpts)
      expect(() =>
        tap.ingest('[agent-event] agent_started\n[agent-event] agent_exited code=0\n', 'stdout')
      ).not.toThrow()
      expect(calls).toBe(2)
    })
  })
})

// The agent's lines, byte-identical to cloud's
// services/agent/internal/productevents/testdata/events.txt.
const PRODUCT_FIXTURE = fs
  .readFileSync(path.join(__dirname, 'fixtures', 'agent-product-events.txt'), 'utf8')
  .trimEnd()
  .split('\n')

const THREAD = '0b6f2a8e-2f4c-4c55-9a43-6a1d2f0e7c11'
const TURN = '5e1d9c3a-8b7f-4e2d-a1c6-3f9b0d4e8a72'
const WORKFLOW = 'd3a8f1c6-7e2b-4a9d-8c5f-2b1e9a0d6c34'

// What ComfyUI prints for an agent line it logs as its own record: ANSI level
// tag, the line, the installed agent's version, CRLF on Windows.
function relayed(agentLine: string): string {
  return `\u001b[32m[INFO]\u001b[0m ${agentLine} agent_version=0.0.1\r\n`
}

describe('agentTap product events', () => {
  let captured: Array<{ event: string; ctx: Record<string, unknown> }>
  let emitted: string[]

  const baseOpts = {
    installationId: 'inst-1',
    variant: 'desktop',
    release: '1.0.47',
    coreBetaFlags: []
  }
  const context = {
    installation_id: 'inst-1',
    variant: 'desktop',
    release: '1.0.47',
    core_beta_flags: [],
    distribution: 'local',
    deployment: 'local'
  }

  beforeEach(() => {
    captured = []
    emitted = []
    _resetProductEventBudgetForTest()
    vi.spyOn(telemetry, 'capture').mockImplementation((event, ctx) => {
      captured.push({ event, ctx: ctx as Record<string, unknown> })
      return true
    })
    vi.spyOn(telemetry, 'emit').mockImplementation((event) => {
      emitted.push(event)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function ingest(text: string): void {
    createAgentTap(baseOpts).ingest(text, 'stderr')
  }

  function turnStarted(tail: string): string {
    return relayed(
      `[agent-event] agent_turn_started thread_id=${THREAD} turn_id=${TURN} workflow_id=${WORKFLOW}${tail}`
    )
  }

  it('captures the six fixture events from ComfyUI’s relay under their Cloud names', () => {
    ingest(PRODUCT_FIXTURE.map(relayed).join(''))
    expect(captured.map((c) => c.event)).toEqual([...PRODUCT_EVENTS.keys()])
    expect(emitted, 'product events are captured, not emitted with a Datadog mirror').toEqual([])
    expect(captured[1]?.ctx).toEqual({
      accepted_at: '2026-10-09T12:00:01Z',
      engine: 'inline',
      model: 'claude-opus-4-8',
      occurred_at: '2026-10-09T12:00:01Z',
      thread_id: THREAD,
      turn_id: TURN,
      workflow_id: WORKFLOW,
      agent_version: '0.0.1',
      ...context
    })
    expect(captured[3]?.ctx).toMatchObject({
      event_schema_version: '1',
      mutation_id: '3f7a9c1e5b2d8f4a6c0e9b7d1a3f5c8e2b4d6f8a0c1e3b5d7f9a2c4e6b8d0f1a',
      op_count: 3,
      timestamp: '2026-10-09T12:00:02.123456789Z'
    })
    expect(captured[4]?.ctx).toMatchObject({
      is_blank_canvas_start: true,
      canvas_node_count_before: 0
    })
    expect(captured[5]?.ctx).toMatchObject({
      error_class: 'internal',
      retryable: true,
      duration_ms: 800
    })
  })

  it('never reads a product event inside the agent’s relayed output', () => {
    ingest(`\u001b[32m[INFO]\u001b[0m [comfy-agent] ${PRODUCT_FIXTURE[1]}\r\n`)
    ingest(`\u001b[32m[INFO]\u001b[0m [comfy-agent] x\r${PRODUCT_FIXTURE[1]}\r\n`)
    expect(captured, 'a carriage return in the agent output must not start a new record').toEqual(
      []
    )
  })

  it.each([
    ['nothing', '', true],
    ['the level tag', '[INFO] ', true],
    ['a progress-bar redraw', '\r 50%|#####| 3/6 [00:01<00:01,  2.95it/s][INFO] ', true],
    ['other text on the line (accepted limitation)', '[ERROR] could not be started: x ', true],
    ['the agent relay tag', '[INFO] [comfy-agent] ', false],
    ['the agent relay tag before a redraw', '[INFO] [comfy-agent] x\r', false]
  ])('reads product and lifecycle records alike behind %s', (_label, ahead, read) => {
    createAgentTap(baseOpts).ingest(`${ahead}${PRODUCT_FIXTURE[1]} agent_version=0.0.1\n`, 'stderr')
    createAgentTap(baseOpts).ingest(`${ahead}[agent-event] agent_started\n`, 'stderr')
    expect(
      captured.map((c) => c.event),
      'product records follow the lifecycle relay rule'
    ).toEqual(read ? ['agent_turn_started'] : [])
    expect(emitted, 'product records follow the lifecycle relay rule').toEqual(
      read ? ['comfy.desktop.comfyui.agent.agent_started'] : []
    )
  })

  it.each([
    ['agent_session_started', ['thread_id']],
    ['agent_turn_started', ['thread_id', 'turn_id', 'workflow_id']],
    ['agent_first_response', ['thread_id', 'turn_id']],
    [
      'agent_mutation_applied',
      ['session_id', 'thread_id', 'turn_id', 'workflow_id', 'mutation_id']
    ],
    ['agent_turn_completed', ['session_id', 'thread_id', 'turn_id', 'workflow_id']],
    ['agent_turn_failed', ['thread_id', 'turn_id', 'workflow_id']]
  ])('drops %s missing any of its ids', (event, ids) => {
    const line = PRODUCT_FIXTURE.find((l) => l.startsWith(`[agent-event] ${event} `))!
    for (const id of ids) ingest(relayed(line.replace(new RegExp(` ${id}=[^ ]+`), '')))
    expect(captured).toEqual([])
    ingest(relayed(line))
    expect(captured.map((c) => c.event)).toEqual([event])
  })

  it.each([
    ['a path', 'C:private_workflow.json'],
    ['prose-like token', 'private-prompt'],
    ['upper-case UUID', WORKFLOW.toUpperCase()]
  ])('drops an event whose id is %s', (_label, id) => {
    ingest(
      relayed(
        `[agent-event] agent_turn_started thread_id=${THREAD} turn_id=${TURN} workflow_id=${id}`
      )
    )
    expect(captured).toEqual([])
  })

  const firstResponse = (tail: string): string =>
    relayed(`[agent-event] agent_first_response thread_id=${THREAD} turn_id=${TURN}${tail}`)
  const sessionStarted = (tail: string): string =>
    relayed(`[agent-event] agent_session_started thread_id=${THREAD}${tail}`)

  it.each([
    ['a fractional count', firstResponse(' time_to_first_response_ms=1.0')],
    ['a negative count', firstResponse(' time_to_first_response_ms=-1')],
    ['a count past 2^53-1', firstResponse(' time_to_first_response_ms=9007199254740992')],
    ['a non-boolean', sessionStarted(' is_resume=yes')],
    ['an offset timestamp', turnStarted(' accepted_at=2026-10-09T14:00:01+02:00')],
    ['a duplicate key', turnStarted(` thread_id=${THREAD}`)],
    ['a model with a slash', turnStarted(' model=a/b')],
    ['a model with a backslash', turnStarted(' model=C:\\x')],
    ['a non-ASCII model', turnStarted(' model=caf\u00e9')],
    ['a model past 128 characters', turnStarted(` model=${'m'.repeat(129)}`)],
    ['a cohort holding an email', sessionStarted(' feature_flag_cohort=a@b.com')],
    [
      'a malformed agent_version',
      sessionStarted(' agent_version=latest').replace(' agent_version=0.0.1', '')
    ]
  ])('drops the line for %s', (_label, line) => {
    ingest(line)
    expect(captured).toEqual([])
  })

  it('omits a field it doesn’t know, another event’s field and prototype keys, keeping the event', () => {
    ingest(
      turnStarted(
        ` cost_usd=3 mutation_id=${'a'.repeat(64)} __proto__=x constructor=y distribution=cloud`
      )
    )
    expect(captured).toHaveLength(1)
    expect(captured[0]?.ctx).toEqual({
      thread_id: THREAD,
      turn_id: TURN,
      workflow_id: WORKFLOW,
      agent_version: '0.0.1',
      ...context
    })
  })

  it('forwards an enum value it doesn’t know as unknown', () => {
    ingest(turnStarted(' engine=warp run_mode=auto'))
    expect(captured[0]?.ctx).toMatchObject({ engine: 'unknown', run_mode: 'auto' })
  })

  it('keeps all-digit ids and the schema version as strings', () => {
    ingest(
      relayed(
        `[agent-event] agent_mutation_applied session_id=${THREAD} thread_id=${THREAD} turn_id=${TURN} workflow_id=${WORKFLOW} mutation_id=${'1'.repeat(64)} event_schema_version=2`
      )
    )
    expect(captured[0]?.ctx).toMatchObject({
      mutation_id: '1'.repeat(64),
      event_schema_version: '2'
    })
  })

  it('drops a mutation whose id is not a 64-character lowercase hex digest', () => {
    const line = PRODUCT_FIXTURE[3]!
    const id = line.match(/ mutation_id=([0-9a-f]+)/)![1]!
    ingest(relayed(line.replace(id, id.slice(1))))
    ingest(relayed(line.replace(id, id.toUpperCase())))
    expect(captured).toEqual([])
  })

  it('accepts a 128-character model and a ComfyUI dev-build agent_version', () => {
    ingest(
      relayed(
        PRODUCT_FIXTURE[1]!.replace('model=claude-opus-4-8', `model=${'m'.repeat(128)}`)
      ).replace('agent_version=0.0.1', 'agent_version=0.0.0.dev9503+lifecycle')
    )
    expect(captured[0]?.ctx).toMatchObject({
      model: 'm'.repeat(128),
      agent_version: '0.0.0.dev9503+lifecycle'
    })
  })

  it('forwards a schema version it can\u2019t read as unknown', () => {
    ingest(
      relayed(PRODUCT_FIXTURE[4]!.replace('event_schema_version=1', 'event_schema_version=v2'))
    )
    expect(captured[0]?.ctx).toMatchObject({ event_schema_version: 'unknown' })
  })

  it('counts only delivered events against the hourly cap', () => {
    const tap = createAgentTap(baseOpts)
    vi.mocked(telemetry.capture).mockReturnValue(false)
    tap.ingest(relayed(PRODUCT_FIXTURE[1]!).repeat(130), 'stderr')
    vi.mocked(telemetry.capture).mockImplementation((event, ctx) => {
      captured.push({ event, ctx: ctx as Record<string, unknown> })
      return true
    })
    tap.ingest(relayed(PRODUCT_FIXTURE[1]!), 'stderr')
    expect(captured.map((c) => c.event)).toEqual(['agent_turn_started'])
  })

  it('keeps parsing the chunk when capture throws', () => {
    vi.mocked(telemetry.capture).mockImplementationOnce(() => {
      throw new Error('boom')
    })
    ingest(relayed(PRODUCT_FIXTURE[0]!) + relayed(PRODUCT_FIXTURE[1]!))
    expect(captured.map((c) => c.event)).toEqual(['agent_turn_started'])
  })

  it('counts only delivered events against the process budget', () => {
    vi.mocked(telemetry.capture).mockReturnValue(false)
    for (const _launch of [1, 2, 3]) {
      const tap = createAgentTap(baseOpts)
      for (const line of PRODUCT_FIXTURE) tap.ingest(relayed(line).repeat(100), 'stderr')
    }
    vi.mocked(telemetry.capture).mockImplementation((event, ctx) => {
      captured.push({ event, ctx: ctx as Record<string, unknown> })
      return true
    })
    ingest(PRODUCT_FIXTURE.map(relayed).join(''))
    expect(captured, 'undelivered events (no consent yet) must not use up the budget').toHaveLength(
      6
    )
  })

  it('leaves product events out of parseAgentEventLine', () => {
    expect(parseAgentEventLine(relayed(PRODUCT_FIXTURE[1]!).trimEnd())).toBeNull()
    expect(parseAgentEventLine('[INFO] [agent-event] agent_started')).not.toBeNull()
  })

  it('caps agent_mutation_applied at 600 and the other events at 120 per hour', () => {
    const tap = createAgentTap(baseOpts)
    const mutation = relayed(PRODUCT_FIXTURE[3]!)
    tap.ingest(mutation.repeat(601) + relayed(PRODUCT_FIXTURE[1]!).repeat(121), 'stderr')
    expect(captured.filter((c) => c.event === 'agent_mutation_applied')).toHaveLength(600)
    expect(captured.filter((c) => c.event === 'agent_turn_started')).toHaveLength(120)
  })

  it('caps product events at 1500 per Desktop process, across launches', () => {
    for (const _launch of [1, 2, 3]) {
      const tap = createAgentTap(baseOpts)
      for (const line of PRODUCT_FIXTURE) tap.ingest(relayed(line).repeat(100), 'stderr')
    }
    expect(captured).toHaveLength(1500)
    ingest('[INFO] [agent-event] agent_started\n')
    expect(emitted, 'lifecycle events keep their own budget').toEqual([
      'comfy.desktop.comfyui.agent.agent_started'
    ])
  })

  it('names no product field that telemetry or the tap sets itself', () => {
    for (const name of PRODUCT_FIELDS.keys()) {
      expect(telemetry.DEFAULT_EVENT_PROPERTY_NAMES.has(name), name).toBe(false)
      expect(name.startsWith('$'), name).toBe(false)
      expect(Object.hasOwn(context, name), name).toBe(false)
    }
    for (const event of PRODUCT_EVENTS.values()) {
      for (const name of [...event.required, ...event.optional])
        expect(PRODUCT_FIELDS.has(name), name).toBe(true)
    }
    for (const name of PRODUCT_EVENTS.keys()) expect(ALLOWED_EVENTS.has(name), name).toBe(false)
  })
})

describe('agentTap consent gating', () => {
  beforeEach(() => {
    process.env['POSTHOG_API_KEY'] = 'test-key'
    process.env['POSTHOG_ENABLED'] = '1'
    telemetry._resetForTest()
    telemetry.initTelemetry({ appVersion: '0.0.0', appEnv: 'test', isPackaged: true })
  })

  afterEach(() => {
    telemetry._resetForTest()
    sdkCaptures.length = 0
    delete process.env['POSTHOG_API_KEY']
    delete process.env['POSTHOG_ENABLED']
  })

  function agentCaptures(): string[] {
    return sdkCaptures
      .map((c) => c.event)
      .filter((e) => e.startsWith('comfy.desktop.comfyui.agent.'))
  }

  it('reaches the SDK when consent is granted', () => {
    telemetry.setConsentState('granted')
    telemetry.bindAnonymousId('anon-1', 'anon-1', {})
    createAgentTap({ installationId: 'inst-1' }).ingest('[agent-event] agent_started\n', 'stdout')
    expect(agentCaptures()).toEqual(['comfy.desktop.comfyui.agent.agent_started'])
  })

  it('never reaches the SDK when consent is denied', () => {
    telemetry.setConsentState('denied')
    telemetry.bindAnonymousId('anon-1', 'anon-1', {})
    const tap = createAgentTap({ installationId: 'inst-1' })
    tap.ingest('[agent-event] agent_started\n[agent-event] mystery\n', 'stdout')
    expect(agentCaptures()).toEqual([])
  })

  it.each(['denied', 'undecided'] as const)(
    'delivers a product event only once consent is granted, and nothing seen while %s',
    (before) => {
      _resetProductEventBudgetForTest()
      telemetry.setConsentState(before)
      telemetry.bindAnonymousId('anon-1', 'anon-1', {})
      const tap = createAgentTap({ installationId: 'inst-1' })
      tap.ingest(relayed(PRODUCT_FIXTURE[1]!), 'stderr')
      expect(sdkCaptures.filter((c) => c.event === 'agent_turn_started')).toHaveLength(0)
      telemetry.setConsentState('granted')
      tap.ingest(relayed(PRODUCT_FIXTURE[2]!), 'stderr')
      expect(
        sdkCaptures.map((c) => c.event).filter((e) => e.startsWith('agent_')),
        'the line seen before consent is never sent later'
      ).toEqual(['agent_first_response'])
    }
  )

  it('delivers at most 60 of one product event a minute, through telemetry\u2019s own limit', () => {
    _resetProductEventBudgetForTest()
    telemetry._test_resetVolumeGuards()
    telemetry.setConsentState('granted')
    telemetry.bindAnonymousId('anon-1', 'anon-1', {})
    createAgentTap({ installationId: 'inst-1' }).ingest(
      relayed(PRODUCT_FIXTURE[3]!).repeat(100),
      'stderr'
    )
    expect(
      sdkCaptures.filter((c) => c.event === 'agent_mutation_applied'),
      'accepted limitation: a turn landing more than 60 mutations in a minute loses the rest'
    ).toHaveLength(60)
  })

  it('ships the dropped-event report when consent is granted', () => {
    telemetry.setConsentState('granted')
    telemetry.bindAnonymousId('anon-1', 'anon-1', {})
    const tap = createAgentTap({ installationId: 'inst-1' })
    tap.ingest('[agent-event] mystery\n', 'stdout')
    expect(agentCaptures(), 'the denied case is only meaningful if this arrives').toEqual([
      'comfy.desktop.comfyui.agent.unknown_events_dropped'
    ])
  })
})
