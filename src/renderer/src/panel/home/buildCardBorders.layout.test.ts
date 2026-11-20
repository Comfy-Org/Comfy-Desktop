import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { userEvent } from 'vitest/browser'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import '../../assets/main.css'
import HomeBuildCard from './HomeBuildCard.vue'
import HomeNewBuildTile from './HomeNewBuildTile.vue'
import ChooserInstallTile from '../../views/chooser/ChooserInstallTile.vue'
import { provideBuildMenuHost } from './useBuildMenu'
import { provideBuildLogs } from '../../composables/useBuildProgress'
import { useInstallationStore } from '../../stores/installationStore'
import type { Installation } from '../../types/ipc'

const BUILD: Installation = {
  id: 'flux',
  name: 'Flux Sandbox',
  sourceId: 'standalone',
  sourceLabel: 'Standalone',
  sourceCategory: 'local',
  status: 'installed',
  version: 'v0.42.4',
  installPath: '/Users/someone/ComfyUI/Flux Sandbox'
}

const mounted: VueWrapper[] = []

beforeEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
  ;(window as unknown as { api: unknown }).api = new Proxy(
    {},
    {
      get: (_, method) =>
        String(method).startsWith('on')
          ? vi.fn(() => vi.fn())
          : vi.fn().mockResolvedValue(undefined)
    }
  )
  setActivePinia(createPinia())
  useInstallationStore().installations = [BUILD]
})

async function mountWithHost(render: () => ReturnType<typeof h>): Promise<HTMLElement> {
  const wrapper = mount(
    defineComponent({
      setup() {
        provideBuildMenuHost({ launch: vi.fn(), openDetails: vi.fn(), showProgress: vi.fn() })
        provideBuildLogs(vi.fn())
        return render
      }
    }),
    { attachTo: document.body }
  )
  mounted.push(wrapper)
  await flushPromises()
  return wrapper.element as HTMLElement
}

function borderWidths(el: HTMLElement): string[] {
  const style = getComputedStyle(el)
  return [
    style.borderTopWidth,
    style.borderRightWidth,
    style.borderBottomWidth,
    style.borderLeftWidth
  ]
}

const NONE = ['0px', '0px', '0px', '0px']

describe('build cards have no border', () => {
  it.each(['iris', 'tide'] as const)('Home build card (%s)', async (tone) => {
    const el = await mountWithHost(() => h(HomeBuildCard, { build: BUILD, status: 'ready', tone }))
    expect(borderWidths(el)).toEqual(NONE)
  })

  it('Home New build tile beside them', async () => {
    const el = await mountWithHost(() => h(HomeNewBuildTile))
    expect(borderWidths(el)).toEqual(NONE)
  })

  it('Builds tile', async () => {
    const el = await mountWithHost(() => h(ChooserInstallTile, { installation: BUILD }))
    expect(borderWidths(el)).toEqual(NONE)
  })
})

const CARDS = [
  ['Home build card', () => h(HomeBuildCard, { build: BUILD, status: 'ready', tone: 'iris' })],
  ['Builds tile', () => h(ChooserInstallTile, { installation: BUILD })]
] as const

describe('build cards have a glass surface', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'dark'
    return () => delete document.documentElement.dataset.theme
  })

  it.each(CARDS)(
    '%s is a see-through card fill with a top sheen and highlight',
    async (_, render) => {
      const style = getComputedStyle(await mountWithHost(render))
      expect(style.backgroundColor).toBe('oklab(0.23 0 0 / 0.75)')
      expect(style.backgroundImage).toMatch(/^linear-gradient\(.+, rgba\(0, 0, 0, 0\) 40%\)$/)
      expect(style.boxShadow).toBe('oklch(1 0 0 / 0.06) 0px 1px 0px 0px inset')
    }
  )

  it.each(CARDS)('%s turns to the card hover fill under the pointer', async (_, render) => {
    const el = await mountWithHost(render)
    await userEvent.hover(el, { force: true })
    await expect.poll(() => getComputedStyle(el).backgroundColor).toBe('oklab(0.265 0 0 / 0.8)')
  })
})
