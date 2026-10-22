<script setup lang="ts">
import { computed } from 'vue'
import { SliderRoot, SliderThumb, SliderTrack } from 'reka-ui'
import Badge from '../../landing/ui/Badge.vue'
import Button from '../../landing/ui/Button.vue'
import Input from '../../landing/ui/Input.vue'
import { clampToGamut, formatOklch, inGamut, maxChroma, parseColor, type Oklch } from '../color'
import { shortName, type Token } from '../tokens'
import { setToken, valueOf } from '../tweaks'

/**
 * Color token editor in OKLCH: lightness, chroma, hue and alpha sliders
 * whose tracks show what each channel does, a before/after swatch, and an
 * sRGB gamut check (fit lowers chroma, keeps L and H). The text field takes
 * any CSS color; values are written back as oklch().
 */
const { token } = defineProps<{ token: Token }>()

const raw = computed({
  get: () => valueOf(token),
  set: (v: string) => {
    const o = parseColor(v)
    setToken(token, o ? formatOklch(o) : v)
  }
})
const color = computed(() => parseColor(raw.value))
const original = computed(() => parseColor(token.value))
const set = (patch: Partial<Oklch>): void =>
  setToken(token, formatOklch({ ...color.value!, ...patch }))

const fits = computed(() => !color.value || inGamut(color.value))
const cMax = computed(() => (color.value ? maxChroma(color.value.l, color.value.h) : 0.4))

/** Each track paints its channel across the full range, others held. */
const css = (o: Oklch): string => formatOklch(o)
const channels = computed(() => {
  const o = color.value!
  const hueC = Math.max(o.c, 0.1)
  return [
    {
      key: 'l' as const,
      label: 'Lightness',
      max: 1,
      step: 0.001,
      show: o.l.toFixed(3),
      track: `linear-gradient(to right in oklch, ${css({ ...o, l: 0, alpha: 1 })}, ${css({ ...o, l: 1, alpha: 1 })})`
    },
    {
      key: 'c' as const,
      label: 'Chroma',
      max: 0.4,
      step: 0.001,
      show: o.c.toFixed(3),
      track: `linear-gradient(to right in oklch, ${css({ ...o, c: 0, alpha: 1 })}, ${css({ ...o, c: 0.4, alpha: 1 })})`
    },
    {
      key: 'h' as const,
      label: 'Hue',
      max: 360,
      step: 0.5,
      show: `${o.h.toFixed(1)}°`,
      track: `linear-gradient(to right in oklch longer hue, ${css({ ...o, c: hueC, h: 0, alpha: 1 })}, ${css({ ...o, c: hueC, h: 359.9, alpha: 1 })})`
    },
    {
      key: 'alpha' as const,
      label: 'Alpha',
      max: 1,
      step: 0.01,
      show: o.alpha.toFixed(2),
      track: `linear-gradient(to right, ${css({ ...o, alpha: 0 })}, ${css({ ...o, alpha: 1 })})`
    }
  ]
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Before / after -->
    <div class="flex h-10 overflow-hidden rounded-control border border-border-strong">
      <span
        class="flex flex-1 items-end p-1.5 text-ui text-muted-foreground"
        :style="{ background: token.value }"
        :title="`Before: ${original ? formatOklch(original) : token.value}`"
        ><span class="rounded-min bg-media-overlay px-1">before</span></span
      >
      <span
        class="flex flex-1 items-end justify-end p-1.5 text-ui text-muted-foreground"
        :style="{ background: raw }"
        :title="`Now: ${raw}`"
        ><span class="rounded-min bg-media-overlay px-1">now</span></span
      >
    </div>

    <Input v-model="raw" size="sm" mono :aria-label="`${shortName(token)} value`" />

    <template v-if="color">
      <div v-for="ch in channels" :key="ch.key" class="flex flex-col gap-1">
        <div class="flex items-center justify-between text-ui">
          <span class="text-muted-foreground">{{ ch.label }}</span>
          <span class="font-mono text-subtle-foreground tabular-nums"
            >{{ ch.show
            }}<template v-if="ch.key === 'c'"> · max {{ cMax.toFixed(3) }}</template></span
          >
        </div>
        <SliderRoot
          :model-value="[color[ch.key]]"
          :min="0"
          :max="ch.max"
          :step="ch.step"
          class="relative flex h-4 touch-none items-center select-none"
          @update:model-value="(v?: number[]) => v && set({ [ch.key]: v[0] })"
        >
          <SliderTrack
            class="relative h-2 grow rounded-full ring-1 ring-border-default ring-inset"
            :style="{ background: ch.track }"
          />
          <SliderThumb
            :aria-label="`${shortName(token)} ${ch.label}`"
            class="block size-3.5 rounded-full border-2 border-base-foreground bg-card-background shadow-popover outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          />
        </SliderRoot>
      </div>

      <div v-if="!fits" class="flex items-center gap-2">
        <Badge variant="outline">outside sRGB</Badge>
        <span class="flex-1 text-ui text-muted-foreground"
          >Chroma is above {{ cMax.toFixed(3) }} for this lightness and hue; screens clip it.</span
        >
        <Button size="sm" @click="setToken(token, formatOklch(clampToGamut(color)))"
          >Fit to sRGB</Button
        >
      </div>
    </template>
  </div>
</template>
