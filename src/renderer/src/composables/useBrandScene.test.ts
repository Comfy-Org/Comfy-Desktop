import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { lerpKf, makeBezier, useBrandScene } from './useBrandScene'
import type { BrandScene, Keyframe } from '../lib/brandScene/types'

describe('makeBezier', () => {
  it('pins the endpoints and clamps outside [0,1]', () => {
    const ease = makeBezier(0.42, 0, 0.58, 1)
    expect(ease(0)).toBe(0)
    expect(ease(1)).toBe(1)
    expect(ease(-0.5)).toBe(0)
    expect(ease(2)).toBe(1)
  })

  it('is the identity for a linear control curve', () => {
    const linear = makeBezier(0, 0, 1, 1)
    for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(linear(x), 'within the solver 1e-5 x-tolerance, not exact').toBeCloseTo(x, 4)
    }
  })

  it('eases in/out around the diagonal', () => {
    const ease = makeBezier(0.42, 0, 0.58, 1)
    expect(ease(0.25)).toBeLessThan(0.25)
    expect(ease(0.75)).toBeGreaterThan(0.75)
    expect(ease(0.5)).toBeCloseTo(0.5, 5)
  })
})

describe('lerpKf', () => {
  const track: Keyframe[] = [
    { t: 0, v: [0, 100] },
    { t: 10, v: [50, 0] }
  ]

  it('returns [0,0] for an empty track', () => {
    expect(lerpKf([], 5)).toEqual([0, 0])
  })

  it('holds the first value before the track starts', () => {
    expect(lerpKf(track, -5)).toEqual([0, 100])
  })

  it('holds the last value after the track ends', () => {
    expect(lerpKf(track, 999)).toEqual([50, 0])
  })

  it('linearly interpolates between keyframes with no easing tangents', () => {
    expect(lerpKf(track, 5)).toEqual([25, 50])
  })

  it('applies the segment easing tangents when present', () => {
    const eased: Keyframe[] = [
      { t: 0, v: [0, 0], eo: [0.42, 0] },
      { t: 10, v: [100, 0], ei: [0.58, 1] }
    ]
    expect(lerpKf(eased, 2.5)[0]).toBeLessThan(25)
  })

  it('does not divide by zero on a coincident keyframe pair', () => {
    const flat: Keyframe[] = [
      { t: 5, v: [7, 8] },
      { t: 5, v: [9, 10] }
    ]
    expect(lerpKf(flat, 5)).toEqual([7, 8])
  })
})

// Minimal comp so `useBrandScene` gets an onMounted context and a stage node.
const TINY_SCENE: BrandScene = {
  fps: 60,
  duration: 100,
  compW: 1056,
  compH: 784,
  scenes: []
}

let lastScene: ReturnType<typeof useBrandScene> | null = null

function mountScene() {
  return mount(
    defineComponent({
      setup() {
        const stageRef = ref<HTMLElement | null>(null)
        lastScene = useBrandScene(stageRef, TINY_SCENE)
        return () => h('div', [h('div', { ref: stageRef, class: 'brand-scene-stage' })])
      }
    })
  )
}

describe('useBrandScene playback gating', () => {
  let rafSpy: ReturnType<typeof vi.spyOn>
  let hidden = false
  let reduced = false
  let wrappers: Array<ReturnType<typeof mountScene>>

  function mount() {
    const w = mountScene()
    wrappers.push(w)
    return w
  }

  beforeEach(() => {
    hidden = false
    reduced = false
    wrappers = []
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('reduced-motion') ? reduced : false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {}
    }))
    rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1 as unknown as number)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  })

  afterEach(() => {
    wrappers.forEach((w) => w.unmount())
    rafSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('starts the loop on mount when visible and motion is allowed', () => {
    mount()
    expect(rafSpy).toHaveBeenCalled()
  })

  it('does not start the loop when mounted on a hidden tab', () => {
    hidden = true
    mount()
    expect(rafSpy).not.toHaveBeenCalled()
  })

  it('does not start the loop under prefers-reduced-motion', () => {
    reduced = true
    mount()
    expect(rafSpy).not.toHaveBeenCalled()
  })

  it('tears the loop down on unmount', () => {
    const wrapper = mount()
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')
    wrapper.unmount()
    expect(cancelSpy).toHaveBeenCalled()
  })

  it('reveals immediately when there are no clips to wait on', () => {
    mount()
    expect(lastScene?.ready.value, 'a scene with no active video has nothing to decode').toBe(true)
  })
})
