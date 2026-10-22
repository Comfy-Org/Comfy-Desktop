<script setup lang="ts">
import { computed } from 'vue'
import { MessageSquare, Plus } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import { agent, resetAgent } from '../../agent'
import { go, toast } from '../../useProto'

/** Sidebar in Agent mode: a new chat, and recent chats. */
const current = computed(() => agent.messages.find((m) => m.role === 'user')?.text)
const RECENT = [
  'Seasonal backgrounds for Nike',
  'Coca-Cola shade swatches app',
  'Upscale Porsche renders to 4K'
]
function newChat(): void {
  resetAgent()
  go('agent')
}
</script>

<template>
  <nav class="flex flex-col gap-px" aria-label="Agent">
    <Button
      variant="ghost"
      class="h-8 w-full justify-start gap-2.5 px-3 text-ui font-normal"
      @click="newChat"
      ><Plus :size="15" /><span class="sidebar-label text-left">New chat</span></Button
    >
  </nav>
  <div class="mt-5.5 flex flex-col">
    <div
      class="flex h-6.5 items-center px-3 text-ui font-medium tracking-wider text-subtle-foreground uppercase"
    >
      <span>Recent</span>
    </div>
    <Button
      v-if="current"
      variant="ghost"
      class="h-8 w-full justify-start gap-2.5 bg-secondary-background-hover px-3 text-ui font-normal text-base-foreground"
      @click="go('agent')"
      ><MessageSquare :size="14" /><span class="sidebar-label text-left">{{
        current
      }}</span></Button
    >

    <Button
      v-for="r in RECENT"
      :key="r"
      variant="ghost"
      class="h-8 w-full justify-start gap-2.5 px-3 text-ui font-normal"
      @click="toast(`Open “${r}”`)"
      ><MessageSquare :size="14" /><span class="sidebar-label text-left">{{ r }}</span></Button
    >
  </div>
</template>
