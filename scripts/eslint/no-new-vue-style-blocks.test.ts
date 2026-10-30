// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ESLint, Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import { parser as tsParser } from 'typescript-eslint'
import vueParser from 'vue-eslint-parser'

import rule from './no-new-vue-style-blocks'
import exceptions from './vue-style-exceptions.json'

const root = resolve(import.meta.dirname, '../..')
const ruleId = 'desktop/no-new-vue-style-blocks'
const linter = new Linter()
const config = {
  files: ['**/*.vue'],
  languageOptions: {
    parser: vueParser,
    parserOptions: { ecmaVersion: 'latest', parser: tsParser }
  },
  plugins: { desktop: { rules: { 'no-new-vue-style-blocks': rule } } },
  rules: { [ruleId]: 'error' }
} satisfies Linter.Config

function lint(source: string, file = 'src/renderer/src/NewComponent.vue') {
  return linter.verify(source, config, { filename: resolve(root, file) })
}

function expectForbidden(source: string, file?: string, count = 1) {
  const messages = lint(source, file)
  expect(messages).toHaveLength(count)
  for (const message of messages) {
    expect(message.ruleId).toBe(ruleId)
    expect(message.severity).toBe(2)
    expect(message.message).toContain('Use Tailwind utilities')
  }
}

const frozenFile = 'src/renderer/src/comfyTitlePopup/DownloadsFullView.vue'
const frozenSource = readFileSync(resolve(root, frozenFile), 'utf8')
const frozenBlock = frozenSource.slice(frozenSource.indexOf('<style>')).trim()

describe('no new Vue style blocks', () => {
  it.each([
    '<style>.new { color: red }</style>',
    '<style scoped>.new { color: red }</style>',
    '<style module>.new { color: red }</style>',
    '<style lang="scss">.new { color: red }</style>',
    '<style src="./new.css"></style>',
    '<style scoped src="./new.css" />',
    '<style/>',
    '<style\n scoped\n>.new { color: red }</style>',
    '<style>/* Empty and comment-only blocks are still new blocks. */</style>'
  ])('rejects %s', (block) => {
    expectForbidden(`<template><div /></template>\n${block}`)
  })

  it('reports every block at its opening tag', () => {
    const messages = lint('<template><div /></template>\n<style/>\n<style scoped/>')
    expect(messages.map(({ ruleId, line, column }) => ({ ruleId, line, column }))).toEqual([
      { ruleId, line: 2, column: 1 },
      { ruleId, line: 3, column: 1 }
    ])
  })

  it('ignores style text inside script strings, HTML comments, and template text', () => {
    expect(
      lint(`<script>const example = '<style scoped>.x {}</style>'</script>
<!-- <style src="./example.css" /> -->
<template><div>&lt;style&gt;</div></template>`)
    ).toEqual([])
  })

  it.each(Object.keys(exceptions))('preserves the exact exception in %s', (file) => {
    expect(lint(readFileSync(resolve(root, file), 'utf8'), file)).toEqual([])
  })

  it('accepts CRLF checkout line endings', () => {
    expect(lint(frozenSource.replace(/\n/g, '\r\n'), frozenFile)).toEqual([])
  })

  it('allows changing the template around an unchanged block', () => {
    expect(lint(`<template><main /></template>\n${frozenBlock}`, frozenFile)).toEqual([])
  })

  it('allows removing an exception without requiring replacement CSS', () => {
    expect(lint('<template><div /></template>', frozenFile)).toEqual([])
  })

  it.each([
    'src/renderer/src/NewComponent.vue',
    'src/renderer/src/comfyTitlePopup/NewComponent.vue',
    'src/renderer/src/views/DownloadsFullView.vue',
    'another-checkout/src/renderer/src/comfyTitlePopup/DownloadsFullView.vue'
  ])('does not transfer an exception to %s', (file) => {
    expectForbidden(frozenBlock, file)
  })

  it.each([
    frozenBlock.replace('32px', '64px'),
    frozenBlock.replace('</style>', '.new { color: red }\n</style>'),
    frozenBlock.replace('<style>', '<style scoped>'),
    '<style src="./replacement.css" />'
  ])('rejects modified exception content or attributes', (block) => {
    expectForbidden(block, frozenFile)
  })

  it.each(['<style>.new { color: red }</style>', frozenBlock])(
    'rejects additional blocks even in a file with an exception',
    (extra) => {
      expectForbidden(`${frozenBlock}\n${extra}`, frozenFile)
      expectForbidden(`${extra}\n${frozenBlock}`, frozenFile)
    }
  )

  it('enforces the rule through the actual project ESLint configuration', async () => {
    const eslint = new ESLint({ cwd: root })
    const [rejected] = await eslint.lintText('<template><div /></template>\n<style scoped/>', {
      filePath: 'src/renderer/src/views/LoadSnapshotModal.vue'
    })
    expect(rejected?.messages).toEqual([expect.objectContaining({ ruleId, severity: 2, line: 2 })])
    const [accepted] = await eslint.lintText(frozenSource, { filePath: frozenFile })
    expect(accepted?.messages.filter((message) => message.ruleId === ruleId)).toEqual([])
    const [expanded] = await eslint.lintText(`${frozenSource}\n<style src="./new.css"/>`, {
      filePath: frozenFile
    })
    expect(expanded?.messages.filter((message) => message.ruleId === ruleId)).toHaveLength(1)
  })
})
