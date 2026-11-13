import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import WorkspaceAvatar from './WorkspaceAvatar.vue'

function initialOf(workspaceName: string): string {
  return mount(WorkspaceAvatar, { props: { workspaceName, subscriptionTier: null } }).text()
}

describe('WorkspaceAvatar', () => {
  it('shows the first letter of the name in upper case', () => {
    expect(initialOf('harbor')).toBe('H')
  })

  it('skips leading spaces', () => {
    expect(initialOf('  harbor')).toBe('H')
  })

  it('keeps a whole emoji or accented letter', () => {
    expect(initialOf('🇩🇪 Berlin')).toBe('🇩🇪')
    expect(initialOf('👩‍💻 Studio')).toBe('👩‍💻')
    expect(initialOf('école')).toBe('É')
  })

  it('keeps a letter whose upper case is two letters', () => {
    expect(initialOf('ßtudio')).toBe('ß')
  })

  it('shows a question mark for a blank name', () => {
    expect(initialOf('   ')).toBe('?')
  })
})
