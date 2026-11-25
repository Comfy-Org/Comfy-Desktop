<script setup lang="ts">
import { computed } from 'vue'
import { cssOf } from '../theme/color'
import { NODE_COLORS, describe, MODES } from '../theme/model'
import { fileOf, GAPS, HARDCODED, untokened, versusAlex } from '../theme/integration'
import { results, state, swatch } from '../theme/usePlayground'

/** How the colours on screen land in @comfyorg/design-system: each token
 *  against Alex's stack, what the Home keeps outside the tokens, what
 *  ComfyUI needs that the Home doesn't, and the contrast that breaks. */
const rows = computed(() => versusAlex(state.value))
const kept = computed(() => untokened(state.value))
const risks = computed(() =>
  MODES.flatMap((m) => {
    const r = results.value[m]
    const graph = [
      'node@canvas',
      'node-header@canvas',
      'node-border@canvas',
      'node-foreground@node-header',
      'primary@canvas'
    ]
      .filter((id) => r[id] && !r[id]!.pass)
      .map((id) => id.replace('@', ' on '))
    const nodes = NODE_COLORS.filter((n) =>
      ['text', 'title', 'canvas'].some((k) => !r[`${n.id}:${k}`]!.pass)
    ).map((n) => n.id.replace('_', ' '))
    return [
      { m, what: 'Graph', list: graph },
      { m, what: 'Custom node colours', list: nodes }
    ]
  })
)
const label = (m: string): string => (m === 'dark' ? 'Dark' : 'Light')
</script>

<template>
  <div class="st-sec">
    <p class="st-note">
      Each token as it is now, against Alex’s stack, and the file it goes to in ComfyUI_frontend.
      One theme for platform and Desktop: Desktop only overrides these tokens.
    </p>

    <h3 class="st-group">Tokens</h3>
    <div v-for="r in rows" :key="r.id" class="sti-row">
      <span class="sti-sw">
        <i class="pg-sw is-sm" :style="{ background: swatch('dark', r.id) }" />
        <i class="pg-sw is-sm" :style="{ background: swatch('light', r.id) }" />
      </span>
      <div class="sti-main">
        <code>{{ r.id }}</code>
        <small
          >{{ describe(state.map.dark[r.id]) }} · {{ describe(state.map.light[r.id]) }} ·
          {{ fileOf(r.id) }}</small
        >
      </div>
      <span :class="['sti-tag', `is-${r.verdict.split(' ')[0]!.toLowerCase()}`]"
        >{{ r.verdict
        }}{{ r.verdict === 'Changes Alex' ? ` (${r.modes.map(label).join(', ')})` : '' }}</span
      >
    </div>

    <h3 class="st-group">Kept outside the tokens</h3>
    <p v-if="kept.length" class="st-note">
      Legacy names this start leaves as they are:
      <code v-for="(k, i) in kept" :key="k"
        >--color-{{ k }}{{ i < kept.length - 1 ? ', ' : '' }}</code
      >.
    </p>
    <div v-for="h in HARDCODED" :key="h.what" class="sti-block">
      <b>{{ h.what }}</b>
      <small
        ><code>{{ h.value }}</code></small
      >
      <small>{{ h.where }}</small>
      <span>→ {{ h.then }}</span>
    </div>

    <h3 class="st-group">What ComfyUI needs that the Home doesn’t</h3>
    <div v-for="g in GAPS" :key="g.need" class="sti-block">
      <b>{{ g.need }}</b>
      <small>{{ g.home }}</small>
      <span>→ {{ g.fallback }}</span>
    </div>

    <h3 class="st-group">Contrast risks on ComfyUI</h3>
    <div v-for="r in risks" :key="r.m + r.what" class="sti-block">
      <b>{{ label(r.m) }} · {{ r.what }}</b>
      <span :class="r.list.length ? 'is-fail' : 'is-pass'">{{
        r.list.length ? r.list.join(', ') : 'All pass'
      }}</span>
    </div>
    <p class="st-note">
      Light mode lightens custom node colours by +0.5 HSL; node text on them is measured with
      node-foreground ({{ cssOf(results.light['red:text']!.fg) }} in light).
    </p>
  </div>
</template>
