import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import { parser as tsParser } from 'typescript-eslint'
import vueParser from 'vue-eslint-parser'

import rule from './product-link-utm'

const ruleId = 'desktop/product-link-utm'
const linter = new Linter()
const plugins = { desktop: { rules: { 'product-link-utm': rule } } }
const rules = { [ruleId]: 'error' } as const
const configs = {
  ts: {
    files: ['**/*.ts'],
    languageOptions: { parser: tsParser },
    plugins,
    rules
  },
  vue: {
    files: ['**/*.vue'],
    languageOptions: { parser: vueParser, parserOptions: { parser: tsParser } },
    plugins,
    rules
  }
} satisfies Record<string, Linter.Config>

function lint(source: string, kind: keyof typeof configs = 'ts') {
  return linter.verify(source, configs[kind], { filename: `file.${kind}` })
}

function messageIds(source: string, kind: keyof typeof configs = 'ts') {
  return lint(source, kind).map((message) => message.messageId)
}

describe('product link utm', () => {
  it.each([
    "const a = 'https://comfy.org'\n",
    "const a = 'https://comfy.org/hub/workflows/x'\n",
    "const a = 'http://www.comfy.org/pricing'\n",
    "const a = 'https://docs.comfy.org/get_started'\n",
    "const a = 'https://blog.comfy.org/p/news'\n",
    "const a = 'https://registry.comfy.org/nodes'\n",
    "const a = 'https://Docs.Comfy.org/x'\n",
    "const a = 'See https://docs.comfy.org/x for details'\n",
    'const a = `https://comfy.org/hub/workflows/${id}`\n',
    'const a = `${base} and https://docs.comfy.org/x`\n',
    "open(productLink(other, 'help_tip') + 'https://comfy.org')\n",
    "productLink(base, 'https://comfy.org')\n"
  ])('reports an untagged link in %j', (source) => {
    expect(messageIds(source)).toContain('untagged')
  })

  it.each([
    "const a = productLink('https://comfy.org/hub', 'home_card')\n",
    "const a = links.productLink('https://docs.comfy.org/x', 'help_tip')\n",
    "const a = productLink(`https://comfy.org/hub/workflows/${id}`, 'workflow_dialog')\n",
    "const a = 'https://desktop-assets.comfy.org/standalone'\n",
    "const a = 'https://api.comfy.org/nodes'\n",
    "const a = 'https://cloud.comfy.org/'\n",
    "const a = 'https://platform.comfy.org/profile'\n",
    "const a = 'https://media.comfy.org/x.png'\n",
    "const a = 'https://comfy.org.example.com/'\n",
    "const a = 'https://comfy.organic.com/'\n",
    "const a = 'https://notcomfy.org/'\n",
    "const a = 'support@comfy.org'\n",
    "const a = 'docs.comfy.org'\n",
    "const a = 'https://github.com/Comfy-Org/ComfyUI'\n"
  ])('accepts %j', (source) => {
    expect(lint(source)).toEqual([])
  })

  it.each(['Home_Card', 'home-card', 'homeCard', 'home__card', '_home', 'home_', ''])(
    'reports the campaign %j that is not snake_case',
    (campaign) => {
      const source = `productLink(url, '${campaign}')\n`
      expect(lint(source)).toEqual([
        expect.objectContaining({ ruleId, messageId: 'campaign', severity: 2 })
      ])
    }
  )

  it.each(['home_card', 'release_notes', 'upgrade_button_2', 'help'])(
    'accepts the snake_case campaign %j',
    (campaign) => {
      expect(lint(`productLink(url, '${campaign}')\n`)).toEqual([])
      expect(lint(`productLink(url, \`${campaign}\`)\n`)).toEqual([])
    }
  )

  it('leaves a computed campaign to the caller', () => {
    expect(lint('productLink(url, campaign)\n')).toEqual([])
  })

  it('points to productLink and the convention', () => {
    const [message] = lint("const a = 'https://comfy.org'\n")
    expect(message?.message).toContain('productLink')
    expect(message?.message).toContain('src/shared/productLink.ts')
    expect(message?.message).toContain(
      'https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/docs/guidance/product-links.md'
    )
  })

  it('honours an eslint-disable-next-line directive', () => {
    const source = `// eslint-disable-next-line ${ruleId}\nconst origin = 'https://comfy.org'\n`
    expect(lint(source)).toEqual([])
  })

  describe('in a Vue component', () => {
    it.each([
      '<template><a href="https://comfy.org/pricing">Pricing</a></template>\n',
      '<template><a :href="\'https://docs.comfy.org/x\'">Docs</a></template>\n',
      '<template><a :href="`https://comfy.org/hub/${id}`">Hub</a></template>\n',
      '<template><a @click="open(\'https://blog.comfy.org\')">Blog</a></template>\n',
      '<script setup lang="ts">\nconst docs = \'https://docs.comfy.org/x\'\n</script>\n'
    ])('reports an untagged link in %j', (source) => {
      expect(messageIds(source, 'vue')).toEqual(['untagged'])
    })

    it.each([
      "<template><a :href=\"productLink('https://comfy.org/pricing', 'pricing_link')\">P</a></template>\n",
      '<template><img src="https://media.comfy.org/x.png" /></template>\n',
      '<template><a href="https://github.com/Comfy-Org">GitHub</a></template>\n',
      '<template><p>Write to support@comfy.org</p></template>\n',
      "<script setup lang=\"ts\">\nconst docs = productLink('https://docs.comfy.org/x', 'help_tip')\n</script>\n"
    ])('accepts %j', (source) => {
      expect(lint(source, 'vue')).toEqual([])
    })

    it('reports a campaign that is not snake_case inside the template', () => {
      const source = '<template><a :href="productLink(url, \'PricingLink\')">P</a></template>\n'
      expect(messageIds(source, 'vue')).toEqual(['campaign'])
    })
  })
})
