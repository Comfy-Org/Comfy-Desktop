<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppWindow } from '@lucide/vue'

const props = defineProps<{
  appTitle: string
  picture: string | null
  status: string
  stepCount?: string | null
  waiting?: boolean
}>()
const emit = defineEmits<{ open: [] }>()

const { t } = useI18n()

const pictureBroke = ref(false)
watch(
  () => props.picture,
  () => (pictureBroke.value = false)
)
const shownPicture = computed(() => (pictureBroke.value ? null : props.picture))
const fullStatus = computed(() => [props.status, props.stepCount].filter(Boolean).join(' · '))
</script>

<template>
  <button
    type="button"
    class="flex w-full cursor-pointer items-center gap-3 border-none bg-transparent px-3 py-2.5 text-left [font:inherit] text-foreground hover:bg-card-hover/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    :aria-label="t('runOverview.openApp', { app: appTitle })"
    @click="emit('open')"
  >
    <span
      class="grid size-8 shrink-0 place-items-center overflow-hidden rounded-md bg-secondary text-muted-foreground outline outline-1 -outline-offset-1 outline-border"
      :class="{ 'opacity-60': waiting }"
      aria-hidden="true"
    >
      <img
        v-if="shownPicture"
        :src="shownPicture"
        alt=""
        class="size-full object-cover"
        draggable="false"
        @error="pictureBroke = true"
      />
      <AppWindow v-else :size="16" data-testid="run-overview-app-icon" />
    </span>
    <span class="flex min-w-0 flex-auto flex-col">
      <span class="truncate text-[14px] leading-5" :title="appTitle">{{ appTitle }}</span>
      <span
        class="flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-muted-foreground"
        :title="fullStatus"
      >
        <slot name="icon" />
        <span class="flex min-w-0 gap-1" data-testid="run-overview-status">
          <span class="truncate">{{ status }}</span>
          <span v-if="stepCount" class="shrink-0">· {{ stepCount }}</span>
        </span>
      </span>
    </span>
    <slot name="end" />
  </button>
</template>
