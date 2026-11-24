import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import zh from '@locales/zh.json'
import { resetAppLocale, switchAppLocaleToChinese } from '../../lib/switchAppLocale'
import BaseCopyButton from './BaseCopyButton.vue'

describe('BaseCopyButton', () => {
  afterEach(resetAppLocale)

  it('names itself Copy to clipboard when the caller gives no name', () => {
    const button = mount(BaseCopyButton, { props: { value: 'x' } }).get('button')
    expect(button.attributes('aria-label')).toBe('Copy to clipboard')
    expect(button.attributes('title')).toBe('Copy to clipboard')
  })

  it('names itself in the app language', () => {
    switchAppLocaleToChinese()
    const button = mount(BaseCopyButton, { props: { value: 'x' } }).get('button')
    expect(button.attributes('aria-label')).toBe(zh.common.copyToClipboard)
  })

  it('keeps the name the caller gives', () => {
    const button = mount(BaseCopyButton, { props: { value: 'x', ariaLabel: 'Copy path' } }).get(
      'button'
    )
    expect(button.attributes('aria-label')).toBe('Copy path')
  })
})
