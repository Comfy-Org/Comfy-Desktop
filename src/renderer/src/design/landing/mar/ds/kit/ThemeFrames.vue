<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { DsMode, FrameSection } from './mode'

/**
 * A page in one mode (kit/mode.ts), once per theme, side by side when both
 * show. Mar's themes live on <html>, so each is a frame of this entry; a
 * frame reports its height and never scrolls on its own, and its section
 * titles (the first theme's) for the page's “On this page” links.
 */
const { page, mode, themes } = defineProps<{ page: string; mode: DsMode; themes: string[] }>()
const emit = defineEmits<{ sections: [FrameSection[]] }>()
const heights = ref<Record<string, number>>({})
const frames = ref<HTMLIFrameElement[]>([])
function onMessage(e: MessageEvent): void {
  const f = frames.value.find((x) => x.contentWindow === e.source)
  if (!f) return
  if (e.data?.type === 'mar-ds:height')
    heights.value = { ...heights.value, [f.dataset.theme!]: e.data.h }
  if (e.data?.type === 'mar-ds:sections' && f.dataset.theme === themes[0])
    emit(
      'sections',
      (e.data.list as { title: string; top: number }[]).map((s) => ({ ...s, frame: f }))
    )
}
onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))
const src = (theme: string): string => `?frame=page&page=${page}&mode=${mode}&theme=${theme}`
</script>

<template>
  <div :class="['ds-themes', themes.length > 1 && 'is-both']">
    <div v-for="t in themes" :key="`${page}-${mode}-${t}`" class="ds-theme">
      <span v-if="themes.length > 1" class="ds-theme-label">{{
        t === 'dark' ? 'Dark' : 'Light'
      }}</span>
      <iframe
        ref="frames"
        :data-theme="t"
        :src="src(t)"
        :title="`${page}, ${mode}, ${t}`"
        class="ds-theme-frame"
        :style="{ height: `${heights[t] ?? 240}px` }"
      />
    </div>
  </div>
</template>
