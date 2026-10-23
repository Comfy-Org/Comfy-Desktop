import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  handleAction: null as null | (() => Promise<{ ok: boolean }>)
}))

vi.mock('../shared', () => ({
  installations: { update: async () => {} },
  i18n: { t: (key: string) => key },
  sourceMap: { stub: { handleAction: () => harness.handleAction!() } },
  _operationAborts: new Map(),
  MSG_CANCELLED: 'cancelled'
}))

vi.mock('../../logsBroadcast', () => ({ appendLog: () => {} }))

vi.mock('../../../settings', () => ({
  getMirrorConfig: () => ({ pypiMirror: undefined, useChineseMirrors: false })
}))

vi.mock('../../pip', () => ({
  installFilteredRequirementsDetailed: vi.fn(),
  runUvPipDetailed: vi.fn(async () => ({ code: 0, output: '' }))
}))

import { handleDelegateToSource } from './delegate'
import {
  _resetAgentPrefetchesForTest,
  prefetchAgentRequirements,
  stopAgentPrefetches
} from '../../agentRequirementsLaunch'
import type { PrefetchRequest } from '../../agentRequirementsLaunch'
import { installFilteredRequirementsDetailed } from '../../pip'

describe('handleDelegateToSource', () => {
  let dir = ''

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delegate-hold-'))
    _resetAgentPrefetchesForTest()
  })

  afterEach(() => {
    stopAgentPrefetches()
    _resetAgentPrefetchesForTest()
    vi.mocked(installFilteredRequirementsDetailed).mockReset()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("stops the install's background download before a source action works on its environment, and starts none during it", async () => {
    const order: string[] = []
    vi.mocked(installFilteredRequirementsDetailed).mockImplementation(async (...args) => {
      const signal = args[6] as AbortSignal
      if (signal.aborted) return { code: 1, output: '' }
      return new Promise((resolve) =>
        signal.addEventListener(
          'abort',
          () => {
            order.push('download stopped')
            resolve({ code: 1, output: '' })
          },
          { once: true }
        )
      )
    })
    const background: PrefetchRequest = {
      plan: {
        reqPath: path.join(dir, 'agent_requirements.txt'),
        uvPath: '/uv',
        pythonPath: '/py',
        installPath: dir
      },
      steps: [{ text: 'comfy-agent==0.2.0\n' }],
      signature: 'core',
      eager: true
    }
    expect(prefetchAgentRequirements(background, () => {})).toBe(true)
    await vi.waitFor(() => expect(installFilteredRequirementsDetailed).toHaveBeenCalled())
    let refusedDuringAction: boolean | undefined
    harness.handleAction = async () => {
      order.push('action')
      refusedDuringAction = !prefetchAgentRequirements(background, () => {})
      return { ok: true }
    }
    const ctx = {
      event: { sender: { isDestroyed: () => false, send: () => {} } },
      installationId: 'i',
      inst: { id: 'i', sourceId: 'stub', installPath: dir },
      actionData: {}
    }

    expect(await handleDelegateToSource(ctx as never, 'update-comfyui')).toEqual({ ok: true })

    expect(order, 'an update or a PyTorch change renames what uv holds open').toEqual([
      'download stopped',
      'action'
    ])
    expect(refusedDuringAction, 'nothing starts for the install while the action runs').toBe(true)
    expect(
      prefetchAgentRequirements(background, () => {}),
      'released once it ends'
    ).toBe(true)
  })
})
