<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { Plus, Sparkles } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import PromptBox from '../PromptBox.vue'
import AgentThread from './AgentThread.vue'
import { flow, resetFlow, send, suggestions } from '../../appFlow'

/** Variant 1 · Chat: one conversation; each step is a card in the thread. */
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
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <header class="flex items-center gap-2 px-10 pt-6 pb-4">
      <h1 class="flex items-center gap-2 text-heading font-semibold">
        <Sparkles :size="16" />{{ flow.draft?.name ?? 'New app' }}
      </h1>
      <Button variant="ghost" size="sm" class="ml-auto" @click="resetFlow"
        ><Plus :size="13" />New</Button
      >
    </header>
    <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
      <div class="mx-auto w-full max-w-3xl px-6 pt-4 pb-10">
        <AgentThread />
        <div v-if="!flow.busy && suggestions().length" class="mt-5 flex flex-wrap gap-2 pl-10">
          <Button v-for="s in suggestions()" :key="s" size="sm" @click="submit(s)">{{ s }}</Button>
        </div>
      </div>
    </div>
    <div class="px-6 pb-5">
      <PromptBox v-model="text" chat class="mx-auto max-w-3xl" @send="submit" />
    </div>
  </div>
</template>
