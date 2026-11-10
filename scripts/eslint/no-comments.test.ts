import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import { parser as tsParser } from 'typescript-eslint'
import vueParser from 'vue-eslint-parser'

import rule from './no-comments'

const ruleId = 'desktop/no-comments'
const linter = new Linter()
const plugins = { desktop: { rules: { 'no-comments': rule } } }
const rules = { [ruleId]: 'error' } as const
const configs = {
  ts: {
    files: ['**/*.ts'],
    languageOptions: { parser: tsParser },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    plugins,
    rules
  },
  vue: {
    files: ['**/*.vue'],
    languageOptions: { parser: vueParser, parserOptions: { parser: tsParser } },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    plugins,
    rules
  }
} satisfies Record<string, Linter.Config>

function lint(source: string, kind: keyof typeof configs = 'ts') {
  return linter.verify(source, configs[kind], { filename: `file.${kind}` })
}

function fix(source: string, kind: keyof typeof configs = 'ts') {
  return linter.verifyAndFix(source, configs[kind], { filename: `file.${kind}` })
}

describe('no comments', () => {
  it.each([
    [
      'line comment on its own line',
      'const a = 1\n// note\nconst b = 2\n',
      'const a = 1\nconst b = 2\n'
    ],
    ['trailing line comment', 'const a = 1 // note\n', 'const a = 1\n'],
    ['block comment', '/* note */\nconst a = 1\n', 'const a = 1\n'],
    ['JSDoc', '/**\n * Adds.\n */\nexport function add() {}\n', 'export function add() {}\n'],
    [
      'indented comment',
      'function f() {\n  // note\n  return 1\n}\n',
      'function f() {\n  return 1\n}\n'
    ],
    ['inline block comment', 'f(/* a */ 1)\n', 'f(1)\n'],
    ['comment between tokens', 'const a =/**/1\n', 'const a = 1\n'],
    [
      'CRLF line comment',
      'const a = 1\r\n// note\r\nconst b = 2\r\n',
      'const a = 1\r\nconst b = 2\r\n'
    ],
    ['comment at end of file', 'const a = 1\n// note', 'const a = 1\n']
  ])('removes a %s', (_, source, expected) => {
    expect(lint(source)).toEqual([expect.objectContaining({ ruleId, severity: 2 })])
    expect(fix(source).output).toBe(expected)
  })

  it.each([
    '// eslint-disable-next-line no-console\nconsole.log(1)\n',
    '/* eslint-disable no-console */\nconsole.log(1)\n',
    'console.log(1) // eslint-disable-line no-console\n',
    '// @ts-expect-error\nconst a: string = 1\n',
    '// @ts-nocheck\nconst a = 1\n',
    '/// <reference types="vite/client" />\nconst a = 1\n',
    '// @vitest-environment node\nconst a = 1\n',
    '// prettier-ignore\nconst a = [1,2]\n',
    'const m = await import(/* @vite-ignore */ path)\n',
    'const v = /* @__PURE__ */ make()\n',
    '/* v8 ignore next */\nconst a = 1\n',
    '#!/usr/bin/env node\nconst a = 1\n'
  ])('keeps the tool directive in %s', (source) => {
    expect(lint(source)).toEqual([])
  })

  it('strips a prose reason from a lint directive', () => {
    const result = fix('// eslint-disable-next-line no-console -- debugging\nconsole.log(1)\n')
    expect(result.output).toBe('// eslint-disable-next-line no-console\nconsole.log(1)\n')
  })

  it('strips a prose reason from a block lint directive', () => {
    const result = fix('/* eslint-disable no-console -- debugging */\nconsole.log(1)\n')
    expect(result.output).toBe('/* eslint-disable no-console */\nconsole.log(1)\n')
  })

  it.each([
    [
      '// @ts-expect-error -- testing a bad value\nconst a: string = 1\n',
      '// @ts-expect-error\nconst a: string = 1\n'
    ],
    [
      '// @ts-expect-error testing a bad value\nconst a: string = 1\n',
      '// @ts-expect-error\nconst a: string = 1\n'
    ],
    [
      '<template>\n  <!-- eslint-disable-next-line vue/no-v-html -- trusted -->\n  <div v-html="x" />\n</template>\n',
      '<template>\n  <!-- eslint-disable-next-line vue/no-v-html -->\n  <div v-html="x" />\n</template>\n'
    ]
  ])('strips the prose reason from %s', (source, expected) => {
    expect(fix(source, source.startsWith('<') ? 'vue' : 'ts').output).toBe(expected)
  })

  it('ignores comment syntax inside strings and templates', () => {
    expect(lint("const a = '// not a comment'\nconst b = `/* nor this */`\n")).toEqual([])
  })

  it('removes script, template, and top-level comments from Vue files', () => {
    const source = [
      '<!-- top -->',
      '<script setup lang="ts">',
      '// script',
      'const a = 1',
      '</script>',
      '<template>',
      '  <!-- template -->',
      '  <div>{{ a }}</div>',
      '</template>',
      ''
    ].join('\n')
    expect(lint(source, 'vue')).toHaveLength(3)
    expect(fix(source, 'vue').output).toBe(
      [
        '<script setup lang="ts">',
        'const a = 1',
        '</script>',
        '<template>',
        '  <div>{{ a }}</div>',
        '</template>',
        ''
      ].join('\n')
    )
  })

  it('keeps Vue template lint directives', () => {
    const source =
      '<template>\n  <!-- eslint-disable-next-line vue/no-v-html -->\n  <div v-html="x" />\n</template>\n'
    expect(lint(source, 'vue')).toEqual([])
  })
})

describe('no comments with allowDocComments', () => {
  const apiSpec = {
    ...configs.ts,
    rules: { [ruleId]: ['error', { allowDocComments: true }] }
  } satisfies Linter.Config

  function lintApiSpec(source: string) {
    return linter.verify(source, apiSpec, { filename: 'file.ts' })
  }

  it.each([
    ['multi-line JSDoc', '/**\n * Adds.\n */\nexport function add() {}\n'],
    ['one-line JSDoc on a member', 'export interface A {\n  /** The id. */\n  id: string\n}\n']
  ])('keeps a %s', (_, source) => {
    expect(lintApiSpec(source)).toEqual([])
  })

  it.each([
    ['line comment', 'const a = 1\n// note\nconst b = 2\n'],
    ['block comment', '/* note */\nconst a = 1\n'],
    ['empty block comment', 'const a =/**/1\n']
  ])('still rejects a %s', (_, source) => {
    expect(lintApiSpec(source)).toEqual([expect.objectContaining({ ruleId, severity: 2 })])
  })
})
