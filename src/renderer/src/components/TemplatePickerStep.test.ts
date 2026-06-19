import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'

import { en } from '../lib/i18nMessages'
import type { DiskSpaceInfo, FieldOption } from '../types/ipc'
import TemplatePickerStep from './TemplatePickerStep.vue'

const GB = 1024 ** 3

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })

const NONE: FieldOption = { value: 'none', label: 'Blank canvas' }

const IMAGE: FieldOption = {
  value: 'flux_schnell',
  label: 'Flux Schnell',
  description: 'Fast text-to-image.',
  data: { modality: 'image', sizeBytes: 8 * GB, thumbnailUrl: './x.webp' },
}
const VIDEO: FieldOption = {
  value: 'wan_video',
  label: 'Wan Video',
  description: 'Text-to-video.',
  data: { modality: 'video', sizeBytes: 16 * GB },
}

function mountPicker(props: Partial<{
  selectedValue: string | null
  diskSpace: DiskSpaceInfo | null
  diskSpaceLoading: boolean
}> = {}) {
  return mount(TemplatePickerStep, {
    props: {
      options: [NONE, IMAGE, VIDEO],
      noneValue: 'none',
      selectedValue: IMAGE.value,
      diskSpace: null,
      diskSpaceLoading: false,
      ...props,
    },
    global: { plugins: [i18n] },
  })
}

describe('TemplatePickerStep', () => {
  it('renders one radio per template and excludes the none sentinel', () => {
    const rows = mountPicker().findAll('button[role="radio"]')
    expect(rows).toHaveLength(2) // none is dropped; Image + Video remain
    expect(rows[0]!.text()).toContain('Flux Schnell')
    expect(rows[1]!.text()).toContain('Wan Video')
  })

  it('tags only the first template as Recommended', () => {
    const wrapper = mountPicker()
    const tags = wrapper.findAll('.tps__recommended')
    expect(tags).toHaveLength(1)
    expect(wrapper.findAll('button[role="radio"]')[0]!.text()).toContain('Recommended')
  })

  it('marks the selected row via aria-checked', () => {
    const rows = mountPicker({ selectedValue: VIDEO.value }).findAll('button[role="radio"]')
    expect(rows[0]!.attributes('aria-checked')).toBe('false')
    expect(rows[1]!.attributes('aria-checked')).toBe('true')
  })

  it('emits select with the clicked option', async () => {
    const wrapper = mountPicker()
    await wrapper.findAll('button[role="radio"]')[1]!.trigger('click')
    expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({ value: VIDEO.value })
  })

  it('leaves Enter/Space to native button activation (does not preventDefault)', async () => {
    // Rows are <button>s, so the browser fires `click` on Enter/Space natively.
    // The keydown handler must NOT swallow them, or keyboard select would break.
    const wrapper = mountPicker({ selectedValue: IMAGE.value })
    const row = wrapper.findAll('button[role="radio"]')[0]!
    for (const key of ['Enter', ' ']) {
      const ev = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true })
      row.element.dispatchEvent(ev)
      expect(ev.defaultPrevented).toBe(false)
    }
  })

  it('ArrowDown moves selection to the next row', async () => {
    const wrapper = mountPicker({ selectedValue: IMAGE.value })
    await wrapper.findAll('button[role="radio"]')[0]!.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({ value: VIDEO.value })
  })

  it('shows a meta line with modality and size', () => {
    const meta = mountPicker().findAll('.brand-variant-row__meta')[0]!.text()
    expect(meta).toContain('Image')
    expect(meta).toContain('GB')
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

  it('falls back to the modality glyph when the thumbnail fails to load', async () => {
    const wrapper = mountPicker({ selectedValue: IMAGE.value })
    const firstIcon = wrapper.findAll('.brand-variant-row__icon')[0]!
    expect(firstIcon.find('img').exists()).toBe(true)
    await firstIcon.find('img').trigger('error')
    expect(firstIcon.find('img').exists()).toBe(false) // swapped for the glyph
    expect(firstIcon.find('svg').exists()).toBe(true)
  })

  it('renders the bundled preview src for a template thumbnail', () => {
    const icon = mountPicker({ selectedValue: IMAGE.value }).findAll('.brand-variant-row__icon')[0]!
    expect(icon.find('img').attributes('src')).toBe('./x.webp')
  })
})
