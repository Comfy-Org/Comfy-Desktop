<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import CollapsibleSectionToggle from '../../components/CollapsibleSectionToggle.vue'
import { lastNonEmptyLine } from '../../lib/performanceTestResults'

const FOLLOW_THRESHOLD_PX = 24
const MONOSPACE = "font-[ui-monospace,SFMono-Regular,Consolas,'Liberation_Mono',monospace]"

const props = defineProps<{
  logs: string
}>()

const expanded = defineModel<boolean>('expanded', { required: true })

const { t } = useI18n()
const pane = useTemplateRef<HTMLElement>('pane')
const shownLogs = computed(() => props.logs.trimStart())
const lastLine = computed(() => lastNonEmptyLine(props.logs))

function scrollToEnd(): void {
  if (pane.value) pane.value.scrollTop = pane.value.scrollHeight
}

function isFollowing(): boolean {
  const element = pane.value
  if (!element) return true
  return element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_THRESHOLD_PX
}

watch(
  () => props.logs,
  async () => {
    const follow = isFollowing()
    await nextTick()
    if (follow) scrollToEnd()
  }
)

watch(expanded, async (open) => {
  if (!open) return
  await nextTick()
  scrollToEnd()
})
</script>

<template>
  <section
    class="performance-test__logs-section mt-9 flex w-full min-w-0 flex-none flex-col"
    :class="{ 'performance-test__logs-section--collapsed': !expanded }"
  >
    <div class="flex min-h-10 min-w-0 items-center">
      <CollapsibleSectionToggle
        class="shrink-0 self-center text-[11px] font-semibold tracking-[0.04em] text-subtle-foreground uppercase hover:text-foreground [&_.collapsible-section-toggle__chevron]:size-3.5"
        :expanded="expanded"
        :label="t('settings.logs')"
        @toggle="expanded = !expanded"
      />
      <span
        v-if="!expanded"
        class="performance-test__logs-summary ml-3 min-w-0 truncate text-[12px] text-text-muted"
        :class="MONOSPACE"
        >{{ lastLine || t('performanceTest.logsPlaceholder') }}</span
      >
    </div>
    <div
      v-show="expanded"
      ref="pane"
      class="performance-test__logs mt-1.5 max-h-[min(360px,37.5vh)] min-h-0 overflow-auto rounded-xl bg-[color-mix(in_srgb,black_35%,transparent)] px-3.5 py-3 text-[12px] leading-[1.65] whitespace-pre-wrap text-text-muted scroll-visible"
      :class="MONOSPACE"
      role="log"
    >
      {{ shownLogs || t('performanceTest.logsPlaceholder') }}
    </div>
  </section>
</template>
