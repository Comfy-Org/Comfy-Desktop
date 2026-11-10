<script setup lang="ts">
import { computed } from 'vue'
import { Camera, Check, ChevronRight, Scan, UserRound, X } from 'lucide-vue-next'
import { PopoverClose, PopoverRoot, PopoverTrigger } from 'reka-ui'
import PopoverContent from '../../ui/PopoverContent.vue'
import SegmentedControl from '../../ui/SegmentedControl.vue'
import Select from '../../ui/Select.vue'
import Switch from '../../ui/Switch.vue'
import NumberField from '../../ui/NumberField.vue'
import { cn } from '../../ui/cn'
import { toast } from '../../useProto'
import {
  CAMERA,
  CINE_ASPECTS,
  CINE_DEFAULTS,
  CINE_MODELS,
  LOOK,
  type CineGroup,
  type CineOption
} from './cinematic'

/**
 * Cinematic Studio's panel, built like the hub's (comfy.org/hub/apps/
 * cinematic-studio) in the New UI's own surfaces: Image or Video and the
 * model, the scene in a box with the character and AI prompt at its foot,
 * the direction as rows with a picture each that open a picker beside the
 * panel, and the format along the bottom.
 */
const values = defineModel<Record<string, string>>('values', { required: true })
const { reference } = defineProps<{
  /** The character's picture, the example's until you change it. */
  reference?: string
}>()

const get = (id: string): string => values.value[id] ?? CINE_DEFAULTS[id] ?? ''
const set = (id: string, v: string): void => {
  values.value[id] = v
}
const opt = (g: CineGroup): CineOption | undefined => g.options.find((o) => o.label === get(g.id))

/** The camera row: the body as its value, the rest as small tags. */
const cameraTags = computed(() =>
  CAMERA.slice(1)
    .map((g) => get(g.id))
    .filter((v) => v !== 'Auto')
)
const hasReference = computed(() => Boolean(reference) && get('character') !== 'none')
</script>

<template>
  <div class="cine">
    <!-- Image or Video, and the model -->
    <section class="cine-block">
      <div class="flex items-center justify-between gap-3">
        <h2 class="cine-title">New shot</h2>
        <SegmentedControl
          :model-value="get('mode')"
          variant="contained"
          size="sm"
          :options="[
            { value: 'Image', label: 'Image' },
            { value: 'Video', label: 'Video' }
          ]"
          @update:model-value="(v: string) => set('mode', v)"
        />
      </div>
      <Select
        :model-value="get('model')"
        size="sm"
        :options="CINE_MODELS.map((m) => ({ value: m, label: m }))"
        @update:model-value="(v: string) => set('model', v)"
      />

      <!-- The scene, with the character and AI prompt at its foot -->
      <div class="cine-prompt">
        <textarea
          :value="values.scene ?? ''"
          rows="4"
          placeholder="Describe the moment. Who, where, what is happening."
          aria-label="Scene"
          @input="set('scene', ($event.target as HTMLTextAreaElement).value)"
        />
        <div class="flex items-center justify-between gap-2">
          <span v-if="hasReference" class="cine-ref">
            <img :src="reference" alt="" />
            <button
              type="button"
              aria-label="Remove the character reference"
              @click="set('character', 'none')"
            >
              <X :size="11" />
            </button>
          </span>
          <button
            v-else
            type="button"
            class="cine-ref-add"
            aria-label="Add a character reference"
            title="Add a character reference"
            @click="toast('Pick an image')"
          >
            <UserRound :size="14" />
          </button>
          <label class="flex items-center gap-2 text-ui text-muted-foreground">
            <Switch
              :model-value="get('enhance') === 'On'"
              aria-label="AI prompt"
              @update:model-value="(v: boolean) => set('enhance', v ? 'On' : 'Off')"
            />AI prompt
          </label>
        </div>
      </div>
    </section>

    <!-- Direction: a row each, a picker beside the panel -->
    <section class="cine-block">
      <h2 class="cine-title">Direction</h2>
      <div class="cine-rows">
        <PopoverRoot>
          <PopoverTrigger as-child>
            <button type="button" class="cine-row">
              <span class="cine-thumb is-icon"><Camera :size="14" /></span>
              <span class="cine-key">Camera</span>
              <span class="cine-val">{{ get('camera') }}</span>
              <span class="cine-tags">
                <span v-for="t in cameraTags" :key="t" class="cine-tag">{{ t }}</span>
              </span>
              <ChevronRight :size="14" class="cine-chev" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="right" align="start" :side-offset="20" class="cine-picker">
            <header class="cine-picker-head">
              <h3 class="cine-title">Camera</h3>
              <PopoverClose class="cine-close" aria-label="Close"><X :size="14" /></PopoverClose>
            </header>
            <div class="flex flex-col gap-4 p-4 pt-1">
              <div v-for="g in CAMERA" :key="g.id" class="flex flex-col gap-2">
                <p class="text-ui text-muted-foreground">{{ g.label }}</p>
                <div
                  class="flex flex-wrap gap-1.5"
                  role="radiogroup"
                  data-no-pill
                  :aria-label="g.label"
                >
                  <button
                    v-for="o in g.options"
                    :key="o.label"
                    type="button"
                    role="radio"
                    :aria-checked="get(g.id) === o.label"
                    :class="cn('cine-chip', get(g.id) === o.label && 'is-on')"
                    @click="set(g.id, o.label)"
                  >
                    {{ o.label }}
                  </button>
                </div>
              </div>
            </div>
          </PopoverContent>
        </PopoverRoot>

        <PopoverRoot v-for="g in LOOK" :key="g.id">
          <PopoverTrigger as-child>
            <button type="button" class="cine-row">
              <span class="cine-thumb">
                <img v-if="opt(g)?.preview" :src="opt(g)!.preview" alt="" />
                <span v-else-if="opt(g)?.palette" class="cine-palette">
                  <span v-for="c in opt(g)!.palette" :key="c" :style="{ background: c }" />
                </span>
                <Scan v-else :size="13" />
              </span>
              <span class="cine-key">{{ g.label }}</span>
              <span class="cine-val">{{ get(g.id) }}</span>
              <ChevronRight :size="14" class="cine-chev" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="right" align="start" :side-offset="20" class="cine-picker">
            <header class="cine-picker-head">
              <h3 class="cine-title">{{ g.label }}</h3>
              <PopoverClose class="cine-close" aria-label="Close"><X :size="14" /></PopoverClose>
            </header>
            <div class="cine-grid" role="radiogroup" data-no-pill :aria-label="g.label">
              <button
                v-for="o in g.options"
                :key="o.label"
                type="button"
                role="radio"
                :aria-checked="get(g.id) === o.label"
                :class="cn('cine-tile', get(g.id) === o.label && 'is-on')"
                @click="set(g.id, o.label)"
              >
                <span class="cine-tile-pic">
                  <img v-if="o.preview" :src="o.preview" alt="" loading="lazy" />
                  <span v-else-if="o.palette" class="cine-palette">
                    <span v-for="c in o.palette" :key="c" :style="{ background: c }" />
                  </span>
                  <Scan v-else :size="22" class="text-subtle-foreground" />
                  <span v-if="get(g.id) === o.label" class="cine-check"><Check :size="12" /></span>
                </span>
                <span class="truncate">{{ o.label }}</span>
              </button>
            </div>
          </PopoverContent>
        </PopoverRoot>
      </div>
    </section>

    <!-- Format: the frame, the size and how many takes -->
    <section class="cine-block">
      <h2 class="cine-title">Format</h2>
      <div class="cine-format">
        <Select
          :model-value="get('aspect')"
          size="sm"
          :options="CINE_ASPECTS"
          @update:model-value="(v: string) => set('aspect', v)"
        />
        <Select
          :model-value="get('size')"
          size="sm"
          :options="[
            { value: '1K', label: '1K' },
            { value: '2K', label: '2K' }
          ]"
          @update:model-value="(v: string) => set('size', v)"
        />
        <NumberField
          :model-value="Number(get('count'))"
          :min="1"
          :max="4"
          aria-label="Takes"
          @update:model-value="(v: number) => set('count', String(v))"
        />
      </div>
    </section>
  </div>
</template>

<style scoped>
.cine {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 16px 16px 8px;
}
.cine-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* Section titles: the uppercase label (UI-RULES › Type). */
.cine-title {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-subtle-foreground);
}

/* The scene: a text block in a box (UI-RULES › Surfaces). */
.cine-prompt {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 10px 8px 12px;
  border-radius: var(--radius-card);
  background: var(--color-secondary-background);
}
.cine-prompt textarea {
  resize: none;
  border: 0;
  background: transparent;
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  line-height: 1.5;
  outline: none;
}
.cine-prompt textarea::placeholder {
  color: var(--color-subtle-foreground);
}
.cine-ref,
.cine-ref-add {
  position: relative;
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 8px;
}
.cine-ref-add {
  color: var(--color-muted-foreground);
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  transition: color 150ms;
}
.cine-ref-add:hover {
  color: var(--color-base-foreground);
}
.cine-ref img {
  width: 100%;
  height: 100%;
  border-radius: 8px;
  object-fit: cover;
}
.cine-ref button {
  position: absolute;
  top: -5px;
  right: -5px;
  display: grid;
  width: 16px;
  height: 16px;
  place-items: center;
  border-radius: 999px;
  background: var(--color-base-foreground);
  color: var(--color-app-background);
  opacity: 0;
  transition: opacity 150ms;
}
.cine-ref:hover button,
.cine-ref button:focus-visible {
  opacity: 1;
}

/* Direction rows: no dividers, a fill on hover (UI-RULES › No lines). */
.cine-rows {
  display: flex;
  flex-direction: column;
  padding: 4px;
  border-radius: var(--radius-card);
  background: var(--color-secondary-background);
}
.cine-row {
  display: flex;
  height: 40px;
  min-width: 0;
  align-items: center;
  gap: 10px;
  padding: 0 8px 0 6px;
  border-radius: 8px;
  text-align: left;
  outline: none;
  transition: background-color 150ms;
}
.cine-row:hover,
.cine-row[data-state='open'],
.cine-row:focus-visible {
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
.cine-thumb {
  display: grid;
  width: 36px;
  height: 24px;
  flex-shrink: 0;
  place-items: center;
  overflow: hidden;
  border-radius: 5px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-muted-foreground);
}
.cine-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cine-key {
  width: 52px;
  flex-shrink: 0;
  font-size: var(--text-ui);
  color: var(--color-subtle-foreground);
}
.cine-val {
  flex-shrink: 0;
  font-size: var(--text-ui);
  font-weight: 500;
  color: var(--color-base-foreground);
}
.cine-tags {
  display: flex;
  min-width: 0;
  gap: 4px;
  overflow: hidden;
}
.cine-tag {
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: 4px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  font-size: 11px;
  color: var(--color-muted-foreground);
}
.cine-chev {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--color-subtle-foreground);
}
.cine-palette {
  display: flex;
  width: 100%;
  height: 100%;
}
.cine-palette > span {
  flex: 1;
}

/* The picker beside the panel */
:root .proto-ui.proto-ui.proto-ui .cine-picker {
  width: 340px;
  max-height: min(560px, var(--reka-popover-content-available-height));
  overflow-y: auto;
  padding: 0;
}
.cine-picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 8px 16px;
}
.cine-close {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 6px;
  color: var(--color-muted-foreground);
}
.cine-close:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
.cine-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 10px;
  padding: 4px 16px 16px;
}
.cine-tile {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  font-size: var(--text-ui);
  color: var(--color-muted-foreground);
  text-align: left;
  outline: none;
}
.cine-tile:hover,
.cine-tile.is-on {
  color: var(--color-base-foreground);
}
.cine-tile-pic {
  position: relative;
  display: grid;
  aspect-ratio: 16 / 9;
  place-items: center;
  overflow: hidden;
  border-radius: 8px;
  background: var(--color-secondary-background);
  box-shadow: 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  transition: box-shadow 150ms;
}
.cine-tile-pic img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cine-tile:hover .cine-tile-pic {
  box-shadow: 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 24%, transparent);
}
.cine-tile.is-on .cine-tile-pic,
.cine-tile:focus-visible .cine-tile-pic {
  box-shadow: 0 0 0 2px var(--color-base-foreground);
}
.cine-check {
  position: absolute;
  top: 6px;
  right: 6px;
  display: grid;
  width: 18px;
  height: 18px;
  place-items: center;
  border-radius: 999px;
  background: var(--color-base-foreground);
  color: var(--color-app-background);
}
:root .proto-ui.proto-ui.proto-ui .cine-chip {
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  font-size: var(--text-ui);
  color: var(--color-muted-foreground);
  transition:
    background-color 150ms,
    color 150ms;
}
:root .proto-ui.proto-ui.proto-ui .cine-chip:hover {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .cine-chip.is-on {
  background: var(--color-base-foreground);
  color: var(--color-app-background);
}

/* Format: three controls on one line */
.cine-format {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1.1fr;
  gap: 6px;
}

@media (prefers-reduced-motion: reduce) {
  .cine-row,
  .cine-tile-pic,
  .cine-chip,
  .cine-ref button {
    transition: none;
  }
}
</style>
