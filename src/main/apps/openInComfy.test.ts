// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listInstalls = vi.fn()
const launchInstall = vi.fn()
const runningSessions = new Map<string, unknown>()

vi.mock('../host/panelView', () => ({ setActivePanel: vi.fn() }))
vi.mock('../host/registry', () => ({ getEntryByInstallationId: () => null }))
vi.mock('../installations', () => ({ CLOUD_SOURCE_ID: 'cloud', list: () => listInstalls() }))
vi.mock('../lib/ipc/shared', () => ({ _runningSessions: runningSessions }))
vi.mock('./appsBuild', () => ({
  categoryOf: () => 'local',
  findApps: vi.fn(),
  launchAppsBuild: vi.fn(),
  launchInstall: (...args: unknown[]) => launchInstall(...args),
  showComfyWindow: vi.fn()
}))

const { openInComfy } = await import('./openInComfy')

const onCloud = {
  where: 'cloud',
  prompt: { '1': { class_type: 'SaveImage', inputs: {} } }
}

beforeEach(() => {
  vi.clearAllMocks()
  runningSessions.clear()
})

describe('openInComfy on Comfy Cloud', () => {
  it('asks the user to add Comfy Cloud when there is none', async () => {
    listInstalls.mockResolvedValue([])

    expect(await openInComfy(onCloud)).toEqual({
      opened: false,
      error: 'Add Comfy Cloud in Comfy Desktop first.'
    })
    expect(launchInstall).not.toHaveBeenCalled()
  })

  it('reports why Comfy Cloud did not start instead of asking to add it again', async () => {
    listInstalls.mockResolvedValue([{ id: 'cloud-1', sourceId: 'cloud', status: 'installed' }])
    launchInstall.mockResolvedValue({ ok: false, message: 'Sign in to Comfy Cloud first.' })

    expect(await openInComfy(onCloud)).toEqual({
      opened: false,
      error: 'Sign in to Comfy Cloud first.'
    })
  })

  it('says Comfy Cloud could not open when the launch gives no reason', async () => {
    listInstalls.mockResolvedValue([{ id: 'cloud-1', sourceId: 'cloud' }])
    launchInstall.mockResolvedValue({ ok: false })

    expect(await openInComfy(onCloud)).toEqual({
      opened: false,
      error: 'Comfy Desktop could not open Comfy Cloud.'
    })
  })
})
