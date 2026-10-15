import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import type { InstallationRecord } from '../installations'

const mocks = vi.hoisted(() => ({
  parent: { isDestroyed: () => false },
  instanceSession: {},
  fromWebContents: vi.fn(),
  fromPartition: vi.fn(),
  openModelAccessPageWindow: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  session: { fromPartition: mocks.fromPartition }
}))
vi.mock('./modelAccessPage', () => ({
  openModelAccessPageWindow: mocks.openModelAccessPageWindow
}))

import { openPerformanceTestModelAccess } from './performanceTestModelAccess'

describe('performance test model access', () => {
  const sender = { id: 1 } as WebContents
  const installation: InstallationRecord = {
    id: 'selected-instance',
    name: 'Selected instance',
    createdAt: '',
    installPath: '/comfy',
    sourceId: 'standalone',
    browserPartition: 'unique'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fromWebContents.mockReturnValue(mocks.parent)
    mocks.fromPartition.mockReturnValue(mocks.instanceSession)
    mocks.openModelAccessPageWindow.mockResolvedValue(true)
  })

  it('opens the repository using the selected instance download session', async () => {
    await expect(
      openPerformanceTestModelAccess(sender, installation, 'image_flux3_klein_distilled_t2i')
    ).resolves.toBe(true)
    expect(mocks.fromPartition).toHaveBeenCalledWith('persist:selected-instance')
    expect(mocks.openModelAccessPageWindow).toHaveBeenCalledWith(
      sender,
      'https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy',
      { parent: mocks.parent, session: mocks.instanceSession }
    )
  })

  it('does not open arbitrary URLs supplied instead of a supported template', async () => {
    await expect(
      openPerformanceTestModelAccess(sender, installation, 'https://example.com')
    ).resolves.toBe(false)
    expect(mocks.openModelAccessPageWindow).not.toHaveBeenCalled()
  })
})
