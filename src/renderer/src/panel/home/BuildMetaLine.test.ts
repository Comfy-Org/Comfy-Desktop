import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

import '../../assets/main.css'
import BuildMetaLine from './BuildMetaLine.vue'

const VERSION = 'v0.3.68'
const SLACK = 10

const mounted: VueWrapper[] = []

const hostWidth = ref(1000)

async function mountTrailingOnly(): Promise<VueWrapper> {
  hostWidth.value = 1000
  const Host = defineComponent({
    setup: () => () =>
      h('div', { style: { width: `${hostWidth.value}px`, display: 'flex' } }, [
        h(BuildMetaLine, {
          text: '',
          trailing: VERSION,
          buildName: 'Flux Sandbox',
          showUpdate: true
        })
      ])
  })
  await document.fonts.load('12px Inter')
  const wrapper = mount(Host, { attachTo: document.body })
  mounted.push(wrapper)
  await flushPromises()
  await document.fonts.ready
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  return wrapper
}

function naturalWidths(wrapper: VueWrapper): { trailing: number; fullNote: number } {
  const line = wrapper.get('[data-testid="build-update-note"]').element.parentElement!
  const trailing = line.firstElementChild as HTMLElement
  const fullNote = wrapper.get('[data-testid="build-update-note-sizer"]').element
  return {
    trailing: trailing.scrollWidth,
    fullNote: fullNote.getBoundingClientRect().width
  }
}

function noteText(wrapper: VueWrapper): string {
  return wrapper.get('[data-testid="build-update-note"]').text().trim()
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

describe('BuildMetaLine with only a version beside the update note', () => {
  it('chooses the short label when only Update fits beside the version', async () => {
    const wrapper = await mountTrailingOnly()
    const { trailing, fullNote } = naturalWidths(wrapper)
    hostWidth.value = trailing + fullNote - SLACK

    await vi.waitFor(() => expect(noteText(wrapper)).toBe('· Update'))
    expect(wrapper.text()).toContain(VERSION)
  })

  it('keeps the full label when the version and Update available both fit', async () => {
    const wrapper = await mountTrailingOnly()
    const { trailing, fullNote } = naturalWidths(wrapper)
    hostWidth.value = trailing + fullNote + SLACK

    await flushPromises()
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    expect(noteText(wrapper)).toBe('· Update available')
    expect(wrapper.text()).toContain(VERSION)
  })
})
