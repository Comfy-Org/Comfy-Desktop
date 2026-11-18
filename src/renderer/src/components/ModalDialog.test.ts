import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ModalDialog from './ModalDialog.vue'
import { useModal } from '../composables/useModal'
import { TID } from '../../../shared/testIds'

const modal = useModal()
let wrapper: VueWrapper

async function settle(): Promise<void> {
  await flushPromises()
  await vi.runAllTimersAsync()
  await flushPromises()
}

function getElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Missing dialog control: ${selector}`)
  return element
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  modal.dismiss()
  wrapper = mount(ModalDialog, { attachTo: document.body })
})

afterEach(async () => {
  modal.dismiss()
  wrapper.unmount()
  await settle()
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('ModalDialog shared controls', () => {
  it('focuses the prompt, validates it, and returns trimmed text on Enter', async () => {
    const result = modal.prompt({ title: 'Name snapshot', message: '', required: 'Enter a name.' })
    await settle()
    const input = getElement<HTMLInputElement>(`[data-testid="${TID.modalPromptInput}"]`)
    expect(document.activeElement).toBe(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    expect(getElement('.dialog-error').textContent).toBe('Enter a name.')
    expect(modal.state.visible).toBe(true)

    input.value = '  Saved snapshot  '
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await expect(result).resolves.toBe('Saved snapshot')
  })

  it('records rich-confirm checkbox choices through the modal state API', async () => {
    const result = modal.confirm({
      title: 'Restore snapshot',
      message: 'Choose what to restore.',
      checkboxes: [{ id: 'models', label: 'Include models', checked: false }]
    })
    await settle()
    const checkbox = getElement<HTMLButtonElement>('[role="checkbox"]')
    checkbox.click()
    await settle()
    expect(checkbox.getAttribute('aria-checked')).toBe('true')
    getElement<HTMLButtonElement>(`[data-testid="${TID.modalConfirm}"]`).click()
    await expect(result).resolves.toBe(true)
    expect(modal.getLastCheckboxValues()).toEqual({ models: true })
  })

  it('enables an options confirmation only after a shared checkbox is selected', async () => {
    const result = modal.confirmWithOptions({
      title: 'Delete files',
      message: 'Select files.',
      confirmLabel: 'Delete selected',
      options: [{ id: 'cache', label: 'Cache', checked: false }]
    })
    await settle()
    const action = [...document.querySelectorAll<HTMLButtonElement>('.dialog-actions button')].find(
      (button) => button.textContent?.trim() === 'Delete selected'
    )!
    expect(action.disabled).toBe(true)
    getElement<HTMLButtonElement>('[role="checkbox"]').click()
    await settle()
    expect(action.disabled).toBe(false)
    expect(action.getAttribute('data-variant')).toBe('destructive')
    action.click()
    await expect(result).resolves.toEqual({ cache: true })
  })

  it('retains destructive styling for a simple danger-solid confirmation', async () => {
    const result = modal.confirm({
      title: 'Delete installation',
      message: 'Delete files?',
      confirmStyle: 'danger-solid'
    })
    await settle()
    const action = getElement<HTMLButtonElement>('[data-testid="base-alert-action"]')
    expect(action.getAttribute('data-variant')).toBe('destructive')
    action.click()
    await expect(result).resolves.toBe(true)
  })

  it('keeps a loading confirmation disabled and dismisses it as cancellation', async () => {
    const result = modal.confirm({ title: 'Restore snapshot', message: '', loading: true })
    await settle()
    expect(getElement<HTMLButtonElement>(`[data-testid="${TID.modalConfirm}"]`).disabled).toBe(true)
    getElement('[role="dialog"]').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    )
    await expect(result).resolves.toBe(false)
  })
})
