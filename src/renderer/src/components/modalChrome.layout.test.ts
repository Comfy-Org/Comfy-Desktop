import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import '../assets/main.css'
import BaseModal from './ui/BaseModal.vue'
import BaseAlert from './ui/BaseAlert.vue'
import BasePrompt from './ui/BasePrompt.vue'
import ModalDialog from './ModalDialog.vue'
import ModalShell from './ModalShell.vue'
import SetupModal from './SetupModal.vue'
import TrackModal from '../views/TrackModal.vue'
import InstallWizardModal from '../views/InstallWizardModal.vue'
import { useModal } from '../composables/useModal'

vi.mock('../lib/telemetry', () => ({
  emitTelemetryAction: vi.fn(),
  emitTelemetryEvent: vi.fn()
}))

const MODAL_PADDING = 24
const TITLE_GAP = 16

const mounted: VueWrapper[] = []

beforeEach(() => {
  document.documentElement.dataset.theme = 'dark'
  window.api = new Proxy(
    {},
    {
      get: (_, method) =>
        String(method).startsWith('on')
          ? vi.fn(() => vi.fn())
          : vi.fn().mockResolvedValue(undefined)
    }
  ) as unknown as typeof window.api
  setActivePinia(createPinia())
})

afterEach(() => {
  useModal().dismiss()
  mounted.splice(0).forEach((w) => w.unmount())
  document.body.innerHTML = ''
})

async function settle(): Promise<void> {
  await flushPromises()
  await Promise.all(document.getAnimations().map((animation) => animation.finished))
}

async function open(mountIt: () => VueWrapper): Promise<VueWrapper> {
  const wrapper = mountIt()
  mounted.push(wrapper)
  await settle()
  return wrapper
}

async function closeAll(): Promise<void> {
  useModal().dismiss()
  mounted.splice(0).forEach((w) => w.unmount())
  await settle()
}

const MODAL_DIALOG_VARIANTS: Record<string, () => void> = {
  prompt: () => void useModal().prompt({ title: 'Name snapshot', message: 'Give it a name.' }),
  confirm: () =>
    void useModal().confirm({
      title: 'Confirm',
      message: 'Sure?',
      messageDetails: [{ label: 'Details', items: ['One'] }],
      checkboxes: [{ id: 'keep', label: 'Keep my models', checked: true }]
    }),
  confirmWithOptions: () =>
    void useModal().confirmWithOptions({
      title: 'Options',
      message: 'Pick',
      options: [{ id: 'a', label: 'A' }]
    }),
  select: () => void useModal().select({ title: 'Select', items: [{ value: 'a', label: 'A' }] })
}

async function eachModalDialogVariant(check: (variant: string) => void): Promise<void> {
  await open(() => mount(ModalDialog, { attachTo: document.body }))
  for (const [variant, show] of Object.entries(MODAL_DIALOG_VARIANTS)) {
    show()
    await settle()
    check(variant)
    useModal().dismiss()
    await settle()
  }
}

function el(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector)
  if (!found) throw new Error(`missing ${selector}`)
  return found
}

function px(node: HTMLElement, property: string): number {
  return parseFloat(getComputedStyle(node).getPropertyValue(property))
}

function contentBox(node: HTMLElement): {
  left: number
  right: number
  top: number
  bottom: number
} {
  const rect = node.getBoundingClientRect()
  return {
    left: rect.left + px(node, 'border-left-width') + px(node, 'padding-left'),
    right: rect.right - px(node, 'border-right-width') - px(node, 'padding-right'),
    top: rect.top + px(node, 'border-top-width') + px(node, 'padding-top'),
    bottom: rect.bottom - px(node, 'border-bottom-width') - px(node, 'padding-bottom')
  }
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
  const reach = focusRingReach(input)
  expect(reach).toBeGreaterThan(0)
  const ring = input.getBoundingClientRect()
  const body = el(bodySelector).getBoundingClientRect()
  expect(ring.left - reach).toBeGreaterThanOrEqual(body.left)
  expect(ring.right + reach).toBeLessThanOrEqual(body.right)
  expect(ring.top - reach).toBeGreaterThanOrEqual(body.top)
  expect(ring.bottom + reach).toBeLessThanOrEqual(body.bottom)
}

function expectSpanning(selectors: string[], contentSelector: string): void {
  const content = contentBox(el(contentSelector))
  for (const selector of selectors) {
    for (const field of document.querySelectorAll<HTMLElement>(selector)) {
      const rect = field.getBoundingClientRect()
      expect(Math.abs(rect.left - content.left), `${selector} left`).toBeLessThanOrEqual(1)
      expect(Math.abs(rect.right - content.right), `${selector} right`).toBeLessThanOrEqual(1)
    }
  }
}

function expectFooterInsets(
  panelSelector: string,
  bodySelector: string,
  footerSelector: string
): void {
  const panel = el(panelSelector).getBoundingClientRect()
  const footer = el(footerSelector)
  const buttons = footer.querySelectorAll<HTMLElement>('button')
  const last = buttons[buttons.length - 1]
  if (!last) throw new Error(`no button in ${footerSelector}`)
  const button = last.getBoundingClientRect()
  const line = footer.getBoundingClientRect().top + px(footer, 'border-top-width')
  const gaps = {
    top: button.top - line,
    bottom: panel.bottom - button.bottom,
    right: panel.right - button.right,
    side: contentBox(el(bodySelector)).left - panel.left
  }
  for (const [edge, gap] of Object.entries(gaps)) {
    expect(
      Math.abs(gap - MODAL_PADDING),
      `${footerSelector} ${edge} gap ${gap}`
    ).toBeLessThanOrEqual(1)
  }
}

function expectTitleGap(titleSelector: string, firstContent: HTMLElement): void {
  const gap = firstContent.getBoundingClientRect().top - contentBox(el(titleSelector)).bottom
  expect(Math.abs(gap - TITLE_GAP), `${titleSelector} to body ${gap}`).toBeLessThanOrEqual(1)
}

const swatch = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!

function paintedLuminance(node: Element, card: Element): number {
  const layers: Element[] = []
  for (let n: Element | null = node; n && n !== card; n = n.parentElement) layers.unshift(n)
  swatch.globalCompositeOperation = 'copy'
  swatch.fillStyle = '#000'
  swatch.fillRect(0, 0, 1, 1)
  swatch.globalCompositeOperation = 'source-over'
  for (const layer of [card, ...layers]) {
    swatch.fillStyle = getComputedStyle(layer).backgroundColor
    swatch.fillRect(0, 0, 1, 1)
  }
  const [r, g, b] = [...swatch.getImageData(0, 0, 1, 1).data].map((v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function darkerThanCard(cardSelector: string): string[] {
  const card = el(cardSelector)
  const floor = paintedLuminance(card, card)
  const darker: string[] = []
  for (const node of card.querySelectorAll<HTMLElement>('*')) {
    const style = getComputedStyle(node)
    if (style.backgroundColor === 'rgba(0, 0, 0, 0)' || style.maskImage !== 'none') continue
    const rect = node.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    if (paintedLuminance(node, card) < floor - 0.0005) {
      darker.push(`${cardSelector} .${node.classList[0]} ${style.backgroundColor}`)
    }
  }
  return darker
}

function lineWidths(node: HTMLElement): { top: string; bottom: string } {
  const style = getComputedStyle(node)
  return { top: style.borderTopWidth, bottom: style.borderBottomWidth }
}

describe('modal chrome', () => {
  it('keeps only the line above the footer: no divider under the header', async () => {
    await open(() =>
      mount(BaseModal, {
        attachTo: document.body,
        props: { open: true, ariaLabel: 'M' },
        slots: { header: 'Title', default: 'Body', footer: 'Footer' }
      })
    )
    expect(lineWidths(el('.base-modal-header')).bottom).toBe('0px')
    expect(lineWidths(el('.base-modal-footer')).top).toBe('1px')
    await closeAll()

    await open(() =>
      mount(BaseAlert, {
        attachTo: document.body,
        props: { open: true, title: 'Alert', message: 'Something happened.' }
      })
    )
    expect(lineWidths(el('.base-alert-header')).bottom).toBe('0px')
    await closeAll()

    await open(() =>
      mount(ModalShell, {
        attachTo: document.body,
        props: { title: 'View' },
        slots: { default: 'Body' }
      })
    )
    expect(lineWidths(el('.view-modal-header')).bottom).toBe('0px')
    await closeAll()

    await eachModalDialogVariant(() => {
      expect(lineWidths(el('.dialog-title')).bottom).toBe('0px')
      expect(lineWidths(el('.dialog-actions')).top).toBe('1px')
      for (const options of document.querySelectorAll<HTMLElement>('.dialog-options')) {
        expect(lineWidths(options)).toEqual({ top: '0px', bottom: '0px' })
      }
    })
  })

  it('leaves the same gap between the title and the body in every modal', async () => {
    await open(() =>
      mount(BaseModal, {
        attachTo: document.body,
        props: { open: true, ariaLabel: 'M' },
        slots: {
          header: () => h('h2', { class: 'm-0' }, 'Title'),
          default: () => h('p', { class: 'm-0' }, 'Body')
        }
      })
    )
    expectTitleGap('.base-modal-header', el('.base-modal-body > p'))
    await closeAll()

    await open(() =>
      mount(BaseAlert, {
        attachTo: document.body,
        props: { open: true, title: 'Alert', message: 'Something happened.' }
      })
    )
    expectTitleGap('.base-alert-header', el('.base-alert-message'))
    await closeAll()

    await open(() =>
      mount(ModalShell, {
        attachTo: document.body,
        props: { title: 'View' },
        slots: { default: () => h('p', { class: 'm-0' }, 'Body') }
      })
    )
    expectTitleGap('.view-modal-header', el('.view-modal-body > p'))
    await closeAll()

    const track = await open(() => mount(TrackModal, { attachTo: document.body }))
    ;(track.vm as unknown as { open: () => void }).open()
    await settle()
    expectTitleGap('.setup-modal-lead', el('.setup-modal-lead').nextElementSibling as HTMLElement)
    await closeAll()

    await eachModalDialogVariant((variant) => {
      const first =
        variant === 'confirmWithOptions' || variant === 'select'
          ? el('.dialog-title').nextElementSibling
          : el('.dialog-body').firstElementChild
      expectTitleGap('.dialog-title', first as HTMLElement)
    })
  })

  it('puts the footer button 24px from the footer line, the bottom and the right, like the body sides', async () => {
    await open(() =>
      mount(BaseModal, {
        attachTo: document.body,
        props: { open: true, ariaLabel: 'M' },
        slots: { header: 'Title', default: 'Body', footer: '<button>OK</button>' }
      })
    )
    expectFooterInsets('.base-modal-panel', '.base-modal-body', '.base-modal-footer')
    await closeAll()

    await open(() =>
      mount(BaseAlert, {
        attachTo: document.body,
        props: { open: true, title: 'Alert', message: 'Something happened.' }
      })
    )
    expectFooterInsets('.base-alert-panel', '.base-alert-panel', '.base-alert-footer')
    await closeAll()

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
    expectFooterInsets('.setup-modal-panel', '.setup-modal-body', '.setup-modal-foot')
    await closeAll()

    await eachModalDialogVariant(() =>
      expectFooterInsets('.dialog-box', '.dialog-box', '.dialog-actions')
    )
  })

  it('lines fields and text boxes up with the body edges and the footer button', async () => {
    await open(() => mount(ModalDialog, { attachTo: document.body }))
    MODAL_DIALOG_VARIANTS.prompt!()
    await settle()
    expectSpanning(['.dialog-prompt-card', '.dialog-input'], '.dialog-box')
    const card = el('.dialog-prompt-card')
    const input = el('.dialog-input')
    expect(getComputedStyle(card).borderRadius).toBe(getComputedStyle(input).borderRadius)
    expect(card.getBoundingClientRect().height).toBe(input.getBoundingClientRect().height)
    expect(Math.abs(contentBox(card).left - contentBox(input).left)).toBeLessThanOrEqual(0.5)
    await closeAll()

    await open(() =>
      mount(BasePrompt, {
        attachTo: document.body,
        props: { open: true, title: 'Name', message: 'Give it a name.' }
      })
    )
    expectSpanning(['.base-prompt-input'], '.base-modal-body')
    await closeAll()

    const track = await open(() => mount(TrackModal, { attachTo: document.body }))
    ;(track.vm as unknown as { open: () => void }).open()
    await settle()
    expectSpanning(['.setup-form-row'], '.setup-modal-body')
    const body = contentBox(el('.setup-modal-body'))
    for (const control of document.querySelectorAll<HTMLElement>('.setup-form-row__control')) {
      expect(Math.abs(control.getBoundingClientRect().right - body.right)).toBeLessThanOrEqual(1)
    }
    const buttons = el('.setup-modal-foot').querySelectorAll<HTMLElement>('button')
    const install = buttons[buttons.length - 1]!.getBoundingClientRect()
    expect(Math.abs(install.right - body.right)).toBeLessThanOrEqual(1)
  })

  it('shows the whole focus ring of the Name snapshot input', async () => {
    await open(() => mount(ModalDialog, { attachTo: document.body }))
    MODAL_DIALOG_VARIANTS.prompt!()
    await settle()
    await expectFocusRingInside('.dialog-input', '.dialog-body')
  })

  it('shows the whole focus ring of the BasePrompt input', async () => {
    await open(() =>
      mount(BasePrompt, {
        attachTo: document.body,
        props: { open: true, title: 'Name', message: 'Give it a name.' }
      })
    )
    await expectFocusRingInside('.base-prompt-input', '.base-modal-body')
  })

  it('keeps every box inside a modal a step lighter than the card, never darker', async () => {
    const darker: string[] = []

    await open(() =>
      mount(BaseModal, {
        attachTo: document.body,
        props: { open: true, ariaLabel: 'M' },
        slots: { header: 'Title', default: 'Body', footer: '<button>OK</button>' }
      })
    )
    darker.push(...darkerThanCard('.base-modal-panel'))
    await closeAll()

    await open(() =>
      mount(BaseAlert, {
        attachTo: document.body,
        props: { open: true, title: 'Alert', message: 'Something happened.' }
      })
    )
    darker.push(...darkerThanCard('.base-alert-panel'))
    await closeAll()

    await open(() =>
      mount(BasePrompt, {
        attachTo: document.body,
        props: { open: true, title: 'Name', message: 'Give it a name.' }
      })
    )
    darker.push(...darkerThanCard('.base-modal-panel'))
    await closeAll()

    await open(() =>
      mount(ModalShell, {
        attachTo: document.body,
        props: { title: 'View' },
        slots: { default: 'Body' }
      })
    )
    darker.push(...darkerThanCard('[data-modal-content]'))
    await closeAll()

    await eachModalDialogVariant(() => darker.push(...darkerThanCard('.dialog-box')))
    await closeAll()

    const track = await open(() => mount(TrackModal, { attachTo: document.body }))
    ;(track.vm as unknown as { open: () => void }).open()
    await settle()
    darker.push(...darkerThanCard('.setup-modal-panel'))
    await closeAll()

    Object.assign(window, {
      api: new Proxy(
        {
          getSources: vi.fn().mockResolvedValue([]),
          getInstallations: vi.fn().mockResolvedValue([]),
          getDiskSpace: vi.fn().mockResolvedValue({ free: 1e11, total: 1e12 }),
          validateInstallPath: vi.fn().mockResolvedValue([]),
          getFieldOptions: vi.fn().mockResolvedValue([]),
          comfybuilder: {
            getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
            onAuthChanged: vi.fn(() => vi.fn()),
            listWorkspaces: vi.fn().mockResolvedValue([]),
            listBuilds: vi.fn().mockResolvedValue([])
          }
        } as Record<string, unknown>,
        {
          get: (stubs, method) =>
            String(method) in stubs
              ? stubs[String(method)]
              : String(method).startsWith('on')
                ? vi.fn(() => vi.fn())
                : vi.fn().mockResolvedValue(undefined)
        }
      )
    })
    const wizard = await open(() => mount(InstallWizardModal, { attachTo: document.body }))
    await (wizard.vm as unknown as { open: (opts: object) => Promise<void> }).open({})
    await settle()
    darker.push(...darkerThanCard('.setup-modal-panel'))

    expect(darker).toEqual([])
  })
})
