import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
  REASONS
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
