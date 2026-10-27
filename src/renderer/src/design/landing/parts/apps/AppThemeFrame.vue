<script setup lang="ts">
import { computed, ref } from 'vue'
import { Flag } from 'lucide-vue-next'
import ComfyCLogo from '../../../../components/icons/ComfyCLogo.vue'
import SpaceMark from '../space/SpaceMark.vue'
import MemberAvatar from '../MemberAvatar.vue'
import AppRunPanel from './AppRunPanel.vue'
import { cn } from '../../ui/cn'
import { thumb } from '../../mock'
import { toast } from '../../useProto'
import { kitById, themeStyle, type AppTheme } from '../../appTheme'
import type { AppLayout, Field } from '../../appFlow'

/**
 * The app page in its theme: header (brand or Comfy), title or cover,
 * optional presets, the inputs and Run, and the "Made with Comfy" footer
 * (always there - a guardrail). The same page in a tab, in the agent's
 * previews, and on the theme cards.
 */
const {
  name,
  blurb,
  author,
  thumbId,
  fields,
  cost,
  payer,
  layout,
  theme,
  gate,
  compact = false
} = defineProps<{
  name: string
  blurb: string
  author: string
  thumbId: string
  fields: Field[]
  cost: number
  payer: string
  layout: AppLayout
  theme: AppTheme
  gate?: () => boolean
  /** Smaller paddings and type (previews inside the agent's thread). */
  compact?: boolean
}>()
const emit = defineEmits<{ done: [] }>()

const kit = computed(() => kitById(theme.kit))
const panel = ref<InstanceType<typeof AppRunPanel>>()
defineExpose({ run: () => panel.value?.run() })
const PRESETS = ['Softbox studio', 'Golden hour', 'Marble counter']
const titleStyle = computed(() => ({
  fontWeight: 'var(--app-title-weight)',
  letterSpacing: 'var(--app-title-spacing)',
  textTransform: theme.font === 'condensed' ? ('uppercase' as const) : undefined
}))
const pad = computed(() => (compact ? 'px-6' : 'px-10'))
</script>

<template>
  <div :style="themeStyle(theme)" class="bg-app-background text-base-foreground">
    <header
      :class="
        cn(
          'mx-auto flex w-full max-w-5xl items-center justify-between',
          pad,
          compact ? 'py-4' : 'py-6'
        )
      "
    >
      <span class="flex min-w-0 items-center gap-2.5 text-ui font-medium">
        <SpaceMark v-if="kit" :brand="kit.brand" size="sm" />
        <ComfyCLogo v-else :size="18" />
        <span class="truncate">{{
          theme.header === 'minimal' ? name : (kit?.name ?? 'Comfy')
        }}</span>
      </span>
      <slot name="account" />
    </header>

    <div :class="cn('mx-auto w-full max-w-5xl', pad, compact ? 'pb-6' : 'pb-16')">
      <!-- Cover image with the title on it -->
      <div
        v-if="theme.header === 'hero'"
        :class="cn('relative overflow-hidden rounded-panel', compact ? 'mt-1 h-36' : 'mt-2 h-60')"
      >
        <img :src="thumb(thumbId)" alt="" class="absolute inset-0 size-full object-cover" />
        <span
          class="absolute inset-0 bg-[linear-gradient(180deg,transparent_30%,rgb(0_0_0/0.7))]"
        />
        <div :class="cn('absolute inset-x-0 bottom-0 text-white', compact ? 'p-4' : 'p-7')">
          <h1 :class="compact ? 'text-title' : 'text-display'" :style="titleStyle">{{ name }}</h1>
          <p class="mt-1 text-ui text-white/80">{{ blurb }}</p>
        </div>
      </div>
      <!-- Title -->
      <div v-else-if="theme.header === 'title'" :class="compact ? 'pt-2' : 'pt-10'">
        <h1 :class="compact ? 'text-title' : 'text-display'" :style="titleStyle">{{ name }}</h1>
        <p
          :class="
            cn('mt-2 text-muted-foreground', compact ? 'text-ui' : 'text-heading font-normal')
          "
        >
          {{ blurb }}
        </p>
      </div>
      <p
        v-if="theme.header !== 'minimal'"
        class="mt-4 flex items-center gap-2 text-ui text-subtle-foreground"
      >
        <MemberAvatar :name="author" size="sm" />by {{ author }}
      </p>

      <!-- Quick-start presets -->
      <div v-if="theme.presets" class="mt-6 flex flex-wrap items-center gap-2">
        <span class="text-ui text-subtle-foreground">Start from</span>
        <button
          v-for="p in PRESETS"
          :key="p"
          type="button"
          class="h-8 rounded-control border border-border-default px-3 text-ui text-muted-foreground outline-none hover:bg-secondary-background hover:text-base-foreground focus-visible:ring-2 focus-visible:ring-border-focus"
          @click="toast(`Preset: ${p}`)"
        >
          {{ p }}
        </button>
      </div>

      <div :class="compact ? 'mt-6' : 'mt-12'">
        <AppRunPanel
          ref="panel"
          :layout
          :fields
          :thumb-id="thumbId"
          :cost
          :payer
          :gate
          :compact
          :run-label="theme.runLabel"
          @done="emit('done')"
        />
      </div>
      <slot name="below" />

      <footer
        :class="
          cn(
            'flex items-center justify-between border-t border-border-default text-ui text-subtle-foreground',
            compact ? 'mt-8 pt-4' : 'mt-24 pt-6'
          )
        "
      >
        <span class="flex items-center gap-1.5"><ComfyCLogo :size="12" />Made with Comfy</span>
        <button type="button" class="flex items-center gap-1.5" @click="toast('Report sent')">
          <Flag :size="12" />Report this app
        </button>
      </footer>
    </div>
  </div>
</template>
