// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildLaunchSpec,
  launchArgsForManagerAnswer,
  managerAllowedByGovernance,
  managerAllowedByPolicy,
  readGovernance,
  venvPython
} from './launch'

const isWin = process.platform === 'win32'

function layout(
  installPath: string,
  opts: { python?: boolean; main?: boolean } = { python: true, main: true }
): void {
  if (opts.python !== false) {
    fs.mkdirSync(path.dirname(venvPython(installPath)), { recursive: true })
    fs.writeFileSync(venvPython(installPath), '')
  }
  if (opts.main !== false) {
    fs.mkdirSync(path.join(installPath, 'ComfyUI'), { recursive: true })
    fs.writeFileSync(path.join(installPath, 'ComfyUI', 'main.py'), '')
  }
}

/** Write a policy envelope shaped like a governed archive's (signature unchecked). */
function writePolicy(installPath: string, payload: unknown, raw?: string): void {
  const file = path.join(installPath, 'ComfyUI', 'governance', 'policy.signed.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  fs.writeFileSync(file, raw ?? JSON.stringify({ schema: 1, payload: encoded, signature: 'sig' }))
}

describe('launch', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbc-launch-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('venvPython points at the archive venv per platform', () => {
    expect(venvPython(dir)).toBe(
      isWin ? path.join(dir, 'venv', 'python.exe') : path.join(dir, 'venv', 'bin', 'python3')
    )
  })

  it.runIf(isWin)('venvPython prefers the staged windows interpreter at venv/base', () => {
    const staged = path.join(dir, 'venv', 'base', 'python.exe')
    fs.mkdirSync(path.dirname(staged), { recursive: true })
    fs.writeFileSync(staged, '')
    // Current archives stage it below the venv root; that placement is what keeps the
    // venv's entry points relocatable (Comfy-Org/cloud#6138).
    expect(venvPython(dir)).toBe(staged)
  })

  it('builds a spec that drives the venv python against ComfyUI/main.py', () => {
    const p = path.join(dir, 'install')
    layout(p)
    const spec = buildLaunchSpec(p, { launchArgs: '--cpu --port 9001' })
    expect(spec).toEqual({
      cmd: venvPython(p),
      args: ['-s', path.join('ComfyUI', 'main.py'), '--cpu', '--port', '9001'],
      cwd: p,
      port: 9001
    })
  })

  it('drops every manager-enabling flag when the build turned the manager off', () => {
    const p = path.join(dir, 'install')
    layout(p)
    const spec = buildLaunchSpec(p, {
      launchArgs: '--enable-manager --cpu --enable-manager-legacy-ui --port 9001',
      managerAllowed: false
    })
    expect(spec?.args).toEqual(['-s', path.join('ComfyUI', 'main.py'), '--cpu', '--port', '9001'])
    expect(spec?.port).toBe(9001)
  })

  it('drops the default manager flag too when the build turned the manager off', () => {
    const p = path.join(dir, 'install')
    layout(p)
    expect(buildLaunchSpec(p, { managerAllowed: false })?.args).toEqual([
      '-s',
      path.join('ComfyUI', 'main.py')
    ])
  })

  it.each([[true], [undefined]])('keeps the manager flag when managerAllowed is %s', (allowed) => {
    const p = path.join(dir, 'install')
    layout(p)
    expect(buildLaunchSpec(p, { managerAllowed: allowed })?.args).toEqual([
      '-s',
      path.join('ComfyUI', 'main.py'),
      '--enable-manager'
    ])
  })

  it.each([
    ['an allowlist (the wizard wrote No)', { mode: 'allowlist' as const }, false],
    ['an allowlist naming packs', { mode: 'allowlist' as const, list: ['KJNodes'] }, false],
    ['an empty blocklist (the wizard wrote Yes)', { mode: 'blocklist' as const, list: [] }, true],
    ['no policy (a snapshot build)', null, true],
    ['an absent policy', undefined, true]
  ])('managerAllowedByPolicy reads %s', (_name, policy, expected) => {
    expect(managerAllowedByPolicy(policy)).toBe(expected)
  })

  it.each([
    // [name, stored args, allowed now, allowed before, expected]
    ['a No build loses the default flag', '--enable-manager', false, undefined, ''],
    [
      'a No build keeps its other args',
      '--enable-manager --cpu --port 9001',
      false,
      undefined,
      '--cpu --port 9001'
    ],
    [
      'a No build loses the legacy flag too',
      '--cpu --enable-manager-legacy-ui',
      false,
      true,
      '--cpu'
    ],
    [
      'a No build leaves a lookalike flag alone',
      '--enable-manager-foo',
      false,
      undefined,
      '--enable-manager-foo'
    ],
    [
      'a No build preserves whitespace inside a quoted value',
      '--enable-manager --path "C:\\My  Models"',
      false,
      undefined,
      '--path "C:\\My  Models"'
    ],
    [
      'a No build leaves a manager-looking substring inside a quoted value alone',
      '--label "use --enable-manager here"',
      false,
      undefined,
      '--label "use --enable-manager here"'
    ],
    ['a No build removes a quoted manager flag', '"--enable-manager" --cpu', false, true, '--cpu'],
    [
      'a No build loses an abbreviated legacy flag',
      '--enable-manager-l --cpu',
      false,
      true,
      '--cpu'
    ],
    [
      'a Yes build is left alone',
      '--enable-manager --cpu',
      true,
      undefined,
      '--enable-manager --cpu'
    ],
    ['a Yes build whose user removed the flag stays that way', '--cpu', true, true, '--cpu'],
    [
      'a build that went from No to Yes gets the flag back',
      '--cpu',
      true,
      false,
      '--enable-manager --cpu'
    ],
    [
      'a build that went from No to Yes keeps a flag the user already has',
      '--enable-manager-legacy-ui',
      true,
      false,
      '--enable-manager-legacy-ui'
    ]
  ])('launchArgsForManagerAnswer: %s', (_name, args, allowed, before, expected) => {
    expect(launchArgsForManagerAnswer(args, allowed, before)).toBe(expected)
  })

  // ComfyUI refuses `--enable-manager` under any custom-node policy, because
  // Manager's prestartup runs scheduled pack installs before a pack is checked
  // (Comfy-Org/ComfyUI#16167).
  it.each([['allowlist'], ['blocklist']])(
    'drops a typed manager flag on a governed %s build',
    (mode) => {
      const p = path.join(dir, 'install')
      layout(p)
      writePolicy(p, { activeForms: ['customNode'], customNodeMode: mode })
      const spec = buildLaunchSpec(p, {
        launchArgs: '--enable-manager --cpu --enable-manager-legacy-ui',
        governance: readGovernance(p)
      })
      expect(spec?.args).toEqual(['-s', path.join('ComfyUI', 'main.py'), '--cpu'])
    }
  )

  it.each([['allowlist'], ['blocklist']])(
    'drops the default manager flag on a governed %s build',
    (mode) => {
      const p = path.join(dir, 'install')
      layout(p)
      writePolicy(p, { activeForms: ['customNode'], customNodeMode: mode })
      expect(buildLaunchSpec(p, { governance: readGovernance(p) })?.args).toEqual([
        '-s',
        path.join('ComfyUI', 'main.py')
      ])
    }
  )

  // ComfyUI's parser accepts any unique prefix of an option (argparse's
  // allow_abbrev), so these all turn Manager on. Checked against
  // comfy/cli_args.py of Comfy-Org/ComfyUI#16167 on Python 3.9, 3.11, 3.13
  // and 3.14.
  it.each([
    ['--enable-manager'],
    ['--enable-manager-legacy-ui'],
    ['--enable-manager-legacy-u'],
    ['--enable-manager-legacy'],
    ['--enable-manager-l'],
    ['--enable-manager-']
  ])('drops %s on a governed blocklist build', (flag) => {
    const p = path.join(dir, 'install')
    layout(p)
    writePolicy(p, { activeForms: ['customNode'], customNodeMode: 'blocklist' })
    const spec = buildLaunchSpec(p, {
      launchArgs: `${flag} --cpu`,
      governance: readGovernance(p)
    })
    expect(spec?.args).toEqual(['-s', path.join('ComfyUI', 'main.py'), '--cpu'])
  })

  // None of these turns Manager on. Ambiguous prefixes, `--flag=value` on an
  // on/off flag and an unknown option all make ComfyUI's parser exit with an
  // error on every build, governed or not, so launch leaves the typo for the
  // user to see. The rest are other options that share the `--enable-` prefix.
  it.each([
    ['--enable-manage'],
    ['--enable-m'],
    ['--enable-manager=1'],
    ['--enable-manager-l=1'],
    ['--enable-manager-foo'],
    ['--enable-manager-legacy-uix'],
    ['-enable-manager'],
    ['--enable-dynamic-vram'],
    ['--enable-d'],
    ['--enable-assets'],
    ['--enable-cors-header']
  ])('leaves %s alone on a governed blocklist build', (flag) => {
    const p = path.join(dir, 'install')
    layout(p)
    writePolicy(p, { activeForms: ['customNode'], customNodeMode: 'blocklist' })
    const spec = buildLaunchSpec(p, {
      launchArgs: `${flag} --cpu`,
      governance: readGovernance(p)
    })
    expect(spec?.args).toEqual(['-s', path.join('ComfyUI', 'main.py'), flag, '--cpu'])
  })

  it('keeps the manager flag on a governed build whose custom nodes are not governed', () => {
    const p = path.join(dir, 'install')
    layout(p)
    writePolicy(p, { activeForms: ['nodeId'], customNodeMode: null })
    expect(buildLaunchSpec(p, { governance: readGovernance(p) })?.args).toEqual([
      '-s',
      path.join('ComfyUI', 'main.py'),
      '--enable-manager'
    ])
  })

  it('keeps the manager flag on a build with no policy file', () => {
    const p = path.join(dir, 'install')
    layout(p)
    expect(buildLaunchSpec(p, { governance: readGovernance(p) })?.args).toEqual([
      '-s',
      path.join('ComfyUI', 'main.py'),
      '--enable-manager'
    ])
  })

  it.each([
    ['an allowlist', { kind: 'governed' as const, customNodeMode: 'allowlist' as const }, false],
    ['a blocklist', { kind: 'governed' as const, customNodeMode: 'blocklist' as const }, false],
    ['ungoverned custom nodes', { kind: 'governed' as const, customNodeMode: null }, true],
    ['an ordinary build', null, true],
    ['an absent governance', undefined, true]
  ])('managerAllowedByGovernance reads %s', (_name, governance, expected) => {
    expect(managerAllowedByGovernance(governance)).toBe(expected)
  })

  it('readGovernance returns null for an ordinary build', () => {
    layout(dir)
    expect(readGovernance(dir)).toBeNull()
  })

  it.each([
    ['an allowlist', { customNodeMode: 'allowlist' }, undefined, 'allowlist'],
    ['a blocklist', { customNodeMode: 'blocklist' }, undefined, 'blocklist'],
    ['ungoverned custom nodes', { activeForms: ['nodeId'], customNodeMode: null }, undefined, null],
    ['a payload without a mode', { activeForms: ['customNode'] }, undefined, 'allowlist'],
    ['an unknown mode', { customNodeMode: 'everything' }, undefined, 'allowlist'],
    ['an envelope that is not JSON', {}, 'not json', 'allowlist'],
    ['a payload that is not base64url JSON', {}, '{"payload":"!!"}', 'allowlist']
  ])('readGovernance reads %s', (_name, payload, raw, expected) => {
    writePolicy(dir, payload, raw)
    expect(readGovernance(dir)).toEqual({ kind: 'governed', customNodeMode: expected })
  })

  it.each([
    ['python missing', { python: false }],
    ['main.py missing', { main: false }]
  ])('returns null when %s', (_name, opts) => {
    const p = path.join(dir, 'install')
    layout(p, opts)
    expect(buildLaunchSpec(p)).toBeNull()
  })
})
