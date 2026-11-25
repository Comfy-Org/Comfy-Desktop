<script setup lang="ts">
import type { Component } from 'vue'
import { Coins } from 'lucide-vue-next'
import { AgentChat } from '../../icons/agentChat'
import {
  Astroid,
  ComfyAssets,
  ComfyModel,
  ComfyNode,
  ComfyTemplate,
  ComfyWorkflow
} from '../../icons/comfyIcons'
import { AppIcon, GraphIcon } from '../../icons/kindIcons'
import Cell from '../kit/Cell.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'

const ICONS: { name: string; icon: Component; use: string }[] = [
  { name: 'GraphIcon', icon: GraphIcon, use: 'A workflow (node graph)' },
  { name: 'AppIcon', icon: AppIcon, use: 'An app (panels-top-left)' },
  { name: 'AgentChat', icon: AgentChat, use: 'Agent: a chat with a corner sparkle' },
  { name: 'ComfyWorkflow', icon: ComfyWorkflow, use: 'Comfy workflow' },
  { name: 'ComfyTemplate', icon: ComfyTemplate, use: 'Template' },
  { name: 'ComfyAssets', icon: ComfyAssets, use: 'Assets' },
  { name: 'ComfyModel', icon: ComfyModel, use: 'Model' },
  { name: 'ComfyNode', icon: ComfyNode, use: 'Node' },
  { name: 'Astroid', icon: Astroid, use: 'Comfy mark' },
  { name: 'Coins', icon: Coins, use: 'Credits, in credit gold (lucide)' }
]
</script>

<template>
  <Section
    title="Production icons"
    note="Where the product already has the concept, its icon. 15px in the sidebar, 16 elsewhere, 20 large; the stroke follows lucide."
  >
    <Cells :min="180">
      <Cell v-for="i in ICONS" :key="i.name" :label="`${i.name} · ${i.use}`">
        <span class="flex items-center gap-4 text-base-foreground">
          <component :is="i.icon" :size="15" :class="i.name === 'Coins' && 'ds-gold'" />
          <component :is="i.icon" :size="16" :class="i.name === 'Coins' && 'ds-gold'" />
          <component :is="i.icon" :size="20" :class="i.name === 'Coins' && 'ds-gold'" />
          <component :is="i.icon" :size="20" class="text-muted-foreground" />
        </span>
      </Cell>
    </Cells>
  </Section>
</template>

<style>
/* Production's credit gold (parts/WorkspaceMenu.vue), deeper in light (mar/shell/marShell.css). */
.ds-gold {
  color: #ddbd31;
}
[data-ds-theme='light'] .ds-gold {
  color: oklch(0.66 0.13 85);
}
</style>
