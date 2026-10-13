import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, provide, ref, type Component } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

import AnnouncementModal from './AnnouncementModal.vue'
import BrandTakeoverLayout from './BrandTakeoverLayout.vue'
import Modal from './Modal.vue'
import BaseAlert from './ui/BaseAlert.vue'
import { PAGE_COVERED } from '../lib/pageCovered'

const wrappers: VueWrapper[] = []

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
})

describe("What's New over dialogs", () => {
  it('lets a confirmation opened above it handle Escape first', async () => {
    const announcement = track(mount(AnnouncementModal, { attachTo: document.body }))
    await flushPromises()
    const alert = mountAlert('Restart to update?', false)
    await alert.setProps({ open: true })
    await flushPromises()

    pressEscape()
    expect(alert.emitted('cancel')).toHaveLength(1)
    expect(announcement.emitted('close')).toBeUndefined()

    await alert.setProps({ open: false })
    await flushPromises()
    pressEscape()
    expect(announcement.emitted('close')).toHaveLength(1)
  })

  it('leaves a confirmation that was already open focused and usable', async () => {
    const alert = mountAlert('Stop ComfyUI?', true)
    await flushPromises()
    const focused = document.activeElement
    expect(focused?.closest('[role="alertdialog"]')).not.toBeNull()

    const announcement = track(mount(AnnouncementModal, { attachTo: document.body }))
    await flushPromises()

    expect(document.activeElement).toBe(focused)
    expect(focused?.closest('[inert]')).toBeNull()
    pressEscape()
    expect(alert.emitted('cancel')).toHaveLength(1)
    expect(announcement.emitted('close')).toBeUndefined()
  })
})

describe('page surfaces under a title-bar modal', () => {
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
