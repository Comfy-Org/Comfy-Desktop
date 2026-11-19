import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { h } from 'vue'
import Button from '@comfyorg/design-system/button/Button'

import '../assets/main.css'
import FirstUseTakeover from './FirstUseTakeover.vue'
import TrackModal from './TrackModal.vue'
import ComfyLifecycleView from '../panel/ComfyLifecycleView.vue'
import { useSessionStore } from '../stores/sessionStore'
import type { Installation } from '../types/ipc'

const wrappers: VueWrapper[] = []

beforeEach(() => {
  setActivePinia(createPinia())
  window.api = new Proxy(
    {
      platform: 'darwin',
      getSystemInfo: vi.fn().mockResolvedValue({
        gpu_label: 'Apple M3 Max',
        gpu_model: 'Apple M3 Max',
        cpu_model: 'Apple M3 Max',
        total_memory_gb: 36,
        gpu_tier: 'high'
      }),
      validateHardware: vi.fn().mockResolvedValue({ supported: true }),
      getDefaultInstallDir: vi.fn().mockResolvedValue('/Users/ada/ComfyUI-Installs'),
      getDiskSpace: vi.fn().mockResolvedValue({ free: 412 * 1024 ** 3, total: 1000 * 1024 ** 3 }),
      getSources: vi.fn().mockResolvedValue([]),
      getFieldOptions: vi.fn().mockResolvedValue([]),
      getUniqueName: vi.fn().mockResolvedValue('ComfyUI'),
      getRunningInstances: vi.fn().mockResolvedValue([]),
      getLastCrashError: vi.fn().mockResolvedValue(null)
    } as Record<string, unknown>,
    {
      get: (target, key) =>
        key in target
          ? target[key as string]
          : String(key).startsWith('on')
            ? vi.fn(() => () => {})
            : vi.fn().mockResolvedValue(undefined)
    }
  ) as unknown as typeof window.api
})

afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount()
  document.body.innerHTML = ''
})

async function track(wrapper: VueWrapper): Promise<void> {
  wrappers.push(wrapper)
  await flushPromises()
  await new Promise((resolve) => requestAnimationFrame(resolve))
}

function look(el: Element): { height: number; radius: string; background: string } {
  const style = getComputedStyle(el)
  return {
    height: (el as HTMLElement).offsetHeight,
    radius: style.borderTopLeftRadius,
    background: style.backgroundColor
  }
}

async function designSystemPrimary(): Promise<ReturnType<typeof look>> {
  await track(
    mount(() => h(Button, { variant: 'inverted', size: 'lg', 'data-testid': 'ref' }, () => 'OK'), {
      attachTo: document.body
    })
  )
  return look(document.querySelector('[data-testid="ref"]')!)
}

describe('primary buttons', () => {
  it('Set up Install is the design system white primary', async () => {
    const reference = await designSystemPrimary()
    await track(mount(FirstUseTakeover, { attachTo: document.body }))
    expect(look(document.querySelector('[data-testid="setup-install"]')!)).toEqual(reference)
  })

  it('Add existing build Save is the design system white primary', async () => {
    const reference = await designSystemPrimary()
    const modal = mount(TrackModal, { attachTo: document.body })
    ;(modal.vm as unknown as { open: () => void }).open()
    await track(modal)
    const save = look(document.querySelector('.track-save')!)
    expect(save.height).toBe(reference.height)
    expect(save.radius).toBe(reference.radius)
  })

  it('the launch spinner is foreground white with no ring around it', async () => {
    useSessionStore().ready = true
    await track(
      mount(ComfyLifecycleView, {
        attachTo: document.body,
        props: {
          installationId: 'inst-1',
          installation: { id: 'inst-1', name: 'Local', status: 'installed' } as Installation
        }
      })
    )
    useSessionStore().launchingInstances.set('inst-1', { installationName: 'Local' })
    await flushPromises()
    const icon = document.querySelector('.lifecycle-placeholder__icon')!
    const probe = document.createElement('span')
    probe.className = 'text-foreground'
    document.body.appendChild(probe)
    expect(getComputedStyle(icon).color).toBe(getComputedStyle(probe).color)
    expect(getComputedStyle(icon).borderTopWidth).toBe('0px')
  })

  it('the launch screen centres the spinner block and shows the build under the title', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'display:flex;flex-direction:column;width:1244px;height:892px'
    document.body.appendChild(host)
    useSessionStore().ready = true
    await track(
      mount(ComfyLifecycleView, {
        attachTo: host,
        props: {
          installationId: 'inst-1',
          installation: {
            id: 'inst-1',
            name: 'My build',
            version: 'v0.3.62',
            status: 'installed'
          } as Installation
        }
      })
    )
    const mountPoint = host.firstElementChild as HTMLElement
    mountPoint.style.cssText = 'display:flex;flex-direction:column;flex:1 1 0%;min-height:0'
    useSessionStore().launchingInstances.set('inst-1', { installationName: 'My build' })
    await flushPromises()
    const hostBox = host.getBoundingClientRect()
    const block = document.querySelector('.lifecycle-placeholder')!.getBoundingClientRect()
    const icon = document.querySelector('.lifecycle-placeholder__icon')!.getBoundingClientRect()
    expect(
      Math.abs(block.left + block.width / 2 - (hostBox.left + hostBox.width / 2))
    ).toBeLessThanOrEqual(1)
    expect(
      Math.abs(block.top + block.height / 2 - (hostBox.top + hostBox.height / 2))
    ).toBeLessThanOrEqual(1)
    expect(
      Math.abs(icon.left + icon.width / 2 - (hostBox.left + hostBox.width / 2))
    ).toBeLessThanOrEqual(1)

    const title = document.querySelector('.lifecycle-placeholder h2')!.getBoundingClientRect()
    const line = document.querySelector('.lifecycle-placeholder__build')!
    expect(line.textContent?.trim()).toBe('My build · v0.3.62')
    expect(Math.round(line.getBoundingClientRect().top - title.bottom)).toBe(4)
    const muted = document.createElement('span')
    muted.className = 'text-muted-foreground'
    document.body.appendChild(muted)
    expect(getComputedStyle(line).color).toBe(getComputedStyle(muted).color)
  })

  it('the launch screen has no build line without a build name or version', async () => {
    useSessionStore().ready = true
    await track(
      mount(ComfyLifecycleView, {
        attachTo: document.body,
        props: { installationId: 'inst-1', installation: null }
      })
    )
    useSessionStore().launchingInstances.set('inst-1', { installationName: '' })
    await flushPromises()
    expect(document.querySelector('.lifecycle-placeholder')).not.toBeNull()
    expect(document.querySelector('.lifecycle-placeholder__build')).toBeNull()
  })

  it('Browse in Add existing build is the filled secondary button with no outline', async () => {
    await track(
      mount(
        () => h(Button, { variant: 'secondary', size: 'sm', 'data-testid': 'ref' }, () => 'Change'),
        {
          attachTo: document.body
        }
      )
    )
    const reference = document.querySelector('[data-testid="ref"]')!
    const modal = mount(TrackModal, { attachTo: document.body })
    ;(modal.vm as unknown as { open: () => void }).open()
    await track(modal)
    const browse = document.querySelector('.config-path-browse')!
    const style = getComputedStyle(browse)
    expect(style.backgroundColor).toBe(getComputedStyle(reference).backgroundColor)
    expect(style.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(style.boxShadow).toBe('none')
    expect(style.borderTopWidth).toBe('0px')
    expect((browse as HTMLElement).offsetHeight).toBe(24)
    const field = document.querySelector('.config-path-input') as HTMLElement
    expect(field.offsetHeight).toBe(40)
  })
})
