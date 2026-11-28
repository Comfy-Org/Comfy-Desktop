import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { stubWindowApi } from '../../lib/stubWindowApi'

const modalMock = vi.hoisted(() => ({ alert: vi.fn() }))
vi.mock('../../composables/useModal', () => ({ useModal: () => modalMock }))

import DeployToCloudDialog from './DeployToCloudDialog.vue'
import {
  closeDeployToCloud,
  deployToCloudTarget,
  openDeployToCloud
} from '../../composables/useDeployToCloud'
import type { Installation } from '../../types/ipc'

const apiMock = {
  platform: 'darwin' as const,
  openExternal: vi.fn(),
  comfybuilder: {
    promoteLocalInstance: vi.fn(),
    openAgentApp: vi.fn()
  }
}
stubWindowApi(apiMock)

const BUILD = {
  id: 'local-1',
  name: 'ComfyUI',
  sourceId: 'standalone',
  sourceCategory: 'local',
  status: 'installed',
  installPath: '/Users/me/ComfyUI-Installs/ComfyUI'
} as unknown as Installation

const mounted: VueWrapper[] = []

function mountDialog(): void {
  mounted.push(mount(DeployToCloudDialog, { attachTo: document.body }))
}

function byTestId(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
}

async function shown(id: string): Promise<HTMLElement> {
  await vi.waitFor(() => expect(byTestId(id)).not.toBeNull())
  return byTestId(id)!
}

async function openAgentMenu(): Promise<void> {
  await userEvent.click(await shown('deploy-to-cloud-agent'))
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  apiMock.comfybuilder.promoteLocalInstance.mockResolvedValue({ ok: true })
  apiMock.comfybuilder.openAgentApp.mockResolvedValue(true)
  apiMock.openExternal.mockResolvedValue(undefined)
})

afterEach(() => {
  closeDeployToCloud()
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

describe('Deploy to Cloud dialog', () => {
  it('stays closed until a build asks for it', async () => {
    mountDialog()
    await flushPromises()

    expect(byTestId('deploy-to-cloud-dialog')).toBeNull()
  })

  it('sells Comfy Cloud with the video, three points and a note on what is shared', async () => {
    mountDialog()
    openDeployToCloud(BUILD)

    const dialog = await shown('deploy-to-cloud-dialog')
    expect(dialog.textContent).toContain('Run this build on Comfy Cloud')
    expect(dialog.textContent).toContain(
      'Deploy your local setup to Comfy Cloud with your custom nodes and models.'
    )
    expect([...dialog.querySelectorAll('li')].map((li) => li.textContent?.trim())).toEqual([
      'Bring your custom nodes and models',
      'Run on powerful cloud GPUs',
      'Pay only while your GPU workers are up, plus storage'
    ])
    expect(byTestId('deploy-to-cloud-note')!.textContent?.trim()).toBe(
      'Your custom node and model names are shared with Comfy Cloud to set this up.'
    )
    const sources = [...dialog.querySelectorAll('video source')].map((s) => s.getAttribute('src'))
    expect(sources).toEqual([
      'https://media.comfy.org/website/cloud-deploy/cloud-deploy-1280.webm',
      'https://media.comfy.org/website/cloud-deploy/cloud-deploy-1280.mp4'
    ])
  })

  it('makes Use your agent the primary action and Set up manually the other', async () => {
    mountDialog()
    openDeployToCloud(BUILD)

    expect((await shown('deploy-to-cloud-agent')).textContent?.trim()).toBe('Use your agent')
    expect(byTestId('deploy-to-cloud-manual')!.textContent?.trim()).toBe('Set up manually')
    expect(document.activeElement).toBe(byTestId('deploy-to-cloud-agent'))
  })

  it('closes and creates the draft on Set up manually', async () => {
    mountDialog()
    openDeployToCloud(BUILD)

    ;(await shown('deploy-to-cloud-manual')).click()
    await flushPromises()

    expect(deployToCloudTarget.value).toBeNull()
    expect(apiMock.comfybuilder.promoteLocalInstance).toHaveBeenCalledExactlyOnceWith('local-1')
  })

  it.each([
    ['claude', 'deploy-to-cloud-agent-claude'],
    ['codex', 'deploy-to-cloud-agent-codex']
  ])('hands the prompt to %s and closes', async (app, item) => {
    mountDialog()
    openDeployToCloud(BUILD)

    await openAgentMenu()
    ;(await shown(item)).click()
    await flushPromises()

    expect(apiMock.comfybuilder.openAgentApp).toHaveBeenCalledExactlyOnceWith(
      app,
      expect.stringContaining('Install folder: "/Users/me/ComfyUI-Installs/ComfyUI"')
    )
    expect(apiMock.comfybuilder.promoteLocalInstance).not.toHaveBeenCalled()
    expect(deployToCloudTarget.value).toBeNull()
  })

  it('stays open and offers the copy when the agent app does not open', async () => {
    apiMock.comfybuilder.openAgentApp.mockResolvedValue(false)
    mountDialog()
    openDeployToCloud(BUILD)

    await openAgentMenu()
    ;(await shown('deploy-to-cloud-agent-claude')).click()
    await flushPromises()

    expect(modalMock.alert).toHaveBeenCalledExactlyOnceWith({
      title: 'Could not open your agent',
      message: 'Copy the prompt instead, and paste it into your coding agent.'
    })
    expect(deployToCloudTarget.value).toEqual(BUILD)
  })

  it('copies the prompt and says so on the button', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    mountDialog()
    openDeployToCloud(BUILD)

    await openAgentMenu()
    ;(await shown('deploy-to-cloud-agent-copy')).click()

    await vi.waitFor(() =>
      expect(byTestId('deploy-to-cloud-agent')!.textContent?.trim()).toBe('Copied')
    )
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('comfy skills show comfy-build')
    )
    expect(deployToCloudTarget.value).toEqual(BUILD)
  })

  it('opens the docs in the browser', async () => {
    mountDialog()
    openDeployToCloud(BUILD)

    ;(await shown('deploy-to-cloud-docs')).click()

    expect(apiMock.openExternal).toHaveBeenCalledExactlyOnceWith(
      'https://docs.comfy.org/development/overview'
    )
  })

  it('closes from the close button without creating anything', async () => {
    mountDialog()
    openDeployToCloud(BUILD)

    ;(await shown('deploy-to-cloud-close')).click()
    await flushPromises()

    expect(deployToCloudTarget.value).toBeNull()
    expect(apiMock.comfybuilder.promoteLocalInstance).not.toHaveBeenCalled()
    expect(apiMock.comfybuilder.openAgentApp).not.toHaveBeenCalled()
  })
})
