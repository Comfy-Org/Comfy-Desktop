import { describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { App } from 'vue'
import type {
  ComfySystemModalBridge,
  SystemModalSpec
} from '../../../preload/comfySystemModalPreload'

const QUIT_SPEC: SystemModalSpec = {
  id: 'quit-1',
  title: 'Quit ComfyUI Desktop?',
  message: 'Running builds will stop.',
  confirmLabel: 'Quit',
  cancelLabel: 'Keep open',
  theme: { bg: '#202020', text: '#dddddd' }
}

type BridgeWindow = { __comfySystemModal?: ComfySystemModalBridge }

describe('system modal entry point', () => {
  it('renders the title, message and both buttons of a modal pushed by main', async () => {
    const host = document.createElement('div')
    host.id = 'app'
    document.body.append(host)
    let showModal: ((spec: SystemModalSpec) => void) | undefined
    ;(window as BridgeWindow).__comfySystemModal = {
      action: () => {},
      ready: () => {},
      notifyRendered: () => {},
      onModal: (cb) => {
        showModal = cb
        return () => {}
      }
    }

    try {
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
    } finally {
      ;(host as HTMLElement & { __vue_app__?: App }).__vue_app__?.unmount()
      host.remove()
      delete (window as BridgeWindow).__comfySystemModal
    }
  })
})
