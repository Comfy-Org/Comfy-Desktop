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

/** What reached the PostHog SDK, for the consent tests that run the real `emit`. */
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

const { createAgentTap, AGENT_EVENT_LINE, ALLOWED_EVENTS, ALLOWED_FIELD_NAMES, REASONS } =
  await import('./agentTap')
const telemetry = await import('./telemetry')

const AGENT_EVENTS = [
  'flag_enabled',
  'package_missing',
  'install_hint',
  'agent_starting',
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

    it('never forwards the tap-generated counter name as a parsed event', () => {
      expect(ALLOWED_EVENTS.has('unknown_events_dropped')).toBe(false)
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
      'v23.0.0-nightly20240814a4b1ad2b68'
    ])('accepts the version string %s', (version) => {
      ingestLine(`[agent-event] node_found node_version=${version}`)
      expect(captured[0]?.ctx['node_version']).toBe(version)
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
      expect(captured).toEqual([])
      tap.flushSummary()
      expect(captured).toHaveLength(1)
      expect(captured[0]?.event).toBe('comfy.desktop.comfyui.agent.unknown_events_dropped')
      expect(captured[0]?.ctx['count']).toBe(2)
      expect(JSON.stringify(captured[0]?.ctx)).not.toContain('prompt_submitted')
    })

    it('cannot have its dropped-event counter forged by a crafted line', () => {
      ingestLine('[agent-event] unknown_events_dropped count=999')
      expect(captured).toEqual([])
    })

    it('ignores assets lines and untagged agent output', () => {
      const tap = createAgentTap(baseOpts)
      tap.ingest('[assets-event] assets.enabled hashing_enabled=true\n', 'stdout')
      tap.ingest('agent: loaded /home/user/models/secret.safetensors\n', 'stdout')
      tap.ingest('prefix [agent-event] agent_started\n', 'stdout')
      tap.flushSummary()
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
      ['an unsafe integer', 'node_fetched duration_ms=9007199254740993'],
      ['a quoted version', 'agent_started agent_version="1.0.0"'],
      ['a duplicate field', 'agent_exited code=0 code=1'],
      ['an uppercase key', 'agent_exited Code=1'],
      ['a prototype key', 'agent_exited constructor=1'],
      ['a base-context collision', 'agent_exited variant=spoofed']
    ])('rejects the whole line for %s', (_label, body) => {
      ingestLine(`[agent-event] ${body}`)
      expect(captured).toEqual([])
    })

    it('rejects the whole line when only one of several fields is bad', () => {
      ingestLine('[agent-event] node_fetch_failed duration_ms=-10 reason=timeout')
      expect(captured).toEqual([])
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

  describe('stream buffering', () => {
    it('handles a line split across chunk boundaries', () => {
      const tap = createAgentTap(baseOpts)
      tap.ingest('[agent-event] agent_ex', 'stdout')
      tap.ingest('ited code=3\n', 'stdout')
      expect(captured[0]?.ctx['code']).toBe(3)
    })

    it('flushes a trailing unterminated line on flushSummary', () => {
      const tap = createAgentTap(baseOpts)
      tap.ingest('[agent-event] agent_exited code=0', 'stderr')
      expect(captured).toEqual([])
      tap.flushSummary()
      expect(captured.map((c) => c.event)).toEqual(['comfy.desktop.comfyui.agent.agent_exited'])
    })

    it('drops a partial line from a dead process on beginBoot', () => {
      const tap = createAgentTap(baseOpts)
      tap.ingest('[agent-event] agent_exited code=0', 'stdout')
      tap.beginBoot()
      tap.flushSummary()
      expect(captured).toEqual([])
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
    tap.flushSummary()
    expect(agentCaptures()).toEqual([])
  })
})
