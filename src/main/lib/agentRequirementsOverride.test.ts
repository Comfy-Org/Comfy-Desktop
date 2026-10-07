import { describe, expect, it } from 'vitest'
import {
  START_FAILURES_TO_REVERT,
  classifyAgentEvent,
  createAgentStartWatcher,
  effectiveAgentRequirements,
  isRevertedFor,
  nextOverrideState,
  overrideChangesOthers,
  overrideSignature,
  parseAgentRequirementsOverride,
  parseDryRun,
  readOverrideState
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

  it('refuses more entries than there are overridable packages', () => {
    const raw = { 'comfy-agent': '1', 'comfy-cli': '1', 'nodejs-wheel-binaries': '1', x: '1' }
    expect(parseAgentRequirementsOverride(raw)).toEqual({ kind: 'refused', reason: 'too_many' })
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
    // Core shipping a bare `comfy-agent` is why: going back to it would leave the override in place.
    for (const core of ['comfy-agent\n', 'comfy-agent>=0.2\n', 'comfy-agent[extra]==0.2\n'])
      expect(effectiveAgentRequirements(core, pins({ 'comfy-agent': '0.2.3' }))).toEqual({
        kind: 'refused',
        reason: 'unsupported_line'
      })
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

describe('the dry-run check', () => {
  const OVERRIDE_DRY = [
    'Resolved 50 packages in 251ms',
    'Would uninstall 2 packages',
    ' - comfy-cli==1.21.0',
    ' + comfy-cli==1.20.0',
    ' + new-dep==1.0.0'
  ].join('\n')

  it('reads targets and replacements out of uv output', () => {
    expect(parseDryRun(OVERRIDE_DRY)).toEqual({
      installs: new Map([
        ['comfy-cli', '1.20.0'],
        ['new-dep', '1.0.0']
      ]),
      replaces: new Set(['comfy-cli'])
    })
  })

  it('reads coloured output', () => {
    expect(parseDryRun('\u001b[31m - \u001b[0mrequests==2.0.0').replaces).toEqual(
      new Set(['requests'])
    )
  })

  it('allows changes to the overridden packages and packages only the override adds', () => {
    const core = parseDryRun('Would make no changes')
    expect(
      overrideChangesOthers(parseDryRun(OVERRIDE_DRY), core, pins({ 'comfy-cli': '1.20.0' }))
    ).toBe(false)
  })

  it('flags an installed package the override would move and core would not', () => {
    const effective = parseDryRun(' - requests==2.32.0\n + requests==2.31.0')
    const core = parseDryRun('Would make no changes')
    expect(overrideChangesOthers(effective, core, pins({ 'comfy-cli': '1.20.0' }))).toBe(true)
  })

  it('flags an installed package core would move and the override would leave behind', () => {
    const effective = parseDryRun('Would make no changes')
    const core = parseDryRun(' - requests==2.31.0\n + requests==2.32.0')
    expect(overrideChangesOthers(effective, core, pins({ 'comfy-cli': '1.20.0' }))).toBe(true)
  })

  it('allows a move core itself makes to the same version', () => {
    const lines = ' - requests==2.31.0\n + requests==2.32.0'
    expect(
      overrideChangesOthers(parseDryRun(lines), parseDryRun(lines), pins({ 'comfy-cli': '1.20.0' }))
    ).toBe(false)
  })
})

describe('agent start classification', () => {
  const outcome = (line: string): AgentStartOutcome | undefined => {
    const event = classifyAgentEvent(line)
    return event && 'outcome' in event ? event.outcome : undefined
  }

  it('reads a start, with or without the log-level prefix', () => {
    expect(outcome('[agent-event] agent_started duration_ms=4300 agent_version=0.2.3')).toBe(
      'started'
    )
    expect(outcome('[INFO] [agent-event] agent_started duration_ms=1')).toBe('started')
    expect(outcome('\u001b[32m[INFO] [agent-event] agent_started\u001b[0m')).toBe('started')
  })

  it('counts an error and a failed health check as failures', () => {
    expect(outcome('[agent-event] agent_error reason=spawn_failed')).toBe('failed')
    expect(outcome('[agent-event] health_check_failed reason=crashed')).toBe('failed')
  })

  it('does not count a declined permission prompt', () => {
    expect(outcome('[agent-event] agent_error reason=permission_denied')).toBe('inconclusive')
  })

  it('ignores an exit, a missing package and a slow start', () => {
    // Core prints agent_exited on every stop, including a user quitting during a slow start.
    for (const line of [
      '[agent-event] agent_exited code=0',
      '[agent-event] agent_exited code=3',
      '[agent-event] package_missing',
      '[agent-event] agent_waiting duration_ms=60000'
    ])
      expect(classifyAgentEvent(line)).toBeNull()
  })

  it('ignores lines that only mention an event', () => {
    expect(classifyAgentEvent('note: [agent-event] agent_started')).toBeNull()
    expect(classifyAgentEvent('[agent-event] agent_started  extra')).toBeNull()
  })

  it('reads the version the agent is starting', () => {
    expect(classifyAgentEvent('[agent-event] agent_starting agent_version=0.2.3')).toEqual({
      agentVersion: '0.2.3'
    })
  })
})

describe('createAgentStartWatcher', () => {
  it('settles once, on the first verdict, across chunk boundaries', () => {
    const outcomes: AgentStartOutcome[] = []
    const versions: string[] = []
    const watch = createAgentStartWatcher({
      onOutcome: (o) => outcomes.push(o),
      onAgentVersion: (v) => versions.push(v)
    })
    watch.ingest(
      '[agent-event] agent_starting agent_version=0.2.3\n[agent-event] health_che',
      'stderr'
    )
    expect(outcomes).toEqual([])
    watch.ingest('ck_failed reason=crashed\n[agent-event] agent_started\n', 'stderr')
    watch.ingest('[agent-event] agent_error reason=crashed\n', 'stdout')
    expect(versions).toEqual(['0.2.3'])
    expect(outcomes).toEqual(['failed'])
  })

  it('decides nothing for a session that ends before a verdict', () => {
    const outcomes: AgentStartOutcome[] = []
    const watch = createAgentStartWatcher({ onOutcome: (o) => outcomes.push(o) })
    watch.ingest('[agent-event] agent_starting\n[agent-event] agent_exited code=0\n', 'stderr')
    expect(outcomes).toEqual([])
  })
})

describe('the start-failure latch', () => {
  const p = pins({ 'comfy-agent': '0.2.3' })

  it(`reverts on the ${START_FAILURES_TO_REVERT}nd consecutive failure, and reports it once`, () => {
    const first = nextOverrideState(null, p, 'failed')!
    expect(first).toEqual({
      state: { signature: 'comfy-agent==0.2.3', failures: 1, reverted: false },
      reverted: false
    })
    const second = nextOverrideState(first.state, p, 'failed')!
    expect(second.reverted).toBe(true)
    expect(isRevertedFor(second.state, p)).toBe(true)
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
    const state = { signature: overrideSignature(p), failures: 1, reverted: false }
    const record = (value: unknown): InstallationRecord =>
      ({ id: 'i', agentRequirementsOverride: value }) as unknown as InstallationRecord
    expect(readOverrideState(record(state))).toEqual(state)
    expect(readOverrideState(record(undefined))).toBeNull()
    expect(readOverrideState(record({ signature: 'x', failures: '1', reverted: false }))).toBeNull()
  })
})
