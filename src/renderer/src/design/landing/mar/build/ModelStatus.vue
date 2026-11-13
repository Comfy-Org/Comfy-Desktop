<script setup lang="ts">
import { computed } from 'vue'
import { Check, Download, Pause, Play, RotateCw, X } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Tooltip from '../../ui/Tooltip.vue'
import { toast } from '../../useProto'
import { downloadOf, fmtSize, freeGb, modelsApi, type Model } from './models'

/** A model's state and the one action it needs: download, the live
 *  progress with pause / resume / cancel, retry when it failed, or a quiet
 *  check when it's on disk. Same control in rows, cards and the detail. */
const { model, wide = false } = defineProps<{ model: Model; wide?: boolean }>()
const dl = computed(() => downloadOf(model.id))
const pct = computed(() =>
  dl.value ? Math.min(100, Math.round((dl.value.receivedGb / model.sizeGb) * 100)) : 0
)
const label = computed(() => {
  const d = dl.value
  if (!d) return ''
  if (d.state === 'queued') return 'Queued'
  if (d.state === 'paused') return `Paused · ${pct.value}%`
  if (d.state === 'failed') return `Failed · ${d.error ?? 'retry'}`
  const left = ((model.sizeGb - d.receivedGb) * 1000) / Math.max(1, d.speed)
  return `${pct.value}% · ${d.speed} MB/s · ${left < 60 ? `${Math.ceil(left)} s` : `${Math.ceil(left / 60)} min`} left`
})

function download(): void {
  if (!modelsApi.download(model.id))
    toast(`Not enough space: ${fmtSize(model.sizeGb)} needed, ${fmtSize(freeGb.value)} free`)
}
</script>

<template>
  <div class="mm-status" :class="{ 'is-wide': wide }" @click.stop>
    <span v-if="model.installed" class="mm-installed"><Check :size="13" />On disk</span>
    <Button v-else-if="!dl" size="sm" @click="download"
      ><Download :size="13" />{{
        wide ? `Download · ${fmtSize(model.sizeGb)}` : 'Download'
      }}</Button
    >
    <template v-else>
      <div class="mm-progress" :class="`is-${dl.state}`">
        <span class="mm-progress-label">{{ label }}</span>
        <span class="mm-progress-track"><i :style="{ width: `${pct}%` }" /></span>
      </div>
      <Tooltip v-if="dl.state === 'failed'" content="Retry">
        <Button size="sm" variant="ghost" aria-label="Retry" @click="modelsApi.retry(model.id)"
          ><RotateCw :size="13"
        /></Button>
      </Tooltip>
      <Button
        v-else-if="dl.state === 'paused'"
        size="sm"
        variant="ghost"
        aria-label="Resume"
        @click="modelsApi.resume(model.id)"
        ><Play :size="13"
      /></Button>
      <Button v-else size="sm" variant="ghost" aria-label="Pause" @click="modelsApi.pause(model.id)"
        ><Pause :size="13"
      /></Button>
      <Button
        size="sm"
        variant="ghost"
        aria-label="Cancel download"
        @click="modelsApi.cancel(model.id)"
        ><X :size="13"
      /></Button>
    </template>
  </div>
</template>

<style scoped>
.mm-status {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
}
.mm-installed {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
.mm-progress {
  display: flex;
  width: 150px;
  flex-direction: column;
  gap: 5px;
  margin-right: 4px;
}
.is-wide .mm-progress {
  width: auto;
  flex: 1;
}
.mm-progress-label {
  overflow: hidden;
  color: var(--color-muted-foreground);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mm-progress-track {
  display: block;
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
.mm-progress-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-base-foreground);
  transition: width 0.2s linear;
}
.is-paused .mm-progress-track i,
.is-queued .mm-progress-track i {
  background: var(--color-subtle-foreground);
}
.is-failed .mm-progress-label {
  color: var(--color-status-danger, #f87171);
}
.is-failed .mm-progress-track i {
  background: var(--color-status-danger, #f87171);
}
</style>
