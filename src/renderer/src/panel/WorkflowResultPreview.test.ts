import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import '../assets/main.css'
import WorkflowResultPreview from './WorkflowResultPreview.vue'

function picture(fill: string, width: number, height: number): string {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${fill}"/></svg>`
  )}`
}

const CARD = picture('red', 40, 40)
const EXAMPLE = { url: picture('blue', 192, 108), kind: 'image' as const, width: 192, height: 108 }

function mountPreview(media = EXAMPLE) {
  const host = document.createElement('div')
  host.style.cssText = 'width: 400px; height: 300px; display: flex'
  document.body.append(host)
  return mount(WorkflowResultPreview, {
    attachTo: host,
    props: { media, zoom: 'fit' as const, poster: CARD }
  })
}

describe('the result of a catalog workflow', () => {
  it('shows the card picture at once, in the result’s own frame, until the result has loaded', async () => {
    const preview = mountPreview()

    const placeholder = preview.get('[data-testid="workflow-result-placeholder"]')
    expect(placeholder.attributes('src')).toBe(CARD)
    const frame = placeholder.element.parentElement!.getBoundingClientRect()
    expect(Math.round((frame.width / frame.height) * 100)).toBe(Math.round((192 / 108) * 100))

    await vi.waitFor(() =>
      expect(preview.find('[data-testid="workflow-result-placeholder"]').exists()).toBe(false)
    )
    expect(preview.get('[data-testid="workflow-result-media"]').classes()).toContain('opacity-100')
    preview.unmount()
  })

  it('keeps the card picture when the result cannot load', async () => {
    const preview = mountPreview({ ...EXAMPLE, url: 'data:image/png;base64,broken' })

    await vi.waitFor(() =>
      expect(preview.find('[data-testid="workflow-result-media"]').exists()).toBe(false)
    )
    await flushPromises()
    expect(preview.get('[data-testid="workflow-result-placeholder"]').attributes('src')).toBe(CARD)
    preview.unmount()
  })

  it('fits a tall card picture inside the frame when the result cannot load', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'width: 400px; height: 300px; display: flex'
    document.body.append(host)
    const preview = mount(WorkflowResultPreview, {
      attachTo: host,
      props: {
        media: { ...EXAMPLE, url: 'data:image/png;base64,broken' },
        zoom: 'fit' as const,
        poster: picture('green', 400, 800)
      }
    })

    await vi.waitFor(() =>
      expect(preview.find('[data-testid="workflow-result-media"]').exists()).toBe(false)
    )
    await vi.waitFor(() =>
      expect(
        preview.get('[data-testid="workflow-result-placeholder"]').element.getBoundingClientRect()
          .height
      ).toBeLessThanOrEqual(300)
    )
    preview.unmount()
  })
})
