<script setup lang="ts">
import { ArrowRight, Cloud, Download, Laptop } from 'lucide-vue-next'
import { go, hostActions, proto } from '../useProto'
import { INSTANCES } from '../mock'
import { onCloud } from './shell/surface'
import { can } from '../milestones'
import SectionHeader from '../ui/SectionHeader.vue'
import ExampleShowcase from './userStates/ExampleShowcase.vue'
import { EXAMPLES } from './userStates/examples'
import EditorEntry from './userStates/EditorEntry.vue'
import { editorEntry } from './userStates/editorEntry'

/**
 * First run · Original (UI Playground › First run): the same Home a
 * returning user gets, only emptier: under the same greeting and prompt
 * (MarHomeV10.vue), run an example (in the look from UI Playground ›
 * First-time examples), or, for those who already know ComfyUI, open the node editor on
 * Cloud or on this computer (UI Playground › Node editor entry).
 */
function openCloud(): void {
  if (proto.signedIn) hostActions.launch(INSTANCES[0]!)
  else hostActions.signIn()
}
</script>

<template>
  <section class="mt-10">
    <SectionHeader
      title="Run an example on Comfy Cloud"
      :link="can.explore ? 'See all' : undefined"
      @link="go('explore')"
    >
      <template #controls>
        <span
          class="inline-flex h-5 items-center rounded-full bg-secondary-background px-2 text-ui text-muted-foreground"
          >{{ EXAMPLES.length }}</span
        >
      </template>
    </SectionHeader>
    <ExampleShowcase />
  </section>

  <section class="mt-10">
    <SectionHeader v-if="editorEntry.id !== 'banner'" title="For ComfyUI users" />
    <EditorEntry v-if="editorEntry.id !== 'rows'" />
    <div v-else class="mar-start-ways">
      <button type="button" class="mar-start-way" @click="openCloud">
        <span class="mar-start-icon"><Cloud :size="17" /></span>
        <span class="flex min-w-0 flex-1 flex-col text-left">
          <span class="text-ui font-medium text-base-foreground">Comfy Cloud</span>
          <span class="text-ui text-subtle-foreground">Fast GPUs, every model ready</span>
        </span>
        <ArrowRight :size="15" class="mar-start-go" />
      </button>
      <button type="button" class="mar-start-way" @click="hostActions.newInstance()">
        <span class="mar-start-icon"><Laptop :size="17" /></span>
        <span class="flex min-w-0 flex-1 flex-col text-left">
          <span class="text-ui font-medium text-base-foreground">This computer</span>
          <span class="text-ui text-subtle-foreground">{{
            onCloud
              ? 'Install the Desktop app, runs on your GPU'
              : 'Set up: runs on your GPU, works offline'
          }}</span>
        </span>
        <component :is="onCloud ? Download : ArrowRight" :size="15" class="mar-start-go" />
      </button>
    </div>
  </section>
</template>

<style scoped>
.mar-start-ways {
  display: grid;
  width: 100%;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.mar-start-icon {
  display: inline-flex;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-muted-foreground);
}
.mar-start-go {
  margin-right: 8px;
  color: var(--color-subtle-foreground);
  transition: transform 400ms cubic-bezier(0.16, 1, 0.3, 1);
}
.mar-start-way:hover .mar-start-go {
  color: var(--color-base-foreground);
  transform: translateX(3px);
}
@media (prefers-reduced-motion: reduce) {
  .mar-start-go {
    transition: none;
  }
}
</style>

<style>
/* Global: these are buttons, past the prototype's button reset. */
:root .proto-ui.proto-ui.proto-ui .mar-start-way {
  display: flex;
  width: auto;
  height: 72px;
  align-items: center;
  gap: 14px;
  padding: 0 18px 0 16px;
  border-radius: 18px;
  background: color-mix(in oklch, var(--color-card-background) 72%, transparent);
  backdrop-filter: blur(20px);
  transition: background-color 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-start-way:hover {
  background: color-mix(in oklch, var(--color-card-background-hover) 80%, transparent);
}
</style>
