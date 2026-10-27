<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { AppWindow, ArrowLeft, ArrowUpRight, Plus, Sparkles } from 'lucide-vue-next'
import Badge from '../../ui/Badge.vue'
import Button from '../../ui/Button.vue'
import SegmentedControl from '../../ui/SegmentedControl.vue'
import PromptBox from '../PromptBox.vue'
import AgentThread from './AgentThread.vue'
import AppThemeFrame from './AppThemeFrame.vue'
import AppPreviewLoading from './AppPreviewLoading.vue'
import {
  flow,
  LAYOUTS,
  libApp,
  openAppUrl,
  resetFlow,
  enterBuilder,
  exitBuilder,
  send,
  suggestions,
  type AppLayout
} from '../../appFlow'

/**
 * Making an app with the agent. It starts as a conversation; from
 * "Create an app" on, the screen splits: the chat on the left, the app on
 * the right, updating as it is built. The first pass goes layout, inputs,
 * look; every step stays editable, and typing changes anything.
 */
const text = ref('')
const scroller = ref<HTMLElement>()
watch(
  () => [flow.messages.length, flow.messages.at(-1)?.shown, flow.stage, flow.split],
  () => nextTick(() => scroller.value?.scrollTo({ top: 1e6, behavior: 'smooth' }))
)
function submit(t = text.value): void {
  send(t)
  text.value = ''
}
const d = computed(() => flow.draft)
const live = computed(() => libApp(flow.appId))

// The first time only ("Create an app"): the preview loads while the
// agent makes the first version (at least ~0.9 s). "Preview app" later
// shows the app straight away.
const loading = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
watch(
  () => flow.split,
  (on) => {
    clearTimeout(timer)
    loading.value = false
    if (!on || flow.stage !== 'workflow') return
    loading.value = true
    const settle = (): void => {
      if (flow.stage === 'workflow') timer = setTimeout(settle, 150)
      else loading.value = false
    }
    timer = setTimeout(settle, 900)
  },
  { immediate: true }
)
// After Exit: the draft is still there, one click away.
const canBuild = computed(() => !!d.value && !['idle', 'workflow'].includes(flow.stage))
// The inputs on the app: the checked ones, as the agent adds them.
const fields = computed(() =>
  (d.value?.fields ?? []).filter((f) => f.on).slice(0, flow.fieldsShown)
)
</script>

<template>
  <div
    :class="[
      'agent-split absolute inset-0 min-h-0',
      flow.split
        ? 'grid grid-cols-[minmax(360px,440px)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-clip'
        : 'flex flex-col'
    ]"
  >
    <!-- Left: the chat -->
    <!-- The chat re-enters (a short fade) as it moves into its column -->
    <section
      :key="flow.split ? 'split' : 'full'"
      :class="[
        'chat-col flex min-h-0 flex-col overflow-clip',
        flow.split ? 'border-r border-border-default' : 'h-full'
      ]"
    >
      <header
        :class="[
          'flex items-center gap-2',
          flow.split ? 'h-14 shrink-0 border-b border-border-default px-3' : 'px-10 pt-6 pb-4'
        ]"
      >
        <!-- App-builder mode: the way out, top left -->
        <Button v-if="flow.split" variant="ghost" size="sm" @click="exitBuilder"
          ><ArrowLeft :size="13" />Exit</Button
        >
        <h1 v-else class="flex min-w-0 items-center gap-2 text-heading font-semibold">
          <Sparkles :size="16" /><span class="truncate">{{ d?.name ?? 'New app' }}</span>
        </h1>
        <span class="flex-1" />
        <Button v-if="!flow.split && canBuild" size="sm" @click="enterBuilder"
          ><AppWindow :size="13" />Preview app</Button
        >
        <Button variant="ghost" size="sm" @click="resetFlow"><Plus :size="13" />New</Button>
      </header>
      <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
        <div :class="['w-full pt-2 pb-10', flow.split ? 'px-5' : 'mx-auto max-w-3xl px-6']">
          <AgentThread />
          <div v-if="!flow.busy && suggestions().length" class="mt-5 flex flex-wrap gap-2 pl-10">
            <Button v-for="s in suggestions()" :key="s" size="sm" @click="submit(s)">{{
              s
            }}</Button>
          </div>
        </div>
      </div>
      <div :class="flow.split ? 'px-4 pb-4' : 'px-6 pb-5'">
        <PromptBox
          v-model="text"
          chat
          :class="flow.split ? '' : 'mx-auto max-w-3xl'"
          @send="submit"
        />
      </div>
    </section>

    <!-- Right: the app, live -->
    <Transition name="app-pane" appear>
      <section v-if="flow.split && d" class="flex min-h-0 flex-col overflow-clip">
        <header class="flex h-14 shrink-0 items-center gap-3 border-b border-border-default px-5">
          <span class="truncate text-ui font-medium">{{ d.name }}</span>
          <Badge v-if="live" variant="outline"
            ><span class="size-1.5 rounded-full bg-status-running" />Live</Badge
          >
          <Badge v-else>Draft</Badge>
          <span class="flex-1" />
          <SegmentedControl
            v-if="!live"
            :model-value="d.layout"
            size="sm"
            :options="LAYOUTS.map((l) => ({ value: l.id, label: l.label }))"
            @update:model-value="(v: string) => (d!.layout = v as AppLayout)"
          />
          <Button v-else size="sm" variant="primary" @click="openAppUrl(live.id)"
            >Open app<ArrowUpRight :size="12"
          /></Button>
        </header>
        <div class="relative min-h-0 flex-1 overflow-y-auto">
          <!-- A short load while the agent makes the first version -->
          <Transition name="preview-load">
            <AppPreviewLoading
              v-if="loading"
              :layout="d.layout"
              class="absolute inset-0 z-1 bg-app-background"
            />
          </Transition>
          <AppThemeFrame
            compact
            class="min-h-full"
            :name="d.name"
            :blurb="d.blurb"
            author="Pablo · Silverside"
            :thumb-id="d.thumbId"
            :fields
            :cost="d.cost"
            :payer="live ? 'Paid by you' : 'Paid by you while it is a draft'"
            :layout="d.layout"
            :theme="d.theme"
          />
        </div>
      </section>
    </Transition>
  </div>
</template>

<style>
/* The main area's decorative glow is taller than the window, so it can
   scroll a little. The agent's split view fills it exactly: keep it still
   (clip is not a scroll container, so focus can't scroll it either). */
.proto-main.proto-main:has(> .agent-split) {
  overflow: clip;
}
</style>

<style scoped>
/* Entering app-builder mode: the app opens on the right (fade, with a
   small shift from the right and a touch of scale - never from zero),
   just after the sidebar starts to close. Strong ease-out: it enters. */
.app-pane-enter-active {
  transition:
    opacity 420ms cubic-bezier(0.19, 1, 0.22, 1) 80ms,
    transform 420ms cubic-bezier(0.19, 1, 0.22, 1) 80ms;
}
.app-pane-enter-from {
  opacity: 0;
  transform: translateX(24px) scale(0.99);
}
/* Exit is quicker and simpler: it just fades, holding its place while
   the chat takes the full width back. */
.app-pane-leave-active {
  position: absolute;
  inset: 0 0 0 min(440px, 36%);
  transition: opacity 180ms ease;
}
.app-pane-leave-to {
  opacity: 0;
}
/* The preview fades in over its loading state. */
.preview-load-leave-active {
  transition: opacity 260ms ease;
}
.preview-load-leave-to {
  opacity: 0;
}
/* The chat settles into its new column. */
.chat-col {
  animation: chat-settle 300ms cubic-bezier(0.19, 1, 0.22, 1);
}
@keyframes chat-settle {
  from {
    opacity: 0;
    transform: translateX(-8px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .app-pane-enter-from {
    transform: none;
  }
  .chat-col {
    animation: chat-fade 200ms ease;
  }
  @keyframes chat-fade {
    from {
      opacity: 0;
    }
  }
}
</style>
