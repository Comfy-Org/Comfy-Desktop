import { describe, expect, it } from 'vitest'
import {
  POSTHOG_CONTROLLED_ARGS,
  controlledArg,
  isControlledArg,
  oppositeArg
} from './posthogControlledArgs'

/** The rule the explicit rows replaced: swap the `--enable-`/`--disable-` prefix, keeping the
 *  stem exact. Copied here verbatim so the table is checked against it, not against itself. */
function prefixOpposite(arg: string): string | null {
  if (arg.startsWith('--enable-')) return '--disable-' + arg.slice('--enable-'.length)
  if (arg.startsWith('--disable-')) return '--enable-' + arg.slice('--disable-'.length)
  return null
}

describe('POSTHOG_CONTROLLED_ARGS', () => {
  it('lists exactly the args a payload could grant before the table existed, in order', () => {
    expect(POSTHOG_CONTROLLED_ARGS.map((row) => row.arg)).toEqual([
      '--enable-assets',
      '--enable-asset-hashing',
      '--disable-assets',
      '--enable-agent'
    ])
  })

  it('names each arg once', () => {
    const args = POSTHOG_CONTROLLED_ARGS.map((row) => row.arg)
    expect(new Set(args).size).toBe(args.length)
  })

  it.each(POSTHOG_CONTROLLED_ARGS.map((row) => [row.arg, row] as const))(
    '%s states the opposite and direction its prefix implied',
    (arg, row) => {
      expect(row.opposite).toBe(prefixOpposite(arg))
      expect(row.direction).toBe(arg.startsWith('--enable-') ? 'enable' : 'disable')
    }
  )

  it.each(POSTHOG_CONTROLLED_ARGS.map((row) => [row.arg, row] as const))(
    "%s requires blockers exactly when it turns something on (today's rows)",
    (_, row) => {
      expect(row.requiresBlockers).toBe(row.direction === 'enable')
    }
  )

  it('pairs opposites symmetrically wherever both are listed', () => {
    for (const row of POSTHOG_CONTROLLED_ARGS) {
      if (row.opposite === null || !isControlledArg(row.opposite)) continue
      expect(oppositeArg(row.opposite)).toBe(row.arg)
    }
  })
})

describe('lookups', () => {
  it('keeps a stem exact: assets never pairs with asset hashing', () => {
    expect(oppositeArg('--enable-assets')).toBe('--disable-assets')
    expect(oppositeArg('--enable-asset-hashing')).toBe('--disable-asset-hashing')
  })

  it.each(['--listen', '--disable-asset-hashing', '--enable-assets ', '', '--ENABLE-ASSETS'])(
    'treats %j as outside the allowlist',
    (arg) => {
      expect(isControlledArg(arg)).toBe(false)
      expect(controlledArg(arg)).toBeUndefined()
      expect(oppositeArg(arg)).toBeNull()
    }
  )
})
