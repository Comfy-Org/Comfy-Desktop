import { modelKey } from '../panel/workflowTargets'
import type { ElectronApi } from '../types/ipc'
import type { BridgeSeed, FakeBridge } from './fakeBridge'
import {
  EXPLORE_WORKFLOWS,
  HIDDEN_APP_CARDS,
  INSTALL_STEPS,
  WORKFLOW_NEEDS,
  everydayBuilds,
  localAssets,
  type PreviewMachine
} from './fixtures'

export interface PreviewStage {
  bridge: FakeBridge
  see(selector: string): Promise<HTMLElement>
  click(selector: string): Promise<void>
  press(selector: string, key: string): Promise<void>
}

export interface PreviewScenario {
  id: string
  title: string
  ready: string
  seed(machine: PreviewMachine): BridgeSeed
  arrange?(stage: PreviewStage): Promise<void>
}

const FIRST_USE: BridgeSeed = { settings: { firstUseCompleted: false } }

const NEVER_SETTLES = new Promise<void>(() => {})

function reportInstallProgress(bridge: FakeBridge, installationId: string): void {
  const send = (phase: string, percent: number, status: string): void =>
    bridge.emit('onInstallProgress', { installationId, phase, percent, status })
  const log = (text: string): void => bridge.emit('onComfyOutput', { installationId, text })

  bridge.emit('onInstallProgress', { installationId, phase: 'steps', steps: INSTALL_STEPS })
  log('[download] Downloading the ComfyUI bundle\n')
  send('download', 100, 'Downloaded')
  log('[extract] Unpacking the download\n')
  send('extract', 100, 'Extracted')
  log('[setup] Creating the Python environment\n')
  log('[setup] Copying the bundled packages into it\n')
  send('setup', 42, 'Copying packages… 8,214 / 19,560 files  ·  0:38 elapsed  ·  0:52 remaining')
}

function installThatKeepsRunning(bridge: FakeBridge): (installationId: string) => Promise<void> {
  return (installationId) => {
    reportInstallProgress(bridge, installationId)
    return NEVER_SETTLES
  }
}

async function acceptTermsAndInstall({ see, click }: PreviewStage): Promise<void> {
  await see('[data-testid="setup-version"]')
  await click('[data-testid="setup-consent-tos"] [role="checkbox"]')
  await click('[data-testid="setup-install"]')
}

const SIGNED_IN = {
  signedIn: true,
  email: 'someone@comfy.org',
  workspaceId: 'w-personal',
  workspaceName: 'Personal Workspace',
  workspaceType: 'personal'
} as const

function exploreSeed(machine: PreviewMachine): BridgeSeed {
  return {
    installations: everydayBuilds(machine),
    auth: SIGNED_IN,
    replies: {
      listCatalogWorkflows: async () => EXPLORE_WORKFLOWS,
      catalogWorkflowNeeds: async () => WORKFLOW_NEEDS,
      catalogLocalBuildVersions: async () => ({
        'inst-comfyui': '0.42.4',
        'inst-video-experiments': '0.42.4'
      })
    }
  }
}

const LTX_WORKFLOW_ID = 'ae574655-5f6e-44c4-bd2a-cb8aa4dbbbc9'

const DOWNLOAD_STEPS = 12
const DOWNLOAD_STEP_MS = 300
const OPEN_MS = 800

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function launchLikeDesktop(bridge: FakeBridge): void {
  const needs = structuredClone(WORKFLOW_NEEDS)
  bridge.reply({
    catalogWorkflowNeeds: async () => structuredClone(needs),
    launchCatalogWorkflow: async (id, target, _workspaceId, options) => {
      if (target.where === 'local' && options?.downloadMissing) {
        const missing = new Set(needs.missingByBuild[target.build] ?? [])
        const totalBytes = needs.models
          .filter((model) => missing.has(modelKey(model)))
          .reduce((total, model) => total + (model.sizeBytes ?? 0), 0)
        for (let step = 1; step <= DOWNLOAD_STEPS; step += 1) {
          await pause(DOWNLOAD_STEP_MS)
          bridge.emit('onCatalogWorkflowDownload', {
            id,
            build: target.build,
            receivedBytes: Math.round((totalBytes * step) / DOWNLOAD_STEPS),
            totalBytes
          })
        }
        needs.missingByBuild[target.build] = []
      }
      await pause(OPEN_MS)
      return { opened: true }
    }
  })
}

function downloadThatKeepsRunning(bridge: FakeBridge): ElectronApi['launchCatalogWorkflow'] {
  return (id, target) => {
    if (target.where === 'local') {
      bridge.emit('onCatalogWorkflowDownload', {
        id,
        build: target.build,
        receivedBytes: 4_100_000_000,
        totalBytes: 38_593_133_384
      })
    }
    return new Promise(() => {})
  }
}

async function openExploreWorkflows({ bridge, click, see }: PreviewStage): Promise<void> {
  launchLikeDesktop(bridge)
  await click('[data-testid="app-sidebar-apps"]')
  await click('[data-testid="explore-workflows-tab"]')
  await see('[data-testid="workflows-grid"]')
}

async function openWorkflowPage(stage: PreviewStage): Promise<void> {
  await openExploreWorkflows(stage)
  await stage.click(`[data-testid="workflow-card-${LTX_WORKFLOW_ID}"]`)
  await stage.see('[data-testid="workflow-needs-state"]')
}

export const SCENARIOS: PreviewScenario[] = [
  {
    id: 'first-use',
    title: 'First launch: Set up',
    ready: '[data-testid="setup-version"]',
    seed: () => FIRST_USE
  },
  {
    id: 'installing',
    title: 'First build installing, on Home',
    ready: '[data-testid="home-build-progress"]',
    seed: () => FIRST_USE,
    arrange: async (stage) => {
      stage.bridge.reply({ installInstance: installThatKeepsRunning(stage.bridge) })
      await acceptTermsAndInstall(stage)
    }
  },
  {
    id: 'install-steps',
    title: 'Install steps and log',
    ready: '[data-testid="build-progress-step-detail"]',
    seed: () => FIRST_USE,
    arrange: async (stage) => {
      stage.bridge.reply({ installInstance: installThatKeepsRunning(stage.bridge) })
      await acceptTermsAndInstall(stage)
      await stage.click('[data-testid="home-build-open"]')
    }
  },
  {
    id: 'home',
    title: 'Home with builds',
    ready: '[data-testid="home-builds"]',
    seed: (machine) => ({ installations: everydayBuilds(machine) })
  },
  {
    id: 'home-empty',
    title: 'Home with no builds',
    ready: '[data-testid="home-view"]',
    seed: () => ({})
  },
  {
    id: 'builds',
    title: 'Builds',
    ready: '.chooser-view',
    seed: (machine) => ({ installations: everydayBuilds(machine) }),
    arrange: async ({ click }) => {
      await click('[data-testid="app-sidebar-chooser"]')
    }
  },
  {
    id: 'new-build',
    title: 'New build',
    ready: '[data-testid="config-summary"]',
    seed: (machine) => ({ installations: everydayBuilds(machine) }),
    arrange: async ({ click }) => {
      await click('[data-testid="app-sidebar-new-build"]')
    }
  },
  {
    id: 'apps',
    title: 'Apps',
    ready: '[data-testid="app-sidebar-apps"][aria-current="page"]',
    seed: (machine) => ({ installations: everydayBuilds(machine) }),
    arrange: async ({ click }) => {
      await click('[data-testid="app-sidebar-apps"]')
    }
  },
  {
    id: 'explore-workflows',
    title: 'Explore: Workflows',
    ready: '[data-testid="workflows-grid"]',
    seed: exploreSeed,
    arrange: openExploreWorkflows
  },
  {
    id: 'explore-workflow-filters',
    title: 'Explore: Workflows, filters open',
    ready: '[data-testid="explore-filter-useCase"]',
    seed: exploreSeed,
    arrange: async (stage) => {
      await openExploreWorkflows(stage)
      await stage.press('[data-testid="explore-filters"]', 'Enter')
    }
  },
  {
    id: 'workflow-page',
    title: 'Workflow page',
    ready: '[data-testid="catalog-workflow-action"]',
    seed: exploreSeed,
    arrange: openWorkflowPage
  },
  {
    id: 'workflow-page-graph',
    title: 'Workflow page: graph',
    ready: '[data-testid="workflow-graph-node"]',
    seed: exploreSeed,
    arrange: async (stage) => {
      await openWorkflowPage(stage)
      await stage.click('[data-testid="workflow-tab-graph"]')
    }
  },
  {
    id: 'workflow-page-download',
    title: 'Workflow page: models to download',
    ready: '[data-testid="catalog-workflow-note"]',
    seed: exploreSeed,
    arrange: async (stage) => {
      await openWorkflowPage(stage)
      await stage.press('[data-testid="catalog-workflow-target"]', 'Enter')
      await stage.click('[data-testid="catalog-workflow-target-local:inst-video-experiments"]')
      await stage.click('[data-testid="workflow-needs"]')
    }
  },
  {
    id: 'workflow-page-downloading',
    title: 'Workflow page: downloading models',
    ready: '[data-testid="catalog-workflow-progress"]',
    seed: exploreSeed,
    arrange: async (stage) => {
      await openWorkflowPage(stage)
      await stage.press('[data-testid="catalog-workflow-target"]', 'Enter')
      await stage.click('[data-testid="catalog-workflow-target-local:inst-video-experiments"]')
      stage.bridge.reply({ launchCatalogWorkflow: downloadThatKeepsRunning(stage.bridge) })
      await stage.click('[data-testid="catalog-workflow-action"]')
    }
  },
  {
    id: 'staff-apps',
    title: 'Development page for staff',
    ready: '[data-testid="staff-apps-grid"]',
    seed: (machine) => ({
      installations: everydayBuilds(machine),
      replies: { listHiddenApps: async () => ({ apps: HIDDEN_APP_CARDS }) }
    }),
    arrange: async ({ click }) => {
      await click('[data-testid="app-sidebar-staff-apps"]')
    }
  },
  {
    id: 'assets',
    title: 'Assets',
    ready: '[data-testid="app-sidebar-assets"][aria-current="page"]',
    seed: (machine) => ({
      installations: everydayBuilds(machine),
      replies: {
        listLocalAssets: async () => {
          const assets = localAssets()
          const count = (kind: string) => assets.filter((asset) => asset.kind === kind).length
          return {
            assets,
            total: assets.length,
            counts: {
              all: assets.length,
              image: count('image'),
              video: count('video'),
              audio: count('audio'),
              '3d': count('3d')
            }
          }
        }
      }
    }),
    arrange: async ({ click }) => {
      await click('[data-testid="app-sidebar-assets"]')
    }
  },
  {
    id: 'signed-in',
    title: 'Signed in to a team workspace',
    ready: '[data-testid="workspace-switcher-trigger"]',
    seed: (machine) => ({
      installations: everydayBuilds(machine),
      auth: {
        signedIn: true,
        email: 'someone@comfy.org',
        workspaceId: 'w-silverside',
        workspaceName: 'Silverside',
        workspaceType: 'team'
      },
      settings: { dashboardWorkspaceId: 'w-silverside' },
      workspaces: [
        {
          id: 'w-personal',
          name: 'Personal Workspace',
          type: 'personal',
          role: 'owner',
          subscriptionTier: null
        },
        {
          id: 'w-silverside',
          name: 'Silverside',
          type: 'team',
          role: 'owner',
          subscriptionTier: 'CREATOR'
        },
        {
          id: 'w-harbor',
          name: 'Harbor',
          type: 'team',
          role: 'member',
          subscriptionTier: 'ENTERPRISE'
        }
      ]
    })
  }
]

export function findScenario(id: string | null): PreviewScenario | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id)
}
