<script setup lang="ts">
import NumberField from '../../../ui/NumberField.vue'
import Select from '../../../ui/Select.vue'
import { ALIAS_GROUPS, aliasKey, MODES } from '../theme/model'
import {
  aliasOptions,
  aliasPct,
  aliasSwatch,
  aliasTo,
  setAlias,
  setAliasPct
} from '../theme/usePlayground'

/** The names Desktop and the prototype use today, and what each now
 *  means: the surface paints with these. */
const varName = (group: string, name: string): string =>
  group === 'proto' ? `--color-${name}` : `--${name}`
</script>

<template>
  <div class="st-sec">
    <p class="st-note">
      The names Desktop and the prototype use today, and what each now means. The surface paints
      with this table: change a row and its components follow.
    </p>
    <section v-for="g in ALIAS_GROUPS" :key="g.id">
      <h3 class="st-group">
        {{ g.label }} <small>{{ g.source }}</small>
      </h3>
      <div v-for="n in g.names" :key="n.name" class="stl-row">
        <div class="stl-name">
          <code>{{ varName(g.id, n.name) }}</code>
          <small
            >{{ n.uses ? `${n.uses} uses` : '' }}{{ n.uses && n.note ? ' · ' : ''
            }}{{ n.note }}</small
          >
        </div>
        <div class="stt-line">
          <code v-if="g.fixed" class="stl-fixed">{{ aliasTo(aliasKey(g.id, n.name)) }}</code>
          <template v-else>
            <Select
              :model-value="aliasTo(aliasKey(g.id, n.name))"
              :options="aliasOptions"
              size="sm"
              class="pg-pick"
              @update:model-value="setAlias(aliasKey(g.id, n.name), $event)"
            />
            <NumberField
              v-if="aliasTo(aliasKey(g.id, n.name)) !== 'keep'"
              :model-value="aliasPct(aliasKey(g.id, n.name))"
              :min="0"
              :max="100"
              :step="5"
              unit="%"
              :aria-label="`${n.name} opacity`"
              class="pg-pct"
              @update:model-value="setAliasPct(aliasKey(g.id, n.name), $event)"
            />
          </template>
          <template v-for="m in MODES" :key="m">
            <i
              v-if="aliasSwatch(m, aliasKey(g.id, n.name))"
              class="pg-sw"
              :title="m === 'dark' ? 'Dark' : 'Light'"
              :style="{ background: aliasSwatch(m, aliasKey(g.id, n.name)) }"
            />
          </template>
          <small v-if="!aliasSwatch('dark', aliasKey(g.id, n.name))">as is</small>
        </div>
      </div>
    </section>
  </div>
</template>
