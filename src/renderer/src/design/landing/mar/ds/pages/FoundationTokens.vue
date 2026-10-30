<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Check, Copy } from 'lucide-vue-next'
import tokensCss from '../../../ui/tokens.css?raw'
import Section from '../kit/Section.vue'
import { useMode } from '../kit/mode'

/**
 * Colour, Type and Radius: the tokens in ui/tokens.css (names and their
 * comments as the use), with Mar's own corners, valued live in this frame's
 * theme so Mar's overrides and light mode show. Overview: the picture.
 * Details: name, value, use, copyable.
 */
const { kind } = defineProps<{ kind: 'colour' | 'type' | 'radius' }>()
const details = useMode().mode === 'details'

interface Tok {
  name: string
  use: string
  value?: string
  lh?: string
}

const PREFIX = { colour: '--color-', type: '--text-', radius: '--radius-' }[kind]
const parsed: Tok[] = [
  ...tokensCss.matchAll(/^[ \t]*(--[\w-]+):[^;]+;[ \t]*(?:\/\*\s*(.*?)\s*\*\/)?/gm)
]
  .filter((m) => m[1]!.startsWith(PREFIX) && !m[1]!.endsWith('--line-height'))
  .map((m) => ({ name: m[1]!, use: m[2] ?? '' }))

// Mar's corners for controls (UI Playground › Corners).
const MAR: Tok[] =
  kind === 'radius'
    ? [
        { name: '--mar-tab-radius', use: 'Tab tracks, filters, sort, search, view' },
        { name: '--mar-tab-item-radius', use: 'What sits in a track' }
      ]
    : []
const USE: Record<string, string> = {
  '--radius-panel': 'The content panel',
  '--radius-card': 'Cards',
  '--radius-control': 'Buttons, fields',
  '--radius-min': 'The smallest corner',
  '--text-ui': 'Body, navigation, controls',
  '--text-heading': 'Section titles',
  '--text-title': 'Page titles',
  '--text-display': 'Home’s greeting'
}

const tokens = ref<Tok[]>([...parsed, ...MAR])
onMounted(() =>
  setTimeout(() => {
    const css = getComputedStyle(document.documentElement)
    tokens.value = tokens.value.map((t) => ({
      ...t,
      use: t.use || USE[t.name] || '',
      value: css.getPropertyValue(t.name).trim(),
      lh: kind === 'type' ? css.getPropertyValue(`${t.name}--line-height`).trim() : undefined
    }))
  }, 500)
)

// Colours, grouped by what they're for.
const GROUPS: [string, RegExp][] = [
  ['Surfaces', /background/],
  ['Text', /foreground/],
  ['Lines', /border/],
  ['Status and media', /status|overlay/]
]
const groups = computed(() =>
  GROUPS.map(([label, re]) => ({ label, items: tokens.value.filter((t) => re.test(t.name)) }))
)

const copied = ref('')
async function copy(t: Tok): Promise<void> {
  const text = `${t.name}: ${t.value}`
  await navigator.clipboard.writeText(text)
  copied.value = t.name
  setTimeout(() => (copied.value = ''), 1200)
}
const short = (n: string): string => n.replace(PREFIX, '').replace('--mar-', 'mar-')
</script>

<template>
  <Section v-if="details" :title="`${kind[0]!.toUpperCase()}${kind.slice(1)} tokens`">
    <table class="ds-specs">
      <thead>
        <tr>
          <th>Token</th>
          <th>Value</th>
          <th>Use</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="t in tokens" :key="t.name">
          <td>
            <code>{{ t.name }}</code>
          </td>
          <td>
            <code>{{ t.value }}{{ t.lh ? ` / ${t.lh}` : '' }}</code>
          </td>
          <td>{{ t.use }}</td>
          <td>
            <button
              type="button"
              class="ds-specs-copy"
              :aria-label="`Copy ${t.name}`"
              @click="copy(t)"
            >
              <component :is="copied === t.name ? Check : Copy" :size="12" />
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </Section>

  <template v-else-if="kind === 'colour'">
    <Section
      v-for="g in groups"
      :key="g.label"
      :title="g.label"
      :note="g.label === 'Surfaces' ? 'Grey scale: pictures carry the colour.' : undefined"
    >
      <div class="ds-tok-swatches">
        <figure v-for="t in g.items" :key="t.name">
          <i :style="{ background: `var(${t.name})` }" />
          <figcaption>{{ short(t.name) }}</figcaption>
        </figure>
      </div>
    </Section>
  </template>

  <Section
    v-else-if="kind === 'type'"
    title="Type scale"
    note="One size for body, navigation and controls; three above it."
  >
    <div class="ds-tok-type">
      <p
        v-for="t in tokens"
        :key="t.name"
        :style="{ fontSize: `var(${t.name})`, lineHeight: `var(${t.name}--line-height)` }"
      >
        <span>{{ short(t.name) }}</span
        >Make something beautiful
      </p>
    </div>
  </Section>

  <Section
    v-else
    title="Corners"
    note="Inner = outer − padding. Controls follow UI Playground › Corners."
  >
    <div class="ds-tok-radii">
      <figure v-for="t in tokens" :key="t.name">
        <i :style="{ borderRadius: `var(${t.name})` }" />
        <figcaption>{{ short(t.name) }} · {{ t.value }}</figcaption>
      </figure>
    </div>
  </Section>
</template>

<style>
.ds-tok-swatches {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
}
.ds-tok-swatches figure,
.ds-tok-radii figure {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ds-tok-swatches i {
  height: 56px;
  border-radius: 10px;
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
}
.ds-tok-swatches figcaption,
.ds-tok-radii figcaption {
  color: var(--color-muted-foreground);
  font-size: 11.5px;
}
.ds-tok-type {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ds-tok-type span {
  display: inline-block;
  width: 90px;
  color: var(--color-subtle-foreground);
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11px;
}
.ds-tok-radii {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 16px;
}
.ds-tok-radii i {
  height: 72px;
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 16%, transparent);
}
</style>
