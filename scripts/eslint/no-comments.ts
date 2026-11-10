import type { Rule } from 'eslint'
import type { AST } from 'vue-eslint-parser'

type CommentLike = { type: string; value: string; range: [number, number] }

const toolDirectives = [
  /^\s*(eslint-disable(-next-line|-line)?|eslint-enable)\b/,
  /^\s*(eslint|eslint-env|globals?|exported)\s/,
  /^\s*@ts-(expect-error|ignore|nocheck|check)\b/,
  /^\/\s*<(reference|amd-module)\b/,
  /^\s*prettier-ignore\b/,
  /^\s*(v8|c8|istanbul)\s+ignore\b/,
  /^\s*@vitest-environment\b/,
  /^\s*@vite-ignore\s*$/,
  /^\s*[#@]__(PURE|NO_SIDE_EFFECTS)__\s*$/
]

const directiveReasons = [
  /^\s*(?:eslint-disable(?:-next-line|-line)?|eslint-enable)\b.*?(\s+--\s.*?)\s*$/s,
  /^\s*@ts-(?:expect-error|ignore)\b(\s*\S.*?)\s*$/s
]

function isToolDirective(comment: CommentLike) {
  return comment.type === 'Shebang' || toolDirectives.some((pattern) => pattern.test(comment.value))
}

function isDocComment(comment: CommentLike) {
  return comment.type === 'Block' && comment.value.startsWith('*')
}

function openerLength(comment: CommentLike) {
  return comment.type.startsWith('HTML') ? 4 : 2
}

function directiveReason(comment: CommentLike): [number, number] | undefined {
  for (const pattern of directiveReasons) {
    const match = pattern.exec(comment.value)
    if (!match?.[1]) continue
    const start = comment.range[0] + openerLength(comment) + match[0].indexOf(match[1])
    return [start, start + match[1].length]
  }
  return undefined
}

function isBlank(text: string) {
  return /^\s*$/.test(text)
}

function removal(
  text: string,
  [start, end]: [number, number]
): { range: [number, number]; text: string } {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const newline = text.indexOf('\n', end)
  const lineEnd = newline === -1 ? text.length : newline
  const before = text.slice(lineStart, start)
  const after = text.slice(end, lineEnd)
  if (isBlank(before) && isBlank(after)) {
    return { range: [lineStart, newline === -1 ? text.length : newline + 1], text: '' }
  }
  if (isBlank(after)) {
    return { range: [start - (before.length - before.trimEnd().length), end], text: '' }
  }
  if (isBlank(before) || /^\s/.test(after)) {
    return { range: [start, end + (after.length - after.trimStart().length)], text: '' }
  }
  return { range: [start, end], text: ' ' }
}

export default {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: { description: 'Disallow code comments other than tool directives' },
    schema: [
      {
        type: 'object',
        properties: { allowDocComments: { type: 'boolean' } },
        additionalProperties: false
      }
    ],
    messages: {
      forbidden:
        'Do not write code comments. Make the code say it with names, functions, types, and tests. Rationale belongs in the commit message or PR description.',
      directiveReason:
        'Do not append a prose reason to a tool directive. Put the reason in the PR description.'
    }
  },
  create(context) {
    const source = context.sourceCode
    const text = source.text
    const allowDocComments = context.options[0]?.allowDocComments === true

    function check(comment: CommentLike) {
      if (allowDocComments && isDocComment(comment)) return
      const loc = {
        start: source.getLocFromIndex(comment.range[0]),
        end: source.getLocFromIndex(comment.range[1])
      }
      if (!isToolDirective(comment)) {
        const { range, text: replacement } = removal(text, comment.range)
        context.report({
          loc,
          messageId: 'forbidden',
          fix: (fixer) => fixer.replaceTextRange(range, replacement)
        })
        return
      }
      const reason = directiveReason(comment)
      if (!reason) return
      context.report({
        loc,
        messageId: 'directiveReason',
        fix: (fixer) => fixer.removeRange(reason)
      })
    }

    return {
      Program() {
        for (const comment of source.getAllComments()) check(comment as CommentLike)
        const getDocumentFragment = source.parserServices?.getDocumentFragment as
          | (() => AST.VDocumentFragment | null)
          | undefined
        for (const comment of getDocumentFragment?.()?.comments ?? []) {
          check(comment as CommentLike)
        }
      }
    }
  }
} satisfies Rule.RuleModule
