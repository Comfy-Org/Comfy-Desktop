<script setup lang="ts">
import ScrollRow from '../../ui/ScrollRow.vue'
import WorkflowCard from '../WorkflowCard.vue'
import { toast } from '../../useProto'
import {
  STARTERS,
  changeFromHome,
  flow,
  homeOpen,
  installInBackground,
  lowSpace,
  type Starter
} from './setupFlow'
import { imgUrl } from './canvasData'
import zitThumb from '../assets/templates/image_z_image_turbo.webp'
import minimaxThumb from '../assets/templates/video_minimax_h3_i2v.webp'

/**
 * The starter workflows, on the Home after the first local install: the one
 * place they're offered now that Set up no longer asks. They are the Home's
 * own workflow cards (WorkflowCard.vue), in a row like Recently used. Each says where it runs:
 * Local with the models it downloads on first open, or Cloud, nothing to
 * download. The recommended one of each type, and one that runs on Cloud.
 */
type Shelf = Starter & { kind: string; src: string }
const pick = (k: keyof typeof STARTERS, id: string, kind: string, src?: string): Shelf => {
  const s = STARTERS[k].find((x) => x.id === id) as Starter
  return { ...s, kind, src: src ?? imgUrl(s.img) }
}
const SHELF: Shelf[] = [
  pick('image', 'zit', 'Image', zitThumb),
  pick('video', 'minimax', 'Video', minimaxThumb),
  pick('3d', 'triposplat', '3D'),
  pick('audio', 'sa3', 'Audio'),
  pick('image', 'seedream', 'Image')
]
const where = (s: Starter): string => (s.credits ? 'Cloud' : `Local · ${s.gb} GB`)
// Home first: while the install runs behind the Home, a pick joins it (its
// models download as the last step) and ComfyUI opens on it when it ends.
const waiting = (): boolean => flow.background && flow.running
// Home first › Pick to install, before the install: a local pick starts it
// with that workflow queued. Without the space, Change setup comes first.
const toInstall = (): boolean => homeOpen.value && flow.homeCard && !flow.running
function open(s: Shelf): void {
  if (toInstall() && !s.credits) {
    if (lowSpace.value) return changeFromHome()
    flow.picked = s
    installInBackground()
    toast(`${s.title} opens when ComfyUI is ready.`)
    return
  }
  if (waiting() && !s.credits) {
    flow.picked = flow.picked?.id === s.id ? null : s
    if (flow.picked) toast(`${s.title} opens when ComfyUI is ready.`)
    return
  }
  toast(
    s.credits
      ? `Opening ${s.title} on Comfy Cloud`
      : `Downloading ${s.gb} GB of models. ${s.title} opens when they're ready.`
  )
}
</script>

<template>
  <ScrollRow :columns="5" class="mar-recent-row" aria-label="Starter workflows">
    <WorkflowCard
      v-for="s in SHELF"
      :key="s.id"
      :src="s.src"
      :title="s.title"
      :meta="s.kind"
      :right="where(s)"
      :class="waiting() && flow.picked?.id === s.id && 'mss-shelf-picked'"
      :aria-pressed="waiting() ? flow.picked?.id === s.id : undefined"
      @open="open(s)"
    />
  </ScrollRow>
</template>

<style>
/* Picked while the install runs: it opens when ComfyUI is ready. An outline,
   so it draws over the picture and wins over the card's own shadow. */
:root .proto-ui.proto-ui.proto-ui .mss-shelf-picked {
  outline: 2px solid var(--color-base-foreground);
  outline-offset: -2px;
}
</style>
