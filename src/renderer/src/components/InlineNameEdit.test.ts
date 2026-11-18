import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import InlineNameEdit from './InlineNameEdit.vue'

function mountName(name: string, onRename?: (newName: string) => Promise<boolean>) {
  const wrapper = mount(InlineNameEdit, {
    props: { name, prefix: 'test', onRename },
    attachTo: document.body
  })
  const field = () => wrapper.get<HTMLElement>('.test-name').element
  return { wrapper, field }
}

async function typeName(field: HTMLElement, text: string): Promise<void> {
  field.focus()
  field.textContent = text
  await flushPromises()
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('InlineNameEdit', () => {
  it('renames on Enter', async () => {
    const onRename = vi.fn().mockResolvedValue(true)
    const { field } = mountName('Old', onRename)

    await typeName(field(), '  New Name  ')
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()

    expect(onRename).toHaveBeenCalledWith('New Name')
    expect(document.activeElement).not.toBe(field())
  })

  it('keeps editing when Enter only confirms an input method candidate', async () => {
    const onRename = vi.fn().mockResolvedValue(true)
    const { field } = mountName('Old', onRename)

    await typeName(field(), 'ni')
    field().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })
    )
    await flushPromises()

    expect(onRename).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(field())
  })

  it('throws the draft away on Escape', async () => {
    const onRename = vi.fn().mockResolvedValue(true)
    const { field } = mountName('Old', onRename)

    await typeName(field(), 'Draft')
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()

    expect(onRename).not.toHaveBeenCalled()
    expect(field().textContent).toBe('Old')
  })

  it('keeps the draft unsaved when the user switches to another app mid-edit', async () => {
    const onRename = vi.fn().mockResolvedValue(true)
    const { field } = mountName('Old', onRename)

    await typeName(field(), 'Half typ')
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    field().dispatchEvent(new FocusEvent('blur'))
    await flushPromises()

    expect(onRename).not.toHaveBeenCalled()
    expect(field().textContent).toBe('Half typ')
  })

  it('puts the saved name back when the rename is refused', async () => {
    const onRename = vi.fn().mockResolvedValue(false)
    const { field } = mountName('Original', onRename)

    await typeName(field(), 'Duplicate')
    field().blur()
    await flushPromises()

    expect(onRename).toHaveBeenCalledWith('Duplicate')
    expect(field().textContent).toBe('Original')
  })

  it('pastes multi-line text as a single line of plain text', async () => {
    const onRename = vi.fn().mockResolvedValue(true)
    const { field } = mountName('', onRename)
    field().focus()

    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', 'My\nBuild')
    clipboardData.setData('text/html', '<b>Bold</b>')
    field().dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true }))
    await flushPromises()

    expect(field().textContent).toBe('My Build')
  })

  it('shows a read-only name when renaming is not offered', async () => {
    const { wrapper, field } = mountName('Comfy Cloud')

    expect(field().textContent).toBe('Comfy Cloud')
    expect(field().getAttribute('contenteditable')).toBeNull()
    expect(wrapper.find('.test-edit-btn').exists()).toBe(false)
  })

  it('shows the new name when it changes outside the editor', async () => {
    const { wrapper, field } = mountName('First', vi.fn().mockResolvedValue(true))

    await wrapper.setProps({ name: 'Second' })
    await flushPromises()

    expect(field().textContent).toBe('Second')
  })
})
