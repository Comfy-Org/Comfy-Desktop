import type { SelectOption } from '../landing/ui/Select.vue'
import { displayValue, shortName, TOKENS, tokensIn, type TokenGroup } from './tokens'
import { valueOf } from './tweaks'

/** Select options for a token group: name, current value, color swatch. */
export function tokenOptions(group: TokenGroup): SelectOption[] {
  return tokensIn(group).map((t) => {
    const lh = TOKENS.find((x) => x.name === `${t.name}--line-height`)
    return {
      value: t.name,
      label: shortName(t),
      hint: displayValue(t, valueOf(t), lh && valueOf(lh)),
      swatch: t.group === 'color' ? `var(--${t.name})` : undefined
    }
  })
}
