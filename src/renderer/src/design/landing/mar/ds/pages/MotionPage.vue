<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { RotateCcw } from 'lucide-vue-next'
import Section from '../kit/Section.vue'
import { snippet } from '../materials'
import { EASES, MOTIONS } from '../motion'
import { onPlayback, readPlayback } from '../kit/playback'
import MotionSpecimen from './MotionSpecimen.vue'

/**
 * Motion, in this frame's theme: Mar's curves, then every animation with
 * its specimen, its values and the rule that makes it. The bar above the
 * frames sets the speed and previews reduced motion (kit/playback.ts).
 */
const specimens = ref<Record<string, InstanceType<typeof MotionSpecimen>>>({})
const reduced = ref(readPlayback().reduced)
let stop: (() => void) | undefined
onMounted(() => (stop = onPlayback((p) => (reduced.value = p.reduced))))
onBeforeUnmount(() => stop?.())

// The curves race: each dot crosses on its easing, again and again.
const across = ref(false)
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => (timer = setInterval(() => (across.value = !across.value), 1400)))
onBeforeUnmount(() => clearInterval(timer))

const sources = (src: [string, string][]): { where: string; code: string }[] =>
  src.map(([file, needle]) => {
    const s = snippet(file, needle)
    return s
      ? { where: `${s.file}:${s.line}`, code: s.code }
      : { where: file, code: `“${needle}” has moved` }
  })
</script>

<template>
  <div class="ds-motion">
    <p v-if="reduced" class="ds-motion-reduced">
      Previewing reduced motion: the code's own <code>prefers-reduced-motion</code> rules are on.
    </p>

    <Section
      title="Curves"
      note="Short, out-expo for things arriving; in-out for one move across the screen. Only transform and opacity move where possible."
    >
      <div class="ds-motion-eases">
        <div v-for="e in EASES" :key="e.name" class="ds-motion-ease">
          <div class="ds-motion-track">
            <i
              :style="{ transitionTimingFunction: e.value, translate: across ? '100% 0' : '0 0' }"
            />
          </div>
          <code>{{ e.name }}</code>
          <span>{{ e.value }} · {{ e.use }}</span>
        </div>
      </div>
    </Section>

    <Section v-for="m in MOTIONS" :key="m.id" :title="m.name" :note="m.trigger">
      <div class="ds-motion-item">
        <div class="ds-motion-stage">
          <MotionSpecimen
            :id="m.id"
            :ref="(el) => el && (specimens[m.id] = el as InstanceType<typeof MotionSpecimen>)"
          />
          <button type="button" class="ds-motion-replay" @click="specimens[m.id]?.replay()">
            <RotateCcw :size="12" />Replay
          </button>
        </div>
        <dl class="ds-motion-spec">
          <dt>Duration</dt>
          <dd>{{ m.duration }}</dd>
          <dt>Easing</dt>
          <dd>
            <code>{{ m.easing }}</code>
          </dd>
          <dt>Animates</dt>
          <dd>{{ m.props }}</dd>
          <dt>Reduced motion</dt>
          <dd>{{ m.reduced }}</dd>
          <template v-if="m.flag">
            <dt>Note</dt>
            <dd class="is-flag">{{ m.flag }}</dd>
          </template>
        </dl>
      </div>
      <details class="ds-motion-src">
        <summary>The code</summary>
        <figure v-for="s in sources(m.src)" :key="s.where">
          <figcaption>
            <code>{{ s.where }}</code>
          </figcaption>
          <pre><code>{{ s.code }}</code></pre>
        </figure>
      </details>
    </Section>
  </div>
</template>

<style>
.ds-motion {
  display: flex;
  flex-direction: column;
  gap: 28px;
}
.ds-motion-reduced {
  padding: 8px 12px;
  border-radius: 10px;
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  font-size: 12.5px;
}
.ds-motion-eases {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ds-motion-ease {
  display: grid;
  grid-template-columns: 160px max-content 1fr;
  align-items: center;
  gap: 12px;
  font-size: 12px;
}
.ds-motion-ease span {
  color: var(--color-muted-foreground);
}
.ds-motion-track {
  height: 10px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
}
.ds-motion-track i {
  display: block;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: var(--color-base-foreground);
  transition-property: translate;
  transition-duration: 900ms;
}
.ds-motion-track {
  padding-right: 10px;
}
.ds-motion-track i {
  translate: 0 0;
}
.ds-motion-item {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 16px;
}
.ds-motion-stage {
  position: relative;
  display: flex;
  min-height: 160px;
  padding: 20px 16px 36px;
  border-radius: 12px;
  background: color-mix(in oklch, var(--color-base-foreground) 3%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
.ds-motion-replay {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 6px;
  color: var(--color-muted-foreground);
  font-size: 11.5px;
}
.ds-motion-replay:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-base-foreground);
}
.ds-motion-spec {
  display: grid;
  grid-template-columns: max-content 1fr;
  align-content: start;
  gap: 6px 12px;
  font-size: 12px;
}
.ds-motion-spec dt {
  color: var(--color-muted-foreground);
}
.ds-motion-spec code,
.ds-motion-src code {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11px;
}
.ds-motion-spec .is-flag {
  color: oklch(0.8 0.14 75);
}
.ds-motion-src summary {
  color: var(--color-muted-foreground);
  font-size: 12px;
  cursor: pointer;
}
.ds-motion-src figure {
  margin-top: 8px;
}
.ds-motion-src figcaption {
  color: var(--color-subtle-foreground);
}
.ds-motion-src pre {
  overflow-x: auto;
  margin-top: 4px;
  padding: 10px 12px;
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
  font-size: 11px;
  line-height: 1.5;
}
</style>
