import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import '../assets/main.css'

type Callback = (value: unknown) => void

const LIGHT_EDITOR = { bg: 'rgb(224, 224, 224)', text: 'rgb(51, 51, 51)' }
const DARK_EDITOR = { bg: 'rgb(53, 53, 53)', text: 'rgb(221, 221, 221)' }

let callbacks: Map<string, Callback[]>
let wrapper: VueWrapper | null = null

function emit(event: string, value: unknown): void {
  for (const cb of callbacks.get(event) ?? []) cb(value)
}

function installBridge(): void {
  callbacks = new Map()
  const fixed: Record<string, unknown> = {
    getInstallationId: () => 'build-1',
    isMac: () => true,
    isLinux: () => false
  }
  const bridge = new Proxy(fixed, {
    get(target, key: string) {
      if (key in target) return target[key]
      if (key.startsWith('on')) {
        return (cb: Callback) => {
          callbacks.set(key, [...(callbacks.get(key) ?? []), cb])
          return () => {}
        }
      }
      return () => {}
    }
  })
  ;(window as unknown as { __comfyTitleBar: unknown }).__comfyTitleBar = bridge
  ;(window as unknown as { api: unknown }).api = {
    getSetting: async () => false,
    onSettingsChanged: () => () => {}
  }
}

async function mountTitleBar(editor: { bg: string; text: string }): Promise<VueWrapper> {
  const { default: TitleBarApp } = await import('./TitleBarApp.vue')
  wrapper = mount(TitleBarApp, { attachTo: document.body })
  await flushPromises()
  emit('onSourceCategoryChanged', 'local')
  emit('onThemeChanged', editor)
  emit('onDownloadsChanged', {
    active: [{ url: 'u', filename: 'a.safetensors', progress: 0.4, status: 'downloading' }],
    recent: []
  })
  await flushPromises()
  return wrapper
}

function style(el: Element): CSSStyleDeclaration {
  return getComputedStyle(el)
}

describe('TitleBarApp on a light ComfyUI theme', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'dark')
    installBridge()
    vi.resetModules()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('draws the downloads count dark on light, in the editor colours', async () => {
    const w = await mountTitleBar(LIGHT_EDITOR)
    const badge = style(w.get('.title-downloads-badge').element)
    expect(badge.backgroundColor).toBe(LIGHT_EDITOR.text)
    expect(badge.color).toBe(LIGHT_EDITOR.bg)
  })

  it("fills the What's new dot with the editor text colour, ringed by the bar", async () => {
    const w = await mountTitleBar(LIGHT_EDITOR)
    const dot = style(w.get('.title-announcement-dot').element)
    expect(dot.backgroundColor).toBe(LIGHT_EDITOR.text)
    expect(dot.boxShadow).toContain(LIGHT_EDITOR.bg)
  })

  it('keeps the bottom divider visible: a tint of the editor text, not white', async () => {
    const w = await mountTitleBar(LIGHT_EDITOR)
    const probe = document.createElement('div')
    probe.style.color = `color-mix(in srgb, ${LIGHT_EDITOR.text} 16%, transparent)`
    document.body.append(probe)
    expect(style(w.get('header').element).borderBottomColor).toBe(style(probe).color)
    probe.remove()
  })

  it('keeps the dark editor look: light count on the Desktop foreground', async () => {
    const w = await mountTitleBar(DARK_EDITOR)
    const badge = style(w.get('.title-downloads-badge').element)
    const probe = document.createElement('div')
    probe.style.color = 'var(--action)'
    probe.style.backgroundColor = 'var(--background)'
    document.body.append(probe)
    expect(badge.backgroundColor).toBe(style(probe).color)
    expect(badge.color).toBe(style(probe).backgroundColor)
    expect(style(w.get('.title-announcement-dot').element).backgroundColor).not.toBe(
      DARK_EDITOR.text
    )
    probe.remove()
  })
})
