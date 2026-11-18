import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'

import ModelViewer from './ModelViewer.vue'

const TRIANGLE_STL = `solid triangle
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endfacet
endsolid triangle`

const wrappers: VueWrapper[] = []

async function mountViewer(
  name: string,
  load: () => Promise<Uint8Array | null>
): Promise<VueWrapper> {
  const wrapper = mount(ModelViewer, { attachTo: document.body, props: { name, load } })
  wrappers.push(wrapper)
  await vi.waitFor(() => expect(wrapper.find('[role="status"]').exists()).toBe(false), {
    timeout: 5000
  })
  return wrapper
}

afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount()
})

describe('ModelViewer', () => {
  it('draws a model it can read in a 3D view that the keyboard can reach', async () => {
    const load = vi.fn().mockResolvedValue(new TextEncoder().encode(TRIANGLE_STL))

    const wrapper = await mountViewer('triangle.stl', load)

    const view = wrapper.get('[data-testid="output-detail-model"]')
    expect(view.element.tagName).toBe('CANVAS')
    expect(view.attributes('tabindex')).toBe('0')
    expect(view.attributes('aria-label')).toContain('triangle.stl')
    expect(wrapper.find('[data-testid="output-detail-model-failed"]').exists()).toBe(false)
    expect(load).toHaveBeenCalledOnce()
  })

  it('says it cannot show the model when the file could not be read', async () => {
    const wrapper = await mountViewer('fox.glb', vi.fn().mockResolvedValue(null))

    expect(wrapper.get('[data-testid="output-detail-model-failed"]').text()).toBe(
      "Can't show this 3D model. Download it to open it in a 3D app."
    )
  })

  it('says it cannot show a 3D file type it has no reader for', async () => {
    const wrapper = await mountViewer(
      'scene.usdz',
      vi.fn().mockResolvedValue(new TextEncoder().encode(TRIANGLE_STL))
    )

    expect(wrapper.find('[data-testid="output-detail-model-failed"]').exists()).toBe(true)
  })
})
