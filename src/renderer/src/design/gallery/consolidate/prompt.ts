import { THEME_FILE, THEME_TEXT as tokensSrc } from '../config'
import { snippetsOf, usageOf } from '../inspect/usage'
import { TOKENS, tokensIn, type Token } from '../tokens'
import { mergedInto, valueOf } from '../tweaks'
import {
  GROUP_LABEL,
  rulesFor,
  type ConsolidateGroup,
  type Plan,
  type RuleSetting,
  type Rule
} from './rules'

/**
 * "Ask your agent": a self-contained prompt for a coding agent that asks
 * for a consolidation strategy for one token group. It carries every token
 * with its value, intent comment, usage and real code lines, the gallery's
 * constraints, and what the rules propose today, and asks for an answer
 * that maps one-to-one onto the gallery's merge-by-hand controls.
 */

/** The declaration's trailing comment in tokens.css: the token's intent. */
const intentOf = (t: Token): string =>
  new RegExp(`--${t.name}:[^;]+;\\s*/\\*\\s*(.*?)\\s*\\*/`).exec(tokensSrc)?.[1] ?? ''

const CONSTRAINTS: Record<ConsolidateGroup, string[]> = {
  color: [
    'Select by role, not by looks: only merge tokens that do the same job (text with text, border with border, surface with surface).',
    'Compare colors in OKLCH. ΔE (OKLab ×100) under 2 is indistinguishable.',
    'A tint (alpha < 1) and a solid color are not interchangeable: a tint changes with what is under it.',
    'Keep deliberate state pairs (x / x-hover) together; merge them only as a pair.'
  ],
  text: [
    'Font sizes are whole pixels and at least 12px. Each size carries its line-height (token--line-height), which sits on the 4px grid.',
    'Keep enough steps for hierarchy (label, body, heading, title); adjacent sizes under 2px apart read as the same.'
  ],
  radius: [
    'Radii sit on the 4px grid. Nesting rule: inner radius = outer radius − padding between them.',
    'Keep one radius per role (control, card, panel, …).'
  ],
  shadow: [
    'Shadows express elevation by role (resting card, hovered card, floating chrome, popover, dialog). Keep one per distinct elevation level.',
    'Keep deliberate state pairs (elev / elev-hover) together.',
    'The UI is dark: shadows read mostly through the inset top highlight and the size of the falloff, so tokens with similar falloff are candidates to merge.'
  ]
}

function tokenBlock(t: Token): string {
  const u = usageOf(t)
  const lh = TOKENS.find((o) => o.name === `${t.name}--line-height`)
  const value = lh ? `${valueOf(t)} / line-height ${valueOf(lh)}` : valueOf(t)
  const lines = [
    `### ${t.name}`,
    `- value: \`${value}\``,
    intentOf(t) && `- intent (comment in tokens.css): ${intentOf(t)}`,
    `- used ${u.total}× in ${u.files.length} ${u.files.length === 1 ? 'file' : 'files'}`,
    ...u.files.slice(0, 6).map((f) => `  - ${f.path} (${f.count}×: ${f.utilities.join(', ')})`),
    u.files.length > 6 ? `  - …and ${u.files.length - 6} more files` : '',
    ...snippetsOf(t).map((s) => `  - \`${s.path}:${s.line}\` → \`${s.code}\``)
  ]
  return lines.filter(Boolean).join('\n')
}

function proposalBlock(
  plan: Plan,
  settings: (r: Rule) => RuleSetting,
  g: ConsolidateGroup
): string {
  const rules = rulesFor(g)
    .filter((r) => settings(r).on)
    .map(
      (r) =>
        `- ${r.title}${r.param ? ` (${r.param.label}: ${settings(r).value} ${r.param.unit})` : ''}`
    )
  const merges = [...plan.merges.values()].map(
    (m) =>
      `- merge ${m.from.name} → ${m.into.name} (${(plan.reasons.get(m.from.name) ?? []).join('; ')})`
  )
  const sets = [...plan.sets.values()].map((s) => `- set ${s.token.name} to ${s.value}`)
  const flagged = [...plan.flagged.values()].map(
    (f) => `- unsure: ${f.token.name} (${(plan.reasons.get(f.token.name) ?? []).join('; ')})`
  )
  const body = [...merges, ...sets, ...flagged]
  return [
    'Rules enabled in the gallery:',
    ...rules,
    '',
    body.length
      ? 'What those rules propose (a starting point, not a decision):'
      : 'Those rules propose no changes.',
    ...body
  ].join('\n')
}

export function buildAdvicePrompt(
  g: ConsolidateGroup,
  plan: Plan,
  settings: (r: Rule) => RuleSetting
): string {
  const label = GROUP_LABEL[g]
  const tokens = tokensIn(g).filter((t) => !mergedInto(t))
  const example =
    tokens.length > 1
      ? `{ "from": "${tokens[tokens.length - 1]!.name}", "into": "${tokens[0]!.name}" }`
      : `{ "from": "<token>", "into": "<token>" }`
  return [
    `# Suggest how to consolidate the ${label.toLowerCase()} tokens`,
    '',
    `I maintain a small design system (Vue 3 + Tailwind CSS v4). Tokens are \`@theme\` custom properties in \`${THEME_FILE}\`; components use them as Tailwind utilities (e.g. \`shadow-elev\`, \`text-ui\`, \`rounded-card\`, \`bg-card-background\`). There are ${tokens.length} ${label.toLowerCase()} tokens and I think that's too many, but I can't tell the best merging strategy. Recommend one.`,
    '',
    'You can read the repository for more context. Do not edit any files: this is a recommendation.',
    '',
    '## Constraints',
    ...CONSTRAINTS[g].map((c) => `- ${c}`),
    '- Prefer keeping the more-used token when two are equivalent, unless the other has the clearer name for the role.',
    '- Fewer tokens is the goal, but never at the cost of a visible role disappearing.',
    '',
    `## The ${tokens.length} tokens, with usage and code context`,
    '',
    ...tokens.map(tokenBlock).join('\n\n').split('\n'),
    '',
    '## What the automatic rules suggest',
    proposalBlock(plan, settings, g),
    '',
    '## Answer in this format',
    '1. **Strategy**: 2-3 sentences. Which roles remain and why.',
    '2. **Decisions**: a table `Token | Decision (keep / merge into X / set value to V) | Why`. One row per token above.',
    '3. **Result**: the final token list, one line each: name, value, role.',
    '4. **Risks**: where a merge would visibly change something, with file paths from the context above.',
    "5. **Plan** as JSON, so I can apply it with the gallery's merge-by-hand controls:",
    '```json',
    `{ "group": "${g}", "merges": [${example}], "values": [] }`,
    '```'
  ].join('\n')
}

export async function copyAdvicePrompt(
  g: ConsolidateGroup,
  plan: Plan,
  settings: (r: Rule) => RuleSetting
): Promise<void> {
  await navigator.clipboard.writeText(buildAdvicePrompt(g, plan, settings))
}
