<script setup lang="ts">
import { Bell, ChevronDown, Download, Menu, MessageSquarePlus } from 'lucide-vue-next'
import TitleBarBreadcrumb from './nav/TitleBarBreadcrumb.vue'
import ComfyCLogo from '../../../components/icons/ComfyCLogo.vue'
import { toast } from '../useProto'
import { can } from '../milestones'
import { runTitleBarCommand, titleBarState } from '../titleBar'

/**
 * Browser preview only: a stand-in for the desktop app's title bar, laid
 * out like the real one at this milestone: today's layout (menu left, the
 * centre pill) until the breadcrumb arrives (Milestone 3) - then the
 * breadcrumb on the left and the app menu at the right.
 */
</script>

<template>
  <header
    class="relative flex h-11 shrink-0 items-center gap-3 glass-titlebar border-b border-border-default bg-titlebar-background px-3.5 select-none"
  >
    <span class="flex gap-2" aria-hidden="true">
      <span class="size-3 rounded-full bg-[#ff5f57]" /><span
        class="size-3 rounded-full bg-[#febc2e]"
      /><span class="size-3 rounded-full bg-[#28c840]" />
    </span>
    <span class="w-2" aria-hidden="true" />
    <TitleBarBreadcrumb
      v-if="can.breadcrumb"
      :state="titleBarState"
      @command="runTitleBarCommand"
    />
    <template v-else>
      <button
        type="button"
        class="text-muted-foreground hover:text-base-foreground"
        aria-label="Menu"
        @click="toast('App menu')"
      >
        <Menu :size="16" />
      </button>
      <button
        type="button"
        class="absolute left-1/2 flex h-7 w-72 -translate-x-1/2 items-center gap-2 rounded-control border border-border-default bg-white/[0.03] px-3 text-ui text-base-foreground"
        @click="toast('Instance picker')"
      >
        <ComfyCLogo :size="14" />
        <span class="flex-1 text-center">Comfy Desktop</span>
        <ChevronDown :size="12" class="text-subtle-foreground" />
      </button>
    </template>
    <span class="ml-auto flex items-center gap-3.5 text-muted-foreground">
      <Bell :size="15" />
      <MessageSquarePlus :size="15" />
      <Download :size="15" />
      <button
        v-if="can.breadcrumb"
        type="button"
        class="hover:text-base-foreground"
        aria-label="Menu"
        @click="toast('App menu')"
      >
        <Menu :size="16" />
      </button>
    </span>
  </header>
</template>
