import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  hubUrlForListedWorkflow: vi.fn<(id: string) => string | null>(),
  tryOpenExternalUrl: vi.fn(async () => true)
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler)
  }
}))
vi.mock('../../apps/localBuild', () => ({ usableLocalBuilds: async () => [] }))
vi.mock('../../catalog/launchWorkflow', () => ({
  cancelCatalogWorkflowDownload: vi.fn(),
  launchCatalogWorkflow: vi.fn()
}))
vi.mock('../../catalog/workflowNeeds', () => ({ catalogWorkflowNeeds: vi.fn() }))
vi.mock('../../catalog/workflows', () => ({
  hubUrlForListedWorkflow: mocks.hubUrlForListedWorkflow,
  listCatalogWorkflows: vi.fn(),
  listHomeWorkflows: vi.fn()
}))
vi.mock('../i18n', () => ({ getLocale: () => 'en' }))
vi.mock('../openExternal', () => ({ tryOpenExternalUrl: mocks.tryOpenExternalUrl }))

const { registerCatalogHandlers } = await import('./registerCatalogHandlers')

function openWorkflow(id: unknown) {
  const handler = mocks.handlers.get('catalog:open-workflow')
  if (!handler) throw new Error('catalog:open-workflow is not registered')
  return Promise.resolve(handler({}, id))
}

describe('catalog:open-workflow', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.hubUrlForListedWorkflow.mockReset()
    mocks.tryOpenExternalUrl.mockClear()
    registerCatalogHandlers()
  })

  it('opens the Hub page with the workflow dialog campaign', async () => {
    mocks.hubUrlForListedWorkflow.mockReturnValue('https://comfy.org/hub/workflows/upscale')

    await expect(openWorkflow('upscale')).resolves.toBe(true)

    expect(mocks.hubUrlForListedWorkflow).toHaveBeenCalledWith('upscale')
    expect(mocks.tryOpenExternalUrl).toHaveBeenCalledExactlyOnceWith(
      'https://comfy.org/hub/workflows/upscale?utm_source=comfy_desktop&utm_medium=product&utm_campaign=workflow_dialog_hub'
    )
  })

  it('opens nothing for a workflow that is not listed', async () => {
    mocks.hubUrlForListedWorkflow.mockReturnValue(null)

    await expect(openWorkflow('missing')).resolves.toBe(false)

    expect(mocks.tryOpenExternalUrl).not.toHaveBeenCalled()
  })

  it('opens nothing for an id that is not a string', async () => {
    await expect(openWorkflow(7)).resolves.toBe(false)

    expect(mocks.hubUrlForListedWorkflow).not.toHaveBeenCalled()
    expect(mocks.tryOpenExternalUrl).not.toHaveBeenCalled()
  })
})
