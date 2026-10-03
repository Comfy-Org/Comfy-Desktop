import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'

import type { FieldOption } from '../types/ipc'
import { useTemplateTabs } from './useTemplateTabs'

const t = (key: string) => key

const NONE: FieldOption = { value: 'none', label: 'None' }
const opt = (value: string, modality: string, recommended = false): FieldOption => ({
  value,
  label: value,
  recommended,
  data: { modality }
})

const IMG_A = opt('img_a', 'image', true)
const IMG_B = opt('img_b', 'image')
const VID = opt('vid', 'video', true)
const AUD = opt('aud', 'audio')
const THREED = opt('td', '3d')

function setup(options: FieldOption[], selectedValue: string | null = null) {
  return useTemplateTabs(ref(options), 'none', ref(selectedValue ? [selectedValue] : []), t)
}

describe('useTemplateTabs', () => {
  it('builds one tab per populated modality, in Video → Image → 3D → Audio order', () => {
    const { tabs } = setup([NONE, AUD, THREED, VID, IMG_A])
    expect(tabs.value.map((tab) => tab.modality)).toEqual(['video', 'image', '3d', 'audio'])
  })

  it('counts templates per modality', () => {
    const { tabs } = setup([NONE, IMG_A, IMG_B, VID])
    expect(tabs.value.find((tab) => tab.modality === 'image')!.count).toBe(2)
    expect(tabs.value.find((tab) => tab.modality === 'video')!.count).toBe(1)
  })

  it("defaults the active tab to the selected template's modality", () => {
    const { activeModality } = setup([NONE, IMG_A, IMG_B, VID], VID.value)
    expect(activeModality.value).toBe('video')
  })

  it("opens on the first selected template's modality when several are selected", () => {
    const selected = ref<string[]>([AUD.value, IMG_A.value])
    const { activeModality } = useTemplateTabs(ref([NONE, IMG_A, VID, AUD]), 'none', selected, t)
    expect(activeModality.value).toBe('audio')
  })

  it('keeps the active tab when the selection changes', async () => {
    const selected = ref<string[]>([])
    const tabs = useTemplateTabs(ref([NONE, IMG_A, VID]), 'none', selected, t)
    tabs.selectTab('image')
    selected.value = [VID.value]
    await nextTick()
    expect(tabs.activeModality.value).toBe('image')
  })

  it('defaults to the first populated tab when nothing is selected', () => {
    const { activeModality } = setup([NONE, VID, AUD])
    expect(activeModality.value).toBe('video')
  })

  it("exposes only the active tab's cards", () => {
    const tabs = setup([NONE, IMG_A, IMG_B, VID], IMG_A.value)
    expect(tabs.visibleCards.value.map((c) => c.value)).toEqual(['img_a', 'img_b'])
    tabs.selectTab('video')
    expect(tabs.visibleCards.value.map((c) => c.value)).toEqual(['vid'])
  })

  it('excludes the none sentinel from tabs and cards', () => {
    const { tabs, visibleCards } = setup([NONE, IMG_A])
    expect(tabs.value).toHaveLength(1)
    expect(visibleCards.value.every((c) => c.value !== 'none')).toBe(true)
  })

  it('returns no tabs when only the none sentinel is present', () => {
    const { tabs, activeModality, visibleCards } = setup([NONE])
    expect(tabs.value).toHaveLength(0)
    expect(activeModality.value).toBeNull()
    expect(visibleCards.value).toHaveLength(0)
  })
})
