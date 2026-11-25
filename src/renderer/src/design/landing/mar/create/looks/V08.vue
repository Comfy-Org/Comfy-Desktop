<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowRight, Plus, X } from 'lucide-vue-next'
import WorkflowCover from '../../brand/WorkflowCover.vue'
import CategoryChip from '../../CategoryChip.vue'
import { allWorkflows } from '../../../gallery'
import { activeInstance } from '../../../useProto'
import { hubById } from '../../explore/hubWorkflows'
import { closeCreate, openTemplate, openWorkflow, startBlank } from '../createScreen'
import { readiness, type Starter } from '../createStarters'
import {
  buildOf,
  creatorOf,
  hueOf,
  playIn,
  readyIcon,
  runsOf,
  starterById,
  startersFor,
  stopIn,
  useEscapeCloses
} from './lookKitB'
import ResultsB from './ResultsB.vue'
import CreateComposer from './CreateComposer.vue'
import { createInput } from '../createInput'

const FEATURE_ID = 'video_ltx2_3_i2v'
const feature = starterById(FEATURE_ID, 'Image to video', 'dove')!
const featureStory = hubById(FEATURE_ID)?.description ?? feature.line
const reel = (['dunes', 'waves', 'horse', 'smoke'] as const).flatMap((slot) => {
  const s = starterById(FEATURE_ID, 'Image to video', slot)
  return s ? [{ slot, poster: s.poster, clip: s.clip }] : []
})

const COLLECTIONS: { id: string; title: string; dek: string; starters: Starter[] }[] = [
  {
    id: 'product',
    title: 'For product shots',
    dek: 'Clean cutouts, new backdrops and ad-ready stills from one photo of the thing you sell.',
    starters: [...startersFor(['Product & ads'], 6), ...startersFor(['Image editing'], 3)]
  },
  {
    id: 'video',
    title: 'Video in 5 minutes',
    dek: 'Start from a still or a sentence and get a short clip back before your coffee cools.',
    starters: startersFor(['Video generation'], 8, 2)
  },
  {
    id: 'restore',
    title: 'Make it sharper',
    dek: 'Upscale, restore and add detail to images and footage you already have.',
    starters: startersFor(['Upscale'], 8)
  },
  {
    id: 'characters',
    title: 'Characters that stay themselves',
    dek: 'One face, every angle, outfit and scene.',
    starters: startersFor(['Characters & fashion'], 8)
  },
  {
    id: '3d',
    title: 'From a picture to an object',
    dek: 'Meshes and splats from a single image, ready for a game engine or a print.',
    starters: startersFor(['3D'], 8)
  },
  {
    id: 'audio',
    title: 'Sound, voice and music',
    dek: 'Voiceovers, sound effects and loops to finish the clip.',
    starters: startersFor(['Audio'], 8)
  }
]

const query = ref('')
const composer = ref<InstanceType<typeof CreateComposer>>()
const navigated = ref(false)
watch(query, () => (navigated.value = false))
const results = ref<InstanceType<typeof ResultsB>>()
const recents = computed(() => [...allWorkflows.value].sort((a, b) => a.age - b.age).slice(0, 6))
const creator = creatorOf(FEATURE_ID)
const featureReady = computed(() => readiness(feature.template))

function key(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    if (query.value) query.value = ''
    else closeCreate()
    return
  }
  if (!query.value.trim()) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') navigated.value = true
  results.value?.key(e)
}

useEscapeCloses(() => composer.value?.field)
</script>

<template>
  <section class="v08 relative min-h-full px-10 pb-24" aria-label="Create">
    <header class="v08-mast">
      <h1 class="v08-ask">What do you want to make?</h1>
      <div class="v08-start">
        <CreateComposer
          ref="composer"
          v-model="query"
          class="v08-composer"
          :mode="createInput.id"
          :navigated
          @key="key"
          @build="(s) => openTemplate(s.template)"
        />
        <button
          type="button"
          class="v08-blank"
          :class="`is-${createInput.id}`"
          :title="`Empty canvas on ${activeInstance.name}`"
          @click="startBlank"
        >
          <Plus :size="15" />Blank canvas
        </button>
      </div>
      <button type="button" class="v08-icon v08-close" aria-label="Close" @click="closeCreate">
        <X :size="16" />
      </button>
    </header>

    <ResultsB v-if="query.trim()" ref="results" :query class="mt-10" />

    <template v-else>
      <article class="v08-feature">
        <button
          type="button"
          class="v08-feature-media"
          :aria-label="`Use ${feature.makes}`"
          @click="openTemplate(feature.template)"
        >
          <img :src="feature.poster" alt="" />
          <video
            v-if="feature.clip"
            :src="feature.clip"
            :poster="feature.poster"
            muted
            loop
            playsinline
            autoplay
            class="motion-reduce:hidden"
          />
        </button>
        <div class="v08-story">
          <p class="v08-kicker">Template of the day</p>
          <h2 class="v08-headline">Give a still photo a few seconds of life</h2>
          <p class="v08-byline">
            <span class="v08-avatar">{{ creator.name.slice(0, 1) }}</span>
            <span
              >{{ creator.name }}
              <span class="text-subtle-foreground"
                >shared {{ feature.makes }}, used {{ runsOf(FEATURE_ID) }} times</span
              ></span
            >
          </p>
          <p class="v08-dek">{{ featureStory }}</p>
          <div class="v08-reel" aria-label="Made with this template">
            <span
              v-for="r in reel"
              :key="r.slot"
              class="v08-reel-frame"
              @pointerenter="playIn($event.currentTarget)"
              @pointerleave="stopIn($event.currentTarget)"
            >
              <img :src="r.poster" alt="" loading="lazy" />
              <video v-if="r.clip" :src="r.clip" muted loop playsinline preload="none" />
            </span>
          </div>
          <div class="v08-act">
            <button type="button" class="v08-use" @click="openTemplate(feature.template)">
              Use this template
            </button>
            <p class="v08-ready" :class="`is-${featureReady.tone}`">
              <component
                :is="readyIcon(featureReady)"
                v-if="featureReady.tone !== 'off'"
                :size="13"
              />
              <span
                >{{ featureReady.label }}
                <span class="text-subtle-foreground">on {{ activeInstance.name }}</span></span
              >
            </p>
          </div>
        </div>
      </article>

      <section v-if="recents.length" class="v08-shelf">
        <div class="v08-shelf-head">
          <h2 class="v08-shelf-title">Pick up where you left off</h2>
        </div>
        <div class="v08-row is-recents">
          <button
            v-for="w in recents"
            :key="w.id"
            type="button"
            class="v08-recent"
            :style="hueOf(w)"
            @click="openWorkflow(w)"
          >
            <span class="v08-recent-cover"><WorkflowCover :name="w.name" /></span>
            <span class="flex min-w-0 flex-col">
              <span class="truncate text-ui font-medium text-base-foreground">{{ w.name }}</span>
              <span class="truncate text-[12px] text-subtle-foreground"
                >{{ buildOf(w)?.name }}, {{ w.modified.toLowerCase() }}</span
              >
            </span>
          </button>
        </div>
      </section>

      <section v-for="c in COLLECTIONS" :key="c.id" class="v08-shelf">
        <div class="v08-shelf-head">
          <h2 class="v08-shelf-title">{{ c.title }}</h2>
          <p class="v08-shelf-dek">{{ c.dek }}</p>
        </div>
        <div class="v08-row">
          <button
            v-for="s in c.starters"
            :key="s.id"
            type="button"
            class="v08-card group"
            @pointerenter="playIn($event.currentTarget)"
            @pointerleave="stopIn($event.currentTarget)"
            @focus="playIn($event.currentTarget)"
            @blur="stopIn($event.currentTarget)"
            @click="openTemplate(s.template)"
          >
            <span class="v08-card-pic">
              <img :src="s.poster" alt="" loading="lazy" />
              <video
                v-if="s.clip"
                :src="s.clip"
                :poster="s.poster"
                muted
                loop
                playsinline
                preload="none"
              />
              <span class="absolute top-2 left-2"><CategoryChip :category="s.media" /></span>
            </span>
            <span class="v08-card-title">{{ s.makes }}</span>
            <span class="v08-card-line">{{ s.line }}</span>
            <span class="v08-card-more">{{ s.model }} <ArrowRight :size="12" /></span>
          </button>
        </div>
      </section>
    </template>
  </section>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v08 {
  isolation: isolate;
}
:root .proto-ui.proto-ui.proto-ui .v08 > * {
  margin-inline: auto;
  max-width: 1240px;
}
:root .proto-ui.proto-ui.proto-ui .v08-mast {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 24px;
  padding-top: 56px;
  padding-bottom: 32px;
  border-bottom: 1px solid var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .v08-ask {
  color: var(--color-base-foreground);
  font-size: 56px;
  font-weight: 750;
  letter-spacing: -0.035em;
  line-height: 60px;
  text-wrap: balance;
}
:root .proto-ui.proto-ui.proto-ui .v08-start {
  display: flex;
  width: 100%;
  max-width: 720px;
  align-items: center;
  gap: 10px;
}
:root .proto-ui.proto-ui.proto-ui .v08-composer {
  flex: 1;
}
:root .proto-ui.proto-ui.proto-ui .v08-icon {
  display: grid;
  width: 28px;
  height: 28px;
  flex: none;
  place-items: center;
  border-radius: 999px;
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v08-icon:hover {
  background: var(--color-secondary-background-hover);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v08-close {
  position: absolute;
  top: 24px;
  right: 0;
  width: 36px;
  height: 36px;
}
:root .proto-ui.proto-ui.proto-ui .v08-blank {
  display: inline-flex;
  height: 40px;
  flex: none;
  align-items: center;
  gap: 7px;
  padding: 0 16px;
  border-radius: 999px;
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v08-blank.is-agent {
  height: 44px;
  box-shadow: inset 0 0 0 1px var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .v08-blank:hover {
  background: var(--color-secondary-background-hover);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v08-feature {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr);
  gap: 40px;
  margin-top: 32px;
  animation: v08-in 600ms var(--ease-out-expo) both;
}
:root .proto-ui.proto-ui.proto-ui .v08-feature-media {
  position: relative;
  min-height: 460px;
  overflow: hidden;
  border-radius: 24px;
  background: var(--color-card-background);
}
:root .proto-ui.proto-ui.proto-ui .v08-feature-media:focus-visible {
  box-shadow: 0 0 0 3px var(--color-border-focus);
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .v08-feature-media > img,
:root .proto-ui.proto-ui.proto-ui .v08-feature-media > video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v08-story {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: 8px 0;
}
:root .proto-ui.proto-ui.proto-ui .v08-kicker {
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v08-headline {
  margin-top: 10px;
  color: var(--color-base-foreground);
  font-size: 44px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 46px;
  text-wrap: balance;
}
:root .proto-ui.proto-ui.proto-ui .v08-byline {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 18px;
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v08-avatar {
  display: grid;
  width: 28px;
  height: 28px;
  flex: none;
  place-items: center;
  border-radius: 999px;
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
  font-size: 12px;
  font-weight: 700;
}
:root .proto-ui.proto-ui.proto-ui .v08-dek {
  display: -webkit-box;
  margin-top: 16px;
  overflow: hidden;
  color: var(--color-muted-foreground);
  font-size: 15px;
  line-height: 23px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}
:root .proto-ui.proto-ui.proto-ui .v08-reel {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  margin-top: 20px;
}
:root .proto-ui.proto-ui.proto-ui .v08-reel-frame {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 10px;
  background: var(--color-card-background);
}
:root .proto-ui.proto-ui.proto-ui .v08-reel-frame > * {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v08-act {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  margin-top: auto;
  padding-top: 24px;
}
:root .proto-ui.proto-ui.proto-ui .v08-use {
  height: 44px;
  padding: 0 22px;
  border-radius: 999px;
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
  font-size: 14px;
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v08-use:hover {
  background: var(--color-inverted-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .v08-ready {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v08-ready.is-ready svg {
  color: var(--color-status-running);
}
:root .proto-ui.proto-ui.proto-ui .v08-shelf {
  margin-top: 56px;
}
:root .proto-ui.proto-ui.proto-ui .v08-shelf-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 16px;
  margin-bottom: 16px;
}
:root .proto-ui.proto-ui.proto-ui .v08-shelf-title {
  color: var(--color-base-foreground);
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 32px;
}
:root .proto-ui.proto-ui.proto-ui .v08-shelf-dek {
  color: var(--color-subtle-foreground);
  font-size: 14px;
}
:root .proto-ui.proto-ui.proto-ui .v08-row {
  display: flex;
  gap: 16px;
  margin: 0 -8px;
  padding: 4px 8px 8px;
  overflow-x: auto;
  scroll-snap-type: x proximity;
  scrollbar-width: thin;
}
:root .proto-ui.proto-ui.proto-ui .v08-card {
  display: flex;
  width: 236px;
  flex: none;
  flex-direction: column;
  text-align: left;
  outline: none;
  scroll-snap-align: start;
}
:root .proto-ui.proto-ui.proto-ui .v08-card-pic {
  position: relative;
  aspect-ratio: 4 / 5;
  overflow: hidden;
  border-radius: 16px;
  background: var(--color-card-background);
}
:root .proto-ui.proto-ui.proto-ui .v08-card:focus-visible .v08-card-pic {
  box-shadow: 0 0 0 3px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v08-card-pic > img,
:root .proto-ui.proto-ui.proto-ui .v08-card-pic > video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 600ms var(--ease-out-expo);
}
:root .proto-ui.proto-ui.proto-ui .v08-card-pic > video,
:root .proto-ui.proto-ui.proto-ui .v08-reel-frame > video {
  opacity: 0;
  transition: opacity 240ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v08-card:hover .v08-card-pic > video,
:root .proto-ui.proto-ui.proto-ui .v08-card:focus-visible .v08-card-pic > video,
:root .proto-ui.proto-ui.proto-ui .v08-reel-frame:hover > video {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .v08-card:hover .v08-card-pic > * {
  transform: scale(1.03);
}
:root .proto-ui.proto-ui.proto-ui .v08-card-title {
  margin-top: 12px;
  color: var(--color-base-foreground);
  font-size: 15px;
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v08-card-line {
  display: -webkit-box;
  margin-top: 2px;
  overflow: hidden;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  line-height: 18px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
:root .proto-ui.proto-ui.proto-ui .v08-card-more {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v08-row.is-recents {
  gap: 10px;
}
:root .proto-ui.proto-ui.proto-ui .v08-recent {
  display: flex;
  width: 280px;
  flex: none;
  align-items: center;
  gap: 12px;
  padding: 6px 12px 6px 6px;
  border-radius: 14px;
  background: var(--color-secondary-background);
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .v08-recent:hover {
  background: var(--color-secondary-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .v08-recent-cover {
  width: 72px;
  height: 52px;
  flex: none;
  overflow: hidden;
  border-radius: 10px;
}
@keyframes v08-in {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
}
@media (max-width: 1000px) {
  :root .proto-ui.proto-ui.proto-ui .v08-feature {
    grid-template-columns: 1fr;
  }
  :root .proto-ui.proto-ui.proto-ui .v08-ask {
    font-size: 44px;
    line-height: 48px;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v08-feature {
    animation: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v08-card-pic > * {
    transition: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v08-card:hover .v08-card-pic > * {
    transform: none;
  }
}
</style>
