import type { ComfyArgDef } from '../types/ipc'

export interface ParsedArgs {
  known: Map<string, string>
  extra: string[]
}

export function tokenize(raw: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inQuote: string | null = null
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null
        continue
      }
      current += ch
    } else if (ch === '"' || ch === "'") {
      inQuote = ch
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
    } else {
      current += ch
    }
  }
  if (current.length > 0) tokens.push(current)
  return tokens
}

export function parseArgs(raw: string, schema: ComfyArgDef[]): ParsedArgs {
  const tokens = tokenize(raw)
  const schemaMap = new Map(schema.map((a) => [a.name, a]))
  const known = new Map<string, string>()
  const extra: string[] = []

  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]!
    if (token.startsWith('--')) {
      const rest = token.slice(2)
      const eqIdx = rest.indexOf('=')
      const name = eqIdx >= 0 ? rest.slice(0, eqIdx) : rest
      const eqValue = eqIdx >= 0 ? rest.slice(eqIdx + 1) : undefined
      const def = schemaMap.get(name)
      if (def) {
        if (def.type === 'boolean') {
          known.set(name, eqValue ?? '')
          i++
        } else if (eqValue !== undefined) {
          known.set(name, eqValue)
          i++
        } else if (def.type === 'multi-value') {
          const values: string[] = []
          let j = i + 1
          while (j < tokens.length && !tokens[j]!.startsWith('--')) {
            values.push(tokens[j]!)
            j++
          }
          known.set(name, values.join(' '))
          i = j
        } else {
          const next = tokens[i + 1]
          if (next !== undefined && !next.startsWith('--')) {
            known.set(name, next)
            i += 2
          } else {
            known.set(name, '')
            i++
          }
        }
      } else {
        extra.push(token)
        i++
        if (eqValue === undefined && i < tokens.length && !tokens[i]!.startsWith('--')) {
          extra.push(tokens[i]!)
          i++
        }
      }
    } else {
      extra.push(token)
      i++
    }
  }

  return { known, extra }
}

export type ArgTokenStatus =
  | 'ok'
  | 'unsupported'
  | 'missing-value'
  | 'awaiting-value'
  | 'orphaned'
  | 'partial'

export interface ArgToken {
  text: string
  status: ArgTokenStatus
  tooltip?: string
}

export interface ArgValidation {
  tokens: ArgToken[]
  unsupportedFlags: string[]
  missingValueFlags: string[]
  orphanedTokens: string[]
  awaiting: ArgToken | null
  hasIssues: boolean
}

export interface ValidateArgsOptions {
  suppressTrailingPartial?: boolean
}

export function validateArgs(
  raw: string,
  schema: ComfyArgDef[],
  opts: ValidateArgsOptions = {}
): ArgValidation {
  const tokens = tokenize(raw)
  const schemaMap = new Map(schema.map((a) => [a.name, a]))
  const result: ArgToken[] = []

  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]!
    const isLast = i === tokens.length - 1
    if (token.startsWith('--')) {
      const rest = token.slice(2)
      const eqIdx = rest.indexOf('=')
      const name = eqIdx >= 0 ? rest.slice(0, eqIdx) : rest
      const eqValue = eqIdx >= 0 ? rest.slice(eqIdx + 1) : undefined
      const def = schemaMap.get(name)
      if (name === '') {
        result.push({ text: token, status: 'ok' })
        i++
      } else if (!def) {
        result.push({
          text: token,
          status: 'unsupported',
          tooltip: 'Unrecognized argument — will not be passed when launching'
        })
        i++
        if (i < tokens.length && !tokens[i]!.startsWith('--')) {
          result.push({ text: tokens[i]!, status: 'unsupported' })
          i++
        }
      } else if (eqValue !== undefined) {
        if (eqValue === '' && (def.type === 'value' || def.type === 'multi-value')) {
          result.push({
            text: token,
            status: 'missing-value',
            tooltip: `Requires a value: ${def.metavar || 'VALUE'}`
          })
        } else {
          result.push({ text: token, status: 'ok' })
        }
        i++
      } else if (def.type === 'value') {
        const next = tokens[i + 1]
        if (next !== undefined && !next.startsWith('--')) {
          result.push({ text: token, status: 'ok' })
          result.push({ text: next, status: 'ok' })
          i += 2
        } else if (isLast) {
          result.push({
            text: token,
            status: 'awaiting-value',
            tooltip: `Next: provide ${def.metavar || 'VALUE'}`
          })
          i++
        } else {
          result.push({
            text: token,
            status: 'missing-value',
            tooltip: `Requires a value: ${def.metavar || 'VALUE'}`
          })
          i++
        }
      } else if (def.type === 'multi-value') {
        result.push({ text: token, status: 'ok' })
        i++
        while (i < tokens.length && !tokens[i]!.startsWith('--')) {
          result.push({ text: tokens[i]!, status: 'ok' })
          i++
        }
      } else {
        result.push({ text: token, status: 'ok' })
        i++
        if (def.type === 'optional-value' && i < tokens.length && !tokens[i]!.startsWith('--')) {
          result.push({ text: tokens[i]!, status: 'ok' })
          i++
        }
      }
    } else {
      result.push({
        text: token,
        status: 'orphaned',
        tooltip: 'Unexpected positional argument — use --flag syntax'
      })
      i++
    }
  }

  if (opts.suppressTrailingPartial && result.length > 0 && raw.trimEnd() === raw) {
    const last = result[result.length - 1]!
    const lastToken = tokens[tokens.length - 1]
    if (last.text === lastToken && last.text.startsWith('-') && last.status === 'unsupported') {
      last.status = 'partial'
      delete last.tooltip
    }
  }

  const unsupportedFlags = result
    .filter((t) => t.status === 'unsupported' && t.text.startsWith('--'))
    .map((t) => t.text.slice(2).split('=')[0]!)
  const missingValueFlags = result.filter((t) => t.status === 'missing-value').map((t) => t.text)
  const orphanedTokens = result.filter((t) => t.status === 'orphaned').map((t) => t.text)
  const awaiting = result.find((t) => t.status === 'awaiting-value') ?? null

  return {
    tokens: result,
    unsupportedFlags,
    missingValueFlags,
    orphanedTokens,
    awaiting,
    hasIssues:
      unsupportedFlags.length > 0 || missingValueFlags.length > 0 || orphanedTokens.length > 0
  }
}

export function serialize(
  known: Map<string, string>,
  extra: string[],
  schema: ComfyArgDef[]
): string {
  const multiValue = new Set(schema.filter((a) => a.type === 'multi-value').map((a) => a.name))
  const parts: string[] = []
  for (const [name, value] of known) {
    parts.push(`--${name}`)
    if (value !== '') {
      parts.push(multiValue.has(name) || !value.includes(' ') ? value : `"${value}"`)
    }
  }
  parts.push(...extra.map((e) => (e.includes(' ') ? `"${e}"` : e)))
  return parts.join(' ')
}
