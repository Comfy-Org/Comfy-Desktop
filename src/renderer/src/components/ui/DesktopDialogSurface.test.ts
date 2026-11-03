import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import DesktopDialogSurface from './DesktopDialogSurface.vue'

const wrappers: VueWrapper[] = []

async function settleDialog(): Promise<void> {
  await flushPromises()
  await vi.runAllTimersAsync()
  await flushPromises()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(async () => {
  while (wrappers.length) wrappers.pop()?.unmount()
  await settleDialog()
  document.body.innerHTML = ''
  document.body.style.overflow = ''
  vi.useRealTimers()
})

function mountHarness(options: { dismissOnOutside?: boolean } = {}) {
  const outerOpen = ref(false)
  const innerOpen = ref(false)
  const wrapper = mount(
    defineComponent({
      setup: () => () => [
        h('button', { id: 'open-dialog', onClick: () => (outerOpen.value = true) }, 'Open'),
        h('button', { id: 'outside-button' }, 'Outside'),
        h(
          DesktopDialogSurface,
          {
            open: outerOpen.value,
            ariaLabel: 'Outer dialog',
            dismissOnOutside: options.dismissOnOutside,
            contentClass: 'outer-dialog',
            onClose: () => (outerOpen.value = false)
          },
          {
            default: () => [
              h('button', { id: 'open-inner', onClick: () => (innerOpen.value = true) }, 'Inner'),
              h('button', { id: 'close-outer', onClick: () => (outerOpen.value = false) }, 'Close'),
              h(
                DesktopDialogSurface,
                {
                  open: innerOpen.value,
                  ariaLabel: 'Inner dialog',
                  contentClass: 'inner-dialog',
                  onClose: () => (innerOpen.value = false)
                },
                { default: () => h('button', { id: 'inner-action' }, 'Inner action') }
              )
            ]
          }
        )
      ]
    }),
    { attachTo: document.body }
  )
  wrappers.push(wrapper)
  return { wrapper, outerOpen, innerOpen }
}

async function openOuter(): Promise<ReturnType<typeof mountHarness>> {
  const harness = mountHarness()
  const trigger = document.getElementById('open-dialog')!
  trigger.focus()
  trigger.click()
  await settleDialog()
  return harness
}

describe('DesktopDialogSurface', () => {
  it('keeps focus in the shared modal and returns it to its opener on close', async () => {
    await openOuter()
    const content = document.querySelector<HTMLElement>('.outer-dialog')!
    expect(document.activeElement).toBe(content)
    document.getElementById('outside-button')!.focus()
    expect(document.activeElement).toBe(content)

    document.getElementById('close-outer')!.click()
    await settleDialog()
    expect(document.activeElement).toBe(document.getElementById('open-dialog'))
  })

  it('closes only the focused nested dialog and keeps Escape away from the host window', async () => {
    const { outerOpen, innerOpen } = await openOuter()
    document.getElementById('open-inner')!.click()
    await settleDialog()
    const hostEscape = vi.fn()
    window.addEventListener('keydown', hostEscape)
    try {
      document
        .querySelector('.inner-dialog')!
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        )
      await settleDialog()
      expect(innerOpen.value).toBe(false)
      expect(outerOpen.value).toBe(true)
      expect(hostEscape).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', hostEscape)
    }
  })

  it('keeps the body locked until the last nested dialog closes', async () => {
    document.body.style.overflow = 'auto'
    const { outerOpen, innerOpen } = await openOuter()
    document.getElementById('open-inner')!.click()
    await settleDialog()
    expect(document.body.style.overflow).toBe('hidden')

    innerOpen.value = false
    await settleDialog()
    expect(document.body.style.overflow).toBe('hidden')
    outerOpen.value = false
    await settleDialog()
    expect(document.body.style.overflow).toBe('auto')
  })

  it('dismisses from a backdrop press, but not from a drag that started in the dialog', async () => {
    const { outerOpen } = await openOuter()
    const content = document.querySelector<HTMLElement>('.outer-dialog')!
    const backdrop = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!
    content.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    backdrop.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }))
    await settleDialog()
    expect(outerOpen.value).toBe(true)

    backdrop.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    await settleDialog()
    expect(outerOpen.value).toBe(false)
  })

  it('focuses the marked field even when a normal button comes first', async () => {
    const wrapper = mount(DesktopDialogSurface, {
      props: { open: true, ariaLabel: 'Track installation' },
      slots: {
        default:
          '<button id="browse-first">Browse</button><input id="focused-name" autofocus value="My installation" />'
      },
      attachTo: document.body
    })
    wrappers.push(wrapper)
    await settleDialog()
    expect(document.activeElement).toBe(document.getElementById('focused-name'))
  })

  it('falls back to the dialog when its marked field cannot receive focus', async () => {
    const wrapper = mount(DesktopDialogSurface, {
      props: { open: true, ariaLabel: 'Unavailable field', contentClass: 'focus-fallback' },
      slots: {
        default: '<button>Delete</button><input autofocus disabled aria-label="Install name" />'
      },
      attachTo: document.body
    })
    wrappers.push(wrapper)
    await settleDialog()
    expect(document.activeElement).toBe(document.querySelector('.focus-fallback'))
  })

  it('uses a supplied visible title without adding an empty accessible heading', async () => {
    const wrapper = mount(DesktopDialogSurface, {
      props: { open: true, ariaLabelledby: 'visible-dialog-title' },
      slots: { default: '<h2 id="visible-dialog-title">Save snapshot</h2><button>Save</button>' },
      attachTo: document.body
    })
    wrappers.push(wrapper)
    await settleDialog()
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.getAttribute('aria-labelledby')).toBe('visible-dialog-title')
    expect(dialog.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')).toHaveLength(1)
    expect(dialog.querySelector('h2')?.textContent).toBe('Save snapshot')
  })

  it('preserves a non-dismissible dialog when Escape or its backdrop is pressed', async () => {
    const open = ref(true)
    const onClose = vi.fn()
    const wrapper = mount(DesktopDialogSurface, {
      props: {
        open: open.value,
        ariaLabel: 'Required action',
        dismissOnEscape: false,
        dismissOnOutside: false,
        onClose
      },
      slots: { default: '<button>Action</button>' },
      attachTo: document.body
    })
    wrappers.push(wrapper)
    await settleDialog()
    document
      .querySelector('[role="dialog"]')!
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      )
    document
      .querySelector('[data-slot="dialog-overlay"]')!
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    await settleDialog()
    expect(onClose).not.toHaveBeenCalled()
  })
})
