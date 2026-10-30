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
        <a v-if="spec" :href="`#/playground?c=${spec.id}`">Open in Playground</a>
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
  max-width: 720px;
  flex-direction: column;
  gap: 16px;
}
.ds-code-props {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.ds-code-props th {
  padding: 6px 10px;
  color: #6e6e76;
  font-weight: 500;
  text-align: left;
}
.ds-code-props td {
  padding: 7px 10px;
  border-top: 1px solid rgb(255 255 255 / 0.06);
  overflow-wrap: anywhere;
}
.ds-code code {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11px;
}
.ds-code-src {
  color: #6e6e76;
  font-size: 12px;
}
.ds-play-code-head a {
  color: #a1a1a8;
  text-decoration: underline;
  text-underline-offset: 3px;
}
</style>
