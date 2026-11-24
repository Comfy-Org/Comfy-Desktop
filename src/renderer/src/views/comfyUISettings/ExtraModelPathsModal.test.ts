import { afterEach, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

import '../../assets/main.css'
import ExtraModelPathsModal from './ExtraModelPathsModal.vue'
import { MODAL_TITLE_CLASS } from '../../lib/modalTitle'

const wrappers: VueWrapper[] = []

afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount()
})

it('titles the modal with the shared modal title class, 18px like every modal', async () => {
  wrappers.push(
    mount(ExtraModelPathsModal, {
      attachTo: document.body,
      props: { open: true, sections: [], yamlPath: '/Users/me/ComfyUI/extra_model_paths.yaml' }
    })
  )
  await flushPromises()

  const title = document.querySelector('.empm-title')
  expect([...(title?.classList ?? [])]).toEqual(
    expect.arrayContaining(MODAL_TITLE_CLASS.split(' '))
  )
  expect(MODAL_TITLE_CLASS).toBe('text-subtitle font-semibold')
  expect(getComputedStyle(title!).fontSize).toBe('18px')
  expect(getComputedStyle(title!).lineHeight).toBe('28px')
})
