import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import en from '@locales/en.json'
import zh from '@locales/zh.json'
import RunOverviewView from './RunOverviewView.vue'
import type { TitleBarOpenApp, TitleBarRun } from '../types/ipc'

const SWAP = { appId: 'character-swap', appTitle: 'Character Swap', picture: null }
const CUTOUT = { appId: 'remove-background', appTitle: 'Remove Background', picture: null }
const EXTEND = { appId: 'extend-picture', appTitle: 'Extend the Picture', picture: null }
const CLOUD = { where: 'cloud' as const, buildId: null, buildName: null }
const MY_COMFY = { where: 'local' as const, buildId: 'b1', buildName: 'My ComfyUI' }

const runs: TitleBarRun[] = [
  { ...EXTEND, ...MY_COMFY, id: 'e1', state: 'queued', ahead: 0 },
  { ...SWAP, ...CLOUD, id: 's3', state: 'queued', ahead: 2 },
  { ...SWAP, ...CLOUD, id: 's2', state: 'queued', ahead: 1 },
  {
    ...SWAP,
    ...CLOUD,
    id: 's1',
    state: 'running',
    step: 'Swapping the face',
    stepIndex: 3,
    stepCount: 4,
    progress: 0.6
  },
  { ...CUTOUT, ...MY_COMFY, id: 'c1', state: 'running', step: 'Loading models' },
  { ...EXTEND, ...MY_COMFY, id: 'e0', state: 'failed', step: 'Not enough GPU memory', endedAt: 1 },
  { ...SWAP, ...CLOUD, id: 's0', state: 'done', endedAt: 2 }
]

let wrapper: VueWrapper | undefined

function mountOverview(
  list: TitleBarRun[] = runs,
  locale = 'en',
  apps: TitleBarOpenApp[] = []
): VueWrapper {
  const i18n = createI18n({ legacy: false, locale, messages: { en, zh } })
  wrapper = mount(RunOverviewView, {
    props: { overview: { runs: list, apps } },
    attachTo: document.body,
    global: { plugins: [i18n] }
  })
  return wrapper
}

function statusOf(row: DOMWrapper<Element>): string {
  return row
    .get('[data-testid="run-overview-status"]')
    .findAll('span')
    .map((part) => part.text())
    .join(' ')
}

function nextFrames(): Promise<void> {
  return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))
}

function placeLines(view: VueWrapper, where: 'cloud' | 'local'): string[] {
  const place = view.get(`[data-testid="run-overview-place-${where}"]`)
  return [
    place.get('h2').text(),
    ...place
      .findAll('[data-testid="run-overview-run"]')
      .map((row) => `${row.attributes('aria-label')}: ${statusOf(row)}`)
  ]
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

describe('RunOverviewView', () => {
  it('groups runs going now by where they run, Cloud first, each in its own queue order', () => {
    const view = mountOverview()

    expect(placeLines(view, 'cloud')).toEqual([
      'Comfy Cloud',
      'Open Character Swap: Swapping the face · Step 3 of 4',
      'Open Character Swap: 1 run ahead',
      'Open Character Swap: 2 runs ahead'
    ])
    expect(placeLines(view, 'local')).toEqual([
      'My ComfyUI',
      'Open Remove Background: Loading models',
      'Open Extend the Picture: Next'
    ])
  })

  it('names a build it cannot find as this computer', () => {
    const view = mountOverview([
      { ...CUTOUT, ...MY_COMFY, buildName: null, id: 'c1', state: 'queued' }
    ])

    expect(placeLines(view, 'local')).toEqual(['This computer', 'Open Remove Background: Waiting'])
  })

  it('folds finished runs into one line, newest first, and opens them on click', async () => {
    const view = mountOverview()
    const toggle = view.get('[data-testid="run-overview-finished-toggle"]')
    expect(toggle.text()).toBe('Finished · 2')
    expect(view.findAll('[data-testid="run-overview-finished-run"]')).toHaveLength(0)

    await toggle.trigger('click')

    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(
      view.findAll('[data-testid="run-overview-finished-run"]').map((row) => row.text())
    ).toEqual([
      expect.stringContaining('Character SwapDone'),
      expect.stringContaining('Extend the PictureNot enough GPU memory')
    ])
  })

  it('asks to open the app of the run that was clicked', async () => {
    const view = mountOverview()

    await view.findAll('[data-testid="run-overview-run"]')[0]?.trigger('click')

    expect(view.emitted('open')).toEqual([[SWAP.appId]])
  })

  it('still lists open apps that send no runs, and opens them on click', async () => {
    const view = mountOverview(runs, 'en', [
      { id: 'upscale', title: 'Upscale', picture: null, state: 'running' },
      { id: 'relight', title: 'Relight', picture: null, state: 'ready' }
    ])
    const apps = view.findAll('[data-testid="run-overview-app"]')

    expect(view.get('[data-testid="run-overview-apps"] h2').text()).toBe('Other apps')
    expect(apps.map((row) => `${row.attributes('aria-label')}: ${statusOf(row)}`)).toEqual([
      'Open Upscale: Running',
      'Open Relight: Ready'
    ])

    await apps[1]?.trigger('click')

    expect(view.emitted('open')).toEqual([['relight']])
  })

  it('shows the full name and step on hover, and keeps the step count apart', () => {
    const view = mountOverview()
    const running = view.findAll('[data-testid="run-overview-run"]')[0]

    expect(running?.find('[title="Character Swap"]').exists()).toBe(true)
    expect(running?.find('[title="Swapping the face · Step 3 of 4"]').exists()).toBe(true)
    expect(running?.findAll('[data-testid="run-overview-status"] > span')[1]?.classes()).toContain(
      'shrink-0'
    )
  })

  it('shows the app icon when a run has no picture or its picture fails', async () => {
    const view = mountOverview([
      { ...SWAP, ...CLOUD, picture: 'data:image/png;base64,broken', id: 's1', state: 'queued' },
      { ...CUTOUT, ...MY_COMFY, id: 'c1', state: 'queued' }
    ])
    await view.get('img').trigger('error')

    expect(view.findAll('img')).toHaveLength(0)
    expect(view.findAll('[data-testid="run-overview-app-icon"]')).toHaveLength(2)
  })

  it('asks for a new height when the finished runs open and close', async () => {
    const view = mountOverview()
    await nextFrames()
    const before = view.emitted('resize')?.length ?? 0

    await view.get('[data-testid="run-overview-finished-toggle"]').trigger('click')
    await nextFrames()
    const lastHeight = (): number | undefined => view.emitted<[number]>('resize')?.at(-1)?.[0]
    const openedHeight = lastHeight()

    expect(view.emitted('resize')?.length).toBeGreaterThan(before)
    expect(openedHeight).toBe(view.get('.run-overview-content').element.clientHeight)

    await view.get('[data-testid="run-overview-finished-toggle"]').trigger('click')
    await nextFrames()

    expect(lastHeight()).toBeLessThan(openedHeight ?? 0)
  })

  it('shows Stop only for runs the page can stop, and says Stopping… until the run stops', async () => {
    const stoppable: TitleBarRun = { ...SWAP, ...CLOUD, id: 's1', state: 'running', canStop: true }
    const view = mountOverview([stoppable, { ...CUTOUT, ...MY_COMFY, id: 'c1', state: 'queued' }])
    const stops = view.findAll('[data-testid="run-overview-stop"]')

    expect(stops).toHaveLength(1)
    expect(stops[0]?.attributes('aria-label')).toBe('Stop the Character Swap run')

    await stops[0]?.trigger('click')
    await stops[0]?.trigger('click')

    expect(view.emitted('stop')).toEqual([[SWAP.appId, 's1']])
    expect(view.emitted('open')).toBeUndefined()
    expect(stops[0]?.attributes('disabled')).toBeDefined()
    expect(statusOf(view.findAll('[data-testid="run-overview-run"]')[0]!)).toBe('Stopping…')

    await view.setProps({ overview: { runs: [{ ...stoppable, canStop: false }], apps: [] } })

    expect(view.findAll('[data-testid="run-overview-stop"]')).toHaveLength(0)
    expect(statusOf(view.get('[data-testid="run-overview-run"]'))).toBe('Running')
  })

  it('offers Stop again and says it did not stop when the page keeps the run stoppable', async () => {
    vi.useFakeTimers()
    try {
      const stoppable: TitleBarRun = {
        ...SWAP,
        ...CLOUD,
        id: 's1',
        state: 'running',
        canStop: true
      }
      const view = mountOverview([stoppable])
      await view.get('[data-testid="run-overview-stop"]').trigger('click')

      await vi.advanceTimersByTimeAsync(4900)
      expect(view.get('[data-testid="run-overview-stop"]').attributes('disabled')).toBeDefined()

      await vi.advanceTimersByTimeAsync(100)
      expect(view.get('[data-testid="run-overview-stop"]').attributes('disabled')).toBeUndefined()
      expect(statusOf(view.get('[data-testid="run-overview-run"]'))).toBe("Didn't stop. Try again.")

      await view.setProps({
        overview: { runs: [{ ...stoppable, step: 'Swapping the face' }], apps: [] }
      })
      expect(statusOf(view.get('[data-testid="run-overview-run"]'))).toBe('Swapping the face')

      await view.get('[data-testid="run-overview-stop"]').trigger('click')
      expect(view.emitted('stop')).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the time of rows without Stop in line with rows that have it', () => {
    const view = mountOverview([
      { ...SWAP, ...CLOUD, id: 's1', state: 'running', canStop: true, startedAt: 1 },
      { ...CUTOUT, ...MY_COMFY, id: 'c1', state: 'running', startedAt: 1 }
    ])

    expect(view.findAll('[data-testid="run-overview-stop"]')).toHaveLength(1)
    expect(view.findAll('[data-testid="run-overview-stop-space"]')).toHaveLength(1)
  })

  it('leaves no Stop space when no run can stop', () => {
    const view = mountOverview()

    expect(view.findAll('[data-testid="run-overview-stop-space"]')).toHaveLength(0)
  })

  it('speaks Chinese when Desktop does', () => {
    const view = mountOverview(runs, 'zh')

    expect(placeLines(view, 'local')[0]).toBe('My ComfyUI')
    expect(placeLines(view, 'local')[2]).toBe('打开 Extend the Picture: 下一个')
    expect(placeLines(view, 'cloud')[2]).toBe('打开 Character Swap: 前面还有 1 个任务')
  })
})
