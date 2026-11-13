import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import MenuView from './MenuView.vue'

const items = [
  { id: 'performance-test', label: 'Performance Tests' },
  { id: 'benchmarks', label: 'Benchmarks' },
  { kind: 'separator' as const },
  { id: 'settings', label: 'Settings' }
]

let wrapper: VueWrapper | undefined

function mountMenu(menuItems: typeof items = items): VueWrapper {
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: {} } })
  wrapper = mount(MenuView, {
    props: { items: menuItems },
    attachTo: document.body,
    global: { plugins: [i18n] }
  })
  return wrapper
}

function press(key: string, init: KeyboardEventInit = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true, ...init }))
}

function focusedLabel(): string | undefined {
  return document.activeElement?.textContent?.trim()
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

describe('MenuView keyboard', () => {
  it('moves through the items with the arrow keys, skipping the separator and wrapping', () => {
    mountMenu()
    press('ArrowDown')
    expect(focusedLabel()).toBe('Performance Tests')
    press('ArrowDown')
    expect(focusedLabel()).toBe('Benchmarks')
    press('ArrowDown')
    expect(focusedLabel()).toBe('Settings')
    press('ArrowDown')
    expect(focusedLabel()).toBe('Performance Tests')
    press('ArrowUp')
    expect(focusedLabel()).toBe('Settings')
  })

  it('jumps to the first and last items with Home and End', () => {
    mountMenu()
    press('End')
    expect(focusedLabel()).toBe('Settings')
    press('Home')
    expect(focusedLabel()).toBe('Performance Tests')
  })

  it('opens the focused item with Enter or Space', () => {
    const menu = mountMenu()
    press('ArrowDown')
    press('ArrowDown')
    press('Enter')
    press('End')
    press(' ')
    expect(menu.emitted('activate')).toEqual([['benchmarks'], ['settings']])
  })

  it('does nothing on Enter when no item has focus', () => {
    const menu = mountMenu()
    press('Enter')
    expect(menu.emitted('activate')).toBeUndefined()
  })

  it('drops the focus when the popup loses focus, so it reopens clean', () => {
    mountMenu()
    press('ArrowDown')
    window.dispatchEvent(new Event('blur'))
    expect(document.activeElement).toBe(document.body)
  })

  it('reopens clean when the popup gets a new list of items', async () => {
    const menu = mountMenu()
    press('ArrowDown')
    await menu.setProps({ items: [...items] })
    expect(document.activeElement).toBe(document.body)
    press('Enter')
    expect(menu.emitted('activate')).toBeUndefined()
  })

  it('opens an item once when Enter is held down', () => {
    const menu = mountMenu()
    press('ArrowDown')
    press('Enter')
    press('Enter', { repeat: true })
    press('Enter', { repeat: true })
    expect(menu.emitted('activate')).toEqual([['performance-test']])
  })

  it('leaves the keys alone while focus is outside the menu', () => {
    mountMenu()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(input)
    input.remove()
  })

  it('leaves the keys alone during IME composition', () => {
    mountMenu()
    press('ArrowDown', { isComposing: true })
    expect(document.activeElement).toBe(document.body)
  })

  it('skips rows without an id', () => {
    mountMenu([
      { id: 'benchmarks', label: 'Benchmarks' },
      { label: 'Note' },
      { id: 'settings', label: 'Settings' }
    ])
    press('ArrowDown')
    press('ArrowDown')
    expect(focusedLabel()).toBe('Settings')
  })
})

describe('MenuView picked item', () => {
  it('marks a checked item as picked without drawing a check', () => {
    const wrapper = mountMenu([
      { id: 'performance-test', label: 'Performance Tests' },
      { id: 'benchmarks', label: 'Benchmarks', checked: true } as (typeof items)[number]
    ])
    const rows = wrapper.findAll('[role="menuitem"]')
    expect(rows.map((row) => row.attributes('aria-checked'))).toEqual([undefined, 'true'])
    expect(rows[1]!.find('svg').exists()).toBe(false)
  })
})
