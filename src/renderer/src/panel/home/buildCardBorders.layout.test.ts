import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
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
  it.each(['ember', 'iris', 'tide'] as const)('Home build card (%s)', async (tone) => {
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
