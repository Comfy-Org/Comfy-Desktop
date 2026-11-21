import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

import '../../assets/main.css'
import BaseSelect from './BaseSelect.vue'

const wrappers: VueWrapper[] = []

afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount()
  document.body.innerHTML = ''
})

async function openSelectAt(width: number, labels: string[]) {
  document.documentElement.setAttribute('data-theme', 'dark')
  const Host = defineComponent({
    setup: () => () =>
      h('div', { style: { width: `${width}px`, margin: '40px' } }, [
        h(BaseSelect, {
          modelValue: 'a',
          ariaLabel: 'Width test',
          options: labels.map((label, index) => ({ value: index === 0 ? 'a' : label, label }))
        })
      ])
  })
  const wrapper = mount(Host, { attachTo: document.body })
  wrappers.push(wrapper)
  await flushPromises()
  await wrapper.get('.ui-select-trigger').trigger('keydown', { key: 'ArrowDown' })
  await flushPromises()
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const trigger = wrapper.get('.ui-select-trigger').element.getBoundingClientRect()
  const listboxEl = document.querySelector<HTMLElement>('.ui-select-listbox')!
  await Promise.all(listboxEl.getAnimations().map((animation) => animation.finished))
  const listbox = listboxEl.getBoundingClientRect()
  return { trigger, listbox, triggerEl: wrapper.get('.ui-select-trigger').element, listboxEl }
}

function opaque(color: string): boolean {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d')!
  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)
  return context.getImageData(0, 0, 1, 1).data[3] === 255
}

function lightnessOverModal(color: string): number {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d')!
  context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(
    '--modal-surface-bg'
  )
  context.fillRect(0, 0, 1, 1)
  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data
  return (red + green + blue) / 3
}

describe('BaseSelect open menu width', () => {
  it('opens exactly as wide as its trigger when the options fit', async () => {
    const { trigger, listbox } = await openSelectAt(160, ['English', '简体中文'])

    expect(listbox.width).toBe(trigger.width)
    expect(listbox.left).toBe(trigger.left)
  })

  it('sits above its trigger: a lighter surface with an edge that stands out from it', async () => {
    const { triggerEl, listboxEl } = await openSelectAt(160, ['English', '简体中文'])
    const listboxStyle = getComputedStyle(listboxEl)
    const listboxSurface = lightnessOverModal(listboxStyle.backgroundColor)

    expect(opaque(listboxStyle.backgroundColor), 'nothing behind the menu shows through').toBe(true)
    expect(listboxSurface).toBeGreaterThan(
      lightnessOverModal(getComputedStyle(triggerEl).backgroundColor)
    )
    expect(lightnessOverModal(listboxStyle.borderTopColor)).toBeGreaterThan(listboxSurface)
  })
})
