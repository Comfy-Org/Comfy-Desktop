<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { FolderOpen, Play } from 'lucide-vue-next'
import { LOCAL_ASSET_FOLDERS, thumb } from '../../mock'
import { go, hostActions, instanceById } from '../../useProto'

/**
 * Netflix's hero (looks/netflix.css): the latest output, edge to edge at
 * the top of Home, with what made it and the two things to do next. It
 * lands inside Home's own column (`.mar-home`, a Teleport) only while that
 * column is on screen, so Home's code stays as it is.
 */

// The newest file in the first build's output folder: a picture that no
// row on Home shows (rows show workflow covers, not outputs).
const folder = LOCAL_ASSET_FOLDERS.find((f) => f.name === 'output')!
const latest = folder.files.find((f) => f.kind === 'image')!
const inst = folder.instanceId ? instanceById(folder.instanceId) : undefined
const src = thumb(latest.thumbId!)

const target = ref<HTMLElement | null>(null)
let watcher: MutationObserver | undefined
onMounted(() => {
  const find = (): void => {
    const el = document.querySelector<HTMLElement>('.mar-home')
    if (el !== target.value) target.value = el
  }
  find()
  // Home comes and goes with navigation; follow it.
  watcher = new MutationObserver(find)
  watcher.observe(document.body, { childList: true, subtree: true })
})
onBeforeUnmount(() => watcher?.disconnect())
</script>

<template>
  <Teleport v-if="target" :to="target">
    <section class="mar-nf-hero" aria-label="Latest output">
      <img :src alt="" class="mar-nf-hero-img" />
      <div class="mar-nf-hero-copy">
        <p class="mar-nf-hero-kicker">Latest output</p>
        <h2 class="mar-nf-hero-title">
          {{ latest.name.replace(/_\d+\.\w+$/, '').replace(/_/g, ' ') }}
        </h2>
        <p class="mar-nf-hero-meta">
          {{ inst?.name ?? 'This computer' }} · {{ latest.modified }} · {{ latest.size }}
        </p>
        <div class="mar-nf-hero-actions">
          <button
            type="button"
            class="mar-nf-hero-primary"
            @click="inst && hostActions.launch(inst, 'hero-shot-v4')"
          >
            <Play :size="16" fill="currentColor" />Open workflow
          </button>
          <button type="button" class="mar-nf-hero-secondary" @click="go('assets')">
            <FolderOpen :size="16" />Assets
          </button>
        </div>
      </div>
    </section>
  </Teleport>
</template>
