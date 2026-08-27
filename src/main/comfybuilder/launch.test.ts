// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildLaunchSpec, venvPython } from './launch'
import type { GovernanceMarkerState } from './governance'

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

  it.each([
    ['python missing', { python: false }],
    ['main.py missing', { main: false }]
  ])('returns null when %s', (_name, opts) => {
    const p = path.join(dir, 'install')
    layout(p, opts)
    expect(buildLaunchSpec(p)).toBeNull()
  })

  describe('governance launch arguments', () => {
    const baseArgs = '--cpu --port 9001'
    const expectedBase = ['-s', path.join('ComfyUI', 'main.py'), '--cpu', '--port', '9001']

    function marker(
      customNodeMode: 'allowlist' | 'blocklist' | null,
      activeForms: string[]
    ): GovernanceMarkerState {
      return {
        kind: 'governed',
        marker: {
          governanceMarkerVersion: 1,
          governed: true,
          expectedBuildIdentity: 'test',
          publicKey: 'test',
          activeForms,
          customNodeMode
        }
      }
    }

    it.each([
      ['(a) custom allowlist (no model)', marker('allowlist', ['custom_node']), [...expectedBase]],
      [
        '(a) custom allowlist (with model)',
        marker('allowlist', ['custom_node', 'model']),
        [...expectedBase, '--enable-asset-hashing']
      ],
      [
        '(b) custom non-empty blocklist',
        marker('blocklist', ['custom_node']),
        [...expectedBase, '--enable-manager']
      ],
      [
        '(c) model-only governed',
        marker(null, ['model']),
        [...expectedBase, '--enable-manager', '--enable-asset-hashing']
      ],
      [
        '(d) node-id-only governed',
        marker(null, ['node_id']),
        [...expectedBase, '--enable-manager']
      ],
      [
        '(e) partner-only governed',
        marker(null, ['partner']),
        [...expectedBase, '--enable-manager']
      ],
      [
        '(f) all four active',
        marker('allowlist', ['custom_node', 'model', 'node_id', 'partner']),
        [...expectedBase, '--enable-asset-hashing']
      ],
      [
        '(g) non-governed (absent marker)',
        { kind: 'absent' } as GovernanceMarkerState,
        [...expectedBase, '--enable-manager']
      ],
      [
        '(g) non-governed (malformed marker)',
        { kind: 'malformed', reason: 'test' } as GovernanceMarkerState,
        [...expectedBase, '--enable-manager']
      ],
      [
        '(g) empty-blocklist-only build (inactive custom node mode)',
        marker(null, []),
        [...expectedBase, '--enable-manager']
      ]
    ])('adjusts args for %s', (_name, governance, expectedArgs) => {
      const p = path.join(dir, 'install')
      layout(p)
      // Include --enable-manager in the user args to prove it gets stripped when it should be,
      // and preserved when it should be.
      const spec = buildLaunchSpec(p, { launchArgs: `${baseArgs} --enable-manager`, governance })
      expect(spec?.args).toEqual(expectedArgs)
    })

    // Core's `cli_args.py` sets `enable_manager = True` for the legacy-ui flag
    // too, so stripping only `--enable-manager` would leave the Manager on and
    // make core refuse the launch outright.
    it.each(['--enable-manager-legacy-ui', '--enable-manager --enable-manager-legacy-ui'])(
      'strips %s on an allowlist install',
      (managerArgs) => {
        const p = path.join(dir, 'install')
        layout(p)

        const spec = buildLaunchSpec(p, {
          launchArgs: `${baseArgs} ${managerArgs}`,
          governance: marker('allowlist', ['custom_node'])
        })

        expect(spec?.args).toEqual([...expectedBase])
      }
    )

    it('keeps the legacy-ui flag when the custom-node form is not an allowlist', () => {
      const p = path.join(dir, 'install')
      layout(p)

      const spec = buildLaunchSpec(p, {
        launchArgs: `${baseArgs} --enable-manager-legacy-ui`,
        governance: marker('blocklist', ['custom_node'])
      })

      expect(spec?.args).toEqual([...expectedBase, '--enable-manager-legacy-ui'])
    })
  })
})
