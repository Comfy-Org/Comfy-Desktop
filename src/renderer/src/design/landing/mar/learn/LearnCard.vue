<script setup lang="ts">
import { computed } from 'vue'
import { Check, Play } from 'lucide-vue-next'
import { AppIcon, GraphIcon } from '../icons/kindIcons'
import Badge from '../../ui/Badge.vue'
import MediaCard from '../../ui/MediaCard.vue'
import { thumb, type Tutorial } from '../../mock'

/** A tutorial in Mar's Learn page, built like her Recently used / Explore
 *  cards: the image with its length, the title, one line of what it is.
 *  The whole card plays it (a play mark wakes on hover; the card never
 *  grows). Node graph / App is a quiet icon next to the title. Watched
 *  lessons say so; one you started shows a thin bar and what's left. */
const { t } = defineProps<{ t: Tutorial }>()
defineEmits<{ open: [] }>()

const watched = computed(() => (t.progress ?? 0) >= 1)
const started = computed(() => !watched.value && (t.progress ?? 0) > 0)
const left = computed(() => Math.max(1, Math.round(t.minutes * (1 - (t.progress ?? 0)))))
const kind = computed(() => (t.kind === 'graph' ? 'Node graph' : 'App'))
</script>

<template>
  <MediaCard class="mar-learn-card" @click="$emit('open')" @keydown.enter="$emit('open')">
    <template #media>
      <img :src="thumb(t.thumbId)" alt="" loading="lazy" class="size-full object-cover" />
      <span class="mar-learn-play" aria-hidden="true"><Play :size="16" fill="currentColor" /></span>
      <span
        v-if="started"
        class="mar-learn-bar"
        role="progressbar"
        :aria-valuenow="Math.round((t.progress ?? 0) * 100)"
        aria-valuemin="0"
        aria-valuemax="100"
        ><span :style="{ width: `${(t.progress ?? 0) * 100}%` }"
      /></span>
    </template>
    <template v-if="t.isNew && !watched && !started" #top-left>
      <Badge variant="overlay" size="md">New</Badge>
    </template>
    <template #bottom-right>
      <Badge variant="overlay" size="md" class="tabular-nums" :class="started && 'mb-1'">
        <template v-if="watched"><Check :size="12" :stroke-width="2.5" />Watched</template>
        <template v-else-if="started">{{ left }} min left</template>
        <template v-else>{{ t.minutes }} min</template>
      </Badge>
    </template>
    <p class="flex items-center gap-2 text-ui font-medium">
      <span class="min-w-0 flex-1 truncate">{{ t.title }}</span>
      <span class="shrink-0 text-subtle-foreground" :title="kind" :aria-label="kind" role="img">
        <GraphIcon v-if="t.kind === 'graph'" :size="13" /><AppIcon v-else :size="13" />
      </span>
    </p>
    <p class="mt-1 truncate text-ui text-subtle-foreground">{{ t.blurb }}</p>
  </MediaCard>
</template>

<style>
/* Global: shared with the course panel's "Up next" image. */
.mar-learn-play {
  position: absolute;
  top: 50%;
  left: 50%;
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 999px;
  color: oklch(1 0 0);
  background: oklch(0 0 0 / 0.5);
  backdrop-filter: blur(10px);
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.92);
  transition:
    opacity 160ms ease,
    transform 160ms ease;
  pointer-events: none;
}
.mar-learn-play > svg {
  margin-left: 2px;
}
.group:hover .mar-learn-play,
.group:focus-visible .mar-learn-play {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}
.mar-learn-bar {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 3px;
  background: oklch(1 0 0 / 0.22);
}
.mar-learn-bar > span {
  display: block;
  height: 100%;
  background: oklch(1 0 0 / 0.92);
}
</style>
