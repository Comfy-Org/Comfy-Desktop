import { resolve } from 'node:path'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const ruleId = 'better-tailwindcss/enforce-canonical-classes'

const eslint = new ESLint({
  cwd: root,
  overrideConfig: {
    languageOptions: { parserOptions: { projectService: false } }
  }
})

const fixer = new ESLint({
  cwd: root,
  fix: true,
  overrideConfig: {
    languageOptions: { parserOptions: { projectService: false } }
  }
})

describe('canonical Tailwind classes in the project ESLint configuration', () => {
  it('rejects equivalent arbitrary classes using the application theme', async () => {
    const source =
      '<template><div class="rounded-[14px] p-[16px] duration-[120ms] z-[1]" /></template>'
    const [result] = await eslint.lintText(source, {
      filePath: 'src/renderer/src/CanonicalClasses.vue'
    })

    expect(result?.messages).toHaveLength(4)
    expect(result?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId,
          severity: 2,
          message: expect.stringContaining('rounded-shell')
        }),
        expect.objectContaining({ ruleId, severity: 2, message: expect.stringContaining('p-4') }),
        expect.objectContaining({
          ruleId,
          severity: 2,
          message: expect.stringContaining('duration-120')
        }),
        expect.objectContaining({ ruleId, severity: 2, message: expect.stringContaining('z-1') })
      ])
    )

    const [fixed] = await fixer.lintText(source, {
      filePath: 'src/renderer/src/CanonicalClasses.vue'
    })
    expect(fixed?.output).toBe(
      '<template><div class="rounded-shell p-4 duration-120 z-1" /></template>'
    )
    expect(fixed?.messages).toEqual([])
  })

  it('fixes bound strings, conditional classes, and shared class constants', async () => {
    const source = `<script setup lang="ts">
const CARD_CLASS = 'p-[16px]'
const stateClasses = { 'z-[1]': true }
const variantClass = { compact: 'rounded-[14px]' }
</script>
<template>
  <div :class="[CARD_CLASS, stateClasses, variantClass.compact, true ? 'duration-[120ms]' : 'duration-150', { 'h-[22px]': true }]" />
</template>`
    const [fixed] = await fixer.lintText(source, {
      filePath: 'src/renderer/src/CanonicalClasses.vue'
    })

    expect(fixed?.output).toContain("const CARD_CLASS = 'p-4'")
    expect(fixed?.output).toContain("const stateClasses = { 'z-1': true }")
    expect(fixed?.output).toContain("const variantClass = { compact: 'rounded-shell' }")
    expect(fixed?.output).toContain("true ? 'duration-120' : 'duration-150'")
    expect(fixed?.output).toContain("{ 'h-5.5': true }")
    expect(fixed?.messages).toEqual([])
  })

  it('fixes class constants in renderer TypeScript files', async () => {
    const [fixed] = await fixer.lintText("export const LINK_CLASS = 'p-[16px]'", {
      filePath: 'src/renderer/src/CanonicalClasses.ts'
    })

    expect(fixed?.output).toBe("export const LINK_CLASS = 'p-4'")
    expect(fixed?.messages).toEqual([])
  })

  it('fixes classes passed to component and transition props', async () => {
    const [fixed] = await fixer.lintText(
      '<template><div content-class="max-w-[620px]" :overlay-class="[\'z-[1000]\']" enter-from-class="opacity-0 [transform:translateY(4px)]" /></template>',
      { filePath: 'src/renderer/src/CanonicalClasses.vue' }
    )

    expect(fixed?.output).toBe(
      '<template><div content-class="max-w-155" :overlay-class="[\'z-1000\']" enter-from-class="opacity-0 transform-[translateY(4px)]" /></template>'
    )
    expect(fixed?.messages).toEqual([])
  })

  it('uses existing color and radius aliases without changing typography', async () => {
    const [fixed] = await fixer.lintText(
      '<template><div class="hover:bg-[var(--surface)] border-[var(--border)] focus-visible:outline-[var(--focus-ring)] rounded-[var(--radius-control)] text-[13px]/5 sm:text-[22px]/[30px]" /></template>',
      { filePath: 'src/renderer/src/CanonicalClasses.vue' }
    )

    expect(fixed?.output).toBe(
      '<template><div class="hover:bg-surface border-border focus-visible:outline-focus-ring rounded-control text-[13px]/5 sm:text-[22px]/[30px]" /></template>'
    )
    expect(fixed?.messages).toEqual([])
  })

  it('preserves arbitrary values, independent utilities, and unrelated strings', async () => {
    const source = `<script setup lang="ts">
const label = 'p-[16px]'
</script>
<template>
  <div :aria-label="label" class="w-[calc(100%-3px)] bg-[rgb(137_137_137/0.05)] text-[13px] leading-[1.45] h-4 w-4 ml-2 mr-2">{{ label }}</div>
</template>`
    const [result] = await fixer.lintText(source, {
      filePath: 'src/renderer/src/CanonicalClasses.vue'
    })

    expect(result?.output).toBeUndefined()
    expect(result?.messages).toEqual([])
  })

  it('preserves variable syntax understood by the design-system class merger', async () => {
    const source =
      '<template><div class="text-[length:var(--takeover-fs-body)] [font-family:inherit] font-[family-name:monospace] font-[family-name:var(--font-mono,monospace)] w-[var(--base-modal-width,640px)] min-w-[var(--reka-select-trigger-width)] size-[var(--takeover-logo-size)] gap-[var(--takeover-gap-md)]" /></template>'
    const [result] = await fixer.lintText(source, {
      filePath: 'src/renderer/src/CanonicalClasses.vue'
    })

    expect(result?.output).toBeUndefined()
    expect(result?.messages).toEqual([])
  })

  it('does not apply the renderer theme to main-process code', async () => {
    const [result] = await fixer.lintText("export const LINK_CLASS = 'p-[16px]'", {
      filePath: 'src/main/CanonicalClasses.ts'
    })

    expect(result?.output).toBeUndefined()
    expect(result?.messages).toEqual([])
  })
})
