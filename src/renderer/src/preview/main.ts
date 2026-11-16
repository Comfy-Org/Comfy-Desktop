import { createFakeBridge } from './fakeBridge'
import { isPreviewPlatform, previewMachine, type PreviewPlatform } from './fixtures'
import { SCENARIOS, findScenario, type PreviewScenario, type PreviewStage } from './scenarios'

const APPEAR_TIMEOUT_MS = 10_000
const PLATFORMS: { value: PreviewPlatform; label: string }[] = [
  { value: 'darwin', label: 'macOS' },
  { value: 'win32', label: 'Windows' },
  { value: 'linux', label: 'Linux' }
]

function appear(selector: string): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    const find = (): HTMLElement | null => document.querySelector<HTMLElement>(selector)
    const found = find()
    if (found) return resolve(found)
    const observer = new MutationObserver(() => {
      const el = find()
      if (!el) return
      observer.disconnect()
      clearTimeout(timer)
      resolve(el)
    })
    const timer = setTimeout(() => {
      observer.disconnect()
      reject(new Error(`Preview: nothing matched ${selector} within ${APPEAR_TIMEOUT_MS} ms`))
    }, APPEAR_TIMEOUT_MS)
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true
    })
  })
}

function addTheQueryMainGivesThePanel(firstUseCompleted: boolean): void {
  const url = new URL(window.location.href)
  url.searchParams.set('firstUseCompleted', String(firstUseCompleted))
  window.history.replaceState(null, '', url)
}

function showFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  document.documentElement.dataset.previewFailed = message
  console.error(message)
}

async function showScenario(scenario: PreviewScenario, platform: PreviewPlatform): Promise<void> {
  const bridge = createFakeBridge({ platform, ...scenario.seed(previewMachine(platform)) })
  window.api = bridge.api
  document.title = `${scenario.title} — Comfy Desktop preview`
  addTheQueryMainGivesThePanel(bridge.settings.firstUseCompleted === true)

  const { mountPanel } = await import('../panel/mountPanel')
  mountPanel()

  const stage: PreviewStage = {
    bridge,
    see: appear,
    click: async (selector) => (await appear(selector)).click()
  }
  await bridge.quiet()
  await scenario.arrange?.(stage)
  await appear(scenario.ready)
  await bridge.quiet()
  await document.fonts.ready
  document.documentElement.dataset.previewReady = scenario.id
}

async function showIndex(): Promise<void> {
  await import('../assets/main.css')
  document.documentElement.classList.add('desktop-panel')
  document.title = 'Comfy Desktop preview'
  document.getElementById('panel-boot-splash')?.remove()

  const list = document.createElement('ul')
  list.className = 'm-0 flex list-none flex-col gap-2 p-0'
  for (const scenario of SCENARIOS) {
    const row = document.createElement('li')
    row.className = 'flex items-baseline gap-4'
    row.dataset.scenario = scenario.id
    const name = document.createElement('span')
    name.className = 'w-72 text-foreground'
    name.textContent = scenario.title
    row.append(name)
    for (const platform of PLATFORMS) {
      const link = document.createElement('a')
      link.className = 'text-muted-foreground underline hover:text-foreground'
      link.href = `?scenario=${scenario.id}&platform=${platform.value}`
      link.textContent = platform.label
      row.append(link)
    }
    list.append(row)
  }

  const heading = document.createElement('h1')
  heading.className = 'm-0 mb-6 text-[22px]/[27px] font-semibold text-foreground'
  heading.textContent = 'Comfy Desktop preview'

  const page = document.createElement('main')
  page.className = 'min-h-screen bg-[var(--bg)] p-10 text-[13px]/5'
  page.append(heading, list)
  document.getElementById('app')?.replaceWith(page)
  document.documentElement.dataset.previewReady = 'index'
}

const params = new URLSearchParams(window.location.search)
const scenarioId = params.get('scenario')
const scenario = findScenario(scenarioId)
const platformParam = params.get('platform')
const platform = isPreviewPlatform(platformParam) ? platformParam : 'darwin'

if (scenario) {
  showScenario(scenario, platform).catch(showFailure)
} else if (scenarioId) {
  showFailure(new Error(`Preview: there is no scenario named ${scenarioId}`))
} else {
  showIndex().catch(showFailure)
}
