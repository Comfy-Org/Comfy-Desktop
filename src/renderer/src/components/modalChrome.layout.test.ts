import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import '../assets/main.css'
import BaseModal from './ui/BaseModal.vue'
import BaseAlert from './ui/BaseAlert.vue'
import BasePrompt from './ui/BasePrompt.vue'
import ModalDialog from './ModalDialog.vue'
import ModalShell from './ModalShell.vue'
import SetupModal from './SetupModal.vue'
import DownloadsFullView from '../comfyTitlePopup/DownloadsFullView.vue'
import { useModal } from '../composables/useModal'

vi.mock('../lib/telemetry', () => ({
  emitTelemetryAction: vi.fn(),
  emitTelemetryEvent: vi.fn()
}))

const mounted: VueWrapper[] = []

function setup(): void {
  document.documentElement.dataset.theme = 'dark'
  setActivePinia(createPinia())
}

async function open(mountIt: () => VueWrapper): Promise<void> {
  mounted.push(mountIt())
  await flushPromises()
  await Promise.all(document.getAnimations().map((animation) => animation.finished))
}

function el(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector)
  if (!found) throw new Error(`missing ${selector}`)
  return found
}

function lineWidths(node: HTMLElement): { top: string; bottom: string } {
  const style = getComputedStyle(node)
  return { top: style.borderTopWidth, bottom: style.borderBottomWidth }
}

function focusRingReach(node: HTMLElement): number {
  const spreads = [
    ...getComputedStyle(node).boxShadow.matchAll(
      /(-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px/g
    )
  ]
    .filter((m) => !m.input!.slice(0, m.index).trimEnd().endsWith('inset'))
    .map((m) => Number(m[4]))
  return Math.max(0, ...spreads)
}

async function expectFocusRingInside(inputSelector: string, bodySelector: string): Promise<void> {
  const input = el(inputSelector)
  input.focus()
  await flushPromises()
  expect(document.activeElement).toBe(input)
  const spread = focusRingReach(input)
  expect(spread).toBeGreaterThan(0)
  const ring = input.getBoundingClientRect()
  const body = el(bodySelector).getBoundingClientRect()
  expect(ring.left - spread).toBeGreaterThanOrEqual(body.left)
  expect(ring.right + spread).toBeLessThanOrEqual(body.right)
  expect(ring.top - spread).toBeGreaterThanOrEqual(body.top)
  expect(ring.bottom + spread).toBeLessThanOrEqual(body.bottom)
}

function contentLeft(node: HTMLElement): number {
  const style = getComputedStyle(node)
  return (
    node.getBoundingClientRect().left +
    parseFloat(style.borderLeftWidth) +
    parseFloat(style.paddingLeft)
  )
}

function expectEvenFooterInsets(
  panelSelector: string,
  bodySelector: string,
  footerSelector: string
): void {
  const panel = el(panelSelector).getBoundingClientRect()
  const buttons = el(footerSelector).querySelectorAll<HTMLElement>('button')
  const last = buttons[buttons.length - 1]
  if (!last) throw new Error(`no button in ${footerSelector}`)
  const button = last.getBoundingClientRect()
  const right = panel.right - button.right
  const bottom = panel.bottom - button.bottom
  const side = contentLeft(el(bodySelector)) - panel.left
  expect(
    Math.abs(right - bottom),
    `${footerSelector} right ${right} vs bottom ${bottom}`
  ).toBeLessThanOrEqual(1)
  expect(
    Math.abs(right - side),
    `${footerSelector} right ${right} vs body side ${side}`
  ).toBeLessThanOrEqual(1)
}

afterEach(() => {
  useModal().dismiss()
  mounted.splice(0).forEach((w) => w.unmount())
  document.body.innerHTML = ''
})

describe('modal chrome', () => {
  it('keeps only the line above the footer: no divider under the header', async () => {
    setup()
    await open(() =>
      mount(BaseModal, {
        attachTo: document.body,
        props: { open: true, ariaLabel: 'M' },
        slots: { header: 'Title', default: 'Body', footer: 'Footer' }
      })
    )
    expect(lineWidths(el('.base-modal-header')).bottom).toBe('0px')
    expect(lineWidths(el('.base-modal-footer')).top).toBe('1px')
  })

  it('has no header divider in the alert box', async () => {
    setup()
    await open(() =>
      mount(BaseAlert, {
        attachTo: document.body,
        props: { open: true, title: 'Alert', message: 'Something happened.' }
      })
    )
    expect(lineWidths(el('.base-alert-header')).bottom).toBe('0px')
  })

  it('has no header divider in any ModalDialog variant and keeps the footer line', async () => {
    setup()
    await open(() => mount(ModalDialog, { attachTo: document.body }))
    const variants: Array<() => void> = [
      () => void useModal().prompt({ title: 'Name snapshot', message: 'Give it a name.' }),
      () =>
        void useModal().confirm({
          title: 'Confirm',
          message: 'Sure?',
          messageDetails: [{ label: 'Details', items: ['One'] }]
        }),
      () =>
        void useModal().confirmWithOptions({
          title: 'Options',
          message: 'Pick',
          options: [{ id: 'a', label: 'A' }]
        }),
      () => void useModal().select({ title: 'Select', items: [{ value: 'a', label: 'A' }] })
    ]
    for (const show of variants) {
      show()
      await flushPromises()
      expect(lineWidths(el('.dialog-title')).bottom).toBe('0px')
      expect(lineWidths(el('.dialog-actions')).top).toBe('1px')
      useModal().dismiss()
      await flushPromises()
    }
  })

  it('has no header divider in the full view modal shell', async () => {
    setup()
    await open(() =>
      mount(ModalShell, {
        attachTo: document.body,
        props: { title: 'View' },
        slots: { default: 'Body' }
      })
    )
    expect(lineWidths(el('.view-modal-header')).bottom).toBe('0px')
  })

  it('shows the whole focus ring of the Name snapshot input', async () => {
    setup()
    await open(() => mount(ModalDialog, { attachTo: document.body }))
    void useModal().prompt({ title: 'Name snapshot', message: 'Give this snapshot a name.' })
    await flushPromises()
    await expectFocusRingInside('.dialog-input', '.dialog-body')
  })

  it('shows the whole focus ring of the BasePrompt input', async () => {
    setup()
    await open(() =>
      mount(BasePrompt, {
        attachTo: document.body,
        props: { open: true, title: 'Name', message: 'Give it a name.' }
      })
    )
    await expectFocusRingInside('.base-prompt-input', '.base-modal-body')
  })

  it('insets the footer button equally from the right and bottom edges, matching the body side padding', async () => {
    setup()
    await open(() =>
      mount(BaseModal, {
        attachTo: document.body,
        props: { open: true, ariaLabel: 'M' },
        slots: { header: 'Title', default: 'Body', footer: '<button>OK</button>' }
      })
    )
    expectEvenFooterInsets('.base-modal-panel', '.base-modal-body', '.base-modal-footer')
    mounted.splice(0).forEach((w) => w.unmount())

    await open(() =>
      mount(BaseAlert, {
        attachTo: document.body,
        props: { open: true, title: 'Alert', message: 'Something happened.' }
      })
    )
    expectEvenFooterInsets('.base-alert-panel', '.base-alert-panel', '.base-alert-footer')
    mounted.splice(0).forEach((w) => w.unmount())

    await open(() =>
      mount(SetupModal, {
        attachTo: document.body,
        props: { dialogLabel: 'Set up', title: 'New build' },
        slots: {
          default: 'Body',
          footer: '<span class="flex-1" /><button style="height:36px">Install</button>'
        }
      })
    )
    expectEvenFooterInsets('.setup-modal-panel', '.setup-modal-body', '.setup-modal-foot')
    mounted.splice(0).forEach((w) => w.unmount())

    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;inset:0;display:flex'
    document.body.appendChild(host)
    await open(() =>
      mount(DownloadsFullView, {
        attachTo: host,
        props: {
          state: {
            active: [],
            recent: [
              {
                id: 'done',
                url: 'https://example.com/done',
                filename: 'done.bin',
                progress: 1,
                status: 'completed'
              }
            ]
          }
        }
      })
    )
    expectEvenFooterInsets('.dlm-panel', '.dlm-modal-body', '.dlm-modal-footer')
    mounted.splice(0).forEach((w) => w.unmount())

    await open(() => mount(ModalDialog, { attachTo: document.body }))
    const variants: Array<() => void> = [
      () => void useModal().prompt({ title: 'Name snapshot', message: 'Give it a name.' }),
      () =>
        void useModal().confirm({
          title: 'Confirm',
          message: 'Sure?',
          messageDetails: [{ label: 'Details', items: ['One'] }]
        }),
      () =>
        void useModal().confirmWithOptions({
          title: 'Options',
          message: 'Pick',
          options: [{ id: 'a', label: 'A' }]
        }),
      () => void useModal().select({ title: 'Select', items: [{ value: 'a', label: 'A' }] })
    ]
    for (const show of variants) {
      show()
      await flushPromises()
      await Promise.all(document.getAnimations().map((animation) => animation.finished))
      expectEvenFooterInsets('.dialog-box', '.dialog-box', '.dialog-actions')
      useModal().dismiss()
      await flushPromises()
    }
  })
})
