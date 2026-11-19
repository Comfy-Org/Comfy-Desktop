<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, Copy } from 'lucide-vue-next'
import { CONTENT } from '../content'
import { importLine, SPECS, usage } from '../play'

/** A component's Code tab: a minimal snippet, its props, where it lives. */
const { page, source } = defineProps<{ page: string; source?: string }>()
const content = computed(() => CONTENT[page] ?? {})
const spec = computed(() => SPECS.find((s) => s.id === content.value.play))
const code = computed(() =>
  spec.value ? `${importLine(spec.value)}\n\n${usage(spec.value, {})}` : content.value.snippet
)
const props = computed(
  () =>
    content.value.props ??
    spec.value?.controls
      .filter((c) => !c.role)
      .map((c) => ({
        name: c.name,
        type:
          c.kind === 'select'
            ? c.options!.filter(Boolean).join(' | ')
            : c.kind === 'bool'
              ? 'boolean'
              : 'string',
        default: c.cd !== undefined ? String(c.cd) : c.required ? 'required' : '—',
        use: ''
      })) ??
    []
)
const copied = ref(false)
async function copy(): Promise<void> {
  await navigator.clipboard.writeText(code.value ?? '')
  copied.value = true
  setTimeout(() => (copied.value = false), 1200)
}
</script>

<template>
  <div class="ds-code">
    <div v-if="code" class="ds-play-code">
      <div class="ds-play-code-head">
        <span>Usage</span>
        <a v-if="spec" :href="`#/${page}?tab=playground`">Open in Playground</a>
        <button type="button" @click="copy">
          <component :is="copied ? Check : Copy" :size="13" />Copy
        </button>
      </div>
      <pre><code>{{ code }}</code></pre>
    </div>
    <table v-if="props.length" class="ds-code-props">
      <thead>
        <tr>
          <th>Prop</th>
          <th>Type</th>
          <th>Default</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in props" :key="p.name">
          <td>
            <code>{{ p.name }}</code>
          </td>
          <td>
            <code>{{ p.type }}</code>
          </td>
          <td>
            <code>{{ p.default }}</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="source" class="ds-code-src">
      Source: <code>{{ source }}</code>
    </p>
  </div>
</template>

<style>
.ds-code {
  display: flex;
  max-width: 820px;
  flex-direction: column;
  gap: 24px;
}
.ds-code-props {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  overflow: hidden;
  border-radius: 12px;
  box-shadow: inset 0 0 0 1px var(--color-border-default);
  font-size: 13px;
  line-height: 20px;
}
.ds-code-props th {
  padding: 10px 14px;
  background: var(--color-secondary-background);
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-align: left;
  text-transform: uppercase;
}
.ds-code-props td {
  padding: 10px 14px;
  border-top: 1px solid var(--color-border-default);
  vertical-align: top;
  overflow-wrap: anywhere;
}
.ds-code-props td:not(:first-child) code {
  color: var(--color-muted-foreground);
}
.ds-code code {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 12px;
}
.ds-code-src {
  color: var(--color-subtle-foreground);
  font-size: 13px;
}
.ds-code-src code {
  padding: 2px 6px;
  border-radius: 5px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
}
.ds-play-code-head a {
  color: var(--color-muted-foreground);
  text-decoration: underline;
  text-decoration-color: var(--color-border-strong);
  text-underline-offset: 3px;
}
.ds-play-code-head a:hover {
  color: var(--color-base-foreground);
}
</style>
