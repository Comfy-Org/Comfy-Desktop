import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Button from './Button.vue'
import SearchInput from './SearchInput.vue'
import Skeleton from './Skeleton.vue'
import ListTable from './ListTable.vue'
import InlineEdit from './InlineEdit.vue'

describe('Button', () => {
  it('is a non-submit button with its label', () => {
    const el = mount(Button, { slots: { default: 'Go' } }).get('button')
    expect(el.attributes('type')).toBe('button')
    expect(el.text()).toBe('Go')
  })

  it('forwards disabled and extra attributes', () => {
    const wrapper = mount(Button, { props: { disabled: true }, attrs: { 'data-testid': 'x' } })
    expect(wrapper.get('button').attributes()).toMatchObject({ disabled: '', 'data-testid': 'x' })
  })
})

describe('SearchInput', () => {
  it('emits the typed value and clears it from the clear button', async () => {
    const wrapper = mount(SearchInput, {
      props: { placeholder: 'Search builds', clearLabel: 'Clear', modelValue: 'flux' }
    })
    await wrapper.get('input').setValue('sdxl')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['sdxl'])
    await wrapper.setProps({ modelValue: 'sdxl' })
    await wrapper.get('button[aria-label="Clear"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([''])
  })

  it('puts extra attributes on the field itself', () => {
    const wrapper = mount(SearchInput, {
      props: { placeholder: 'Search', clearLabel: 'Clear' },
      attrs: { disabled: true }
    })
    expect(wrapper.get('input').attributes()).toHaveProperty('disabled')
  })
})

describe('ListTable', () => {
  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'size', label: 'Size', width: '80px', align: 'end' as const }
  ]
  const rows = [
    { name: 'a.json', size: 1 },
    { name: 'b.json', size: 2 }
  ]

  it('renders a header and a row per item, with cell slots', () => {
    const wrapper = mount(ListTable<(typeof rows)[number]>, {
      props: { columns, rows, rowKey: (r) => r.name, loadingLabel: 'Loading' },
      slots: { 'cell-size': '<template #cell-size="{ row }">{{ row.size }} B</template>' }
    })
    expect(wrapper.findAll('[role="columnheader"]').map((h) => h.text())).toEqual(['Name', 'Size'])
    const cells = wrapper.findAll('[role="row"]')[1]!.findAll('[role="cell"]')
    expect(cells.map((c) => c.text())).toEqual(['a.json', '1 B'])
  })

  it('emits activate on click, Enter and Space only when interactive', async () => {
    const quiet = mount(ListTable<(typeof rows)[number]>, {
      props: { columns, rows, rowKey: (r) => r.name, loadingLabel: 'Loading' }
    })
    await quiet.findAll('[role="row"]')[1]!.trigger('click')
    expect(quiet.emitted('activate')).toBeUndefined()

    const live = mount(ListTable<(typeof rows)[number]>, {
      props: { columns, rows, rowKey: (r) => r.name, interactive: true, loadingLabel: 'Loading' }
    })
    await live.findAll('[role="row"]')[1]!.trigger('click')
    await live.findAll('[role="row"]')[2]!.trigger('keydown', { key: 'Enter' })
    await live.findAll('[role="row"]')[2]!.trigger('keydown', { key: ' ' })
    expect(live.emitted('activate')).toEqual([[rows[0]], [rows[1]], [rows[1]]])
  })

  it('leaves a control inside a cell to its own action', async () => {
    const wrapper = mount(ListTable<(typeof rows)[number]>, {
      props: { columns, rows, rowKey: (r) => r.name, interactive: true, loadingLabel: 'Loading' },
      slots: {
        'cell-size': '<template #cell-size><button type="button">Delete</button></template>'
      }
    })
    await wrapper.get('[role="row"] button').trigger('click')
    await wrapper.get('[role="row"] button').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('activate')).toBeUndefined()
  })

  it('announces loading and shows skeleton rows while it has nothing to show yet', async () => {
    const wrapper = mount(ListTable<(typeof rows)[number]>, {
      props: { columns, rows: [], rowKey: (r) => r.name, loading: true, loadingLabel: 'Loading' }
    })
    expect(wrapper.get('[role="status"]').text()).toBe('Loading')
    expect(wrapper.get('[role="table"]').attributes('aria-busy')).toBe('true')
    expect(wrapper.findAllComponents(Skeleton).length).toBeGreaterThan(0)

    await wrapper.setProps({ rows, loading: false })
    expect(wrapper.get('[role="status"]').text()).toBe('')
    expect(wrapper.findAllComponents(Skeleton)).toHaveLength(0)
  })
})

describe('InlineEdit', () => {
  const mountEdit = (editing = true) =>
    mount(InlineEdit, {
      props: { value: 'Studio', editing, label: 'Rename' },
      slots: { default: 'Studio' },
      attachTo: document.body
    })

  it('shows its text until it is opened', () => {
    const wrapper = mountEdit(false)
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.text()).toBe('Studio')
    wrapper.unmount()
  })

  it('saves a trimmed new name on Enter, once', async () => {
    const wrapper = mountEdit()
    const input = wrapper.get('input')
    expect(input.attributes('aria-label')).toBe('Rename')
    await input.setValue('  Studio 2 ')
    await input.trigger('keydown', { key: 'Enter' })
    await input.trigger('blur')
    expect(wrapper.emitted('commit')).toEqual([['Studio 2']])
    wrapper.unmount()
  })

  it('ignores the Enter that confirms an IME candidate', async () => {
    const wrapper = mountEdit()
    await wrapper.get('input').setValue('スタジオ')
    await wrapper.get('input').trigger('keydown', { key: 'Enter', isComposing: true })
    expect(wrapper.emitted('commit')).toBeUndefined()
    wrapper.unmount()
  })

  it('cancels on Escape, and when the name is empty or unchanged', async () => {
    const escaped = mountEdit()
    await escaped.get('input').setValue('Other')
    await escaped.get('input').trigger('keydown', { key: 'Escape' })
    expect(escaped.emitted('commit')).toBeUndefined()
    expect(escaped.emitted('cancel')).toHaveLength(1)
    escaped.unmount()

    const blank = mountEdit()
    await blank.get('input').setValue('   ')
    await blank.get('input').trigger('blur')
    expect(blank.emitted('cancel')).toHaveLength(1)
    blank.unmount()

    const unchanged = mountEdit()
    await unchanged.get('input').trigger('blur')
    expect(unchanged.emitted('commit')).toBeUndefined()
    expect(unchanged.emitted('cancel')).toHaveLength(1)
    unchanged.unmount()
  })
})
