import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import en from '@locales/en.json'
import zh from '@locales/zh.json'
import RunOverviewView from './RunOverviewView.vue'
import type { TitleBarRun } from '../types/ipc'

const SWAP = { appId: 'character-swap', appTitle: 'Character Swap', picture: null }
const CUTOUT = { appId: 'remove-background', appTitle: 'Remove Background', picture: null }
const EXTEND = { appId: 'extend-picture', appTitle: 'Extend the Picture', picture: null }
const CLOUD = { where: 'cloud' as const, buildId: null, buildName: null }
const MY_COMFY = { where: 'local' as const, buildId: 'b1', buildName: 'My ComfyUI' }

const runs: TitleBarRun[] = [
  { ...EXTEND, ...MY_COMFY, id: 'e1', state: 'queued', ahead: 1 },
  { ...SWAP, ...CLOUD, id: 's2', state: 'queued', ahead: 3 },
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

function mountOverview(list: TitleBarRun[] = runs, locale = 'en'): VueWrapper {
  const i18n = createI18n({ legacy: false, locale, messages: { en, zh } })
  wrapper = mount(RunOverviewView, {
    props: { runs: list },
    attachTo: document.body,
    global: { plugins: [i18n] }
  })
  return wrapper
}

function placeLines(view: VueWrapper, where: 'cloud' | 'local'): string[] {
  const place = view.get(`[data-testid="run-overview-place-${where}"]`)
  return [
    place.get('h2').text(),
    ...place
      .findAll('[data-testid="run-overview-run"]')
      .map(
        (row) =>
          `${row.attributes('aria-label')}: ${row.get('[data-testid="run-overview-status"]').text()}`
      )
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
      'Open Character Swap: 3 runs ahead'
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

  it('says there are no runs when every run is gone', () => {
    const view = mountOverview([])

    expect(view.text()).toBe('No runs right now')
  })

  it('speaks Chinese when Desktop does', () => {
    const view = mountOverview(runs, 'zh')

    expect(placeLines(view, 'local')[0]).toBe('My ComfyUI')
    expect(placeLines(view, 'local')[2]).toBe('打开 Extend the Picture: 下一个')
  })
})
