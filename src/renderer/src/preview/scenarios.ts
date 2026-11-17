import type { BridgeSeed, FakeBridge } from './fakeBridge'
import { INSTALL_STEPS, everydayBuilds, localAssets, type PreviewMachine } from './fixtures'

export interface PreviewStage {
  bridge: FakeBridge
  see(selector: string): Promise<HTMLElement>
  click(selector: string): Promise<void>
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
    id: 'assets',
    title: 'Assets',
    ready: '[data-testid="app-sidebar-assets"][aria-current="page"]',
    seed: (machine) => ({
      installations: everydayBuilds(machine),
      replies: {
        listLocalAssets: async () => ({ assets: localAssets(), provenanceIncomplete: false })
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
