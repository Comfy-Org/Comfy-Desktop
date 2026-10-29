<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Play } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import { LOCAL_ASSET_FOLDERS, thumb } from '../../mock'
import { go, hostActions, instanceById } from '../../useProto'

/**
 * Netflix's hero (looks/netflix.css): the latest output, edge to edge at
 * the top of Home, with the image-text treatment Home's launch banner
 * already uses (white type on a veil, a white CTA). It lands inside Home's
 * own column (`.mar-home`, a Teleport) only while that column is on
 * screen, so Home's code stays as it is.
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
      <span class="mar-nf-hero-veil" aria-hidden="true" />
      <div class="mar-nf-hero-copy">
        <p class="text-ui text-white/80">Latest output · {{ inst?.name ?? 'This computer' }}</p>
        <h3
          class="mt-1.5 text-[30px] leading-[1.15] font-medium tracking-[-0.015em] text-white drop-shadow-sm"
        >
          {{ latest.name }}
        </h3>
        <p class="mt-1 text-ui text-white/80">{{ latest.modified }} · {{ latest.size }}</p>
        <div class="mt-5 flex items-center gap-4">
          <Button
            variant="primary"
            size="lg"
            class="bg-white text-black hover:bg-white/90"
            @click="inst && hostActions.launch(inst, 'hero-shot-v4')"
            ><Play :size="14" />Open workflow</Button
          >
          <Button variant="link" class="text-white/80 hover:text-white" @click="go('assets')"
            >See in Assets</Button
          >
        </div>
      </div>
    </section>
  </Teleport>
</template>
