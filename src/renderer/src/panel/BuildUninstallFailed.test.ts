import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import '../assets/main.css'
import BuildUninstallFailed from './BuildUninstallFailed.vue'

let wrapper: VueWrapper | null = null
let host: HTMLElement | null = null

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  host?.remove()
  host = null
})

function mountCard(reason: string, width = 900): HTMLElement {
  host = document.createElement('div')
  host.style.width = `${width}px`
  document.body.append(host)
  wrapper = mount(BuildUninstallFailed, {
    props: { reason, title: "Pulling changes didn't finish", kind: 'operation' },
    attachTo: host
  })
  return wrapper.element as HTMLElement
}

function renderedBox(el: Element): DOMRect {
  const box = el.getBoundingClientRect()
  expect(box.width, 'the element is rendered').toBeGreaterThan(0)
  expect(box.height, 'the element is rendered').toBeGreaterThan(0)
  return box
}

function centerY(el: Element): number {
  const box = renderedBox(el)
  return box.top + box.height / 2
}

function firstLineCenterY(el: Element): number {
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight)
  return renderedBox(el).top + lineHeight / 2
}

describe('the failed task card', () => {
  it.each([
    ['a one-line reason', 'fatal: the remote end hung up unexpectedly'],
    ['a long reason', Array.from({ length: 8 }, (_, i) => `line ${i + 1} of the log`).join('\n')],
    ['a narrow card', 'fatal: the remote end hung up unexpectedly', 360]
  ] as const)('keeps the icon on the title line with %s', (_, reason, width = 900) => {
    const card = mountCard(reason, width)
    const icon = card.querySelector('svg')!
    const title = card.querySelector('h2')!

    expect(Math.abs(centerY(icon) - firstLineCenterY(title))).toBeLessThanOrEqual(1)
  })

  it('centres the buttons on the card', () => {
    const card = mountCard('fatal: the remote end hung up unexpectedly')
    const retry = card.querySelector('[data-testid="build-operation-retry"]')!

    expect(Math.abs(centerY(retry) - centerY(card))).toBeLessThanOrEqual(1)
  })

  it('has no border, the card radius and paddings, and a fill', () => {
    const card = mountCard('fatal: the remote end hung up unexpectedly')
    const style = getComputedStyle(card)

    expect(style.borderTopWidth).toBe('0px')
    expect(style.borderRadius).toBe('14px')
    expect([style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]).toEqual([
      '16px',
      '18px',
      '16px',
      '18px'
    ])
    expect(style.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  })

  it('keeps Dismiss and Try again by default', () => {
    const card = mountCard('A file is in use.')

    expect([...card.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual([
      'Dismiss',
      'Try again'
    ])
  })
})

describe('the start notice', () => {
  it('has one action with its own label and no reason line when none is known', async () => {
    host = document.createElement('div')
    document.body.append(host)
    wrapper = mount(BuildUninstallFailed, {
      props: {
        reason: '',
        title: "ComfyUI didn't start",
        kind: 'start',
        dismissLabel: null,
        retryLabel: 'View logs'
      },
      attachTo: host
    })
    const card = wrapper.element as HTMLElement

    expect([...card.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual([
      'View logs'
    ])
    expect(card.querySelector('[data-testid="build-start-failed-reason"]')).toBeNull()
    await wrapper.get('[data-testid="build-start-retry"]').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })
})
