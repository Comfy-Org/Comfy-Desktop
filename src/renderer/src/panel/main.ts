import { mountPanel } from './mountPanel'
import { initializeRendererBootstrap } from '../lib/rendererBootstrap'
import { registerE2ERendererHooks } from './e2eRendererHooks'

if (new URLSearchParams(window.location.search).get('e2e') === '1') {
  registerE2ERendererHooks()
}

mountPanel()

queueMicrotask(() => initializeRendererBootstrap('panel'))
