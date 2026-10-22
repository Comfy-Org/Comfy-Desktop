<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { Check } from 'lucide-vue-next'
import Badge from '../../landing/ui/Badge.vue'
import Card from '../../landing/ui/Card.vue'
import AnimationPlayer from '../parts/AnimationPlayer.vue'
import GallerySection from '../parts/GallerySection.vue'
import PlanMark from '../parts/PlanMark.vue'
import { sampleClass } from '../consolidate/session'
import type { ConsolidateGroup } from '../consolidate/rules'
import { usageOf } from '../inspect/usage'
import {
  GRID_GROUPS,
  GROUPS,
  KEYFRAMES,
  onGrid,
  px,
  shortName,
  TOKENS,
  type Token
} from '../tokens'
import { valueOf } from '../tweaks'
import { thumb } from '../../landing/mock'

/**
 * Every token group found in the theme (tokens.ts), each previewed the way
 * its namespace is used (theme.ts): swatches, type, boxes, curves, played
 * animations… Unknown namespaces fall back to a value list. Values follow
 * live tweaks.
 */
const CONSOLIDATE = ['color', 'text', 'radius', 'shadow']
const groups = GROUPS.filter((g) => g.ns.id !== 'spacing')
const uses = (t: Token): number => usageOf(t).total
const byName = (name: string): Token | undefined => TOKENS.find((t) => t.name === name)
const leadingOf = (t: Token): Token | undefined => byName(`${t.name}--line-height`)

/** Resolve var(--token) references to the token's (draft) value. */
const resolve = (v: string): string =>
  v.replace(/var\(--([\w-]+)\)/g, (m, n: string) => {
    const t = byName(n)
    return t ? resolve(valueOf(t)) : m
  })

// ── Easing: plot the curve ─────────────────────────────────
const KEYWORD: Record<string, number[]> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1]
}
function curve(v: string): string {
  const m = /cubic-bezier\(([^)]+)\)/.exec(v)
  const b = m ? m[1]!.split(',').map(Number) : KEYWORD[v.trim()]
  if (!b || b.length !== 4) return ''
  const [x1, y1, x2, y2] = b as [number, number, number, number]
  const y = (n: number): number => 48 - n * 48
  return `M0,48 C${x1 * 48},${y(y1)} ${x2 * 48},${y(y2)} 48,0`
}

// ── Animation: keyframes from the theme ─────────────────
const keyframesOf = (v: string): string | undefined =>
  [...KEYFRAMES.keys()].find((k) => new RegExp(`(^|\\s)${k}(\\s|,|$)`).test(v))
// Theme keyframes are only emitted when a utility uses them: inject them.
let sheet: HTMLStyleElement | null = null
onMounted(() => {
  sheet = document.createElement('style')
  sheet.textContent = [...KEYFRAMES.values()].join('\n')
  document.head.appendChild(sheet)
})
onBeforeUnmount(() => sheet?.remove())

// ── Sizes (breakpoints, containers): bars relative to the largest ──
const widthOf = (tokens: Token[], t: Token): string => {
  const max = Math.max(...tokens.map((x) => px(valueOf(x)) ?? 0), 1)
  return `${((px(valueOf(t)) ?? 0) / max) * 100}%`
}

// ── Spacing: the theme's step, or Tailwind's default ───────
const spacing = byName('spacing')
const step = computed(() => (spacing && px(valueOf(spacing))) || 4)
const SPACING = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16]

const offGrid = computed(() =>
  TOKENS.filter((t) => GRID_GROUPS.includes(t.group) && !onGrid(valueOf(t)))
)
</script>

<template>
  <GallerySection
    v-for="g in groups"
    :id="g.ns.id"
    :key="g.ns.id"
    :title="g.ns.label"
    :description="g.ns.description"
    :tokens="g.tokens"
    :consolidate="CONSOLIDATE.includes(g.ns.id) ? (g.ns.id as ConsolidateGroup) : undefined"
  >
    <!-- Color: swatches -->
    <div v-if="g.ns.preview === 'color'" class="grid grid-cols-4 gap-3">
      <div v-for="t in g.tokens" :key="t.name" class="flex flex-col gap-2">
        <span
          :class="['h-12 rounded-control border border-border-default', sampleClass(t)]"
          :data-token="t.name"
          :style="{ background: `var(--${t.name})` }"
        />
        <span class="flex items-baseline gap-2 font-mono text-ui text-muted-foreground"
          ><span class="truncate">{{ shortName(t) }}</span
          ><span class="ml-auto shrink-0 text-subtle-foreground tabular-nums"
            >{{ uses(t) }}×</span
          ></span
        >
        <PlanMark :token="t" />
      </div>
    </div>

    <!-- Type: sizes with their line-height -->
    <div v-else-if="g.ns.preview === 'text'" class="flex flex-col gap-4">
      <div v-for="t in g.tokens" :key="t.name" class="flex items-baseline gap-6">
        <span class="w-40 shrink-0 font-mono text-ui text-subtle-foreground"
          >{{ shortName(t) }} · {{ valueOf(t)
          }}<template v-if="leadingOf(t)"> / {{ valueOf(leadingOf(t)!) }}</template></span
        >
        <span class="w-12 shrink-0 text-right font-mono text-ui text-subtle-foreground tabular-nums"
          >{{ uses(t) }}×</span
        >
        <span
          :class="['rounded-min', sampleClass(t)]"
          :data-token="t.name"
          :style="{
            fontSize: `var(--${t.name})`,
            lineHeight: leadingOf(t) ? `var(--${t.name}--line-height)` : undefined
          }"
          >Comfy Desktop runs your workflows</span
        >
        <PlanMark :token="t" class="ml-auto" />
      </div>
    </div>

    <!-- Line height: two lines at that height -->
    <div v-else-if="g.ns.preview === 'leading'" class="grid grid-cols-2 gap-3">
      <div v-for="t in g.tokens" :key="t.name" class="flex flex-col gap-2">
        <p
          class="rounded-control border border-border-default bg-secondary-background/60 px-3"
          :data-token="t.name"
          :style="{
            lineHeight: valueOf(t),
            fontSize: t.parent ? `var(--${t.parent})` : undefined
          }"
        >
          Runs your workflows locally<br />or on Comfy Cloud
        </p>
        <span class="font-mono text-ui text-muted-foreground"
          >{{ shortName(t) }} · {{ valueOf(t) }} · {{ uses(t) }}×</span
        >
      </div>
    </div>

    <!-- Radius: boxes, with the nesting example -->
    <div v-else-if="g.ns.preview === 'radius'" class="flex flex-wrap items-end gap-4">
      <div v-for="t in g.tokens" :key="t.name" class="flex flex-col items-center gap-2">
        <span
          :class="['size-20 border border-border-strong bg-card-background', sampleClass(t)]"
          :data-token="t.name"
          :style="{ borderRadius: `var(--${t.name})` }"
        />
        <span class="font-mono text-ui text-muted-foreground"
          >{{ shortName(t) }} · {{ valueOf(t) }} · {{ uses(t) }}×</span
        >
        <PlanMark :token="t" />
      </div>
    </div>

    <!-- Shadow: raised tiles. Tailwind inlines shadow values into its
         utilities (no --shadow-* variables at runtime): use the value. -->
    <div v-else-if="g.ns.preview === 'shadow'" class="flex flex-wrap gap-x-10 gap-y-8 py-4">
      <div v-for="t in g.tokens" :key="t.name" class="flex flex-col items-center gap-3">
        <span
          :class="['size-24 rounded-card bg-card-background-hover', sampleClass(t)]"
          :data-token="t.name"
          :style="{ boxShadow: resolve(valueOf(t)) }"
        />
        <span class="font-mono text-ui text-muted-foreground"
          >{{ shortName(t) }} · {{ uses(t) }}×</span
        >
        <PlanMark :token="t" />
      </div>
    </div>

    <!-- Blur: frosted half over an image -->
    <div v-else-if="g.ns.preview === 'blur'" class="flex flex-wrap gap-6">
      <div v-for="t in g.tokens" :key="t.name" class="flex flex-col items-center gap-2">
        <span class="relative block h-24 w-40 overflow-hidden rounded-card" :data-token="t.name">
          <img :src="thumb('image_flux2')" alt="" class="size-full object-cover" />
          <span
            class="absolute inset-y-0 right-0 w-1/2 border-l border-border-strong"
            :style="{ backdropFilter: `blur(${valueOf(t)})` }"
          />
        </span>
        <span class="font-mono text-ui text-muted-foreground"
          >{{ shortName(t) }} · {{ valueOf(t) }} · {{ uses(t) }}×</span
        >
      </div>
    </div>

    <!-- Easing: the curve; hover to run a dot along it -->
    <div v-else-if="g.ns.preview === 'ease'" class="grid grid-cols-3 gap-3">
      <div
        v-for="t in g.tokens"
        :key="t.name"
        class="group flex flex-col gap-3 rounded-control border border-border-default p-4"
        :data-token="t.name"
      >
        <svg viewBox="-4 -8 56 64" class="h-20 w-full overflow-visible" aria-hidden="true">
          <path d="M0,48 L48,0" class="stroke-border-strong" stroke-dasharray="2 3" fill="none" />
          <path
            :d="curve(valueOf(t))"
            class="stroke-base-foreground"
            stroke-width="2"
            fill="none"
          />
        </svg>
        <span class="relative h-1 rounded-full bg-secondary-background">
          <span
            class="absolute -top-1 left-0 size-3 rounded-full bg-base-foreground transition-[left] duration-700 group-hover:left-[calc(100%-12px)]"
            :style="{ transitionTimingFunction: resolve(valueOf(t)) }"
          />
        </span>
        <span class="truncate font-mono text-ui text-muted-foreground"
          >{{ shortName(t) }} · {{ uses(t) }}×</span
        >
        <span class="truncate font-mono text-ui text-subtle-foreground">{{ valueOf(t) }}</span>
      </div>
    </div>

    <!-- Animation: a player with a timeline, speed and loop -->
    <div v-else-if="g.ns.preview === 'animate'" class="grid grid-cols-2 gap-3">
      <div
        v-for="t in g.tokens"
        :key="t.name"
        class="flex flex-col gap-3 rounded-control border border-border-default p-4"
        :data-token="t.name"
      >
        <AnimationPlayer :animation="resolve(valueOf(t))" />
        <span class="truncate font-mono text-ui text-muted-foreground"
          >{{ shortName(t) }} · {{ uses(t) }}×</span
        >
        <span class="truncate font-mono text-ui text-subtle-foreground">{{ valueOf(t) }}</span>
        <span v-if="!keyframesOf(valueOf(t))" class="text-ui text-subtle-foreground"
          >Keyframes not declared in the theme.</span
        >
      </div>
    </div>

    <!-- Font family / weight / letter spacing: text samples -->
    <div
      v-else-if="['font', 'weight', 'tracking'].includes(g.ns.preview)"
      class="flex flex-col gap-3"
    >
      <div v-for="t in g.tokens" :key="t.name" class="flex items-baseline gap-6">
        <span class="w-40 shrink-0 truncate font-mono text-ui text-subtle-foreground"
          >{{ shortName(t) }} · {{ uses(t) }}×</span
        >
        <span
          class="text-heading"
          :data-token="t.name"
          :style="{
            fontFamily: g.ns.preview === 'font' ? valueOf(t) : undefined,
            fontWeight: g.ns.preview === 'weight' ? valueOf(t) : undefined,
            letterSpacing: g.ns.preview === 'tracking' ? valueOf(t) : undefined,
            fontSize: t.parent ? `var(--${t.parent})` : undefined
          }"
          >Comfy Desktop runs your workflows</span
        >
        <span class="ml-auto truncate font-mono text-ui text-subtle-foreground">{{
          valueOf(t)
        }}</span>
      </div>
    </div>

    <!-- Breakpoints, containers: widths relative to the largest -->
    <div v-else-if="g.ns.preview === 'size'" class="flex flex-col gap-2">
      <div v-for="t in g.tokens" :key="t.name" class="flex items-center gap-4">
        <span class="w-40 shrink-0 truncate font-mono text-ui text-subtle-foreground"
          >{{ shortName(t) }} · {{ valueOf(t) }}</span
        >
        <span class="h-3 flex-1">
          <span
            class="block h-full rounded-min bg-inverted-background"
            :data-token="t.name"
            :style="{ width: widthOf(g.tokens, t) }"
          />
        </span>
      </div>
    </div>

    <!-- Aspect ratio: frames -->
    <div v-else-if="g.ns.preview === 'aspect'" class="flex flex-wrap items-end gap-4">
      <div v-for="t in g.tokens" :key="t.name" class="flex flex-col items-center gap-2">
        <span
          class="h-20 rounded-control border border-border-strong bg-secondary-background"
          :data-token="t.name"
          :style="{ aspectRatio: valueOf(t) }"
        />
        <span class="font-mono text-ui text-muted-foreground"
          >{{ shortName(t) }} · {{ valueOf(t) }}</span
        >
      </div>
    </div>

    <!-- Anything else: name, value, uses -->
    <div v-else class="flex flex-col">
      <div
        v-for="t in g.tokens"
        :key="t.name"
        class="flex items-center gap-4 border-t border-border-default py-2 text-ui"
        :data-token="t.name"
      >
        <span class="w-48 shrink-0 truncate font-mono">--{{ t.name }}</span>
        <span class="min-w-0 flex-1 truncate font-mono text-muted-foreground">{{
          valueOf(t)
        }}</span>
        <span class="font-mono text-subtle-foreground tabular-nums">{{ uses(t) }}×</span>
      </div>
    </div>
  </GallerySection>

  <GallerySection
    id="spacing"
    title="Spacing"
    :description="`${spacing ? 'The theme’s' : 'Tailwind’s'} ${step}px step behind p-*, m-*, gap-*, w-* … Use whole steps; half steps (2.5, 1.5) fall off the grid.`"
  >
    <div class="flex flex-col gap-2">
      <div v-for="n in SPACING" :key="n" class="flex items-center gap-4">
        <span class="w-24 font-mono text-ui text-subtle-foreground"
          >{{ n }} · {{ n * step }}px</span
        >
        <span class="h-3 rounded-min bg-inverted-background" :style="{ width: `${n * step}px` }" />
      </div>
    </div>
  </GallerySection>

  <GallerySection
    id="grid"
    title="Grid check"
    description="Size tokens (radius, line-height, blur) must be multiples of 4. Updates as you tweak."
  >
    <Card
      v-if="!offGrid.length"
      variant="inset"
      padding="md"
      class="flex items-center gap-2 text-ui"
    >
      <Check :size="14" class="text-status-running" />Every size token is on the 4px grid.
    </Card>
    <Card v-else variant="inset" padding="md" class="flex flex-col gap-2">
      <div v-for="t in offGrid" :key="t.name" class="flex items-center gap-2 text-ui">
        <Badge variant="outline" size="sm">off grid</Badge>
        <span class="font-mono">--{{ t.name }}</span>
        <span class="text-muted-foreground">{{ valueOf(t) }}</span>
      </div>
    </Card>
  </GallerySection>
</template>
