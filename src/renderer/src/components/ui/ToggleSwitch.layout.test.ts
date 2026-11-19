import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { h } from 'vue'

import '../../assets/main.css'
import ToggleSwitch from './ToggleSwitch.vue'
import BooleanToggle from '../../views/comfyUISettings/BooleanToggle.vue'
import MigrateConfirmBody from '../MigrateConfirmBody.vue'
import type { DetailField } from '../../types/ipc'

type Rgb = [number, number, number]
type Rgba = [number, number, number, number]

const SURFACES = {
  page: 'var(--color-content-background)',
  card: 'var(--card)'
} as const

const mounted: VueWrapper[] = []
let noMotion: HTMLStyleElement | null = null

afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount())
  noMotion?.remove()
  noMotion = null
  document.body.innerHTML = ''
})

function freezeMotion(): void {
  noMotion = document.createElement('style')
  noMotion.textContent = '*, *::before, *::after { transition: none !important; }'
  document.head.appendChild(noMotion)
}

async function mountOn(
  surface: string,
  props: Record<string, unknown> = {}
): Promise<{ wrapper: VueWrapper; host: HTMLElement }> {
  freezeMotion()
  const host = document.createElement('div')
  host.style.background = surface
  host.style.padding = '16px'
  document.body.appendChild(host)
  const wrapper = mount(ToggleSwitch, { props, attachTo: host })
  mounted.push(wrapper)
  await flushPromises()
  return { wrapper, host }
}

function parts(root: Element): { button: HTMLElement; track: HTMLElement; knob: HTMLElement } {
  const button = root.closest('[data-slot="toggle-switch"]') ?? root
  return {
    button: button as HTMLElement,
    track: button.querySelector<HTMLElement>('[data-slot="toggle-switch-track"]')!,
    knob: button.querySelector<HTMLElement>('[data-slot="toggle-switch-knob"]')!
  }
}

const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
function toRgba(css: string): Rgba {
  ctx.canvas.width = ctx.canvas.height = 1
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = '#000'
  ctx.fillStyle = css
  ctx.fillRect(0, 0, 1, 1)
  const d = ctx.getImageData(0, 0, 1, 1).data
  return [d[0]!, d[1]!, d[2]!, d[3]! / 255]
}
function over(top: Rgba, under: Rgb): Rgb {
  const a = top[3]
  return [0, 1, 2].map((i) => top[i]! * a + under[i]! * (1 - a)) as Rgb
}
function luminance([r, g, b]: Rgb): number {
  const f = (v: number): number => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

function knobVsTrack(host: HTMLElement): number {
  const { track, knob } = parts(host.querySelector('[data-slot="toggle-switch"]')!)
  const surface = over(toRgba(getComputedStyle(host).backgroundColor), [0, 0, 0])
  const trackColor = over(toRgba(getComputedStyle(track).backgroundColor), surface)
  const knobColor = over(toRgba(getComputedStyle(knob).backgroundColor), trackColor)
  return contrast(knobColor, trackColor)
}

function insets(host: HTMLElement): { left: number; top: number; right: number; bottom: number } {
  const { track, knob } = parts(host.querySelector('[data-slot="toggle-switch"]')!)
  const t = track.getBoundingClientRect()
  const k = knob.getBoundingClientRect()
  return {
    left: k.left - t.left,
    top: k.top - t.top,
    right: t.right - k.right,
    bottom: t.bottom - k.bottom
  }
}

describe('ToggleSwitch geometry', () => {
  for (const on of [false, true]) {
    it(`keeps the knob centered with an even inset when ${on ? 'on' : 'off'}`, async () => {
      const { host } = await mountOn(SURFACES.page, { modelValue: on })
      const { track, knob } = parts(host.querySelector('[data-slot="toggle-switch"]')!)
      const t = track.getBoundingClientRect()
      const k = knob.getBoundingClientRect()
      expect([t.width, t.height]).toEqual([36, 20])
      expect([k.width, k.height]).toEqual([16, 16])

      const gap = insets(host)
      expect(gap.top).toBeCloseTo(2, 1)
      expect(gap.bottom).toBeCloseTo(2, 1)
      expect(on ? gap.right : gap.left).toBeCloseTo(2, 1)
      expect(k.top + k.height / 2).toBeCloseTo(t.top + t.height / 2, 1)
    })
  }

  it('moves the knob to the far end when switched on', async () => {
    const { host, wrapper } = await mountOn(SURFACES.page, { modelValue: false })
    expect(insets(host).left).toBeCloseTo(2, 1)
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    const gap = insets(host)
    expect(gap.right).toBeCloseTo(2, 1)
    expect(gap.left).toBeCloseTo(18, 1)
  })
})

describe('ToggleSwitch contrast', () => {
  for (const [name, surface] of Object.entries(SURFACES)) {
    for (const on of [false, true]) {
      it(`reads the knob against the track at 3:1 or more, ${on ? 'on' : 'off'}, on ${name}`, async () => {
        const { host } = await mountOn(surface, { modelValue: on })
        expect(knobVsTrack(host)).toBeGreaterThanOrEqual(3)
      })
    }
  }

  it('swaps the knob colour between off and on so the knob never reads as a hole', async () => {
    const { host, wrapper } = await mountOn(SURFACES.page, { modelValue: false })
    const { knob } = parts(host.querySelector('[data-slot="toggle-switch"]')!)
    const off = getComputedStyle(knob).backgroundColor
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    expect(getComputedStyle(knob).backgroundColor).not.toBe(off)
  })
})

describe('ToggleSwitch states', () => {
  it('toggles on click and emits the next value', async () => {
    const { wrapper } = await mountOn(SURFACES.page, { modelValue: false })
    await wrapper.find('button[role="switch"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true])
  })

  it('dims a disabled switch and ignores clicks', async () => {
    const { wrapper, host } = await mountOn(SURFACES.page, { modelValue: true, disabled: true })
    const { button } = parts(host.querySelector('[data-slot="toggle-switch"]')!)
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(Number(getComputedStyle(button).opacity)).toBeCloseTo(0.45, 2)
    expect(getComputedStyle(button).cursor).toBe('not-allowed')
    await wrapper.find('button[role="switch"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeFalsy()
  })

  it('keeps the same geometry when disabled', async () => {
    const { host } = await mountOn(SURFACES.page, { modelValue: false, disabled: true })
    expect(insets(host).left).toBeCloseTo(2, 1)
    expect(insets(host).top).toBeCloseTo(2, 1)
  })

  it('dims an aria-disabled switch the same way and keeps it focusable', async () => {
    const { host } = await mountOn(SURFACES.page, {
      modelValue: false,
      readonly: true,
      'aria-disabled': true
    })
    const { button } = parts(host.querySelector('[data-slot="toggle-switch"]')!)
    expect(button.hasAttribute('disabled')).toBe(false)
    expect(Number(getComputedStyle(button).opacity)).toBeCloseTo(0.45, 2)
  })

  it('ignores clicks while readonly', async () => {
    const { wrapper } = await mountOn(SURFACES.page, { modelValue: false, readonly: true })
    await wrapper.find('button[role="switch"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeFalsy()
  })

  it('shows a visible, non-blue focus ring on keyboard focus', async () => {
    const { host } = await mountOn(SURFACES.page, { modelValue: false })
    const { button, track } = parts(host.querySelector('[data-slot="toggle-switch"]')!)
    await userEvent.tab()
    expect(document.activeElement).toBe(button)
    const style = getComputedStyle(track)
    expect(style.outlineStyle).toBe('solid')
    expect(parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(2)
    const [r, g, b] = toRgba(style.outlineColor)
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(4)
  })

  it('toggles from the keyboard with Space', async () => {
    const { wrapper } = await mountOn(SURFACES.page, { modelValue: false })
    await userEvent.tab()
    await userEvent.keyboard(' ')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true])
  })
})

describe('ToggleSwitch is the one switch', () => {
  it('renders inside BooleanToggle', async () => {
    const field: DetailField = {
      id: 'useChineseMirrors',
      label: 'Use Chinese mirrors',
      value: false,
      editable: true,
      editType: 'boolean'
    }
    const wrapper = mount(() => h(BooleanToggle, { field }), {
      attachTo: document.body
    })
    mounted.push(wrapper)
    expect(wrapper.find('[data-slot="toggle-switch"].bt-switch').exists()).toBe(true)
  })

  it('renders inside MigrateConfirmBody', async () => {
    const wrapper = mount(MigrateConfirmBody, {
      props: {
        preview: null,
        details: [],
        checkboxes: [{ id: 'keep', label: 'Keep the old install', checked: true }]
      },
      attachTo: document.body
    })
    mounted.push(wrapper)
    expect(wrapper.find('[data-slot="toggle-switch"]').attributes('aria-checked')).toBe('true')
  })
})
