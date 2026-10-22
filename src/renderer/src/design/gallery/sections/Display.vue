<script setup lang="ts">
import { Workflow } from 'lucide-vue-next'
import Avatar from '../../landing/ui/Avatar.vue'
import Button from '../../landing/ui/Button.vue'
import EmptyState from '../../landing/ui/EmptyState.vue'
import LocationIcon from '../../landing/ui/LocationIcon.vue'
import Meter from '../../landing/ui/Meter.vue'
import Sparkline from '../../landing/ui/Sparkline.vue'
import StatusDot from '../../landing/ui/StatusDot.vue'
import GallerySection from '../parts/GallerySection.vue'
import Specimen from '../parts/Specimen.vue'
import VariantGroup from '../parts/VariantGroup.vue'
import Stage from '../parts/Stage.vue'
import { state } from '../playground'

const a = state.avatar
const e = state.empty
const SIZES = ['xs', 'sm', 'md', 'lg', 'xl'] as const
const TREND = [12, 18, 15, 22, 30, 26, 34, 41, 38, 47]
</script>

<template>
  <GallerySection
    id="avatar"
    title="Avatar"
    description="Rounded-square tile for monograms and icons."
    tweak-key="avatar"
  >
    <Stage>
      <Avatar :size="a.size as never" :tone="a.tone as never">S</Avatar>
    </Stage>
    <VariantGroup title="Size" prop="size">
      <Specimen v-for="s in SIZES" :key="s" :label="s"><Avatar :size="s">S</Avatar></Specimen>
    </VariantGroup>
    <VariantGroup title="Tone" prop="tone">
      <Specimen label="default"><Avatar>S</Avatar></Specimen>
      <Specimen label="solid"><Avatar tone="solid">P</Avatar></Specimen>
    </VariantGroup>
  </GallerySection>

  <GallerySection
    id="status"
    :components="['StatusDot', 'Meter', 'Sparkline', 'LocationIcon']"
    title="Status and data"
    description="Small signals: state dots, usage meters, trends, where it runs."
  >
    <VariantGroup title="StatusDot" prop="status">
      <Specimen label="running">
        <span class="flex items-center gap-2 text-ui"><StatusDot status="running" />Running</span>
      </Specimen>
      <Specimen label="idle (default)">
        <span class="flex items-center gap-2 text-ui"><StatusDot />Stopped</span>
      </Specimen>
    </VariantGroup>
    <VariantGroup title="Meter" prop="value / max" cell="md">
      <Specimen label="64 / 100" fill><Meter :value="64" :max="100" /></Specimen>
      <Specimen label="120 / 100 · over limit" fill><Meter :value="120" :max="100" /></Specimen>
    </VariantGroup>
    <VariantGroup title="Sparkline" prop="values" cell="md">
      <Specimen label="10 points"><Sparkline :values="TREND" /></Specimen>
    </VariantGroup>
    <VariantGroup title="LocationIcon" prop="kind">
      <Specimen label="local"><LocationIcon kind="local" /></Specimen>
      <Specimen label="cloud"><LocationIcon kind="cloud" /></Specimen>
    </VariantGroup>
  </GallerySection>

  <GallerySection
    id="empty"
    title="Empty state"
    description="Says what will live here and points forward with one action."
    tweak-key="empty"
  >
    <Stage>
      <EmptyState
        :icon="Workflow"
        :layout="e.layout as never"
        :title="String(e.title)"
        :description="String(e.description)"
      >
        <Button v-if="e.action" variant="primary">Ask the agent</Button>
      </EmptyState>
    </Stage>
  </GallerySection>
</template>
