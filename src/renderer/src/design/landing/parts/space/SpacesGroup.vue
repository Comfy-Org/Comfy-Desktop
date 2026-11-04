<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Tooltip from '../../ui/Tooltip.vue'
import { cn } from '../../ui/cn'
import SpaceMark from './SpaceMark.vue'
import { SPACES } from '../../spaces'
import { go, proto, type Page } from '../../useProto'
import MarGroupTitle from '../../mar/shell/MarGroupTitle.vue'
import MarSpacesInvite from '../../mar/userStates/MarSpacesInvite.vue'

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
      <MarGroupTitle title="Spaces" :active="proto.page === 'spaces'" @click="go('spaces')" />
      <!-- With none yet, the invitation below is the one way to add. -->
      <Tooltip v-if="SPACES.length" content="New space">
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
    <!-- None yet (a first-time user): an invitation. -->
    <MarSpacesInvite v-if="!SPACES.length" />
  </div>
</template>
