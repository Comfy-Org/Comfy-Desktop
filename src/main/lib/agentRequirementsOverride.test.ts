import { describe, expect, it, vi } from 'vitest'
import * as telemetry from './telemetry'
import {
  START_FAILURES_TO_REVERT,
  classifyAgentEvent,
  coreFileInstalled,
  coreFrontendVersion,
  createAgentStartWatcher,
  effectiveAgentRequirements,
  installedConstraints,
  isRevertedFor,
  nextOverrideState,
  overrideSignature,
  parseAgentRequirementsOverride,
  pinsOverBareLines,
  compareVersions,
  readFrontendPin,
  readOverrideState,
  reportOverrideDecision
} from './agentRequirementsOverride'
import type { AgentStartOutcome, OverridePin, OverridePins } from './agentRequirementsOverride'
import type { InstallationRecord } from '../installations'

const pins = (entries: Record<string, OverridePin>): OverridePins =>
  new Map(Object.entries(entries))

const WHEEL =
  'https://github.com/Comfy-Org/ComfyUI-private/releases/download/v1/comfy_agent-0.0.1.dev120-py3-none-manylinux2014_x86_64.whl'
const LINUX = 'sys_platform == "linux" and platform_machine == "x86_64"'
const WIN = 'sys_platform == "win32"'

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

  it('accepts an epoch', () => {
    for (const version of ['1!2.3.4', '0!1.0', '12!0', '1!2.3.4rc1.post2.dev3'])
      expect(parseAgentRequirementsOverride({ 'comfy-agent': version }), version).toEqual({
        kind: 'pins',
        pins: pins({ 'comfy-agent': version })
      })
  })

  it('refuses a malformed epoch', () => {
    for (const version of ['!1.0', '1!', '1!!2', 'a!1.0', '1!2!3', '-1!1.0', '1.0!2', '1 !2.0'])
      expect(parseAgentRequirementsOverride({ 'comfy-agent': version }), version).toEqual({
        kind: 'refused',
        reason: 'bad_version'
      })
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

  it('reads URL entries, with or without a marker, spaced the one way', () => {
    const raw = { 'comfy-agent': [`${WHEEL};${LINUX}`, `  ${WHEEL}  `] }
    expect(parseAgentRequirementsOverride(raw)).toEqual({
      kind: 'pins',
      pins: pins({ 'comfy-agent': [`${WHEEL} ; ${LINUX}`, WHEEL] })
    })
  })

  it('accepts the marker grammar: quotes, comparisons, parentheses, membership', () => {
    for (const marker of [
      "(sys_platform == 'darwin' or os_name != \"nt\") and python_version >= '3.10'",
      'platform_machine in "x86_64,AMD64"',
      'python_full_version ~= "3.12.0"'
    ])
      expect(
        parseAgentRequirementsOverride({ 'comfy-agent': [`${WHEEL} ; ${marker}`] }).kind,
        marker
      ).toBe('pins')
  })

  it('takes a wheel from any Comfy-Org path on GitHub or any tailnet host (QA builds only)', () => {
    for (const entry of [
      'https://lab-linux-build.fennec-typhon.ts.net/obl-118/wheels/comfy_agent-0.0.2.dev9123-py3-none-any.whl',
      'https://simon-qa-linux-1.fennec-typhon.ts.net/other/dir/comfyui_frontend_package-1.57.0.dev1184-py3-none-any.whl',
      'https://lab-linux-build.fennec-typhon.ts.net:8443/a-1.0-py3-none-any.whl',
      'https://fennec-typhon.ts.net/a-1.0-py3-none-any.whl',
      'https://github.com/Comfy-Org/ComfyUI-private/raw/main/dist/a-1.0-py3-none-any.whl'
    ])
      expect(
        parseAgentRequirementsOverride({
          'comfy-agent': [entry],
          'comfyui-frontend-package': [entry]
        }).kind,
        entry
      ).toBe('pins')
  })

  it('refuses a host or path that only looks like an allowed one', () => {
    for (const entry of [
      'https://evil.example/?x=fennec-typhon.ts.net/a.whl',
      'https://evil.example/fennec-typhon.ts.net/a.whl',
      'https://evilfennec-typhon.ts.net/a.whl',
      'https://fennec-typhon.ts.net.evil.example/a.whl',
      'https://lab-linux-build.fennec-typhon.ts.net.evil.example/obl-118/wheels/a.whl',
      'https://github.com.evil.example/Comfy-Org/a.whl',
      'https://evil.example/github.com/Comfy-Org/a.whl',
      'https://github.com@evil.example/Comfy-Org/a.whl',
      'https://user@github.com/Comfy-Org/a.whl',
      'https://user:pw@lab-linux-build.fennec-typhon.ts.net/a.whl',
      'https://GitHub.com/Comfy-Org/a.whl',
      'https://LAB-linux-build.fennec-typhon.ts.net/a.whl',
      'https://github.com:8443/Comfy-Org/a.whl',
      'https://github.com/Comfy-Orgx/a.whl',
      'https://github.com/comfy-org/a.whl',
      'https://github.com/someone/Comfy-Org/a.whl',
      'http://lab-linux-build.fennec-typhon.ts.net/a.whl',
      'https://lab-linux-build.fennec-typhon.ts.net/a.tar.gz',
      'https://lab-linux-build.fennec-typhon.ts.net/a/../../b.whl',
      'https://lab-linux-build.fennec-typhon.ts.net/a"b.whl'
    ])
      expect(parseAgentRequirementsOverride({ 'comfy-agent': [entry] }), entry).toEqual({
        kind: 'refused',
        reason: 'bad_url'
      })
  })

  it('refuses a URL entry that is not https or could smuggle anything into the file', () => {
    for (const entry of [
      'http://example.com/a.whl',
      'https://example.com/comfy_agent-0.2.3-py3-none-any.whl',
      'https://github.com/someone-else/comfy_agent-0.2.3-py3-none-any.whl',
      'https://github.com/Comfy-Org/../someone-else/a.whl',
      'https://github.com/Comfy-Org/%2e%2e/someone-else/a.whl',
      'https://github.com/Comfy-Org/ComfyUI-private/releases/download/v1/comfy_agent-0.2.3.tar.gz',
      'https://github.com/Comfy-Org/comfy-cli/archive/refs/heads/main.tar.gz?file=a.whl',
      'https://github.com/Comfy-Org/ComfyUI-private/releases/download/v1/a.whl#sha256=ab',
      'file:///tmp/a.whl',
      'https://github.com/Comfy-Org/ComfyUI-private/releases/download/v1/${TOKEN}.whl',
      'https://github.com/Comfy-Org/ComfyUI-private/releases/download/v1/a\\b.whl',
      `${WHEEL} ; sys_platform == "win32" \\`,
      'https://github.com/Comfy-Org/ComfyUI-private/releases/download/v1/a b.whl',
      `${WHEEL} ; ${WIN} ; ${LINUX}`,
      `${WHEEL} ; ${WIN} # c`,
      `${WHEEL} ; ${WIN}\n-r extra.txt`,
      `${WHEEL}\n-rx.whl`,
      `${WHEEL}\r--index-url=https://evil/x.whl`,
      `${WHEEL}\x85--index-url=https://evil/x.whl`,
      `${WHEEL} ; sys_platform == "linux" --no-deps`,
      `${WHEEL} ; sys_platform == "linux" -C k=v`,
      `${WHEEL} ; sys_platform\t== "win32"`,
      `${WHEEL} ;`,
      3
    ])
      expect(
        parseAgentRequirementsOverride({ 'comfy-agent': [entry] }),
        JSON.stringify(entry)
      ).toEqual({ kind: 'refused', reason: 'bad_url' })
    expect(
      parseAgentRequirementsOverride({ 'comfy-agent': [WHEEL, `${WHEEL} ; ${WIN}\n-r extra.txt`] })
    ).toEqual({ kind: 'refused', reason: 'bad_url' })
    expect(parseAgentRequirementsOverride({ 'comfy-agent': [] })).toEqual({
      kind: 'refused',
      reason: 'bad_url'
    })
  })

  it('refuses the whole payload when only one entry is bad', () => {
    expect(
      parseAgentRequirementsOverride({ 'comfy-agent': '0.2.3', 'comfy-cli': '>=1' }).kind
    ).toBe('refused')
  })
})

describe('effectiveAgentRequirements', () => {
  it('honours the newer-than rule across epochs', () => {
    expect(
      effectiveAgentRequirements('comfy-agent==9.9\n', pins({ 'comfy-agent': '1!0.1' }))
    ).toEqual({ kind: 'text', text: 'comfy-agent==1!0.1\n' })
    for (const version of ['9.9', '99.0', '1!2.0'])
      expect(
        effectiveAgentRequirements('comfy-agent==1!2.0\n', pins({ 'comfy-agent': version })),
        version
      ).toEqual({ kind: 'refused', reason: 'not_newer' })
    expect(
      effectiveAgentRequirements('comfy-agent==1!2.0\n', pins({ 'comfy-agent': '1!2.0.1' }))
    ).toEqual({ kind: 'text', text: 'comfy-agent==1!2.0.1\n' })
  })

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

  it("pins each of core's per-platform URL lines to an exact version, keeping its marker", () => {
    const core = `comfy-agent @ ${WHEEL} ; ${LINUX}\ncomfy-agent @ ${WHEEL}#sha256=ab ; ${WIN} # w\ncomfy-cli==1.21.0\n`
    expect(effectiveAgentRequirements(core, pins({ 'comfy-agent': '0.0.1' }))).toEqual({
      kind: 'text',
      text: `comfy-agent==0.0.1 ; ${LINUX}\ncomfy-agent==0.0.1 ; ${WIN}\ncomfy-cli==1.21.0\n`
    })
    expect(
      effectiveAgentRequirements(`comfy-agent @ ${WHEEL}\n`, pins({ 'comfy-agent': '0.0.1' }))
    ).toEqual({ kind: 'text', text: 'comfy-agent==0.0.1\n' })
  })

  it("replaces core's URL or bare lines with the override's URL lines, once", () => {
    const override = pins({ 'comfy-agent': [`${WHEEL} ; ${LINUX}`, WHEEL] })
    const expected = `comfy-agent @ ${WHEEL} ; ${LINUX}\ncomfy-agent @ ${WHEEL}\n`
    for (const core of [
      `comfy-agent @ ${WHEEL} ; ${LINUX}  # poc\ncomfy-agent @ ${WHEEL} ; ${WIN} \n`,
      `comfy-agent @ ${WHEEL}  # poc\n`,
      'comfy-agent\n'
    ])
      expect(effectiveAgentRequirements(core, override)).toEqual({ kind: 'text', text: expected })
  })

  it('puts a URL override over a line core pinned, since a build has no version to compare', () => {
    expect(
      effectiveAgentRequirements('comfy-agent==9.0\n', pins({ 'comfy-agent': [WHEEL] }))
    ).toEqual({ kind: 'text', text: `comfy-agent @ ${WHEEL}\n` })
  })

  it('refuses a line core continues onto the next', () => {
    for (const core of [
      `comfy-agent @ ${WHEEL}\\\n    --hash=sha256:ab\n`,
      `comfy-agent @ ${WHEEL} ; sys_platform == "linux" and \\ \n    platform_machine == "x86_64"\n`
    ])
      expect(effectiveAgentRequirements(core, pins({ 'comfy-agent': '0.2.3' }))).toEqual({
        kind: 'refused',
        reason: 'unsupported_line'
      })
  })

  it('refuses a package core lists both as a URL and as a version', () => {
    for (const core of [
      `comfy-agent @ ${WHEEL}\ncomfy-agent==0.2.0\n`,
      `comfy-agent==0.2.0\ncomfy-agent @ ${WHEEL}\n`
    ])
      expect(effectiveAgentRequirements(core, pins({ 'comfy-agent': '0.2.3' }))).toEqual({
        kind: 'refused',
        reason: 'unsupported_line'
      })
  })

  it('refuses a URL line it cannot carry over: not https, extras, or options after the marker', () => {
    for (const core of [
      'comfy-agent @ file:///opt/comfy_agent.whl\n',
      `comfy-agent[extra] @ ${WHEEL}\n`,
      `comfy-agent @ ${WHEEL} ; ${WIN} --hash=sha256:ab\n`,
      // uv reads `url;marker` as one URL, which it can't install anywhere.
      `comfy-agent @ ${WHEEL};sys_platform=="win32"\n`
    ])
      expect(effectiveAgentRequirements(core, pins({ 'comfy-agent': '0.2.3' })), core).toEqual({
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
  it('names a URL override by the lines it installs', () => {
    expect(overrideSignature(pins({ 'comfy-agent': [`${WHEEL} ; ${WIN}`] }))).toBe(
      `comfy-agent @ ${WHEEL} ; ${WIN}`
    )
  })

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

  it('compares the epoch before anything else, and reads a missing one as 0', () => {
    expect(compareVersions('1!0.1', '0.9')).toBe(1)
    expect(compareVersions('1!0.1', '999.0.post9')).toBe(1)
    expect(compareVersions('2!0', '1!999')).toBe(1)
    expect(compareVersions('1!0.1.dev1', '0!9.9')).toBe(1)
    expect(compareVersions('0!1.0', '1.0')).toBe(0)
    expect(compareVersions('1!1.0', '1!1.0.1')).toBe(-1)
  })
})

describe('pinsOverBareLines', () => {
  it('names only the pins over lines core left unversioned', () => {
    const core = 'Comfy_Agent\ncomfy-cli==1.21.0\nnodejs-wheel-binaries\n'
    expect(
      pinsOverBareLines(core, pins({ 'comfy-agent': '0.2.3', 'comfy-cli': '1.22.0' }))
    ).toEqual(new Map([['comfy-agent', '0.2.3']]))
  })
})

describe('reportOverrideDecision', () => {
  it('reports the reverted pins core cannot take back, and null without them', () => {
    const emit = vi.spyOn(telemetry, 'emit').mockImplementation(() => {})
    try {
      const reverted = { decision: 'reverted', reason: 'previously_failed' } as const
      const both = pins({ 'comfy-agent': '0.2.3', 'comfy-cli': '1.22.0' })

      reportOverrideDecision('i', {
        ...reverted,
        pins: both,
        staysInstalled: pins({ 'comfy-agent': '0.2.3' })
      })
      reportOverrideDecision('i', { ...reverted, pins: both })

      expect(
        emit.mock.calls.map(([, props]) => (props as Record<string, unknown>).stays_installed)
      ).toEqual(['comfy-agent==0.2.3', null])
    } finally {
      emit.mockRestore()
    }
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

describe('the frontend package', () => {
  const AGENT = 'comfy-agent==0.2.0\ncomfy-cli==1.21.0\n'
  const MAIN = 'torch\ncomfyui-frontend-package==1.55.18\ncomfyui-workflow-templates==0.1.2\n'

  it('takes an exact version, or URL entries on the same terms as the agent', () => {
    expect(parseAgentRequirementsOverride({ 'comfyui-frontend-package': '1.55.19' })).toEqual({
      kind: 'pins',
      pins: pins({ 'comfyui-frontend-package': '1.55.19' })
    })
    const wheel = 'https://github.com/Comfy-Org/x/releases/download/v1/f-1.0-py3-none-any.whl'
    expect(parseAgentRequirementsOverride({ comfyui_frontend_package: [wheel] })).toEqual({
      kind: 'pins',
      pins: new Map([['comfyui-frontend-package', [wheel]]])
    })
    for (const bad of ['https://example.com/f.whl', 'https://github.com/Comfy-Org/x/f.zip'])
      expect(parseAgentRequirementsOverride({ comfyui_frontend_package: [bad] })).toEqual({
        kind: 'refused',
        reason: 'bad_url'
      })
  })

  it("puts a frontend URL over ComfyUI's exact pin, in the agent's file", () => {
    const wheel = 'https://github.com/Comfy-Org/x/releases/download/v1/f-1.0-py3-none-any.whl'
    expect(
      effectiveAgentRequirements(AGENT, new Map([['comfyui-frontend-package', [wheel]]]), MAIN)
    ).toEqual({
      kind: 'text',
      text: `comfy-agent==0.2.0\ncomfy-cli==1.21.0\ncomfyui-frontend-package @ ${wheel}\n`
    })
  })

  it("is pinned from ComfyUI's requirements.txt and added to the agent's file", () => {
    expect(
      effectiveAgentRequirements(AGENT, pins({ 'comfyui-frontend-package': '1.55.19' }), MAIN)
    ).toEqual({
      kind: 'text',
      text: 'comfy-agent==0.2.0\ncomfy-cli==1.21.0\ncomfyui-frontend-package==1.55.19\n'
    })
  })

  it('goes in beside an agent pin', () => {
    const both = pins({ 'comfy-agent': '0.2.3', 'comfyui-frontend-package': '1.55.19' })
    expect(effectiveAgentRequirements(AGENT, both, MAIN)).toEqual({
      kind: 'text',
      text: 'comfy-agent==0.2.3\ncomfy-cli==1.21.0\ncomfyui-frontend-package==1.55.19\n'
    })
  })

  it("must be newer than ComfyUI's pin, so it retires once ComfyUI catches up", () => {
    for (const version of ['1.55.18', '1.55.17'])
      expect(
        effectiveAgentRequirements(AGENT, pins({ 'comfyui-frontend-package': version }), MAIN)
      ).toEqual({ kind: 'refused', reason: 'not_newer' })
  })

  it("is refused when ComfyUI's requirements.txt doesn't name it", () => {
    const frontend = pins({ 'comfyui-frontend-package': '1.55.19' })
    expect(effectiveAgentRequirements(AGENT, frontend)).toEqual({
      kind: 'refused',
      reason: 'not_in_core_file'
    })
    expect(effectiveAgentRequirements(AGENT, frontend, 'torch\n')).toEqual({
      kind: 'refused',
      reason: 'not_in_core_file'
    })
  })

  it("leaves the agent's file alone when only the agent is pinned", () => {
    expect(effectiveAgentRequirements(AGENT, pins({ 'comfy-agent': '0.2.3' }), MAIN)).toEqual({
      kind: 'text',
      text: 'comfy-agent==0.2.3\ncomfy-cli==1.21.0\n'
    })
  })

  it('is held where it is unless this override pins it', () => {
    const list = JSON.stringify([
      { name: 'comfyui-frontend-package', version: '1.55.18' },
      { name: 'requests', version: '2.32.0' }
    ])
    expect(installedConstraints(list)).toBe('comfyui-frontend-package==1.55.18\nrequests==2.32.0\n')
    expect(installedConstraints(list, pins({ 'comfyui-frontend-package': '1.55.19' }))).toBe(
      'requests==2.32.0\n'
    )
  })

  it("reads ComfyUI's exact pin, or none", () => {
    expect(coreFrontendVersion(MAIN)).toBe('1.55.18')
    expect(coreFrontendVersion('comfyui_frontend_package == 1.2.3  # pinned\n')).toBe('1.2.3')
    expect(coreFrontendVersion('comfyui-frontend-package>=1.0\n')).toBeNull()
    expect(coreFrontendVersion('comfyui-frontend-package\n')).toBeNull()
    expect(coreFrontendVersion('torch\n')).toBeNull()
  })

  it('reads back the recorded version, or none', () => {
    const record = (frontendVersionOverride: unknown): InstallationRecord =>
      ({ frontendVersionOverride }) as unknown as InstallationRecord
    expect(readFrontendPin(record({ version: '1.55.19' }))).toBe('1.55.19')
    for (const bad of [undefined, null, 'x', { version: 3 }])
      expect(readFrontendPin(record(bad))).toBeNull()
  })
})

describe('the agent package name and extras', () => {
  it("decorates the first comfy-agent* line, keeping core's name", () => {
    const core = 'comfy-agent-oss==0.2.0\ncomfy-agent-sdk==1.0\ncomfy-cli==1.21.0\n'
    expect(effectiveAgentRequirements(core, pins({ 'comfy-agent': '0.2.3' }))).toEqual({
      kind: 'text',
      text: 'comfy-agent-oss==0.2.3\ncomfy-agent-sdk==1.0\ncomfy-cli==1.21.0\n'
    })
    expect(
      effectiveAgentRequirements('Comfy_Agent_Python\n', pins({ 'comfy-agent': '1!2.0' }))
    ).toEqual({ kind: 'text', text: 'Comfy_Agent_Python==1!2.0\n' })
  })

  it('still refuses the same agent package named twice', () => {
    expect(
      effectiveAgentRequirements(
        'comfy-agent-oss==0.1\ncomfy-agent-oss==0.2\n',
        pins({ 'comfy-agent': '0.3' })
      )
    ).toEqual({ kind: 'refused', reason: 'unsupported_line' })
  })

  it('cannot name the package: only the comfy-agent key selects the agent line', () => {
    for (const key of ['comfy-agent-oss', 'comfy-agentx', 'comfy-agent-oss[go]'])
      expect(parseAgentRequirementsOverride({ [key]: '1.0' }), key).toEqual({
        kind: 'refused',
        reason: 'unknown_package'
      })
  })

  it('keeps comfy-cli and nodejs-wheel-binaries to their exact names', () => {
    expect(
      effectiveAgentRequirements('comfy-cli-extra==1.0\n', pins({ 'comfy-cli': '1.22.0' }))
    ).toEqual({ kind: 'refused', reason: 'not_in_core_file' })
    expect(
      effectiveAgentRequirements(
        'nodejs-wheel-binaries-x==1.0\n',
        pins({ 'nodejs-wheel-binaries': '24.0.0' })
      )
    ).toEqual({ kind: 'refused', reason: 'not_in_core_file' })
  })

  it('lets a renamed agent package move, holding everything else', () => {
    const list = JSON.stringify([
      { name: 'comfy-agent-oss', version: '0.2.0' },
      { name: 'requests', version: '2.32.0' }
    ])
    expect(installedConstraints(list)).toBe('requests==2.32.0\n')
  })

  it('reads extras from the key, canonicalised and sorted, beside an epoch', () => {
    expect(
      parseAgentRequirementsOverride({
        'comfy-agent[go]': '1!2.0',
        'Comfy_CLI[NonFree, b]': '1.22.0'
      })
    ).toEqual({
      kind: 'pins',
      pins: new Map([
        ['comfy-agent', { version: '1!2.0', extras: ['go'] }],
        ['comfy-cli', { version: '1.22.0', extras: ['b', 'nonfree'] }]
      ])
    })
  })

  it("installs the extras with the version, under core's name", () => {
    const parsed = parseAgentRequirementsOverride({
      'comfy-agent[go]': '1!2.0',
      'comfy-cli[nonfree]': '1.22.0'
    })
    if (parsed.kind !== 'pins') throw new Error('expected pins')
    expect(
      effectiveAgentRequirements('comfy-agent-oss==0.2.0\ncomfy-cli==1.21.0\n', parsed.pins)
    ).toEqual({
      kind: 'text',
      text: 'comfy-agent-oss[go]==1!2.0\ncomfy-cli[nonfree]==1.22.0\n'
    })
    expect(overrideSignature(parsed.pins)).toBe('comfy-agent[go]==1!2.0,comfy-cli[nonfree]==1.22.0')
  })

  it('refuses extras that are not PEP 508 extra names', () => {
    for (const key of [
      'comfy-agent[]',
      'comfy-agent[go;x]',
      'comfy-agent[-go]',
      'comfy-agent[go-]',
      'comfy-agent[go,]',
      'comfy-agent[g o]',
      'comfy-agent[go==1]',
      'comfy-agent[go@https://x]',
      'comfy-agent[$X]'
    ])
      expect(parseAgentRequirementsOverride({ [key]: '1.0' }), key).toEqual({
        kind: 'refused',
        reason: 'bad_extra'
      })
    for (const key of ['comfy-agent[go]]', 'comfy-agent [go]', 'comfy-agent[go'])
      expect(parseAgentRequirementsOverride({ [key]: '1.0' }), key).toEqual({
        kind: 'refused',
        reason: 'unknown_package'
      })
  })

  it('still refuses a bad version when the extras are fine', () => {
    expect(parseAgentRequirementsOverride({ 'comfy-agent[go]': '>=1.0' })).toEqual({
      kind: 'refused',
      reason: 'bad_version'
    })
  })
})

describe('extras on a URL pin (QA tier)', () => {
  const lab = 'https://lab-linux-build.fennec-typhon.ts.net/obl-118/wheels/'
  const wheel = `${lab}comfy_agent-0.0.2.dev9123-py3-none-manylinux2014_x86_64.whl`

  it('reads extras beside URL entries', () => {
    expect(
      parseAgentRequirementsOverride({ 'comfy-agent[go]': [`${wheel} ; sys_platform == "linux"`] })
    ).toEqual({
      kind: 'pins',
      pins: new Map([
        ['comfy-agent', { urls: [`${wheel} ; sys_platform == "linux"`], extras: ['go'] }]
      ])
    })
  })

  it("installs name[extras] @ url over core's line, under core's name", () => {
    const parsed = parseAgentRequirementsOverride({ 'comfy-agent[go]': [wheel] })
    if (parsed.kind !== 'pins') throw new Error('expected pins')
    expect(effectiveAgentRequirements('comfy-agent-oss==9.0\n', parsed.pins)).toEqual({
      kind: 'text',
      text: `comfy-agent-oss[go] @ ${wheel}\n`
    })
    expect(overrideSignature(parsed.pins)).toBe(`comfy-agent[go] @ ${wheel}`)
  })

  it('still refuses a bad URL or bad extras', () => {
    expect(
      parseAgentRequirementsOverride({ 'comfy-agent[go]': ['https://example.com/a.whl'] })
    ).toEqual({ kind: 'refused', reason: 'bad_url' })
    expect(parseAgentRequirementsOverride({ 'comfy-agent[g;o]': [wheel] })).toEqual({
      kind: 'refused',
      reason: 'bad_extra'
    })
  })
})
