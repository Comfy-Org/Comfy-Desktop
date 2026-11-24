import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import MenuView from './MenuView.vue'
import type { TitlePopupMenuItem } from '../../../types/ipc'

const items: TitlePopupMenuItem[] = [
  { id: 'performance-test', label: 'Performance tests' },
  { id: 'benchmarks', label: 'Benchmarks' },
  { kind: 'separator' },
  { id: 'settings', label: 'Settings' }
]

let wrapper: VueWrapper | undefined

function mountMenu(menuItems: TitlePopupMenuItem[] = items): VueWrapper {
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
    expect(focusedLabel()).toBe('Performance tests')
    press('ArrowDown')
    expect(focusedLabel()).toBe('Benchmarks')
    press('ArrowDown')
    expect(focusedLabel()).toBe('Settings')
    press('ArrowDown')
    expect(focusedLabel()).toBe('Performance tests')
    press('ArrowUp')
    expect(focusedLabel()).toBe('Settings')
  })

  it('jumps to the first and last items with Home and End', () => {
    mountMenu()
    press('End')
    expect(focusedLabel()).toBe('Settings')
    press('Home')
    expect(focusedLabel()).toBe('Performance tests')
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

describe('MenuView rows', () => {
  it('draws an icon on each row and spaces the rows 2px apart when the items have icons', () => {
    const view = mountMenu([
      { id: 'performance-test', label: 'Performance tests', icon: 'performance-test' },
      { id: 'benchmarks', label: 'Benchmarks', icon: 'benchmarks' }
    ])
    expect(view.find('ul').classes()).toEqual(expect.arrayContaining(['flex', 'gap-0.5']))
    const rows = view.findAll('li.item')
    expect(rows[0]?.find('.lucide-gauge').exists()).toBe(true)
    expect(rows[1]?.find('.lucide-chart-column').exists()).toBe(true)
  })

  it('keeps rows without icons flush and icon-free', () => {
    const view = mountMenu()
    expect(view.find('ul').classes()).not.toContain('gap-0.5')
    expect(view.find('li.item svg').exists()).toBe(false)
  })

  it('fills label parameters from the locale string', () => {
    const i18n = createI18n({
      legacy: false,
      locale: 'en',
      messages: { en: { fileMenu: { resetZoom: 'Reset Zoom ({percent}%)' } } }
    })
    wrapper = mount(MenuView, {
      props: {
        items: [
          {
            id: 'reset-zoom',
            label: 'Fallback label',
            labelKey: 'fileMenu.resetZoom',
            labelParams: { percent: 144 }
          }
        ]
      },
      attachTo: document.body,
      global: { plugins: [i18n] }
    })
    expect(wrapper.find('li.item').text()).toBe('Reset Zoom (144%)')
  })

  it('lists apps with their picture, name and state, and opens the one picked', async () => {
    const i18n = createI18n({
      legacy: false,
      locale: 'en',
      messages: {
        en: {
          titleBar: { ready: 'Ready' },
          apps: { rail: { running: '{app}, making something', finished: '{app}, ready' } }
        }
      }
    })
    wrapper = mount(MenuView, {
      props: {
        items: [
          {
            id: 'running-app:remove-background',
            label: 'Remove Background',
            app: { picture: 'data:image/png;base64,iVBORw0KGgo=', state: 'running' }
          },
          {
            id: 'running-app:sdr-to-hdr',
            label: 'SDR to HDR',
            app: { picture: null, state: 'ready' }
          }
        ]
      },
      attachTo: document.body,
      global: { plugins: [i18n] }
    })
    const [running, ready] = wrapper.findAll('[data-testid="title-popup-app"]')

    expect(running?.text()).toBe('Remove Background')
    expect(running?.find('img').attributes('src')).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(running?.find('[data-testid="title-popup-app-running"]').exists()).toBe(true)
    expect(running?.attributes('aria-label')).toBe('Remove Background, making something')
    expect(ready?.text()).toBe('SDR to HDR Ready')
    expect(ready?.find('img').exists()).toBe(false)
    expect(ready?.find('[data-testid="title-popup-app-ready"]').exists()).toBe(true)
    expect(ready?.attributes('aria-label')).toBe('SDR to HDR, ready')
    expect(wrapper.find('ul').classes()).toContain('gap-0.5')

    await ready?.trigger('click')
    expect(wrapper.emitted('activate')).toEqual([['running-app:sdr-to-hdr']])
  })
})
