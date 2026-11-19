import { computed, ref, watch, type Ref } from 'vue'
import type { ComfyArgDef } from '../types/ipc'
import { parseArgs } from '../lib/argsParser'

interface UseArgsAutocompleteOptions {
  value: Ref<string>
  schema: Ref<ComfyArgDef[]>
  focused: Ref<boolean>
  onAccept: (next: string) => void
}

const MAX_MATCHES = 8

export function useArgsAutocomplete(opts: UseArgsAutocompleteOptions) {
  const { value, schema, focused, onAccept } = opts

  const acIndex = ref(0)
  const acDismissed = ref(false)

  const parsed = computed(() => parseArgs(value.value, schema.value))

  const searchQuery = computed<string>(() => {
    if (!focused.value) return ''
    const val = value.value
    if (!val) return ''
    if (val.trimEnd() !== val) return ''
    const allTokens = val.split(/\s+/)
    const lastToken = allTokens.pop() ?? ''
    if (!lastToken) return ''
    if (!lastToken.startsWith('-') && allTokens.length > 0) {
      let k = allTokens.length - 1
      while (k >= 0 && !allTokens[k]!.startsWith('-')) k--
      const flagTok = k >= 0 ? allTokens[k]! : undefined
      if (flagTok && flagTok.startsWith('--') && !flagTok.includes('=')) {
        const def = schema.value.find((a) => a.name === flagTok.slice(2))
        if (def) {
          const valuesBefore = allTokens.length - 1 - k
          if (def.type === 'multi-value') return ''
          if (def.type === 'value' && valuesBefore === 0) return ''
        }
      }
    }
    if (lastToken === '-' || lastToken === '--') return '--'
    const stripped = lastToken.replace(/^-{1,2}/, '')
    const eqIdx = stripped.indexOf('=')
    const name = eqIdx >= 0 ? stripped.slice(0, eqIdx) : stripped
    if (!name) return ''
    if (lastToken.startsWith('-') && schema.value.some((a) => a.name === name)) return ''
    return name.toLowerCase()
  })

  const matches = computed<ComfyArgDef[]>(() => {
    const q = searchQuery.value
    if (!q || !schema.value.length) return []
    const filter = q === '--' ? '' : q
    const known = parsed.value.known
    return schema.value
      .filter((a) => (!filter || a.name.includes(filter)) && !known.has(a.name))
      .slice(0, MAX_MATCHES)
  })

  const visible = computed<boolean>(
    () => matches.value.length > 0 && !acDismissed.value && focused.value
  )

  watch(matches, () => {
    acIndex.value = 0
    acDismissed.value = false
  })

  function completeArg(name: string): void {
    const next = value.value.replace(/-{0,2}[\w_-]*$/, `--${name} `)
    onAccept(next)
  }

  function handleKeydown(key: string): 'consumed' | 'pass' {
    if (!visible.value) return 'pass'
    const total = matches.value.length
    if (key === 'ArrowDown') {
      acIndex.value = (acIndex.value + 1) % total
      return 'consumed'
    }
    if (key === 'ArrowUp') {
      acIndex.value = (acIndex.value - 1 + total) % total
      return 'consumed'
    }
    if (key === 'Tab' || key === 'Enter') {
      const m = matches.value[acIndex.value]
      if (m) completeArg(m.name)
      return 'consumed'
    }
    if (key === 'Escape') {
      acDismissed.value = true
      return 'consumed'
    }
    return 'pass'
  }

  return {
    searchQuery,
    matches,
    visible,
    acIndex,
    completeArg,
    handleKeydown
  }
}
