<script setup lang="ts">
import { computed } from 'vue'
import { Check } from 'lucide-vue-next'
import Input from '../../ui/Input.vue'
import SegmentedControl from '../../ui/SegmentedControl.vue'
import Select from '../../ui/Select.vue'
import Switch from '../../ui/Switch.vue'
import { cn } from '../../ui/cn'
import AppLayoutThumb from './AppLayoutThumb.vue'
import { flow, LAYOUTS, type AppLayout } from '../../appFlow'
import {
  ACCENTS,
  BRAND_KITS,
  CORNERS,
  FONTS,
  HEADERS,
  kitById,
  withKit,
  type AppCorners,
  type AppHeader
} from '../../appTheme'

/**
 * The guardrailed knobs of an app's look. Every value is one of a few
 * choices that are known to work together; `only` shows a subset (Themes
 * fine-tunes a few, the Style panel shows them all).
 */
type Control =
  | 'kit'
  | 'layout'
  | 'mode'
  | 'accent'
  | 'font'
  | 'corners'
  | 'header'
  | 'runLabel'
  | 'presets'
const { only } = defineProps<{ only?: Control[] }>()
const show = (c: Control): boolean => !only || only.includes(c)
const d = computed(() => flow.draft!)
const t = computed(() => d.value.theme)
const accents = computed(() => {
  const kit = kitById(t.value.kit)
  return kit ? [...new Set([...kit.colors.slice(0, 1), ...ACCENTS])] : ACCENTS
})
const kitModel = computed({
  get: () => t.value.kit ?? 'none',
  set: (v: string) => (d.value.theme = withKit(t.value, v === 'none' ? null : v))
})
const row = 'flex flex-col gap-2'
const label = 'text-ui text-subtle-foreground'
</script>

<template>
  <div v-if="flow.draft" class="flex flex-col gap-6">
    <div v-if="show('kit')" :class="row">
      <span :class="label">Brand kit</span>
      <Select
        v-model="kitModel"
        :options="[
          { value: 'none', label: 'None · Comfy' },
          ...BRAND_KITS.map((k) => ({ value: k.id, label: k.name, swatch: k.colors[0] }))
        ]"
      />
    </div>

    <div v-if="show('layout')" :class="row">
      <span :class="label">Layout</span>
      <div class="grid grid-cols-3 gap-2">
        <button
          v-for="l in LAYOUTS"
          :key="l.id"
          type="button"
          :class="
            cn(
              'flex flex-col gap-1.5 rounded-control border p-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
              d.layout === l.id
                ? 'border-base-foreground/70'
                : 'border-border-default hover:bg-secondary-background'
            )
          "
          @click="d.layout = l.id as AppLayout"
        >
          <AppLayoutThumb :layout="l.id" />
          <span class="px-0.5 text-ui">{{ l.label }}</span>
        </button>
      </div>
    </div>

    <div v-if="show('mode')" :class="row">
      <span :class="label">Page</span>
      <SegmentedControl
        v-model="t.mode"
        variant="contained"
        size="sm"
        class="self-start"
        :options="[
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' }
        ]"
      />
    </div>

    <div v-if="show('accent')" :class="row">
      <span :class="label">Accent · the Run button</span>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="c in accents"
          :key="c"
          type="button"
          :aria-label="`Accent ${c}`"
          class="relative inline-flex size-7 items-center justify-center rounded-full ring-1 ring-border-strong outline-none ring-inset focus-visible:ring-2 focus-visible:ring-border-focus"
          :style="{ background: c }"
          @click="t.accent = c"
        >
          <Check
            v-if="t.accent === c"
            :size="13"
            :class="
              ['#f4f4f5', '#e2b93b', '#7cc36b', '#d8d2c4', '#c9a45c', '#1ed760'].includes(c)
                ? 'text-black'
                : 'text-white'
            "
          />
        </button>
      </div>
    </div>

    <div v-if="show('font')" :class="row">
      <span :class="label">Type</span>
      <div class="grid grid-cols-5 gap-1.5">
        <button
          v-for="f in FONTS"
          :key="f.id"
          type="button"
          :class="
            cn(
              'flex flex-col items-center gap-0.5 rounded-control border py-2 outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
              t.font === f.id
                ? 'border-base-foreground/70'
                : 'border-border-default hover:bg-secondary-background'
            )
          "
          @click="t.font = f.id"
        >
          <span class="text-heading" :style="{ fontFamily: f.stack, fontWeight: f.weight }"
            >Aa</span
          >
          <span class="text-[11px] text-subtle-foreground">{{ f.label }}</span>
        </button>
      </div>
    </div>

    <div v-if="show('corners')" :class="row">
      <span :class="label">Corners</span>
      <SegmentedControl
        :model-value="t.corners"
        variant="contained"
        size="sm"
        class="self-start"
        :options="CORNERS.map((c) => ({ value: c.id, label: c.label }))"
        @update:model-value="(v: string) => (t.corners = v as AppCorners)"
      />
    </div>

    <div v-if="show('header')" :class="row">
      <span :class="label">Header</span>
      <SegmentedControl
        :model-value="t.header"
        variant="contained"
        size="sm"
        class="self-start"
        :options="HEADERS.map((h) => ({ value: h.id, label: h.label }))"
        @update:model-value="(v: string) => (t.header = v as AppHeader)"
      />
    </div>

    <div v-if="show('runLabel')" :class="row">
      <span :class="label">Run button says</span>
      <Input v-model="t.runLabel" maxlength="18" />
    </div>

    <div v-if="show('presets')" class="flex items-center justify-between gap-3">
      <span class="min-w-0">
        <span class="block text-ui">Quick-start presets</span>
        <span class="block text-ui text-subtle-foreground">Ready-made inputs above the form</span>
      </span>
      <Switch v-model="t.presets" aria-label="Quick-start presets" />
    </div>
  </div>
</template>
