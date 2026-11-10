<script setup lang="ts">
import { computed } from 'vue'
import {
  ChevronRight,
  ImageUp,
  ImageUpscale,
  Minus,
  Plus,
  RectangleHorizontal,
  Scan,
  UserRound
} from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger, PopoverRoot, PopoverTrigger } from 'reka-ui'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import PopoverContent from '../../ui/PopoverContent.vue'
import CineIcon from './CineIcon.vue'
import ProviderMark from './ProviderMark.vue'
import { providerLogo } from '../build/providerLogos'
import SegmentedControl from '../../ui/SegmentedControl.vue'
import Select from '../../ui/Select.vue'
import Switch from '../../ui/Switch.vue'
import { cn } from '../../ui/cn'
import { toast } from '../../useProto'
import {
  CAMERA,
  CINE_ASPECTS,
  CINE_DEFAULTS,
  CINE_MODELS,
  CINE_MODEL_AUTHOR,
  LOOK,
  type CineGroup,
  type CineOption
} from './cinematic'

/**
 * Cinematic Studio's panel, built like the hub's (comfy.org/hub/apps/
 * cinematic-studio) in the New UI's own surfaces: Image or Video and the
 * model, the scene in a box with the character and AI prompt at its foot,
 * the direction as cards with a picture each that open a picker beside
 * the panel, and the format along the bottom.
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

/** The camera card: the body as its value, lens, focal and aperture under it. */
const bodyIcon = computed(
  () => CAMERA[0]!.options.find((o) => o.label === get('camera'))?.icon ?? 'auto'
)
const cameraSpecs = computed(() =>
  CAMERA.slice(1)
    .map((g) => get(g.id))
    .filter((v) => v !== 'Auto')
    .join(' · ')
)
const hasReference = computed(() => Boolean(reference) && get('character') !== 'none')
</script>

<template>
  <div class="cine">
    <!-- Image or Video, and the model -->
    <section class="cine-block">
      <SegmentedControl
        :model-value="get('mode')"
        variant="contained"
        size="sm"
        class="cine-seg"
        :options="[
          { value: 'Image', label: 'Image' },
          { value: 'Video', label: 'Video' }
        ]"
        @update:model-value="(v: string) => set('mode', v)"
      />
      <Select
        :model-value="get('model')"
        class="cine-model"
        :options="CINE_MODELS.map((m) => ({ value: m, label: m }))"
        @update:model-value="(v: string) => set('model', v)"
      >
        <template #icon="{ value }">
          <ProviderMark
            v-if="providerLogo(CINE_MODEL_AUTHOR[value] ?? '')"
            :logo="providerLogo(CINE_MODEL_AUTHOR[value] ?? '')!"
          />
        </template>
      </Select>

      <!-- The character, large, as the app's picture -->
      <div class="cine-field">
        <h2 class="cine-title">Character reference</h2>
        <button
          v-if="hasReference"
          type="button"
          class="cine-source group"
          aria-label="Replace the character reference"
          @click="toast('Pick an image')"
        >
          <img :src="reference" alt="" />
          <span class="cine-source-replace"><ImageUp :size="14" />Replace</span>
        </button>
        <button v-else type="button" class="cine-source is-empty" @click="toast('Pick an image')">
          <UserRound :size="18" />Add a character
        </button>
      </div>

      <!-- The scene, with AI prompt at its foot -->
      <div class="cine-prompt">
        <textarea
          :value="values.scene ?? ''"
          rows="4"
          placeholder="Describe the moment. Who, where, what is happening."
          aria-label="Scene"
          @input="set('scene', ($event.target as HTMLTextAreaElement).value)"
        />
        <div class="flex items-center justify-end gap-2">
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

    <!-- Direction: a row each, its picture and what's picked; it opens a
         picker of pictures beside the panel -->
    <section class="cine-block">
      <h2 class="cine-title">Direction</h2>
      <div class="cine-rows">
        <PopoverRoot>
          <PopoverTrigger as-child>
            <button type="button" class="cine-row">
              <span class="cine-thumb is-icon">
                <CineIcon part="body" :option="bodyIcon" class="cine-thumb-icon" />
              </span>
              <span class="cine-row-text">
                <span class="cine-key">Camera</span>
                <span class="cine-val">{{ get('camera') }}</span>
                <span v-if="cameraSpecs" class="cine-sub">{{ cameraSpecs }}</span>
              </span>
              <ChevronRight :size="15" class="cine-chev" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="right"
            align="start"
            :side-offset="20"
            class="cine-picker is-camera"
          >
            <header class="cine-picker-head">
              <h3 class="cine-title">Camera</h3>
            </header>
            <div class="cine-cols">
              <div
                v-for="g in CAMERA"
                :key="g.id"
                class="cine-col"
                role="radiogroup"
                data-no-pill
                :aria-label="g.label"
              >
                <p class="cine-title cine-col-title">{{ g.label }}</p>
                <div class="cine-col-list">
                  <button
                    v-for="o in g.options"
                    :key="o.label"
                    type="button"
                    role="radio"
                    :aria-checked="get(g.id) === o.label"
                    :class="cn('cine-opt', get(g.id) === o.label && 'is-on')"
                    @click="set(g.id, o.label)"
                  >
                    <span class="truncate">{{ o.label }}</span>
                    <CineIcon
                      v-if="g.part && o.icon"
                      :part="g.part"
                      :option="o.icon"
                      class="cine-opt-icon"
                    />
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
                <Scan v-else :size="15" />
              </span>
              <span class="cine-row-text">
                <span class="cine-key">{{ g.label }}</span>
                <span class="cine-val">{{ get(g.id) }}</span>
              </span>
              <ChevronRight :size="15" class="cine-chev" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="right" align="start" :side-offset="20" class="cine-picker">
            <header class="cine-picker-head">
              <h3 class="cine-title">{{ g.label }}</h3>
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
                  <Scan v-else :size="18" class="mb-3 text-subtle-foreground" />
                  <span class="cine-tile-name">{{ o.label }}</span>
                </span>
              </button>
            </div>
          </PopoverContent>
        </PopoverRoot>
      </div>
    </section>

    <!-- Format: how many takes, the frame and the size, as one row of pills -->
    <section class="cine-block">
      <h2 class="cine-title">Format</h2>
      <div class="cine-pills">
        <div class="cine-pill is-stepper" role="group" aria-label="Takes">
          <button
            type="button"
            aria-label="Fewer takes"
            :disabled="get('count') === '1'"
            @click="set('count', String(Number(get('count')) - 1))"
          >
            <Minus :size="14" />
          </button>
          <span class="tabular-nums" :title="`${get('count')} takes`">{{ get('count') }}</span>
          <button
            type="button"
            aria-label="More takes"
            :disabled="get('count') === '4'"
            @click="set('count', String(Number(get('count')) + 1))"
          >
            <Plus :size="14" />
          </button>
        </div>
        <DropdownMenuRoot>
          <DropdownMenuTrigger as-child>
            <button type="button" class="cine-pill" aria-label="Aspect ratio">
              <RectangleHorizontal :size="14" />{{ get('aspect') }}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" :side-offset="8" class="cine-menu">
            <DropdownMenuItem
              v-for="a in CINE_ASPECTS"
              :key="a.value"
              :class="a.value === get('aspect') && 'bg-secondary-background font-medium'"
              @select="set('aspect', a.value)"
            >
              {{ a.label }}
              <span class="ml-auto font-normal text-subtle-foreground">{{ a.hint }}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuRoot>
        <DropdownMenuRoot>
          <DropdownMenuTrigger as-child>
            <button type="button" class="cine-pill" aria-label="Resolution">
              <ImageUpscale :size="14" />{{ get('size') }}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" :side-offset="8" class="cine-menu">
            <DropdownMenuItem
              v-for="r in ['1K', '2K']"
              :key="r"
              :class="r === get('size') && 'bg-secondary-background font-medium'"
              @select="set('size', r)"
            >
              {{ r }}
              <span class="ml-auto font-normal text-subtle-foreground">{{
                r === '1K' ? 'Faster' : 'Sharper'
              }}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuRoot>
      </div>
    </section>
  </div>
</template>

<style scoped>
.cine {
  display: flex;
  flex-direction: column;
  gap: 28px;
  padding: 20px 20px 12px;
}
.cine-block {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* Section titles: the uppercase label (UI-RULES › Type). */
.cine-title {
  font-size: 10.5px;
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
:root .proto-ui.proto-ui.proto-ui .cine-prompt textarea {
  resize: none;
  border: 0;
  background: transparent;
  color: var(--color-base-foreground);
  font-size: 12px;
  line-height: 1.55;
  outline: none;
}
.cine-prompt textarea::placeholder {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .cine-source {
  position: relative;
  display: grid;
  aspect-ratio: 16 / 10;
  place-items: center;
  overflow: hidden;
  border-radius: var(--radius-card);
  background: var(--color-secondary-background);
  outline: none;
}
.cine-source img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cine-source:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
.cine-source.is-empty {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  border: 1px dashed var(--color-border-strong);
  background: transparent;
  font-size: var(--text-ui);
  color: var(--color-muted-foreground);
}
.cine-source-replace {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: rgb(0 0 0 / 0.5);
  color: white;
  font-size: var(--text-ui);
  font-weight: 500;
  opacity: 0;
  transition: opacity 150ms;
}
.cine-source:hover .cine-source-replace,
.cine-source:focus-visible .cine-source-replace {
  opacity: 1;
}

/* Direction: a row each, with room; a fill on hover, no dividers. */
.cine-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
:root .proto-ui.proto-ui.proto-ui .cine-row {
  display: flex;
  min-width: 0;
  min-height: 56px;
  align-items: center;
  gap: 12px;
  padding: 8px 12px 8px 8px;
  border-radius: var(--radius-card);
  background: var(--color-secondary-background);
  text-align: left;
  outline: none;
  transition: background-color 150ms;
}
:root .proto-ui.proto-ui.proto-ui .cine-row:hover,
:root .proto-ui.proto-ui.proto-ui .cine-row[data-state='open'],
:root .proto-ui.proto-ui.proto-ui .cine-row:focus-visible {
  background: color-mix(in oklch, var(--color-base-foreground) 11%, transparent);
}
.cine-thumb {
  display: grid;
  width: 56px;
  height: 38px;
  flex-shrink: 0;
  place-items: center;
  overflow: hidden;
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-muted-foreground);
}
.cine-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cine-row-text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 1px;
}
.cine-key {
  font-size: 11px;
  line-height: 14px;
  color: var(--color-subtle-foreground);
}
.cine-val,
.cine-sub {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cine-val {
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  color: var(--color-base-foreground);
}
.cine-sub {
  font-size: 11px;
  line-height: 14px;
  color: var(--color-muted-foreground);
}
.cine-chev {
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
.cine-picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 14px 10px;
}
.cine-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 2px 14px 14px;
}
.cine-tile {
  display: block;
  min-width: 0;
  outline: none;
}
.cine-tile-pic {
  position: relative;
  display: grid;
  aspect-ratio: 4 / 3;
  place-items: center;
  overflow: hidden;
  border-radius: 8px;
  background: var(--color-secondary-background);
  transition: box-shadow 150ms;
}
.cine-tile-pic img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cine-tile-pic .cine-palette {
  position: absolute;
  inset: 0;
}
/* The name sits on the picture, over a soft scrim. */
.cine-tile-name {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  overflow: hidden;
  padding: 14px 7px 5px;
  background: linear-gradient(to top, rgb(0 0 0 / 0.62), transparent);
  font-size: 11px;
  font-weight: 500;
  line-height: 14px;
  color: rgb(255 255 255 / 0.94);
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cine-tile:hover .cine-tile-pic {
  box-shadow: 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 30%, transparent);
}
.cine-tile.is-on .cine-tile-pic,
.cine-tile:focus-visible .cine-tile-pic {
  box-shadow: 0 0 0 2px var(--color-base-foreground);
}
/* The camera: four lists side by side, each scrolls on its own */
.cine-cols {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  padding: 2px 12px 12px;
}
.cine-col {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  border-radius: var(--radius-card, 12px);
  background: color-mix(in oklch, var(--color-base-foreground) 4%, transparent);
  padding: 6px;
}
.cine-col-title {
  padding: 8px 6px 10px;
  text-align: center;
}
.cine-col-list {
  display: flex;
  max-height: 360px;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
  scrollbar-width: none;
}
.cine-col-list::-webkit-scrollbar {
  display: none;
}
:root .proto-ui.proto-ui.proto-ui .cine-opt {
  display: flex;
  height: 48px;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-radius: 8px;
  padding: 0 8px 0 12px;
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
  box-shadow: inset 0 0 0 1px transparent;
  font-size: var(--text-ui);
  color: var(--color-muted-foreground);
  text-align: left;
  transition:
    background-color 150ms,
    color 150ms,
    box-shadow 150ms;
}
:root .proto-ui.proto-ui.proto-ui .cine-opt:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .cine-opt.is-on {
  background: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
  box-shadow: inset 0 0 0 1px var(--color-base-foreground);
  color: var(--color-base-foreground);
  font-weight: 500;
}
.cine-opt-icon {
  width: 40px;
  height: 25px;
  flex-shrink: 0;
  opacity: 0.6;
  transition: opacity 150ms;
}
.cine-opt.is-on .cine-opt-icon,
.cine-opt:hover .cine-opt-icon {
  opacity: 1;
}
/* The camera sits on the row itself, no box, like the hub's list */
.cine-thumb.is-icon {
  overflow: visible;
  background: none;
}
.cine-thumb-icon {
  width: 44px;
  height: 28px;
}

.cine-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
}
.cine-field {
  gap: 10px;
}
:root .proto-ui.proto-ui.proto-ui .cine-seg {
  width: 100%;
}

/* Format: one row of pills */
.cine-pills {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
:root .proto-ui.proto-ui.proto-ui .cine-pill {
  display: inline-flex;
  height: 32px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 12px;
  border-radius: var(--radius-control);
  background: var(--color-secondary-background);
  font-size: 12px;
  font-weight: 500;
  color: var(--color-base-foreground);
  outline: none;
  transition: background-color 150ms;
}
.cine-pill > svg {
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .cine-pill:not(.is-stepper):hover,
:root .proto-ui.proto-ui.proto-ui .cine-pill[data-state='open'] {
  background: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
}
.cine-pill:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .cine-pill.is-stepper {
  justify-content: space-between;
  gap: 2px;
  padding: 0 2px;
}
.cine-pill.is-stepper > span {
  min-width: 18px;
  text-align: center;
}
.cine-pill.is-stepper button {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 7px;
  color: var(--color-muted-foreground);
}
.cine-pill.is-stepper button:hover:not(:disabled) {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
}
.cine-pill.is-stepper button:disabled {
  opacity: 0.35;
}

@media (prefers-reduced-motion: reduce) {
  .cine-row,
  .cine-tile-pic,
  .cine-opt,
  .cine-source-replace {
    transition: none;
  }
}
</style>

<style>
/* The picker's box is teleported out of this component, so its size can't
   be scoped. */
:root .proto-ui.proto-ui.proto-ui.cine-picker {
  width: 400px;
  max-height: min(560px, var(--reka-popover-content-available-height));
  overflow-y: auto;
  padding: 0;
}
:root .proto-ui.proto-ui.proto-ui.cine-picker.is-camera {
  width: 780px;
  overflow: hidden;
}
/* The tabs and the model share one height; their buttons live in the
   child components. */
:root .proto-ui.proto-ui.proto-ui .cine-seg > button {
  height: 30px;
  flex: 1;
  justify-content: center;
}
:root .proto-ui.proto-ui.proto-ui .cine-model {
  height: 36px;
  padding-inline: 12px;
  gap: 8px;
}
/* The format menus open the same way and look the same */
:root .proto-ui.proto-ui.proto-ui.cine-menu {
  width: 208px;
}
</style>
