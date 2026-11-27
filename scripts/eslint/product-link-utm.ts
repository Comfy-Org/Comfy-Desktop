import type { Rule } from 'eslint'
import type { AST } from 'vue-eslint-parser'

const CONVENTION_URL =
  'https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/docs/guidance/product-links.md'

const COMFY_LINK = /https?:\/\/(?:www\.|docs\.|blog\.|registry\.)?comfy\.org(?![\w.-])/i
const SNAKE_CASE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/
const HELPER = 'productLink'

type CallNode = Rule.Node & { type: 'CallExpression' }
type ArgumentNode = CallNode['arguments'][number]

function containsComfyLink(text: string): boolean {
  return COMFY_LINK.test(text)
}

function isHelperCall(node: Rule.Node | null | undefined): node is CallNode {
  if (!node || node.type !== 'CallExpression') return false
  const callee = node.callee
  if (callee.type === 'Identifier') return callee.name === HELPER
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    callee.property.name === HELPER
  )
}

function isHelperUrlArgument(node: Rule.Node): boolean {
  const call = node.parent
  return isHelperCall(call) && call.arguments[0] === node
}

function staticCampaign(node: ArgumentNode | undefined): string | null {
  if (!node) return null
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null
  }
  return null
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: `Require comfy.org links to go through ${HELPER} so they carry UTM parameters`
    },
    schema: [],
    messages: {
      untagged: `Wrap this comfy.org link in ${HELPER}(url, 'place_in_app') from src/shared/productLink.ts so it carries UTM parameters. See ${CONVENTION_URL}`,
      campaign: `The ${HELPER} campaign '{{campaign}}' must be snake_case and name the place in the app. See ${CONVENTION_URL}`
    }
  },
  create(context) {
    function checkLiteral(node: Rule.Node) {
      if (node.type !== 'Literal' || typeof node.value !== 'string') return
      if (!containsComfyLink(node.value)) return
      if (isHelperUrlArgument(node)) return
      context.report({ node, messageId: 'untagged' })
    }

    function checkTemplateElement(node: Rule.Node) {
      if (node.type !== 'TemplateElement') return
      if (!containsComfyLink(node.value.cooked ?? node.value.raw)) return
      const template = node.parent
      if (template.type === 'TemplateLiteral' && isHelperUrlArgument(template)) return
      context.report({ node, messageId: 'untagged' })
    }

    function checkCall(node: Rule.Node) {
      if (!isHelperCall(node)) return
      const argument = node.arguments[1]
      const campaign = staticCampaign(argument)
      if (argument && campaign !== null && !SNAKE_CASE.test(campaign)) {
        context.report({ node: argument, messageId: 'campaign', data: { campaign } })
      }
    }

    function checkVLiteral(node: AST.VLiteral) {
      if (!containsComfyLink(node.value)) return
      context.report({ loc: node.loc, messageId: 'untagged' })
    }

    const scriptVisitor: Rule.RuleListener = {
      Literal: checkLiteral,
      TemplateElement: checkTemplateElement,
      CallExpression: checkCall
    }

    const defineTemplateBodyVisitor = context.sourceCode.parserServices
      ?.defineTemplateBodyVisitor as
      | ((template: Record<string, unknown>, script: Rule.RuleListener) => Rule.RuleListener)
      | undefined
    if (!defineTemplateBodyVisitor) return scriptVisitor
    return defineTemplateBodyVisitor(
      {
        Literal: checkLiteral,
        TemplateElement: checkTemplateElement,
        CallExpression: checkCall,
        VLiteral: checkVLiteral
      },
      scriptVisitor
    )
  }
} satisfies Rule.RuleModule
