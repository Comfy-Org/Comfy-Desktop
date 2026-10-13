import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide, ref, type Component } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

import AnnouncementModal from '../components/AnnouncementModal.vue'
import BrandTakeoverLayout from '../components/BrandTakeoverLayout.vue'
import Modal from '../components/Modal.vue'
import ModalDialog from '../components/ModalDialog.vue'
import BaseAlert from '../components/ui/BaseAlert.vue'
import BaseModal from '../components/ui/BaseModal.vue'
import McpSetupModal from '../views/mcp/McpSetupModal.vue'
import { useModal } from './useModal'
import { PAGE_COVERED, PageScope } from '../lib/pageCovered'
import { TELEMETRY_ACTION_EVENT_NAME, type TelemetryActionEventDetail } from '../lib/telemetry'

const wrappers: VueWrapper[] = []
const cleanups: (() => void)[] = []

function track<T extends VueWrapper>(wrapper: T): T {
  wrappers.push(wrapper)
  return wrapper
}

function mountAlert(title: string, open: boolean) {
  return track(
    mount(BaseAlert, { props: { open, title, showCancel: true }, attachTo: document.body })
  )
}

function pressEscape(): void {
  ;(document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  )
}

afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount()
  while (cleanups.length) cleanups.pop()?.()
})

describe.each([
  { name: "What's New", mountCover: () => mount(AnnouncementModal, { attachTo: document.body }) },
  {
    name: 'Feedback',
    mountCover: () =>
      mount(BaseModal, {
        props: { open: true, ariaLabel: 'Send Feedback', coversPage: true },
        attachTo: document.body
      })
  },
  { name: 'MCP setup', mountCover: () => mount(McpSetupModal, { attachTo: document.body }) }
])('$name over the page', ({ mountCover }) => {
  it('closes on Escape before a wizard underneath sees it', async () => {
    const wizardEscape = vi.fn()
    document.addEventListener('keydown', wizardEscape)
    const page = document.createElement('div')
    page.setAttribute('inert', '')
    page.innerHTML = '<div role="dialog" aria-modal="true"><input /></div>'
    document.body.append(page)
    cleanups.push(() => {
      document.removeEventListener('keydown', wizardEscape)
      page.remove()
    })
    page.querySelector('input')?.focus()

    const cover = track(mountCover())
    await flushPromises()
    pressEscape()

    expect(cover.emitted('close')).toHaveLength(1)
    expect(wizardEscape).not.toHaveBeenCalled()
  })

  it('lets a confirmation opened above it handle Escape first', async () => {
    const cover = track(mountCover())
    await flushPromises()
    const alert = mountAlert('Restart to update?', false)
    await alert.setProps({ open: true })
    await flushPromises()

    pressEscape()
    expect(alert.emitted('cancel')).toHaveLength(1)
    expect(cover.emitted('close')).toBeUndefined()

    await alert.setProps({ open: false })
    await flushPromises()
    pressEscape()
    expect(cover.emitted('close')).toHaveLength(1)
  })

  it('leaves a confirmation that was already open focused and usable', async () => {
    const alert = mountAlert('Stop ComfyUI?', true)
    await flushPromises()
    const focused = document.activeElement
    expect(focused?.closest('[role="alertdialog"]')).not.toBeNull()

    const cover = track(mountCover())
    await flushPromises()

    expect(document.activeElement).toBe(focused)
    pressEscape()
    expect(alert.emitted('cancel')).toHaveLength(1)
    expect(cover.emitted('close')).toBeUndefined()
  })

  it('lets a rich confirm opened above it take focus and Escape', async () => {
    track(mount(ModalDialog, { attachTo: document.body }))
    const cover = track(mountCover())
    await flushPromises()
    const answer = useModal().confirm({
      title: 'Delete install?',
      message: 'This removes:',
      messageDetails: [{ label: 'Files', items: ['models/'] }]
    })
    await flushPromises()
    expect(document.activeElement?.closest('.modal-overlay')).not.toBeNull()

    pressEscape()
    await flushPromises()
    expect(document.querySelector('.modal-overlay')).toBeNull()
    expect(cover.emitted('close')).toBeUndefined()
    await expect(answer).resolves.toBe(false)

    pressEscape()
    expect(cover.emitted('close')).toHaveLength(1)
  })
})

it("reports What's New's dismissal once, when it unmounts", async () => {
  const events: TelemetryActionEventDetail[] = []
  const listener = (event: Event): void => {
    events.push((event as CustomEvent<TelemetryActionEventDetail>).detail)
  }
  window.addEventListener(TELEMETRY_ACTION_EVENT_NAME, listener)
  try {
    const announcement = mount(AnnouncementModal, { attachTo: document.body })
    await flushPromises()
    pressEscape()
    pressEscape()
    const dismissed = (): number =>
      events.filter((e) => e.actionName === 'comfy.desktop.announcement.dismissed').length
    expect(dismissed()).toBe(0)

    announcement.unmount()
    expect(dismissed()).toBe(1)
  } finally {
    window.removeEventListener(TELEMETRY_ACTION_EVENT_NAME, listener)
  }
})

it.each([
  {
    name: 'Feedback',
    mountCover: () =>
      mount(BaseModal, { props: { open: true, ariaLabel: 'Send Feedback', coversPage: true } })
  },
  { name: 'MCP setup', mountCover: () => mount(McpSetupModal) }
])('stacks $name below other dialogs', ({ mountCover }) => {
  track(mountCover())

  expect(document.querySelector('.base-modal-overlay--covers-page')).not.toBeNull()
})

describe('page surfaces under a title-bar modal', () => {
  it("puts a page's own modal under What's New, but not a dialog", async () => {
    const covered = ref(false)
    const modal = (label: string) =>
      h(BaseModal, { open: true, ariaLabel: label }, { default: () => h('input') })
    track(
      mount(() => [h(PageScope, null, { default: () => modal('Page') }), modal('Dialog')], {
        attachTo: document.body,
        global: { provide: { [PAGE_COVERED as symbol]: covered } }
      })
    )
    await flushPromises()
    const page = document.querySelector('[aria-label="Page"]')
    const dialog = document.querySelector('[aria-label="Dialog"]')

    covered.value = true
    await nextTick()
    expect(page?.hasAttribute('inert')).toBe(true)
    expect(getComputedStyle(page as Element).zIndex).not.toBe('60')
    expect(dialog?.hasAttribute('inert')).toBe(false)

    covered.value = false
    await nextTick()
    expect(page?.hasAttribute('inert')).toBe(false)
  })

  it.each([
    { name: 'brand takeover', component: BrandTakeoverLayout, root: '.brand-takeover-root' },
    { name: 'legacy modal', component: Modal, root: '.view-modal' }
  ])('makes a $name inert only while the page is covered', async ({ component, root }) => {
    const covered = ref(false)
    const Page = defineComponent({
      setup() {
        provide(PAGE_COVERED, covered)
        return () => h(component as Component, null, { default: () => h('input') })
      }
    })
    track(
      mount(Page, {
        attachTo: document.body,
        global: { stubs: { BrandBackground: { template: '<div><slot /></div>' } } }
      })
    )
    const surface = document.querySelector(root)

    expect(surface?.hasAttribute('inert')).toBe(false)
    covered.value = true
    await nextTick()
    expect(surface?.hasAttribute('inert')).toBe(true)
    covered.value = false
    await nextTick()
    expect(surface?.hasAttribute('inert')).toBe(false)
  })
})
