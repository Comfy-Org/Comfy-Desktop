import fs from 'fs'
import os from 'os'
import path from 'path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getOpsFlagResult = vi.fn()
vi.mock('./telemetry', () => ({
  getOpsFlagResult: (...args: unknown[]) => getOpsFlagResult(...args)
}))

let configDirectory = ''
vi.mock('./paths', () => ({ configDir: () => configDirectory }))

import {
  _resetForTest,
  initWorkspaceMintSwitchFlag,
  isWorkspaceMintSwitchEnabled,
  WORKSPACE_MINT_SWITCH_FLAG_KEY
} from './workspaceMintSwitchFlag'

const BOOT = { distinctId: 'install-1' }

function bootAnswering(result: unknown): Promise<void> {
  getOpsFlagResult.mockResolvedValueOnce(result)
  return initWorkspaceMintSwitchFlag(BOOT)
}

beforeEach(() => {
  configDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mint-switch-flag-'))
  getOpsFlagResult.mockReset()
  _resetForTest()
})

afterEach(() => {
  _resetForTest()
  fs.rmSync(configDirectory, { recursive: true, force: true })
})

describe('workspace mint switch flag', () => {
  it('is on before any fetch', async () => {
    await expect(isWorkspaceMintSwitchEnabled()).resolves.toBe(true)
  })

  it('stays on when PostHog is unreachable with nothing saved', async () => {
    await bootAnswering({ kind: 'unreachable' })

    await expect(isWorkspaceMintSwitchEnabled()).resolves.toBe(true)
    expect(getOpsFlagResult.mock.calls[0]?.[0]).toBe(WORKSPACE_MINT_SWITCH_FLAG_KEY)
  })

  it('turns off when the flag serves false', async () => {
    await bootAnswering({ kind: 'value', value: false })

    await expect(isWorkspaceMintSwitchEnabled()).resolves.toBe(false)
  })

  it('a fetched kill sticks on the next launch while PostHog is unreachable', async () => {
    await bootAnswering({ kind: 'value', value: false })
    _resetForTest()

    await bootAnswering({ kind: 'unreachable' })

    await expect(isWorkspaceMintSwitchEnabled()).resolves.toBe(false)
  })

  it('a kill that arrives after the deadline applies and sticks', async () => {
    await bootAnswering({ kind: 'unreachable' })
    const late = getOpsFlagResult.mock.calls[0]?.[3] as (result: unknown) => void

    late({ kind: 'value', value: false })

    await expect(isWorkspaceMintSwitchEnabled()).resolves.toBe(false)
    _resetForTest()
    await bootAnswering({ kind: 'unreachable' })
    await expect(isWorkspaceMintSwitchEnabled()).resolves.toBe(false)
  })

  it('a later true lifts a saved kill', async () => {
    await bootAnswering({ kind: 'value', value: false })
    _resetForTest()

    await bootAnswering({ kind: 'value', value: true })
    await vi.waitFor(() => expect(getOpsFlagResult).toHaveBeenCalledTimes(2))
    await new Promise((resolve) => setImmediate(resolve))

    await expect(isWorkspaceMintSwitchEnabled()).resolves.toBe(true)
  })

  it('ignores a value that is not a boolean', async () => {
    await bootAnswering({ kind: 'value', value: 'control' })

    await expect(isWorkspaceMintSwitchEnabled()).resolves.toBe(true)
  })
})
