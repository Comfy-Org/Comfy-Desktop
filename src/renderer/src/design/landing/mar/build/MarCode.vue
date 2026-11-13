<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, Copy } from 'lucide-vue-next'
import { tokenize, type Lang } from './highlight'
import MarSeg from '../pages/MarSeg.vue'

/**
 * A dark code block: a bar with the file or client name (or a choice of
 * them, in MarSeg), line numbers, highlighted code and a copy button that confirms.
 * `copy` is what lands on the clipboard; `shown` is what's drawn, so a key
 * can be masked on screen and still copied in full.
 */
const {
  copy,
  shown,
  lang,
  label,
  options = [],
  prose = false,
  copyLabel = 'Copy'
} = defineProps<{
  copy: string
  shown?: string
  lang: Lang
  label?: string
  options?: { value: string; label: string }[]
  prose?: boolean
  copyLabel?: string
}>()
const picked = defineModel<string>('picked')
const emit = defineEmits<{ copied: [] }>()

const lines = computed(() => (shown ?? copy).split('\n').map((l) => tokenize(l, lang)))

const done = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
async function onCopy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(copy)
  } catch {
    // No clipboard (headless, permissions): the confirmation still shows.
  }
  done.value = true
  emit('copied')
  clearTimeout(timer)
  timer = setTimeout(() => (done.value = false), 1600)
}
</script>

<template>
  <div class="mar-bs-code">
    <div class="mar-bs-code-bar">
      <MarSeg
        v-if="options.length"
        :model-value="picked ?? ''"
        :options
        label="Client"
        on-media
        @update:model-value="picked = $event"
      />
      <span v-else class="mar-bs-code-file">{{ label }}</span>
      <button
        type="button"
        class="mar-bs-codebtn"
        :class="done && 'is-done'"
        :aria-label="done ? 'Copied' : copyLabel"
        @click="onCopy"
      >
        <component :is="done ? Check : Copy" :size="13" />{{ done ? 'Copied' : copyLabel }}
      </button>
    </div>
    <div class="mar-bs-pre" :class="prose && 'is-prose'">
      <template v-for="(line, i) in lines" :key="i">
        <span v-if="!prose" class="ln">{{ i + 1 }}</span>
        <span class="lc" :class="prose && 'col-span-2 px-4'"
          ><span v-for="(t, j) in line" :key="j" :class="t.kind !== 'plain' && `hl-${t.kind}`">{{
            t.text
          }}</span
          ><template v-if="!line.length">&#8203;</template></span
        >
      </template>
    </div>
  </div>
</template>
