import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ElectronApi } from '../../../types/ipc'
import { useAuthStore } from '../stores/authStore'
import { useSessionStore } from '../stores/sessionStore'
import type {
  CatalogWorkflow,
  CatalogWorkflowDownload,
  CatalogWorkflowNeeds,
  Installation
} from '../types/ipc'
import CatalogWorkflowDialog from './CatalogWorkflowDialog.vue'

const launchCatalogWorkflow = vi.fn<ElectronApi['launchCatalogWorkflow']>()
const openCatalogWorkflow = vi.fn<ElectronApi['openCatalogWorkflow']>()
const catalogLocalBuildVersions = vi.fn<ElectronApi['catalogLocalBuildVersions']>()
const catalogWorkflowNeeds = vi.fn<ElectronApi['catalogWorkflowNeeds']>()
const signIn = vi.fn()
const writeText = vi.fn<(text: string) => Promise<void>>()
let sendProgress: (progress: CatalogWorkflowDownload) => void = () => {}

const WORKFLOW: CatalogWorkflow = {
  id: 'ltx',
  title: 'LTX-2.3: Image to Video',
  description: 'Upload an image to generate a video.',
  thumbnailUrl: null,
  canOpenLocal: true,
  canOpenCloud: true,
  minComfyUIVersion: '0.16.0',
  hubUrl: 'https://comfy.org/hub/workflows/ltx',
  longDescription: null,
  author: 'ComfyUI',
  generationType: 'animate-images',
  useCases: ['generate-video'],
  models: ['LTX'],
  uses: 17826,
  license: 'open-source',
  publishedAt: null,
  media: [],
  tutorialUrl: null
}

function localBuild(id: string, name: string, lastLaunchedAt: number): Installation {
  return {
    id,
    name,
    sourceId: 'standalone',
    sourceLabel: 'Local',
    sourceCategory: 'local',
    status: 'installed',
    lastLaunchedAt
  }
}

const LAB = localBuild('lab', 'Video Lab', 3)
const SANDBOX = localBuild('sandbox', 'Flux Sandbox', 2)
const OLD = localBuild('old', 'Old', 1)
const CLOUD: Installation = {
  id: 'shared-cloud',
  name: 'Comfy Cloud',
  sourceId: 'cloud',
  sourceLabel: 'Comfy Cloud',
  sourceCategory: 'cloud',
  status: 'installed'
}

const NEEDS: CatalogWorkflowNeeds = {
  graph: {
    nodes: [
      { id: 1, type: 'UNETLoader', pos: [0, 0], size: [200, 60], outputs: [] },
      { id: 2, type: 'SaveVideo', pos: [300, 0], size: [200, 60], inputs: [] }
    ],
    links: []
  },
  models: [
    { filename: 'ltx_fp8.safetensors', directory: 'diffusion_models', sizeBytes: 33_700_000_000 },
    { filename: 'ltx_vae.safetensors', directory: 'vae', sizeBytes: 300_000_000 }
  ],
  missingByBuild: {
    lab: [],
    sandbox: ['ltx_fp8.safetensors', 'ltx_vae.safetensors'],
    old: []
  }
}

function bridge(known: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(known, {
    get: (target, key: string) =>
      key in target
        ? target[key]
        : key.startsWith('on')
          ? () => () => {}
          : () => Promise.resolve(undefined)
  })
}

async function mountDialog(installations: Installation[], workflow = WORKFLOW) {
  const dialog = mount(CatalogWorkflowDialog, {
    props: { workflow, installations, workspaceId: 'selected-workspace' },
    attachTo: document.body,
    global: { stubs: { DesktopDialogSurface: { template: '<section><slot /></section>' } } }
  })
  await flushPromises()
  return dialog
}

function onPage(testId: string): HTMLElement {
  const found = document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  if (!found) throw new Error(`${testId} is not on the page`)
  return found
}

async function pickTarget(dialog: Awaited<ReturnType<typeof mountDialog>>, key: string) {
  dialog
    .get('[data-testid="catalog-workflow-target"]')
    .element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await flushPromises()
  onPage(`catalog-workflow-target-${key}`).click()
  await flushPromises()
}

beforeEach(() => {
  launchCatalogWorkflow.mockReset().mockResolvedValue({ opened: true })
  openCatalogWorkflow.mockReset().mockResolvedValue(true)
  catalogLocalBuildVersions
    .mockReset()
    .mockResolvedValue({ lab: '0.16.0', sandbox: '0.17.0', old: '0.15.0' })
  catalogWorkflowNeeds.mockReset().mockResolvedValue(NEEDS)
  signIn.mockReset().mockResolvedValue({ signedIn: true })
  writeText.mockReset().mockResolvedValue()
  vi.stubGlobal(
    'api',
    bridge({
      launchCatalogWorkflow,
      openCatalogWorkflow,
      catalogLocalBuildVersions,
      catalogWorkflowNeeds,
      onCatalogWorkflowDownload: (listener: typeof sendProgress) => {
        sendProgress = listener
        return () => {}
      },
      getRunningInstances: async () => [],
      comfybuilder: bridge({ signIn, getAuthStatus: async () => ({ signedIn: true }) })
    })
  )
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  setActivePinia(createPinia())
  useAuthStore().status = { signedIn: true }
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('opening a catalog workflow', () => {
  it('offers the build that already has every model and opens the workflow there', async () => {
    useSessionStore().runningInstances.set(LAB.id, {
      installationId: LAB.id,
      installationName: LAB.name,
      mode: 'window'
    })
    const dialog = await mountDialog([SANDBOX, LAB, OLD, CLOUD])

    expect(dialog.get('[data-testid="catalog-workflow-target"]').text()).toContain('Video Lab')
    expect(dialog.get('[data-testid="catalog-workflow-target-status"]').text()).toBe(
      'Running · every model here'
    )
    expect(dialog.get('[data-testid="workflow-needs-summary"]').text()).toBe('2 models · 34.0 GB')
    expect(dialog.get('[data-testid="workflow-needs-state"]').text()).toBe('Installed')
    expect(dialog.get('[data-testid="catalog-workflow-action"]').text()).toContain(
      'Open in Video Lab'
    )

    await dialog.get('[data-testid="catalog-workflow-action"]').trigger('click')
    await flushPromises()

    expect(launchCatalogWorkflow).toHaveBeenCalledWith(
      'ltx',
      { where: 'local', build: 'lab' },
      'selected-workspace',
      { downloadMissing: false }
    )
    expect(dialog.emitted('close')).toEqual([[]])
  })

  it('downloads what a build is missing before launching it, showing progress', async () => {
    let finish: (value: { opened: boolean }) => void = () => {}
    launchCatalogWorkflow.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    const dialog = await mountDialog([SANDBOX, LAB, OLD, CLOUD])

    await pickTarget(dialog, 'local:sandbox')

    expect(dialog.get('[data-testid="catalog-workflow-target-status"]').text()).toBe(
      'Stopped · 2 models missing'
    )
    expect(dialog.get('[data-testid="workflow-needs-state"]').text()).toBe('Downloads first')
    expect(dialog.get('[data-testid="catalog-workflow-note"]').text()).toBe(
      'Downloads 34.0 GB once, then launches Flux Sandbox.'
    )
    await dialog.get('[data-testid="catalog-workflow-action"]').trigger('click')
    sendProgress({
      id: 'ltx',
      build: 'sandbox',
      receivedBytes: 4_100_000_000,
      totalBytes: 34_000_000_000
    })
    await flushPromises()

    expect(launchCatalogWorkflow).toHaveBeenCalledWith(
      'ltx',
      { where: 'local', build: 'sandbox' },
      'selected-workspace',
      { downloadMissing: true }
    )
    expect(dialog.get('[data-testid="catalog-workflow-progress"]').text()).toBe(
      'Downloading 4.1 GB of 34.0 GB'
    )

    finish({ opened: true })
    await flushPromises()
    expect(dialog.emitted('close')).toEqual([[]])
  })

  it('judges a local build by the ComfyUI version Desktop launches, not the tag it recorded', async () => {
    const taggedOlder: Installation = {
      ...LAB,
      version: '0.15.0',
      comfyVersion: { baseTag: 'v0.15.0', baseTagVerified: true }
    }
    const dialog = await mountDialog([taggedOlder, OLD])

    dialog
      .get('[data-testid="catalog-workflow-target"]')
      .element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()

    expect(dialog.get('[data-testid="catalog-workflow-target"]').text()).toContain('Video Lab')
    expect(onPage('catalog-workflow-target-local:old').getAttribute('data-disabled')).toBe('')
    expect(onPage('catalog-workflow-target-local:old').textContent).toContain(
      'Needs ComfyUI 0.16.0 or newer'
    )
  })

  it('keeps the dialog open with the reason when the launch fails', async () => {
    launchCatalogWorkflow.mockResolvedValueOnce({
      opened: false,
      error: 'Could not start Video Lab.'
    })
    const dialog = await mountDialog([LAB, CLOUD])

    await dialog.get('[data-testid="catalog-workflow-action"]').trigger('click')
    await flushPromises()

    expect(dialog.get('[role="alert"]').text()).toBe('Could not start Video Lab.')
    expect(dialog.emitted('close')).toBeUndefined()
  })
})

describe('a workflow that only runs on Comfy Cloud', () => {
  const PARTNER = { ...WORKFLOW, canOpenLocal: false, license: 'partner' as const }

  it('runs it on Comfy Cloud and says why', async () => {
    catalogWorkflowNeeds.mockResolvedValue({ graph: null, models: [], missingByBuild: {} })
    const dialog = await mountDialog([LAB, CLOUD], PARTNER)

    expect(dialog.text()).toContain('Uses a partner model that only runs on Comfy Cloud.')
    expect(dialog.get('[data-testid="workflow-needs-summary"]').text()).toBe(
      'Partner API on Comfy Cloud'
    )
    await dialog.get('[data-testid="catalog-workflow-action"]').trigger('click')
    await flushPromises()

    expect(launchCatalogWorkflow).toHaveBeenCalledWith(
      'ltx',
      { where: 'cloud' },
      'selected-workspace',
      { downloadMissing: false }
    )
  })

  it('asks a signed-out person to log in first', async () => {
    useAuthStore().status = { signedIn: false }
    const dialog = await mountDialog([CLOUD], PARTNER)

    expect(dialog.get('[data-testid="catalog-workflow-target-status"]').text()).toBe(
      'Needs a Comfy account'
    )
    const action = dialog.get('[data-testid="catalog-workflow-action"]')
    expect(action.text()).toContain('Log in to Comfy Cloud')
    await action.trigger('click')

    expect(signIn).toHaveBeenCalledOnce()
    expect(launchCatalogWorkflow).not.toHaveBeenCalled()
  })

  it('offers Comfy Hub when no build can open it', async () => {
    const dialog = await mountDialog([LAB], PARTNER)

    expect(dialog.find('[data-testid="catalog-workflow-target"]').exists()).toBe(false)
    await dialog.get('[data-testid="catalog-workflow-action"]').trigger('click')
    await flushPromises()

    expect(openCatalogWorkflow).toHaveBeenCalledWith('ltx')
    expect(dialog.emitted('close')).toEqual([[]])
  })
})

describe('the workflow page', () => {
  it('draws the workflow’s graph and lists its details', async () => {
    const dialog = await mountDialog([LAB, CLOUD])

    await dialog.get('[data-testid="workflow-tab-graph"]').trigger('click')
    await flushPromises()

    expect(
      dialog.findAll('[data-testid="workflow-graph-node"]').map((node) => node.text())
    ).toEqual(['UNETLoader', 'SaveVideo'])
    const details = dialog.get('[data-testid="workflow-details"]').text()
    expect(details).toContain('ComfyUI')
    expect(details).toContain('17,826')
    expect(details).toContain('Open source')
  })

  it('lists each model the workflow needs with its size', async () => {
    const dialog = await mountDialog([LAB, CLOUD])

    await dialog.get('[data-testid="workflow-needs"]').trigger('click')

    expect(dialog.get('[data-testid="workflow-needs-list"]').text()).toContain(
      'ltx_fp8.safetensors'
    )
    expect(dialog.get('[data-testid="workflow-needs-list"]').text()).toContain('33.7 GB')
  })

  it('copies the Comfy Hub link', async () => {
    const dialog = await mountDialog([LAB, CLOUD])

    await dialog.get('[data-testid="workflow-copy-link"]').trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith('https://comfy.org/hub/workflows/ltx')
    expect(dialog.get('[data-testid="workflow-copy-link"]').attributes('aria-label')).toBe(
      'Link copied'
    )
  })
})
