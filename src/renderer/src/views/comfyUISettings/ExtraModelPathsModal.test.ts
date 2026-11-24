import { afterEach, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

import ExtraModelPathsModal from './ExtraModelPathsModal.vue'

const wrappers: VueWrapper[] = []

afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount()
})

it('titles the modal at the shared 16px heading size, like the other small modals', async () => {
  wrappers.push(
    mount(ExtraModelPathsModal, {
      attachTo: document.body,
      props: { open: true, sections: [], yamlPath: '/Users/me/ComfyUI/extra_model_paths.yaml' }
    })
  )
  await flushPromises()

  const title = document.querySelector('.empm-title')
  expect(title?.classList.contains('text-heading')).toBe(true)
  expect([...(title?.classList ?? [])].some((name) => /^text-\[\d+px\]/.test(name))).toBe(false)
})
