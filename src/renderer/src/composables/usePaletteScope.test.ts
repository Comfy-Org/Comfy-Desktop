import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import type { Component } from 'vue'
import { mount } from '@vue/test-utils'
import { providePaletteScope, usePaletteScope } from './usePaletteScope'

const Teleported: Component = {
  setup() {
    const palette = usePaletteScope()
    return () => h('div', { class: ['floating', palette] })
  }
}

describe('usePaletteScope', () => {
  it('gives no class outside a scope', () => {
    expect(mount(Teleported).classes()).toEqual(['floating'])
  })

  it('gives the palette class under a provided scope', () => {
    const Root: Component = {
      setup() {
        const palette = providePaletteScope()
        return () => h('section', { class: palette }, [h(Teleported)])
      }
    }
    const wrapper = mount(Root)
    expect(wrapper.classes()).toContain('palette-void')
    expect(wrapper.get('.floating').classes()).toContain('palette-void')
  })
})
