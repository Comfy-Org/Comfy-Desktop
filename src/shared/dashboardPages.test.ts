import { describe, expect, it } from 'vitest'

import { isNewWindowDashboardPage } from './dashboardPages'

describe('isNewWindowDashboardPage', () => {
  it.each(['home', 'apps', 'assets', 'chooser'])('accepts the sidebar page %s', (page) => {
    expect(isNewWindowDashboardPage(page)).toBe(true)
  })

  it.each(['benchmarks', 'performance-test', 'settings', '', null, undefined, 3])(
    'rejects %s',
    (page) => {
      expect(isNewWindowDashboardPage(page)).toBe(false)
    }
  )
})
