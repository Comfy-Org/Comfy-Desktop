<script setup lang="ts">
import { ref } from 'vue'
import { Check, Copy, ExternalLink, Pause, Play } from 'lucide-vue-next'
import Button from '../../../ui/Button.vue'
import { BOOKMARKLET, CLOUD, RECEIVER, type CloudStatus } from '../theme/cloudBridge'

/** ComfyUI on Comfy Cloud, in its own tab: how to connect it, and whether
 *  it is. The editor beside this paints that tab live. */
const { status, split } = defineProps<{ status: CloudStatus; split: boolean }>()
const emit = defineEmits<{ open: []; stop: []; resume: [] }>()
const copied = ref(false)
async function copy(): Promise<void> {
  await navigator.clipboard.writeText(RECEIVER)
  copied.value = true
  setTimeout(() => (copied.value = false), 1200)
}
const LABEL: Record<CloudStatus, string> = {
  closed: 'Not open',
  waiting: 'Open, waiting for the receiver',
  connected: 'Connected: edits paint Cloud live',
  paused: 'Paused: Cloud shows its own theme'
}
</script>

<template>
  <div class="stcl">
    <div class="stcl-card">
      <p :class="['stcl-status', `is-${status}`]"><i />{{ LABEL[status] }}</p>
      <h2>ComfyUI on Comfy Cloud</h2>
      <p class="stcl-note">
        Production ComfyUI, with your session. The tokens are applied the way the palette applies
        them (theme.css names on the page, litegraph’s canvas fill), so it shows what the export
        would ship. Nothing is saved to your account except the Dark / Light palette setting, which
        goes back when you stop.
      </p>
      <ol>
        <li>
          <Button variant="primary" size="sm" @click="emit('open')"
            >Open Cloud<ExternalLink :size="14"
          /></Button>
          <span>Opens {{ CLOUD }} in a tab this page can talk to. Open a workflow there.</span>
        </li>
        <li>
          <span class="stcl-run">
            <a class="stcl-bm" :href="BOOKMARKLET" @click.prevent>Theme playground</a>
            <Button variant="ghost" size="sm" @click="copy"
              ><component :is="copied ? Check : Copy" :size="13" />Copy for the console</Button
            >
          </span>
          <span
            >Drag the link to your bookmarks bar and click it in the Cloud tab, or paste the copied
            code in that tab’s console. Once per tab.</span
          >
        </li>
      </ol>
      <div v-if="status === 'connected' || status === 'paused'" class="stcl-row">
        <Button v-if="status === 'connected'" variant="secondary" size="sm" @click="emit('stop')"
          ><Pause :size="13" />Stop: show Cloud’s own theme</Button
        >
        <Button v-else variant="secondary" size="sm" @click="emit('resume')"
          ><Play :size="13" />Paint the tokens again</Button
        >
      </div>
      <p v-if="split" class="stcl-note">
        One Cloud tab holds one theme: Split paints it Dark. Switch to Light to see light.
      </p>
      <p class="stcl-note">
        On ComfyUI today, hover and selected are a solid accent (not accent/40 and /60) and the grid
        is an image: those need code, not tokens.
      </p>
    </div>
  </div>
</template>

<style>
.stcl {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--color-app-background);
}
.stcl-card {
  display: flex;
  max-width: 560px;
  flex-direction: column;
  gap: 14px;
}
.stcl-card h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}
.stcl-note {
  margin: 0;
  color: var(--color-muted-foreground);
  line-height: 20px;
}
.stcl-card ol {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 4px 0;
  padding-left: 18px;
}
.stcl-card li {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  color: var(--color-muted-foreground);
  line-height: 20px;
}
.stcl-run,
.stcl-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.stcl-bm {
  padding: 4px 10px;
  border-radius: 8px;
  background: var(--color-secondary-background);
  box-shadow: inset 0 0 0 1px var(--color-border-strong);
  color: var(--color-base-foreground);
  font-weight: 500;
  text-decoration: none;
  cursor: grab;
}
.stcl-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--color-muted-foreground);
}
.stcl-status i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-muted-foreground);
}
.stcl-status.is-connected {
  color: var(--color-base-foreground);
}
.stcl-status.is-connected i {
  background: var(--color-status-running);
}
.stcl-status.is-waiting i {
  background: var(--color-warning, #fd9903);
}
</style>
