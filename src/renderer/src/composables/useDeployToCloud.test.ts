import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { stubWindowApi } from '../lib/stubWindowApi'

const modalMock = vi.hoisted(() => ({ alert: vi.fn() }))
vi.mock('./useModal', () => ({ useModal: () => modalMock }))

import {
  closeDeployToCloud,
  deployToCloudTarget,
  isPromotingToWorkspace,
  openDeployToCloud,
  useDeployToCloud
} from './useDeployToCloud'
import { useInstallContextMenu } from './useInstallContextMenu'
import type { Installation } from '../types/ipc'

const apiMock = {
  platform: 'darwin' as const,
  comfybuilder: {
    promoteLocalInstance: vi.fn(),
    openAgentApp: vi.fn()
  }
}
stubWindowApi(apiMock)

function makeInstall(overrides: Partial<Installation> = {}): Installation {
  return {
    id: 'inst-1',
    name: 'My "Flux" build',
    sourceId: 'standalone',
    sourceLabel: 'Standalone',
    sourceCategory: 'local',
    status: 'installed',
    installPath: '/Users/me/ComfyUI-Installs/My Flux build',
    ...overrides
  } as unknown as Installation
}

function mountDeploy() {
  let deploy!: ReturnType<typeof useDeployToCloud>
  let menu!: ReturnType<typeof useInstallContextMenu>
  mount(
    defineComponent({
      setup() {
        deploy = useDeployToCloud()
        menu = useInstallContextMenu({ canPromoteToWorkspace: () => true })
        return () => h('div')
      }
    })
  )
  return { deploy, menu }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  apiMock.comfybuilder.promoteLocalInstance.mockResolvedValue({ ok: true })
  apiMock.comfybuilder.openAgentApp.mockResolvedValue(true)
  closeDeployToCloud()
})

describe('the Deploy to Cloud dialog target', () => {
  it('opens on a build and closes again', () => {
    const inst = makeInstall()

    openDeployToCloud(inst)
    expect(deployToCloudTarget.value).toEqual(inst)

    closeDeployToCloud()
    expect(deployToCloudTarget.value).toBeNull()
  })
})

describe('Set up manually', () => {
  it('asks main to create the draft and stays silent on success', async () => {
    const inst = makeInstall()
    const { deploy } = mountDeploy()

    await expect(deploy.setUpManually(inst)).resolves.toBe(true)

    expect(apiMock.comfybuilder.promoteLocalInstance).toHaveBeenCalledExactlyOnceWith(inst.id)
    expect(modalMock.alert).not.toHaveBeenCalled()
  })

  it('shows the build as creating, holds its menu item and refuses a second request', async () => {
    let finishPromotion!: (result: { ok: true }) => void
    apiMock.comfybuilder.promoteLocalInstance.mockReturnValue(
      new Promise((resolve) => {
        finishPromotion = resolve
      })
    )
    const inst = makeInstall()
    const { deploy, menu } = mountDeploy()

    const promotion = deploy.setUpManually(inst)

    expect(isPromotingToWorkspace(inst)).toBe(true)
    menu.openCardMenu(new MouseEvent('contextmenu'), inst)
    expect(
      menu.ctxMenuItems.value.find((item) => item.id === 'promote-to-workspace')
    ).toMatchObject({ label: 'Creating…', disabled: true })
    await expect(deploy.setUpManually(inst)).resolves.toBe(false)
    expect(apiMock.comfybuilder.promoteLocalInstance).toHaveBeenCalledOnce()

    finishPromotion({ ok: true })
    await expect(promotion).resolves.toBe(true)
    expect(isPromotingToWorkspace(inst)).toBe(false)
  })

  it('surfaces a draft creation failure', async () => {
    apiMock.comfybuilder.promoteLocalInstance.mockResolvedValue({
      ok: false,
      message: 'Snapshot upload failed.'
    })
    const { deploy } = mountDeploy()

    await expect(deploy.setUpManually(makeInstall())).resolves.toBe(false)

    expect(modalMock.alert).toHaveBeenCalledExactlyOnceWith({
      title: 'Could not deploy to Cloud',
      message: 'Snapshot upload failed.'
    })
  })

  it('surfaces a draft creation error', async () => {
    apiMock.comfybuilder.promoteLocalInstance.mockRejectedValue(new Error('Offline'))
    const { deploy } = mountDeploy()

    await expect(deploy.setUpManually(makeInstall())).resolves.toBe(false)

    expect(modalMock.alert).toHaveBeenCalledExactlyOnceWith({
      title: 'Could not deploy to Cloud',
      message: 'Offline'
    })
  })
})

describe('Use your agent', () => {
  it.each(['claude', 'codex'] as const)(
    'asks main to open %s with a prompt naming the build and its folder',
    async (app) => {
      const inst = makeInstall()
      const { deploy } = mountDeploy()

      await expect(deploy.openAgent(app, inst)).resolves.toBe(true)

      const [askedApp, prompt] = apiMock.comfybuilder.openAgentApp.mock.calls[0]!
      expect(askedApp).toBe(app)
      expect(prompt).toContain('comfy skills show comfy-build')
      expect(prompt).toContain('Build name: "My \\"Flux\\" build"')
      expect(prompt).toContain('Install folder: "/Users/me/ComfyUI-Installs/My Flux build"')
    }
  )

  it('reports an agent app that could not open', async () => {
    apiMock.comfybuilder.openAgentApp.mockRejectedValue(new Error('IPC gone'))
    const { deploy } = mountDeploy()

    await expect(deploy.openAgent('claude', makeInstall())).resolves.toBe(false)
  })

  it('copies the same prompt it would hand an agent app', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    const inst = makeInstall()
    const { deploy } = mountDeploy()

    await expect(deploy.copyPrompt(inst)).resolves.toBe(true)
    await deploy.openAgent('codex', inst)

    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      apiMock.comfybuilder.openAgentApp.mock.calls[0]![1]
    )
  })

  it('reports a prompt the clipboard refused', async () => {
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    const { deploy } = mountDeploy()

    await expect(deploy.copyPrompt(makeInstall())).resolves.toBe(false)
  })
})
