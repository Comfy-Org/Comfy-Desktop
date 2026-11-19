<script setup lang="ts">
import rulesMd from '../../UI-RULES.md?raw'

/**
 * UI-RULES.md itself, read at build time, so the written rules and the
 * design system can't drift. A small reader for what the file uses:
 * headings, paragraphs, lists (a line indented under an item continues
 * it), **bold**, `code` and [links]. Links to other files show as words.
 */
type Inline = { kind: 'text' | 'strong' | 'code'; text: string }
type Block = { kind: 'h1' | 'h2' | 'p'; parts: Inline[] } | { kind: 'ul'; items: Inline[][] }

function inline(src: string): Inline[] {
  const out: Inline[] = []
  // Links read as their words; the targets are files beside UI-RULES.md.
  const text = src.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g
  let at = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > at) out.push({ kind: 'text', text: text.slice(at, m.index) })
    out.push(m[1] ? { kind: 'strong', text: m[1] } : { kind: 'code', text: m[2]! })
    at = m.index! + m[0].length
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) })
  return out
}

function parse(md: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  let list: string[] | null = null
  const flush = (): void => {
    if (para.length) blocks.push({ kind: 'p', parts: inline(para.join(' ')) })
    if (list) blocks.push({ kind: 'ul', items: list.map(inline) })
    para = []
    list = null
  }
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flush()
      continue
    }
    const head = /^(#{1,2}) (.*)$/.exec(line)
    if (head) {
      flush()
      blocks.push({ kind: head[1] === '#' ? 'h1' : 'h2', parts: inline(head[2]!) })
    } else if (line.startsWith('- ')) {
      if (para.length) flush()
      list ??= []
      list.push(line.slice(2))
    } else if (list && /^\s+/.test(line)) {
      list[list.length - 1] += ` ${line.trim()}`
    } else {
      if (list) flush()
      para.push(line.trim())
    }
  }
  flush()
  return blocks
}

const blocks = parse(rulesMd)
</script>

<template>
  <article class="ds-doc ds-rules-doc">
    <template v-for="(b, i) in blocks" :key="i">
      <ul v-if="b.kind === 'ul'">
        <li v-for="(item, j) in b.items" :key="j">
          <template v-for="(p, k) in item" :key="k"
            ><strong v-if="p.kind === 'strong'">{{ p.text }}</strong
            ><code v-else-if="p.kind === 'code'">{{ p.text }}</code
            ><template v-else>{{ p.text }}</template></template
          >
        </li>
      </ul>
      <component :is="b.kind" v-else :class="b.kind === 'h2' && 'ds-rules-title'">
        <template v-for="(p, k) in b.parts" :key="k"
          ><strong v-if="p.kind === 'strong'">{{ p.text }}</strong
          ><code v-else-if="p.kind === 'code'">{{ p.text }}</code
          ><template v-else>{{ p.text }}</template></template
        >
      </component>
    </template>
    <p class="ds-rules-src">
      Rendered from <code>mar/UI-RULES.md</code>; edit the file, not this page.
    </p>
  </article>
</template>

<style>
/* Section titles are uppercase labels (UI-RULES › Type). */
.ds-doc h2.ds-rules-title {
  margin-top: 32px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.ds-rules-doc ul {
  gap: 10px;
}
.ds-rules-src {
  margin-top: 32px;
  color: var(--color-subtle-foreground);
  font-size: 13px;
}
</style>
