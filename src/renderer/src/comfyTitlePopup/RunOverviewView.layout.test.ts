import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import '../assets/main.css'
import en from '@locales/en.json'
import RunOverviewView from './RunOverviewView.vue'
import type { TitleBarRun } from '../types/ipc'

const CLOUD = { where: 'cloud' as const, buildId: null, buildName: null }
const SWAP = { appId: 'character-swap', appTitle: 'Character Swap', picture: null }
const CUTOUT = { appId: 'remove-background', appTitle: 'Remove Background', picture: null }
const MY_COMFY = { where: 'local' as const, buildId: 'b1', buildName: 'My ComfyUI' }

const runs: TitleBarRun[] = [
  ...Array.from({ length: 4 }, (_, i) => ({
    ...SWAP,
    ...CLOUD,
    id: `q${i}`,
    state: 'queued' as const,
    ahead: i
  })),
  { ...SWAP, ...CLOUD, id: 'd1', state: 'done', endedAt: 2 },
  { ...SWAP, ...CLOUD, id: 'f1', state: 'failed', endedAt: 1 }
]

let wrapper: VueWrapper | undefined

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

function nextFrames(): Promise<void> {
  return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))
}

describe('RunOverviewView layout', () => {
  it('scrolls the finished runs into view when the pop-up is already at its full height', async () => {
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
    wrapper = mount(RunOverviewView, {
      props: { overview: { runs, apps: [] } },
      attachTo: document.body,
      global: { plugins: [i18n] }
    })
    const scroller = wrapper.get<HTMLElement>('[data-testid="run-overview"]').element
    scroller.style.height = '200px'

    await wrapper.get('[data-testid="run-overview-finished-toggle"]').trigger('click')
    await nextFrames()

    const list = wrapper.get('[data-testid="run-overview-finished-run"]').element.closest('ol')
    expect(scroller.scrollTop).toBeGreaterThan(0)
    expect(list?.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      scroller.getBoundingClientRect().bottom + 1
    )
  })

  it('lines up the time of a Cloud run with Stop and a run on this computer without it', () => {
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
    wrapper = mount(RunOverviewView, {
      props: {
        overview: {
          runs: [
            { ...SWAP, ...CLOUD, id: 's1', state: 'running', canStop: true, startedAt: 1 },
            { ...CUTOUT, ...MY_COMFY, id: 'c1', state: 'running', startedAt: 1 }
          ],
          apps: []
        }
      },
      attachTo: document.body,
      global: { plugins: [i18n] }
    })
    const timeRights = wrapper
      .findAll('[data-testid="run-overview-run"]')
      .map((row) => row.get('.tabular-nums').element.getBoundingClientRect().right)

    expect(timeRights).toHaveLength(2)
    expect(Math.abs((timeRights[0] ?? 0) - (timeRights[1] ?? 0))).toBeLessThan(1)
  })
})
