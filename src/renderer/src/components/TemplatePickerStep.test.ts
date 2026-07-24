import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'

import { en } from '../lib/i18nMessages'
import type { DiskSpaceInfo, FieldOption } from '../types/ipc'
import TemplatePickerStep from './TemplatePickerStep.vue'

const GB = 1024 ** 3

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })

const NONE: FieldOption = { value: 'none', label: 'Blank canvas' }

const IMAGE_REC: FieldOption = {
  value: 'sdxl_turbo',
  label: 'SDXL Turbo',
  description: 'Fast text-to-image.',
  recommended: true,
  data: { modality: 'image', sizeBytes: 7 * GB, thumbnailUrl: './x.webp' },
}
const IMAGE_ALT: FieldOption = {
  value: 'flux_schnell',
  label: 'Flux Schnell',
  description: 'Heavier text-to-image.',
  data: { modality: 'image', sizeBytes: 17 * GB },
}
const VIDEO: FieldOption = {
  value: 'wan_video',
  label: 'Wan Video',
  description: 'Text-to-video.',
  recommended: true,
  data: { modality: 'video', sizeBytes: 16 * GB },
}

function mountPicker(props: Partial<{
  options: FieldOption[]
  selectedValue: string | null
  diskSpace: DiskSpaceInfo | null
  diskSpaceLoading: boolean
}> = {}) {
  return mount(TemplatePickerStep, {
    props: {
      options: [NONE, IMAGE_REC, IMAGE_ALT, VIDEO],
      noneValue: 'none',
      selectedValue: IMAGE_REC.value,
      diskSpace: null,
      diskSpaceLoading: false,
      ...props,
    },
    global: { plugins: [i18n] },
  })
}

describe('TemplatePickerStep', () => {
  it('renders one tab per populated modality, excluding the none sentinel', () => {
    const tabs = mountPicker().findAll('[role="tab"]')
    expect(tabs).toHaveLength(2) // Image + Video
    expect(tabs[0]!.text()).toContain('Image')
    expect(tabs[1]!.text()).toContain('Video')
  })

  it('shows only the active tab\'s templates and never the none sentinel', () => {
    const rows = mountPicker().findAll('button[role="radio"]')
    // Active tab follows the selected (recommended image) → both image rows show.
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('SDXL Turbo')
    expect(rows[1]!.text()).toContain('Flux Schnell')
  })

  it('switches visible templates when another tab is clicked', async () => {
    const wrapper = mountPicker()
    await wrapper.findAll('[role="tab"]')[1]!.trigger('click') // Video
    const rows = wrapper.findAll('button[role="radio"]')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.text()).toContain('Wan Video')
  })

  it('shows the recommended badge on the recommended card when it is not selected', () => {
    // Select the non-recommended alt so the recommended card shows its badge
    // (the check replaces it when the recommended card is itself selected).
    const wrapper = mountPicker({ selectedValue: IMAGE_ALT.value })
    const tags = wrapper.findAll('.tps__recommended')
    expect(tags).toHaveLength(1)
    expect(wrapper.findAll('button[role="radio"]')[0]!.text()).toContain('Recommended')
    expect(wrapper.findAll('button[role="radio"]')[1]!.text()).not.toContain('Recommended')
  })

  it('hides the recommended badge on the selected card (check takes its place)', () => {
    // Default selection is the recommended card → only the check shows, no badge.
    const wrapper = mountPicker()
    expect(wrapper.findAll('.tps__recommended')).toHaveLength(0)
    expect(wrapper.findAll('.tps__check')).toHaveLength(1)
  })

  it('marks the selected row via aria-checked', () => {
    const rows = mountPicker({ selectedValue: IMAGE_ALT.value }).findAll('button[role="radio"]')
    expect(rows[0]!.attributes('aria-checked')).toBe('false')
    expect(rows[1]!.attributes('aria-checked')).toBe('true')
  })

  it('emits select with the clicked option', async () => {
    const wrapper = mountPicker()
    await wrapper.findAll('button[role="radio"]')[1]!.trigger('click')
    expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({ value: IMAGE_ALT.value })
  })

  it('leaves Enter/Space to native button activation (does not preventDefault)', () => {
    const wrapper = mountPicker({ selectedValue: IMAGE_REC.value })
    const row = wrapper.findAll('button[role="radio"]')[0]!
    for (const key of ['Enter', ' ']) {
      const ev = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true })
      row.element.dispatchEvent(ev)
      expect(ev.defaultPrevented).toBe(false)
    }
  })

  it('ArrowDown/ArrowRight move selection to the next card within the active tab', async () => {
    for (const key of ['ArrowDown', 'ArrowRight']) {
      const wrapper = mountPicker({ selectedValue: IMAGE_REC.value })
      await wrapper.findAll('button[role="radio"]')[0]!.trigger('keydown', { key })
      expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({ value: IMAGE_ALT.value })
    }
  })

  it('shows the model name, task subtitle, and size on each card', () => {
    const named: FieldOption = {
      value: 'zit',
      label: 'Z-Image-Turbo Text to Image',
      data: { modality: 'image', sizeBytes: 19 * GB, name: 'Z-Image-Turbo', task: 'Text to Image' },
    }
    const card = mountPicker({ options: [NONE, named], selectedValue: named.value })
      .findAll('button[role="radio"]')[0]!
    expect(card.find('.tps__card-title').text()).toBe('Z-Image-Turbo')
    expect(card.find('.tps__card-task').text()).toBe('Text to Image')
    expect(card.find('.tps__card-size').text()).toContain('GB')
  })

  it('falls back to the full label when no short name is provided', () => {
    const card = mountPicker().findAll('button[role="radio"]')[0]!
    expect(card.find('.tps__card-title').text()).toBe('SDXL Turbo')
  })

  // A single populated modality needs no tab strip.
  it('hides the tab strip when only one modality has templates', () => {
    const wrapper = mountPicker({ options: [NONE, IMAGE_REC, IMAGE_ALT], selectedValue: IMAGE_REC.value })
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0)
    expect(wrapper.findAll('button[role="radio"]')).toHaveLength(2)
  })

  // The picker exposes the alert message (shownDiskError); the host wizard
  // renders it above the card and owns the blocked-Install shake.
  type PickerVm = {
    shownDiskError: string | null
  }
  const vmOf = (w: ReturnType<typeof mountPicker>) => w.vm as unknown as PickerVm

  describe('disk hard-block', () => {
    it('exposes the block message when free space is below model + headroom', () => {
      const wrapper = mountPicker({
        selectedValue: VIDEO.value, // 16GB model
        diskSpace: { free: 1 * GB, total: 500 * GB },
      })
      expect(vmOf(wrapper).shownDiskError).toBeTruthy()
    })

    it('does not block while disk space is still loading', () => {
      const wrapper = mountPicker({
        selectedValue: VIDEO.value,
        diskSpace: { free: 1 * GB, total: 500 * GB },
        diskSpaceLoading: true,
      })
      expect(vmOf(wrapper).shownDiskError).toBeNull()
    })

    it('does not block when free space covers the model', () => {
      const wrapper = mountPicker({
        selectedValue: VIDEO.value,
        diskSpace: { free: 100 * GB, total: 500 * GB },
      })
      expect(vmOf(wrapper).shownDiskError).toBeNull()
    })

    it('never blocks the model-free none sentinel even on a full disk', () => {
      const wrapper = mountPicker({
        selectedValue: NONE.value,
        diskSpace: { free: 0, total: 500 * GB },
      })
      expect(vmOf(wrapper).shownDiskError).toBeNull()
    })
  })

  it('falls back to the branded ComfyC tile when the thumbnail fails to load', async () => {
    const wrapper = mountPicker({ selectedValue: IMAGE_REC.value })
    const media = wrapper.findAll('.tps__card-media')[0]!
    expect(media.find('img').exists()).toBe(true)
    await media.find('img').trigger('error')
    expect(media.find('img').exists()).toBe(false) // swapped for the logo tile
    expect(media.find('.tps__card-fallback svg').exists()).toBe(true)
  })

  it('shows the ComfyC fallback tile for templates with no thumbnail (audio)', () => {
    // VIDEO fixture carries no thumbnailUrl → branded tile, not a broken image.
    const wrapper = mountPicker({ options: [NONE, VIDEO], selectedValue: VIDEO.value })
    const media = wrapper.findAll('.tps__card-media')[0]!
    expect(media.find('img').exists()).toBe(false)
    expect(media.find('.tps__card-fallback svg').exists()).toBe(true)
  })

  it('renders the preview src for a template thumbnail', () => {
    const media = mountPicker({ selectedValue: IMAGE_REC.value }).findAll('.tps__card-media')[0]!
    expect(media.find('img').attributes('src')).toBe('./x.webp')
  })

  it('fades the thumbnail in only once it has loaded', async () => {
    const wrapper = mountPicker({ selectedValue: IMAGE_REC.value })
    const img = wrapper.findAll('.tps__card-media')[0]!.find('img')
    expect(img.classes()).not.toContain('tps__card-img--ready')
    await img.trigger('load')
    expect(img.classes()).toContain('tps__card-img--ready')
  })
})
