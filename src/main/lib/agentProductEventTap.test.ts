import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'agent-product-event-tap-test'),
    isPackaged: true,
    on: () => {}
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock('posthog-node', () => ({
  PostHog: class {
    on(): () => void {
      return () => {}
    }
    capture(): void {}
    identify(): void {}
    flush(): Promise<void> {
      return Promise.resolve()
    }
    shutdown(): Promise<void> {
      return Promise.resolve()
    }
  }
}))

const { AGENT_PRODUCT_EVENT_PREFIX, createAgentProductEventTap, parseAgentProductEventLine } =
  await import('./agentProductEventTap')
const telemetry = await import('./telemetry')

const FIXTURE = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'agent-product-events-v1.ndjson'),
  'utf8'
)
const BASE = {
  installationId: 'install-1',
  variant: 'nvidia',
  release: '1.2.3',
  coreBetaFlags: ['--enable-agent']
}

function envelope(overrides: Record<string, unknown> = {}): string {
  return `${AGENT_PRODUCT_EVENT_PREFIX}${JSON.stringify({
    event: 'agent_first_response',
    event_id: 'turn-1:first_response',
    occurred_at: '2026-10-09T12:00:01Z',
    properties: {
      thread_id: 'thread-1',
      turn_id: 'turn-1',
      response_kind: 'thinking',
      time_to_first_response_ms: 230
    },
    ...overrides
  })}`
}

describe('agentProductEventTap', () => {
  beforeEach(() => {
    vi.spyOn(telemetry, 'capture').mockReturnValue(true)
    vi.spyOn(telemetry, 'emit').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accepts the shared six-event golden corpus with trusted local context', () => {
    const tap = createAgentProductEventTap(BASE)
    tap.ingest(FIXTURE, 'stdout')

    expect(telemetry.capture).toHaveBeenCalledTimes(6)
    expect(telemetry.emit).not.toHaveBeenCalled()
    expect(vi.mocked(telemetry.capture).mock.calls.map(([event]) => event)).toEqual([
      'agent_session_started',
      'agent_turn_started',
      'agent_first_response',
      'agent_mutation_applied',
      'agent_turn_completed',
      'agent_turn_failed'
    ])
    expect(telemetry.capture).toHaveBeenCalledWith(
      'agent_turn_completed',
      expect.objectContaining({
        $insert_id: 'turn-1:turn_completed',
        occurred_at: '2026-10-09T12:00:03Z',
        distribution: 'local',
        deployment: 'local',
        installation_id: 'install-1',
        variant: 'nvidia',
        release: '1.2.3',
        core_beta_flags: ['--enable-agent']
      })
    )
  })

  it('parses only exact v1 lines at column zero', () => {
    expect(parseAgentProductEventLine(envelope())).toEqual(
      expect.objectContaining({ event: 'agent_first_response' })
    )
    expect(parseAgentProductEventLine(`[INFO] ${envelope()}`)).toBeNull()
    expect(parseAgentProductEventLine(` ${envelope()}`)).toBeNull()
  })

  it.each([
    ['malformed_json', `${AGENT_PRODUCT_EVENT_PREFIX}{`],
    ['invalid_envelope', envelope({ extra: true })],
    ['unknown_event', envelope({ event: 'agent_prompt_body' })],
    [
      'invalid_properties',
      envelope({
        properties: {
          thread_id: 'thread-1',
          turn_id: 'turn-1',
          response_kind: 'thinking',
          time_to_first_response_ms: 230,
          prompt: 'must not cross the boundary'
        }
      })
    ],
    ['unsupported_version', envelope().replace('/v1]', '/v2]')],
    ['oversized', `${AGENT_PRODUCT_EVENT_PREFIX}${'x'.repeat(17 * 1024)}`]
  ])('rejects %s without forwarding payload data', (reason, line) => {
    const tap = createAgentProductEventTap(BASE)
    tap.ingest(`${line}\n`, 'stderr')

    expect(telemetry.capture).not.toHaveBeenCalled()
    expect(telemetry.emit).toHaveBeenCalledWith(
      'comfy.desktop.comfyui.agent_product_event.invalid',
      {
        reason,
        count: 1,
        distribution: 'local',
        deployment: 'local',
        installation_id: 'install-1',
        variant: 'nvidia',
        release: '1.2.3',
        core_beta_flags: ['--enable-agent']
      }
    )
  })

  it('buffers stdout and stderr independently across chunks', () => {
    const tap = createAgentProductEventTap(BASE)
    const line = envelope()
    tap.ingest(line.slice(0, 30), 'stdout')
    tap.ingest(`${line}\n`, 'stderr')
    tap.ingest(`${line.slice(30)}\n`, 'stdout')
    expect(telemetry.capture).toHaveBeenCalledTimes(2)
  })

  it('drops an unterminated record when a new boot begins', () => {
    const tap = createAgentProductEventTap(BASE)
    const line = envelope()
    tap.ingest(line.slice(0, 30), 'stdout')
    tap.beginBoot()
    tap.ingest(`${line.slice(30)}\n`, 'stdout')
    expect(telemetry.capture).not.toHaveBeenCalled()
  })

  it('contains telemetry sink failures and continues parsing', () => {
    vi.mocked(telemetry.capture).mockImplementationOnce(() => {
      throw new Error('capture failed')
    })
    vi.mocked(telemetry.emit).mockImplementationOnce(() => {
      throw new Error('health emit failed')
    })
    const tap = createAgentProductEventTap(BASE)

    expect(() => tap.ingest(`${envelope()}\n${envelope()}\n`, 'stdout')).not.toThrow()
    expect(telemetry.capture).toHaveBeenCalledTimes(2)
  })
})
