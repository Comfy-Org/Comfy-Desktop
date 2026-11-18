import { expect } from 'vitest'
import type { DOMWrapper } from '@vue/test-utils'

export async function setChecked(control: DOMWrapper<Element>, checked: boolean): Promise<void> {
  if (control.attributes('aria-checked') !== String(checked)) await control.trigger('click')
  expect(control.attributes('aria-checked')).toBe(String(checked))
}
