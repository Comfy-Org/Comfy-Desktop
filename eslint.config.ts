import pluginJs from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import betterTailwindcss from 'eslint-plugin-better-tailwindcss'
import unusedImports from 'eslint-plugin-unused-imports'
import pluginVue from 'eslint-plugin-vue'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import { configs as tseslintConfigs, parser as tseslintParser } from 'typescript-eslint'
import vueParser from 'vue-eslint-parser'

import noComments from './scripts/eslint/no-comments'
import noNewVueStyleBlocks from './scripts/eslint/no-new-vue-style-blocks'

const extraFileExtensions = ['.vue']

const publishedApiSpecs = ['./src/types/comfyDesktopBridge.ts']

const useOpenExternalHelper =
  'Use openExternalUrl or tryOpenExternalUrl from src/main/lib/openExternal.ts. They hand the OS only http, https and mailto links.'

const desktop = {
  rules: { 'no-comments': noComments, 'no-new-vue-style-blocks': noNewVueStyleBlocks }
}

const commonParserOptions = {
  parser: tseslintParser,
  projectService: true,
  tsconfigRootDir: import.meta.dirname,
  ecmaVersion: 2020,
  sourceType: 'module',
  extraFileExtensions
} as const

export default defineConfig([
  {
    ignores: [
      'out/*',
      'dist/*',
      'node_modules/*',
      '.claude/**',
      '.worktrees/**',
      'packages/comfyui-desktop-bridge-types/*.d.ts'
    ]
  },
  {
    files: ['./**/*.{ts,mts}'],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        ...commonParserOptions,
        projectService: {
          allowDefaultProject: ['eslint.config.ts', 'vitest.config.ts', 'vitest.setup.ts']
        }
      }
    }
  },
  {
    files: ['./scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.node }
    }
  },
  {
    files: ['./**/*.vue'],
    plugins: { desktop },
    rules: { 'desktop/no-new-vue-style-blocks': 'error' },
    languageOptions: {
      globals: { ...globals.browser },
      parser: vueParser,
      parserOptions: commonParserOptions
    }
  },
  pluginJs.configs.recommended,
  tseslintConfigs.recommended,
  pluginVue.configs['flat/recommended'],
  eslintConfigPrettier,
  {
    files: ['./src/renderer/**/*.{ts,vue}'],
    plugins: { 'better-tailwindcss': betterTailwindcss },
    settings: {
      'better-tailwindcss': {
        cwd: import.meta.dirname,
        entryPoint: './src/renderer/src/assets/main.css',
        rootFontSize: 16,
        selectors: {
          extends: [
            {
              kind: 'attribute',
              name: '^(?:v-bind:)?[\\w-]+(?:-class|Class)$',
              match: [{ type: 'strings' }, { type: 'objectKeys' }]
            },
            {
              kind: 'variable',
              name: '^.*(?:Class(?:es|Names?)?|_CLASS(?:ES|_NAMES?)?)$',
              match: [{ type: 'strings' }, { type: 'objectKeys' }, { type: 'objectValues' }]
            }
          ]
        }
      }
    },
    rules: {
      'better-tailwindcss/enforce-canonical-classes': [
        'error',
        {
          collapse: false,
          logical: false,
          ignore: [
            '(?:^|:)text-\\[length:var\\(',
            '(?:^|:)\\[font-family:',
            '(?:^|:)font-\\[family-name:',
            '(?:^|:)font-\\[(?:family-name:)?var\\(',
            '(?:^|:)(?:size|(?:min-|max-)?[wh]|gap(?:-[xy])?)-\\[var\\('
          ]
        }
      ],
      'better-tailwindcss/no-restricted-classes': [
        'error',
        {
          restrict: [
            {
              pattern:
                '^(.*:)?(bg|text|border(?:-[trbl])?|outline)-\\(--(bg|text(?:-muted)?|surface|border(?:-hover)?|danger(?:-hover)?|accent-hover|selected|terminal-bg|comfy-yellow|focus-ring|neutral-(?:50|100|200|300|400|500|600|700|800|900|950))\\)(/[^!]+)?(!?)$',
              fix: '$1$2-$3$4$5',
              message: 'Use the equivalent theme utility $1$2-$3$4$5.'
            },
            {
              pattern: '^(.*:)?rounded-\\(--radius-(shell|panel|card|control|min)\\)(!?)$',
              fix: '$1rounded-$2$3',
              message: 'Use the equivalent theme utility $1rounded-$2$3.'
            }
          ]
        }
      ]
    }
  },
  {
    plugins: {
      desktop,
      'unused-imports': unusedImports
    },
    rules: {
      'desktop/no-comments': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': false }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'always' }],
      'unused-imports/no-unused-imports': 'error',
      'vue/no-v-html': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/match-component-import-name': 'error',
      'vue/no-unused-properties': 'error',
      'vue/no-unused-refs': 'error',
      'vue/no-useless-mustaches': 'error',
      'vue/no-useless-v-bind': 'error',
      'vue/no-unused-emit-declarations': 'error',
      'vue/no-use-v-else-with-v-for': 'error',
      'vue/one-component-per-file': 'error'
    }
  },
  {
    files: publishedApiSpecs,
    rules: { 'desktop/no-comments': ['error', { allowDocComments: true }] }
  },
  {
    files: ['./src/main/**/*.ts'],
    ignores: ['./src/main/lib/webContentsViewLifetime.ts', './src/main/**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='WebContentsView']",
          message:
            'Create the view with createWebContentsView. Electron crashes the app at quit when a WebContentsView is garbage-collected while its webContents is alive.'
        }
      ]
    }
  },
  {
    files: ['./src/**/*.{ts,vue}'],
    ignores: ['./src/main/lib/openExternal.ts', './src/**/*.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'shell', property: 'openExternal', message: useOpenExternalHelper }
      ]
    }
  },
  {
    files: ['./src/{main,preload,shared}/**/*.ts'],
    ignores: ['./src/main/lib/openExternal.ts', './src/**/*.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { property: 'openExternal', message: useOpenExternalHelper }
      ]
    }
  },
  {
    files: ['./e2e/support/**/*.cjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  }
])
