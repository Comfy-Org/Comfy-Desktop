import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => '/tmp',
    getVersion: () => '2.3.4',
    getLocale: () => 'en'
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  dialog: {},
  shell: {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false }
}))

const { uuids } = vi.hoisted(() => ({ uuids: [] as string[] }))
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof nodeCrypto>()
  const randomUUID = (): string => uuids.shift() ?? actual.randomUUID()
  return { ...actual, default: { ...actual, randomUUID }, randomUUID }
})

import type { InstallationRecord } from '../../installations'
import type * as nodeCrypto from 'crypto'
import os from 'os'
import path from 'path'
import { buildLaunchEnv, createSessionPath } from './shared'

function inst(sourceId: string, envVars?: Record<string, string>): InstallationRecord {
  return {
    id: 'i1',
    name: 'test',
    createdAt: '2026-01-01T00:00:00.000Z',
    installPath: '/tmp/install',
    sourceId,
    ...(envVars ? { envVars } : {})
  } as InstallationRecord
}

describe('buildLaunchEnv __COMFYUI_DESKTOP_VERSION__', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each(['standalone', 'comfybuilder'])(
    'sets the app version for desktop-managed source %s',
    (sourceId) => {
      expect(buildLaunchEnv(inst(sourceId)).__COMFYUI_DESKTOP_VERSION__).toBe('2.3.4')
    }
  )

  it.each(['portable', 'git'])('leaves it unset for user-managed source %s', (sourceId) => {
    expect(buildLaunchEnv(inst(sourceId))).not.toHaveProperty('__COMFYUI_DESKTOP_VERSION__')
  })

  it.each(['portable', 'git'])(
    'drops a marker inherited from process.env for user-managed source %s',
    (sourceId) => {
      vi.stubEnv('__COMFYUI_DESKTOP_VERSION__', '1.0.0')
      expect(buildLaunchEnv(inst(sourceId))).not.toHaveProperty('__COMFYUI_DESKTOP_VERSION__')
    }
  )

  it('overrides a marker inherited from process.env for desktop-managed sources', () => {
    vi.stubEnv('__COMFYUI_DESKTOP_VERSION__', '1.0.0')
    expect(buildLaunchEnv(inst('standalone')).__COMFYUI_DESKTOP_VERSION__).toBe('2.3.4')
  })

  it('ignores a user env var override', () => {
    const env = buildLaunchEnv(inst('git', { __COMFYUI_DESKTOP_VERSION__: '9.9.9' }))
    expect(env).not.toHaveProperty('__COMFYUI_DESKTOP_VERSION__')
  })
})

describe('createSessionPath', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('gives two launches in the same millisecond different session paths', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_792_800_000_000)
    uuids.push('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002')
    const first = createSessionPath()
    const second = createSessionPath()
    expect(
      first,
      "one shared session path would let one launch consume the other launch's .reboot marker"
    ).not.toBe(second)
    for (const sessionPath of [first, second]) {
      expect(path.dirname(sessionPath)).toBe(os.tmpdir())
      expect(path.basename(sessionPath)).toMatch(
        /^comfyui-desktop-2-1792800000000-0{8}-0{4}-4000-8000-00000000000[12]$/
      )
    }
  })
})

describe('buildLaunchEnv agent client context', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('sets the three vars when the launch has a client context', () => {
    const env = buildLaunchEnv(inst('portable'), undefined, { channel: 'beta', gpuTier: 'mid' })
    expect(env.AGENT_CLIENT_CONTEXT).toBe('desktop')
    expect(env.AGENT_CLIENT_CHANNEL).toBe('beta')
    expect(env.AGENT_CLIENT_GPU_TIER).toBe('mid')
  })

  it('leaves the tier out when the probe had not answered', () => {
    const env = buildLaunchEnv(inst('standalone'), undefined, { channel: 'stable' })
    expect(env.AGENT_CLIENT_CHANNEL).toBe('stable')
    expect(env).not.toHaveProperty('AGENT_CLIENT_GPU_TIER')
  })

  it('drops values from process.env and per-install vars without consent', () => {
    vi.stubEnv('AGENT_CLIENT_CONTEXT', 'desktop')
    vi.stubEnv('AGENT_CLIENT_CHANNEL', 'beta')
    vi.stubEnv('AGENT_CLIENT_GPU_TIER', 'high')
    const env = buildLaunchEnv(
      inst('standalone', { AGENT_CLIENT_CONTEXT: 'desktop', agent_client_channel: 'canary' })
    )
    for (const name of ['AGENT_CLIENT_CONTEXT', 'AGENT_CLIENT_CHANNEL', 'AGENT_CLIENT_GPU_TIER']) {
      expect(env).not.toHaveProperty(name)
    }
    expect(env).not.toHaveProperty('agent_client_channel')
  })

  it('does not let an inherited tier ride along with a context that has none', () => {
    vi.stubEnv('AGENT_CLIENT_GPU_TIER', 'high')
    const env = buildLaunchEnv(inst('standalone'), undefined, { channel: 'stable' })
    expect(env).not.toHaveProperty('AGENT_CLIENT_GPU_TIER')
  })
})
