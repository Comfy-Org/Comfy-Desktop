import { describe, it, expect } from 'vitest'
import { editableFieldIds } from './editableFields'

describe('editableFieldIds', () => {
  it('allows editable fields, editable footer toggles, and the always-editable name and seen', () => {
    const ids = editableFieldIds([
      {
        fields: [
          {
            id: 'updateChannel',
            editable: true,
            footerToggle: { id: 'restartWhenIdle', editable: true }
          },
          { id: 'installPath', editable: false },
          { id: 'locked', footerToggle: { id: 'lockedToggle' } }
        ]
      },
      { title: 'no fields' }
    ])
    expect([...ids].sort()).toEqual(['name', 'restartWhenIdle', 'seen', 'updateChannel'])
  })
})
