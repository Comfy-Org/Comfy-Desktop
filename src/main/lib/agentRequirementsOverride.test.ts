import { describe, expect, it, vi } from 'vitest'
import * as telemetry from './telemetry'
import {
  START_FAILURES_TO_REVERT,
  classifyAgentEvent,
  coreFileInstalled,
  createAgentStartWatcher,
  effectiveAgentRequirements,
  installedConstraints,
  isRevertedFor,
  nextOverrideState,
  overrideSignature,
  parseAgentRequirementsOverride,
  pinsOverBareLines,
  compareVersions,
  readOverrideState,
  reportOverrideDecision
} from './agentRequirementsOverride'
import type { AgentStartOutcome, OverridePins } from './agentRequirementsOverride'
import type { InstallationRecord } from '../installations'

const pins = (entries: Record<string, string>): OverridePins => new Map(Object.entries(entries))

describe('parseAgentRequirementsOverride', () => {
  it('reads exact versions for the overridable packages', () => {
    const parsed = parseAgentRequirementsOverride({ 'comfy-agent': '0.2.3', Comfy_CLI: '1.22.0' })
    expect(parsed).toEqual({
      kind: 'pins',
      pins: pins({ 'comfy-agent': '0.2.3', 'comfy-cli': '1.22.0' })
    })
  })

  it('accepts pre-release, post and dev segments', () => {
    for (const version of ['1.0.0rc1', '1.0.0a2', '1.0.0.post1', '1.0.0.dev3', '2'])
      expect(parseAgentRequirementsOverride({ 'comfy-agent': version }).kind).toBe('pins')
  })

  it('treats an absent or empty field as no override', () => {
    expect(parseAgentRequirementsOverride(undefined)).toEqual({ kind: 'none' })
    expect(parseAgentRequirementsOverride(null)).toEqual({ kind: 'none' })
    expect(parseAgentRequirementsOverride({})).toEqual({ kind: 'none' })
  })

  it('refuses anything that is not a plain object', () => {
    for (const raw of ['comfy-agent==1.0', 3, true, [['comfy-agent', '1.0']]])
      expect(parseAgentRequirementsOverride(raw)).toEqual({ kind: 'refused', reason: 'not_object' })
  })

  it('refuses a package outside the allowlist', () => {
    expect(parseAgentRequirementsOverride({ requests: '2.0.0' })).toEqual({
      kind: 'refused',
      reason: 'unknown_package'
    })
  })

  it('refuses one package named twice under two spellings', () => {
    expect(parseAgentRequirementsOverride({ 'comfy-cli': '1.0', comfy_cli: '1.1' })).toEqual({
      kind: 'refused',
      reason: 'unknown_package'
    })
  })

  it('refuses a fourth entry, which can only be a package outside the allowlist', () => {
    const raw = { 'comfy-agent': '1', 'comfy-cli': '1', 'nodejs-wheel-binaries': '1', x: '1' }
    expect(parseAgentRequirementsOverride(raw)).toEqual({
      kind: 'refused',
      reason: 'unknown_package'
    })
  })

  it('refuses anything but an exact public version, including smuggled options', () => {
    for (const version of [
      '>=1.0',
      '==1.0',
      '1.0 --index-url https://evil.example/simple',
      '1.0\n--find-links /tmp',
      '1.0; sys_platform=="win32"',
      '1.0+local',
      ' 1.0',
      '1.0 ',
      'latest',
      '',
      1.0
    ]) {
      expect(parseAgentRequirementsOverride({ 'comfy-agent': version })).toEqual({
        kind: 'refused',
        reason: 'bad_version'
      })
    }
  })

  it('refuses the whole payload when only one entry is bad', () => {
    expect(
      parseAgentRequirementsOverride({ 'comfy-agent': '0.2.3', 'comfy-cli': '>=1' }).kind
    ).toBe('refused')
  })
})

describe('effectiveAgentRequirements', () => {
  it('replaces the pinned lines and leaves every other line as core wrote it', () => {
    const core = '# agent\ncomfy-agent==0.2.0\n-r extra.txt\ncomfy-cli==1.21.0  # cli\n'
    expect(effectiveAgentRequirements(core, pins({ 'comfy-agent': '0.2.3' }))).toEqual({
      kind: 'text',
      text: '# agent\ncomfy-agent==0.2.3\n-r extra.txt\ncomfy-cli==1.21.0  # cli\n'
    })
  })

  it('matches core lines by normalised name', () => {
    const result = effectiveAgentRequirements(
      'Comfy_CLI == 1.21.0\n',
      pins({ 'comfy-cli': '1.22.0' })
    )
    expect(result).toEqual({ kind: 'text', text: 'Comfy_CLI==1.22.0\n' })
  })

  it('refuses an override for a line core did not pin exactly', () => {
    for (const core of [
      'comfy-agent>=0.2\n',
      'comfy-agent[extra]==0.2\n',
      'comfy-agent==0.2.*\n',
      'comfy-agent; sys_platform == "win32"\n',
      'comfy-agent[extra]\n'
    ])
      expect(
        effectiveAgentRequirements(core, pins({ 'comfy-agent': '0.2.3' })),
        `going back to "${core.trim()}" would not undo the override`
      ).toEqual({ kind: 'refused', reason: 'unsupported_line' })
  })

  it('lets any exact pin replace a line core left unpinned, older or newer', () => {
    const core = 'comfy-agent\ncomfy-cli==1.21.0\n'
    for (const version of ['0.2.3', '0.0.1'])
      expect(effectiveAgentRequirements(core, pins({ 'comfy-agent': version }))).toEqual({
        kind: 'text',
        text: `comfy-agent==${version}\ncomfy-cli==1.21.0\n`
      })
  })

  it('refuses an override that is not newer than core pins', () => {
    for (const version of ['0.2.0', '0.2', '0.1.9', '0.2.0rc1', '0.2.0.dev1'])
      expect(
        effectiveAgentRequirements('comfy-agent==0.2.0\n', pins({ 'comfy-agent': version })),
        `${version} would not be an upgrade over core's 0.2.0`
      ).toEqual({ kind: 'refused', reason: 'not_newer' })
    expect(
      effectiveAgentRequirements('comfy-agent==0.2.0\n', pins({ 'comfy-agent': '0.2.0.post1' }))
        .kind
    ).toBe('text')
  })

  it('refuses a line with an environment marker', () => {
    const core = 'comfy-agent==0.2.0; sys_platform == "win32"\n'
    expect(effectiveAgentRequirements(core, pins({ 'comfy-agent': '0.2.3' }))).toEqual({
      kind: 'refused',
      reason: 'unsupported_line'
    })
  })

  it('refuses a package core lists twice', () => {
    const core = 'comfy-cli==1.21.0\ncomfy-cli==1.21.0\n'
    expect(effectiveAgentRequirements(core, pins({ 'comfy-cli': '1.22.0' }))).toEqual({
      kind: 'refused',
      reason: 'unsupported_line'
    })
  })

  it('never adds a package core does not list', () => {
    expect(
      effectiveAgentRequirements('comfy-agent==0.2.0\n', pins({ 'comfy-cli': '1.0' }))
    ).toEqual({ kind: 'refused', reason: 'not_in_core_file' })
  })
})

describe('installedConstraints', () => {
  const LIST =
    'Using Python 3.12.4 environment at: .venv\n' +
    JSON.stringify([
      { name: 'comfy-cli', version: '1.21.0' },
      { name: 'requests', version: '2.32.0' },
      { name: 'my-node-dep', version: '0.1.0', editable_project_location: '/x' },
      { name: 'Nodejs_Wheel_Binaries', version: '24.19.0' }
    ])

  it("holds every installed package but the agent's own at its installed version", () => {
    expect(installedConstraints(LIST)).toBe('requests==2.32.0\nmy-node-dep==0.1.0\n')
  })

  it('finds the list among the lines uv prints on stderr, before or after it', () => {
    const after = `${JSON.stringify([{ name: 'requests', version: '2.32.0' }])}\nwarning: cache is stale\n`
    expect(installedConstraints(LIST)).toContain('requests==2.32.0')
    expect(installedConstraints(after)).toBe('requests==2.32.0\n')
  })

  it('cannot be read from anything but a list of named, versioned packages', () => {
    expect(installedConstraints('error: no virtual environment found')).toBeNull()
    expect(installedConstraints('[{"name": "requests"}]')).toBeNull()
    expect(installedConstraints('{"name": "requests", "version": "1"}')).toBeNull()
  })
})

describe('coreFileInstalled', () => {
  const CORE = '# agent\ncomfy-agent\ncomfy-cli==1.21.0\nnodejs-wheel-binaries==24.19.0\n'
  const list = (...names: string[]): string =>
    JSON.stringify(names.map((name) => ({ name, version: '1.0' })))

  it('holds once every package core names is installed, whatever its version or spelling', () => {
    expect(coreFileInstalled(CORE, list('Comfy_Agent', 'comfy-cli', 'Nodejs.Wheel-Binaries'))).toBe(
      true
    )
  })

  it("does not hold while any one of core's packages is missing", () => {
    expect(coreFileInstalled(CORE, list('comfy-cli', 'nodejs-wheel-binaries', 'requests'))).toBe(
      false
    )
    expect(coreFileInstalled(CORE, list())).toBe(false)
  })

  it('does not wait on a line uv may never install here: a marker, a URL or a path', () => {
    const extra =
      'pywin32==306 ; sys_platform == "win32"\n' +
      'https://example.com/pkg-1.0-py3-none-any.whl\n' +
      'git+https://github.com/org/pkg\n' +
      'wheels/pkg-1.0-py3-none-any.whl\n' +
      'C:\\vendor\\pkg-1.0-py3-none-any.whl\n'
    const installed = list('comfy-agent', 'comfy-cli', 'nodejs-wheel-binaries')

    expect(coreFileInstalled(CORE + extra, installed)).toBe(true)
  })

  it("still waits on a pinned line whose comment mentions a URL or a ';'", () => {
    const commented = 'comfy-agent==0.0.1  # see https://example.com; pinned by core\n'
    const installed = list('comfy-cli', 'nodejs-wheel-binaries')

    expect(coreFileInstalled(commented, installed)).toBe(false)
  })
})

describe('agent start classification', () => {
  const outcome = (line: string): AgentStartOutcome | null => classifyAgentEvent(line)

  it('reads a start, with or without the log-level prefix', () => {
    expect(outcome('[agent-event] agent_started duration_ms=4300 agent_version=0.2.3')).toBe(
      'started'
    )
    expect(outcome('[INFO] [agent-event] agent_started duration_ms=1')).toBe('started')
    expect(outcome('\u001b[32m[INFO] [agent-event] agent_started\u001b[0m')).toBe('started')
  })

  it('counts an error, a failed health check and a missing package as failures', () => {
    expect(outcome('[agent-event] agent_error reason=spawn_failed')).toBe('failed')
    expect(outcome('[agent-event] health_check_failed reason=crashed')).toBe('failed')
    expect(
      outcome('[agent-event] package_missing'),
      'an override that broke comfy-cli or node leaves the agent off'
    ).toBe('failed')
  })

  it('does not count a declined permission prompt', () => {
    expect(outcome('[agent-event] agent_error reason=permission_denied')).toBe('inconclusive')
  })

  it('ignores an exit and a slow start', () => {
    for (const line of [
      '[agent-event] agent_exited code=0',
      '[agent-event] agent_exited code=3',
      '[agent-event] agent_waiting duration_ms=60000'
    ])
      expect(classifyAgentEvent(line)).toBeNull()
  })

  it('reads a record logged behind a progress-bar redraw', () => {
    expect(
      outcome(' 45%|####      | 9/20 [INFO] [agent-event] health_check_failed reason=crashed')
    ).toBe('failed')
  })

  it("ignores the agent's own output relayed by core, and malformed records", () => {
    expect(classifyAgentEvent('[comfy-agent] [agent-event] agent_started')).toBeNull()
    expect(classifyAgentEvent('[agent-event] agent_started  extra')).toBeNull()
  })
})

describe('createAgentStartWatcher', () => {
  it('settles once, on the first verdict, across chunk boundaries', () => {
    const outcomes: AgentStartOutcome[] = []
    const watch = createAgentStartWatcher((o) => outcomes.push(o))
    watch.ingest(
      '[agent-event] agent_starting agent_version=0.2.3\n[agent-event] health_che',
      'stderr'
    )
    expect(outcomes).toEqual([])
    watch.ingest('ck_failed reason=crashed\n[agent-event] agent_started\n', 'stderr')
    watch.ingest('[agent-event] agent_error reason=crashed\n', 'stdout')
    expect(outcomes).toEqual(['failed'])
  })

  it('decides nothing for a session that ends before a verdict', () => {
    const outcomes: AgentStartOutcome[] = []
    const watch = createAgentStartWatcher((o) => outcomes.push(o))
    watch.ingest('[agent-event] agent_starting\n[agent-event] agent_exited code=0\n', 'stderr')
    expect(outcomes).toEqual([])
  })
})

describe('the start-failure latch', () => {
  const p = pins({ 'comfy-agent': '0.2.3' })

  it(`reverts on the ${START_FAILURES_TO_REVERT}nd consecutive failure, and reports it once`, () => {
    const first = nextOverrideState(null, p, 'failed')!
    expect(first).toEqual({
      state: { signature: 'comfy-agent==0.2.3', failures: 1 },
      reverted: false
    })
    const second = nextOverrideState(first.state, p, 'failed')!
    expect(second.reverted).toBe(true)
    expect(isRevertedFor(second.state, p)).toBe(true)
    const third = nextOverrideState(second.state, p, 'failed')!
    expect(third.reverted, 'only the tipping failure reports the revert').toBe(false)
    expect(isRevertedFor(third.state, p)).toBe(true)
  })

  it('resets the count on a successful start', () => {
    const first = nextOverrideState(null, p, 'failed')!
    const started = nextOverrideState(first.state, p, 'started')!
    expect(started.state.failures).toBe(0)
    expect(nextOverrideState(started.state, p, 'failed')!.reverted).toBe(false)
  })

  it('leaves the state alone for an inconclusive start', () => {
    expect(nextOverrideState(null, p, 'inconclusive')).toBeNull()
  })

  it('gives a new version a fresh count and a fresh try', () => {
    const reverted = nextOverrideState(nextOverrideState(null, p, 'failed')!.state, p, 'failed')!
    const next = pins({ 'comfy-agent': '0.2.4' })
    expect(isRevertedFor(reverted.state, next)).toBe(false)
    expect(nextOverrideState(reverted.state, next, 'failed')!.state.failures).toBe(1)
  })

  it('reads its state back off the install record, ignoring anything malformed', () => {
    const state = { signature: overrideSignature(p), failures: 1 }
    const record = (value: unknown): InstallationRecord =>
      ({ id: 'i', agentRequirementsOverride: value }) as unknown as InstallationRecord
    expect(readOverrideState(record(state))).toEqual(state)
    expect(readOverrideState(record(undefined))).toBeNull()
    expect(readOverrideState(record({ signature: 'x', failures: '1' }))).toBeNull()
  })
})

describe('overrideSignature', () => {
  it('names one override the same whatever order the payload listed it in', () => {
    const a = overrideSignature(pins({ 'comfy-cli': '1.22.0', 'comfy-agent': '0.2.3' }))
    const b = overrideSignature(pins({ 'comfy-agent': '0.2.3', 'comfy-cli': '1.22.0' }))
    expect(a).toBe('comfy-agent==0.2.3,comfy-cli==1.22.0')
    expect(b).toBe(a)
  })
})

describe('compareVersions', () => {
  it('orders versions the way pip does', () => {
    const ascending = [
      '0.9.9',
      '1.0.dev1',
      '1.0a1.dev1',
      '1.0a1',
      '1.0a2',
      '1.0b1',
      '1.0rc1',
      '1.0rc1.post1',
      '1.0',
      '1.0.post1.dev1',
      '1.0.post1',
      '1.0.1',
      '1.10',
      '2'
    ]
    for (let i = 1; i < ascending.length; i++) {
      expect(
        compareVersions(ascending[i - 1]!, ascending[i]!),
        `${ascending[i - 1]} < ${ascending[i]}`
      ).toBe(-1)
      expect(compareVersions(ascending[i]!, ascending[i - 1]!)).toBe(1)
    }
  })

  it('treats trailing zero release segments as equal', () => {
    expect(compareVersions('1.0', '1.0.0.0')).toBe(0)
    expect(compareVersions('2', '2.0')).toBe(0)
  })
})

describe('pinsOverBareLines', () => {
  it('names only the pins over lines core left unversioned', () => {
    const core = 'Comfy_Agent\ncomfy-cli==1.21.0\nnodejs-wheel-binaries\n'
    expect(
      pinsOverBareLines(core, pins({ 'comfy-agent': '0.2.3', 'comfy-cli': '1.22.0' }))
    ).toEqual(['comfy-agent'])
  })
})

describe('reportOverrideDecision', () => {
  it('reports what stays installed after a revert', () => {
    const emit = vi.spyOn(telemetry, 'emit').mockImplementation(() => {})

    reportOverrideDecision('i', {
      decision: 'reverted',
      reason: 'previously_failed',
      pins: pins({ 'comfy-agent': '0.2.3' }),
      staysInstalled: pins({ 'comfy-agent': '0.2.3' })
    })

    expect(emit.mock.calls[0]![1]).toMatchObject({ stays_installed: 'comfy-agent==0.2.3' })
    emit.mockRestore()
  })

  it('never lets a failing telemetry sink reach the launch', () => {
    vi.spyOn(telemetry, 'emit').mockImplementation(() => {
      throw new Error('sink down')
    })

    expect(() =>
      reportOverrideDecision('i', { decision: 'refused', reason: 'bad_version' })
    ).not.toThrow()
  })
})
