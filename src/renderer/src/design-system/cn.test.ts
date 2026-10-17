import { describe, expect, it } from 'vitest'
import { cn } from './cn'

describe('cn', () => {
  it('keeps a custom text size and a text colour apart', () => {
    expect(cn('text-ui', 'text-muted-foreground')).toBe('text-ui text-muted-foreground')
  })

  it('merges the custom radius, shadow and text scales', () => {
    expect(cn('rounded-card', 'rounded-control')).toBe('rounded-control')
    expect(cn('shadow-elev', 'shadow-popover')).toBe('shadow-popover')
    expect(cn('text-ui', 'text-title')).toBe('text-title')
  })
})
