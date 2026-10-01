import { describe, expect, it } from 'vitest'
import path from 'path'
import { coreVersionState, splitLaunchCommand } from './coreBetaInputs'
import type { InstallationRecord } from '../installations'

describe('splitLaunchCommand', () => {
  it("splits Desktop's prefix from the user's args at -s <main.py>", () => {
    expect(
      splitLaunchCommand({
        args: ['-s', 'ComfyUI/main.py', '--base-directory', '/b', '--lowvram'],
        cwd: '/install'
      })
    ).toEqual({
      prefixArgs: ['-s', 'ComfyUI/main.py'],
      userArgs: ['--base-directory', '/b', '--lowvram'],
      mainPyAbs: path.resolve('/install', 'ComfyUI/main.py'),
      comfyuiDir: path.resolve('/install', 'ComfyUI')
    })
  })

  it.each([
    ['no args', { cwd: '/install' }],
    ['no cwd', { args: ['-s', 'main.py'] }],
    ['no -s', { args: ['main.py'], cwd: '/install' }],
    ['-s with nothing after it', { args: ['--lowvram', '-s'], cwd: '/install' }]
  ])('has nothing to split with %s', (_label, cmd) => {
    expect(splitLaunchCommand(cmd)).toBeNull()
  })
})

describe('coreVersionState', () => {
  const inst = {
    comfyVersion: { commit: 'A'.repeat(40), baseTag: 'v0.3.81', baseTagVerified: true }
  } as unknown as InstallationRecord

  it('is current only while the checkout is still at the recorded commit', () => {
    expect(coreVersionState(inst, { kind: 'head', commit: 'a'.repeat(40) })).toMatchObject({
      semver: '0.3.81',
      verified: true,
      current: true
    })
    expect(coreVersionState(inst, { kind: 'head', commit: 'b'.repeat(40) }).current).toBe(false)
  })
})
