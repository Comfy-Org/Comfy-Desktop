import { createHash } from 'node:crypto'
import { relative, resolve } from 'node:path'
import type { Rule } from 'eslint'
import type { AST } from 'vue-eslint-parser'

import exceptions from './vue-style-exceptions.json'

const root = resolve(import.meta.dirname, '../..')
const allowed: Record<string, { sha256: string; reason: string }> = exceptions

// Hash the complete block, including attributes. Ignore only checkout line
// endings so the same source is accepted on Windows and Unix.
export function fingerprintStyleBlock(block: string) {
  return createHash('sha256').update(block.replace(/\r\n/g, '\n')).digest('hex')
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Require Tailwind utilities instead of new Vue SFC style blocks' },
    schema: [],
    messages: {
      forbidden:
        'Do not add or expand Vue <style> blocks. Use Tailwind utilities. Existing exceptions are frozen in scripts/eslint/vue-style-exceptions.json.'
    }
  },
  create(context) {
    const source = context.sourceCode
    const getDocumentFragment = source.parserServices.getDocumentFragment as
      | (() => AST.VDocumentFragment | null)
      | undefined
    if (!getDocumentFragment) return {}

    const file = relative(root, context.physicalFilename).split('\\').join('/')
    const exception = Object.hasOwn(allowed, file) ? allowed[file] : undefined

    return {
      Program() {
        // Consume the exception once: duplicating the original block must fail too.
        let available = exception?.sha256
        for (const block of getDocumentFragment()?.children ?? []) {
          if (block.type !== 'VElement' || block.name !== 'style') continue
          if (available === fingerprintStyleBlock(source.text.slice(...block.range))) {
            available = undefined
            continue
          }
          context.report({ loc: block.startTag.loc, messageId: 'forbidden' })
        }
      }
    }
  }
} satisfies Rule.RuleModule
