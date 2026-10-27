<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowUpRight, Plus, Sparkles } from 'lucide-vue-next'
import Badge from '../../ui/Badge.vue'
import Button from '../../ui/Button.vue'
import SegmentedControl from '../../ui/SegmentedControl.vue'
import PromptBox from '../PromptBox.vue'
import AgentThread from './AgentThread.vue'
import AppThemeFrame from './AppThemeFrame.vue'
import CustomizePanel from './CustomizePanel.vue'
import {
  flow,
  LAYOUTS,
  libApp,
  openAppUrl,
  resetFlow,
  send,
  suggestions,
  type AppLayout
} from '../../appFlow'

/**
 * Making an app with the agent. It starts as a conversation; from
 * "Create an app" on, the screen splits: the chat on the left, the app on
 * the right, updating as it is built (layout, inputs, look). Customizing
 * the look happens in the left column too - no dialog.
 */
const text = ref('')
const scroller = ref<HTMLElement>()
watch(
  () => [flow.messages.length, flow.messages.at(-1)?.shown, flow.stage],
  () => nextTick(() => scroller.value?.scrollTo({ top: 1e6, behavior: 'smooth' }))
)
function submit(t = text.value): void {
  send(t)
  text.value = ''
}
const d = computed(() => flow.draft)
const live = computed(() => libApp(flow.appId))
// The inputs on the app: the checked ones, as the agent adds them.
const fields = computed(() =>
  (d.value?.fields ?? []).filter((f) => f.on).slice(0, flow.fieldsShown)
)
</script>

<template>
  <div
    :class="[
      'h-full min-h-0',
      flow.split ? 'grid grid-cols-[minmax(360px,440px)_minmax(0,1fr)]' : 'flex flex-col'
    ]"
  >
    <!-- Left: the chat, or the customize panel -->
    <section
      :class="['flex min-h-0 flex-col', flow.split ? 'border-r border-border-default' : 'h-full']"
    >
      <CustomizePanel v-if="flow.customizing" />
      <template v-else>
        <header :class="['flex items-center gap-2 pt-6 pb-4', flow.split ? 'px-5' : 'px-10']">
          <h1 class="flex min-w-0 items-center gap-2 text-heading font-semibold">
            <Sparkles :size="16" /><span class="truncate">{{ d?.name ?? 'New app' }}</span>
          </h1>
          <Button variant="ghost" size="sm" class="ml-auto" @click="resetFlow"
            ><Plus :size="13" />New</Button
          >
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
      </template>
    </section>

    <!-- Right: the app, live -->
    <section v-if="flow.split && d" class="flex min-h-0 flex-col">
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
      <div class="min-h-0 flex-1 overflow-y-auto">
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
  </div>
</template>
