import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'

interface ModalSpec {
  id: string
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  theme: { bg: string; text: string }
}

const QUIT_SPEC: ModalSpec = {
  id: 'quit-1',
  title: 'Quit ComfyUI Desktop?',
  message: 'Running builds will stop.',
  confirmLabel: 'Quit',
  cancelLabel: 'Keep open',
  theme: { bg: '#202020', text: '#dddddd' }
}

let showModal: ((spec: ModalSpec) => void) | undefined
let host: HTMLElement

function installBridge(): void {
  showModal = undefined
  ;(window as unknown as { __comfySystemModal: unknown }).__comfySystemModal = {
    action: () => {},
    ready: () => {},
    notifyRendered: () => {},
    onModal: (cb: (spec: ModalSpec) => void) => {
      showModal = cb
      return () => {}
    }
  }
}

describe('system modal entry point', () => {
  beforeEach(() => {
    host = document.createElement('div')
    host.id = 'app'
    document.body.append(host)
    installBridge()
    vi.resetModules()
  })

  afterEach(() => {
    host.remove()
  })

  it('renders the title, message and both buttons of a modal pushed by main', async () => {
    await import('./main')
    await flushPromises()
    expect(showModal, 'the app subscribed to the bridge on mount').toBeTypeOf('function')

    showModal?.(QUIT_SPEC)
    await flushPromises()

    const text = document.body.textContent ?? ''
    expect(text).toContain(QUIT_SPEC.title)
    expect(text).toContain(QUIT_SPEC.message)
    const buttons = Array.from(document.querySelectorAll('button')).map((b) =>
      b.textContent?.trim()
    )
    expect(buttons).toContain(QUIT_SPEC.confirmLabel)
    expect(buttons).toContain(QUIT_SPEC.cancelLabel)
    expect(document.querySelector('[aria-label="Close"]')).not.toBeNull()
  })
})
