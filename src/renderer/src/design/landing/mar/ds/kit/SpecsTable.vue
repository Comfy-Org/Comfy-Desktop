<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Check, Copy } from 'lucide-vue-next'
import type { Content } from '../content'

/**
 * A page's tokens in this frame's theme: name, value, use. Values are read
 * from the hero above (or the page's probe), so they're what renders.
 */
const { content } = defineProps<{ content: Content }>()
const rows = ref<{ name: string; value: string; use: string }[]>([])
const probe = ref<HTMLElement>()
const copied = ref('')

/** A variable written as calc() or var() reads as its length, measured. */
function resolve(name: string, raw: string): string {
  if (!/calc\(|var\(/.test(raw)) return raw
  const el = document.body.appendChild(document.createElement('div'))
  el.style.width = `var(${name})`
  const px = getComputedStyle(el).width
  el.remove()
  return px
}

onMounted(() =>
  setTimeout(() => {
    const doc = document.documentElement
    rows.value = (content.tokens ?? []).map((t) => {
      if (t.name.startsWith('--') && !t.selector)
        return {
          name: t.name,
          value: resolve(t.name, getComputedStyle(doc).getPropertyValue(t.name).trim()),
          use: t.use
        }
      const el =
        probe.value?.querySelector<HTMLElement>(t.selector!) ??
        document.querySelector<HTMLElement>(`.ds-section ${t.selector}`) ??
        document.querySelector<HTMLElement>(t.selector!)
      const value = el ? getComputedStyle(el).getPropertyValue(t.name).trim() : '—'
      return { name: `${t.selector} · ${t.name}`, value, use: t.use }
    })
  }, 700)
)

async function copy(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
  copied.value = text
  setTimeout(() => (copied.value = ''), 1200)
}
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- the page's own probe markup (content.ts) -->
  <div v-if="content.probe" ref="probe" class="ds-specs-probe" v-html="content.probe" />
  <table v-if="content.tokens?.length" class="ds-specs">
    <thead>
      <tr>
        <th>Token</th>
        <th>Value</th>
        <th>Use</th>
        <th />
      </tr>
    </thead>
    <tbody>
      <tr v-for="r in rows" :key="r.name">
        <td>
          <code>{{ r.name }}</code>
        </td>
        <td>
          <code>{{ r.value }}</code>
        </td>
        <td>{{ r.use }}</td>
        <td>
          <button
            type="button"
            class="ds-specs-copy"
            :aria-label="`Copy ${r.name}`"
            @click="copy(`${r.name}: ${r.value}`)"
          >
            <component :is="copied === `${r.name}: ${r.value}` ? Check : Copy" :size="12" />
          </button>
        </td>
      </tr>
    </tbody>
  </table>
  <p v-else class="ds-specs-none">No tokens of its own: it uses the shared ones (Foundations).</p>
</template>

<style>
.ds-specs-probe {
  display: flex;
  max-width: 240px;
  margin-bottom: 16px;
}
.ds-specs-probe > * {
  width: 100%;
}
.ds-specs {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  overflow: hidden;
  border-radius: 12px;
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  font-size: 13px;
  line-height: 20px;
}
.ds-specs th {
  padding: 10px 14px;
  background: color-mix(in oklch, var(--color-base-foreground) 4%, transparent);
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-align: left;
  text-transform: uppercase;
}
.ds-specs td {
  padding: 10px 14px;
  border-top: 1px solid color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  vertical-align: top;
  overflow-wrap: anywhere;
}
.ds-specs td:nth-child(3) {
  color: var(--color-muted-foreground);
}
.ds-specs td:last-child {
  width: 1%;
  padding-right: 10px;
}
.ds-specs code {
  color: var(--color-base-foreground);
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 12px;
}
.ds-specs td:nth-child(2) code {
  color: var(--color-muted-foreground);
}
.ds-specs-copy {
  display: inline-flex;
  padding: 3px;
  border-radius: 5px;
  color: var(--color-muted-foreground);
}
.ds-specs-copy:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
}
.ds-specs-none {
  color: var(--color-muted-foreground);
  font-size: 12.5px;
}
</style>
