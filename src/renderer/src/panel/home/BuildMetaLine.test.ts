import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

import '../../assets/main.css'
import BuildMetaLine from './BuildMetaLine.vue'

const VERSION = 'v0.3.68'
const SLACK = 10

const mounted: VueWrapper[] = []

async function mountTrailingOnly(width: number): Promise<VueWrapper> {
  const Host = defineComponent({
    setup: () => () =>
      h('div', { style: { width: `${width}px`, display: 'flex' } }, [
        h(BuildMetaLine, {
          text: '',
          trailing: VERSION,
          buildName: 'Flux Sandbox',
          showUpdate: true
        })
      ])
  })
  const wrapper = mount(Host, { attachTo: document.body })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

async function naturalWidths(): Promise<{ trailing: number; fullNote: number }> {
  const wrapper = await mountTrailingOnly(1000)
  const line = wrapper.get('[data-testid="build-update-note"]').element.parentElement!
  const trailing = line.firstElementChild as HTMLElement
  const fullNote = wrapper.get('[data-testid="build-update-note-sizer"]').element
  const widths = {
    trailing: trailing.scrollWidth,
    fullNote: fullNote.getBoundingClientRect().width
  }
  wrapper.unmount()
  mounted.splice(mounted.indexOf(wrapper), 1)
  return widths
}

function noteText(wrapper: VueWrapper): string {
  return wrapper.get('[data-testid="build-update-note"]').text().trim()
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

describe('BuildMetaLine with only a version beside the update note', () => {
  it('chooses the short label when only Update fits beside the version', async () => {
    const { trailing, fullNote } = await naturalWidths()
    const wrapper = await mountTrailingOnly(trailing + fullNote - SLACK)

    await vi.waitFor(() => expect(noteText(wrapper)).toBe('· Update'))
    expect(wrapper.text()).toContain(VERSION)
  })

  it('keeps the full label when the version and Update available both fit', async () => {
    const { trailing, fullNote } = await naturalWidths()
    const wrapper = await mountTrailingOnly(trailing + fullNote + SLACK)

    await flushPromises()
    expect(noteText(wrapper)).toBe('· Update available')
    expect(wrapper.text()).toContain(VERSION)
  })
})
