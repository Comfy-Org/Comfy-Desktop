<script setup lang="ts">
import { LayoutGrid, Plus } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Tooltip from '../../ui/Tooltip.vue'
import { cn } from '../../ui/cn'
import SpaceMark from './SpaceMark.vue'
import { SPACES } from '../../spaces'
import { go, proto, type Page } from '../../useProto'

/** Sidebar group in the Spaces variant: the spaces this workspace runs. */
const itemClass = (active: boolean): string =>
  cn(
    'h-8 w-full justify-start gap-2.5 px-3 text-ui font-normal',
    active && 'bg-secondary-background-hover text-base-foreground'
  )
</script>

<template>
  <div v-if="proto.signedIn" class="mt-5.5 flex shrink-0 flex-col">
    <div class="flex h-6.5 items-center justify-between pr-1 pl-3">
      <span class="text-ui font-medium tracking-wider text-subtle-foreground uppercase"
        >Spaces</span
      >
      <Tooltip content="New space">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="New space"
          @click="proto.creatingSpace = true"
          ><Plus :size="13"
        /></Button>
      </Tooltip>
    </div>
    <Button
      variant="ghost"
      :aria-current="proto.page === 'spaces' ? 'page' : undefined"
      :class="
        cn(itemClass(proto.page === 'spaces'), proto.page !== 'spaces' && 'text-muted-foreground')
      "
      @click="go('spaces')"
    >
      <LayoutGrid :size="15" />
      <span class="sidebar-label text-left">All spaces</span>
      <span class="text-ui text-subtle-foreground tabular-nums">{{ SPACES.length }}</span>
    </Button>

    <Button
      v-for="s in SPACES"
      :key="s.id"
      variant="ghost"
      :aria-current="proto.page === `space:${s.id}` ? 'page' : undefined"
      :class="itemClass(proto.page === `space:${s.id}`)"
      @click="go(`space:${s.id}` as Page)"
    >
      <SpaceMark :brand="s.brand" size="xs" />
      <span class="sidebar-label text-left">{{ s.name }}</span>
      <span v-if="s.status === 'draft'" class="text-ui text-subtle-foreground">Draft</span>
    </Button>
  </div>
</template>
