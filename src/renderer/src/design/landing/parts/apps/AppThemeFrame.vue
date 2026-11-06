<script setup lang="ts">
import { computed, ref } from 'vue'
import ComfyCLogo from '../../../../components/icons/ComfyCLogo.vue'
import SpaceMark from '../space/SpaceMark.vue'
import MemberAvatar from '../MemberAvatar.vue'
import AppRunPanel from './AppRunPanel.vue'
import { cn } from '../../ui/cn'
import { thumb } from '../../mock'
import { kitById, type AppTheme } from '../../appTheme'
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
  output,
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
  output?: string
  /** Smaller paddings and type (previews inside the agent's thread). */
  compact?: boolean
}>()
const emit = defineEmits<{ done: [] }>()

const kit = computed(() => kitById(theme.kit))
const panel = ref<InstanceType<typeof AppRunPanel>>()
defineExpose({ run: () => panel.value?.run() })
const titleStyle = computed(() => ({
  fontWeight: 'var(--app-title-weight)',
  letterSpacing: 'var(--app-title-spacing)'
}))
const pad = computed(() => (compact ? 'px-6' : 'px-10'))
// The app page is the product's own page - its font, corners and colours.
// A brand kit only puts its logo in the header.
const MAR_STYLE = { '--app-title-weight': '600', '--app-title-spacing': '-0.02em' }
</script>

<template>
  <div :style="MAR_STYLE" class="mar-app-page bg-app-background text-base-foreground">
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
          :output
          run-label="Run"
          @done="emit('done')"
        >
          <template #place><slot name="place" /></template>
          <template #saved><slot name="saved" /></template>
        </AppRunPanel>
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
      </footer>
    </div>
  </div>
</template>
