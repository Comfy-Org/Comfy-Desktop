<script setup lang="ts">
import { computed, nextTick, ref, watch, type Component } from 'vue'
import {
  CircleDollarSign,
  Download,
  Gauge,
  HardDrive,
  LayoutGrid,
  Paperclip,
  Plus,
  Star
} from 'lucide-vue-next'
import WorkflowCover from '../../brand/WorkflowCover.vue'
import Button from '../../../ui/Button.vue'
import MarStatus from '../../pages/MarStatus.vue'
import { exploreStart } from '../../explore/exploreStart'
import { go } from '../../../useProto'
import { closeCreate, startBlank } from '../createScreen'
import {
  agentLeads,
  chipsOf,
  needsSignIn,
  resultsTitle,
  verticalNeighbour,
  type ChipTone,
  type Found,
  type SmartAnswer,
  type SmartOption,
  type TemplateCard
} from '../smartSearch'
import { playIn, reducedMotion, stopIn } from './lookKitB'
import SmartAgentRow from './SmartAgentRow.vue'

const { answer, options, active, listId } = defineProps<{
  answer: SmartAnswer
  options: SmartOption[]
  active: number
  listId: string
}>()
const emit = defineEmits<{ pick: [option: SmartOption]; hover: [index: number] }>()

const ICONS: Record<ChipTone, Component> = {
  partner: CircleDollarSign,
  best: Star,
  download: Download,
  size: HardDrive,
  input: Paperclip,
  strong: Gauge,
  good: Gauge,
  weak: Gauge
}
const list = ref<HTMLElement>()
const optionId = (i: number): string => `${listId}-${i}`
const indexOf = (id: string): number => options.findIndex((o) => o.id === id)
const cardOption = (card: TemplateCard): SmartOption => ({
  id: card.key,
  kind: 'template',
  card
})
const foundOption = (found: Found): SmartOption => ({ id: found.id, kind: 'found', found })
const agentIndex = computed(() => indexOf('agent'))
const nothing = computed(() => !answer.cards.length && !answer.alsoTry.length)
const title = computed(() => resultsTitle(answer))
const lead = computed(() => agentLeads(answer))
const agentOption: SmartOption = { id: 'agent', kind: 'agent' }
const quick = computed(() =>
  [
    { id: 'workflows', name: 'Your workflows', hits: answer.workflows },
    { id: 'apps', name: 'Apps', hits: answer.apps }
  ].filter((g) => g.hits.length)
)
const groups = computed(() =>
  [
    { id: 'templates', name: title.value, cards: answer.cards, weak: false },
    { id: 'also', name: 'Also try', cards: answer.alsoTry, weak: true }
  ].filter((g) => g.cards.length)
)
const status = computed(() =>
  nothing.value
    ? `No templates match “${answer.query}”.`
    : `${answer.cards.length + answer.alsoTry.length} templates`
)

function browseTemplates(): void {
  exploreStart.value = 'templates'
  closeCreate()
  go('explore')
}

let last = { x: -1, y: -1 }
function onPointer(e: PointerEvent, i: number): void {
  if (e.clientX === last.x && e.clientY === last.y) return
  last = { x: e.clientX, y: e.clientY }
  emit('hover', i)
}

function enter(e: PointerEvent, i: number): void {
  onPointer(e, i)
  if (!reducedMotion()) playIn(e.currentTarget)
}

function verticalTarget(step: 1 | -1): number | null {
  const boxes = [...(list.value?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])].map(
    (el) => el.getBoundingClientRect()
  )
  return verticalNeighbour(boxes, active, step)
}

function revealActive(): void {
  void nextTick(() =>
    list.value?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  )
}

watch(() => active, revealActive)

defineExpose({ verticalTarget, revealActive })
</script>

<template>
  <div
    class="v15-starts"
    :class="[lead && 'is-agent-first', nothing && 'is-none']"
    @mousedown.prevent
  >
    <p class="sr-only" aria-live="polite">{{ status }}</p>
    <p v-if="nothing" class="v15-none" aria-hidden="true">No templates match.</p>
    <div :id="listId" ref="list" role="listbox" class="contents" :aria-label="title">
      <SmartAgentRow
        v-if="lead"
        :id="optionId(agentIndex)"
        role="option"
        :aria-selected="active === agentIndex"
        :data-i="agentIndex"
        :query="answer.query"
        :at="active === agentIndex"
        lead
        @pointermove="onPointer($event, agentIndex)"
        @click="emit('pick', agentOption)"
      />
      <section
        v-for="g in quick"
        :key="g.id"
        class="v15-section"
        role="group"
        :aria-labelledby="`${listId}-${g.id}`"
      >
        <div class="mar-sec hsh" role="presentation">
          <h2 :id="`${listId}-${g.id}`">{{ g.name }}</h2>
        </div>
        <div class="v15-list">
          <div
            v-for="f in g.hits"
            :id="optionId(indexOf(f.id))"
            :key="f.id"
            role="option"
            :aria-selected="active === indexOf(f.id)"
            :data-i="indexOf(f.id)"
            class="v15-item cursor-pointer"
            :class="active === indexOf(f.id) && 'is-at'"
            @pointermove="onPointer($event, indexOf(f.id))"
            @click="emit('pick', foundOption(f))"
          >
            <span class="v15-thumb">
              <img v-if="f.image" :src="f.image" alt="" loading="lazy" />
              <WorkflowCover v-else :name="f.name" />
            </span>
            <span class="v15-file">{{ f.name }}</span>
            <span class="v15-build">{{ f.kind === 'app' ? 'App' : 'Workflow' }}</span>
            <span class="v15-when">{{ f.meta }}</span>
          </div>
        </div>
      </section>

      <section
        v-for="g in groups"
        :key="g.id"
        class="v15-section"
        role="group"
        :aria-labelledby="`${listId}-${g.id}`"
      >
        <div class="mar-sec hsh" role="presentation">
          <h2 :id="`${listId}-${g.id}`">{{ g.name }}</h2>
        </div>
        <div class="v15-row grid-cols-4!">
          <div
            v-for="card in g.cards"
            :id="optionId(indexOf(card.key))"
            :key="card.key"
            role="option"
            :aria-selected="active === indexOf(card.key)"
            :data-i="indexOf(card.key)"
            class="v15-card cursor-pointer"
            :class="[active === indexOf(card.key) && 'is-at', g.weak && 'opacity-60']"
            @pointerenter="enter($event, indexOf(card.key))"
            @pointermove="onPointer($event, indexOf(card.key))"
            @pointerleave="stopIn($event.currentTarget)"
            @click="emit('pick', cardOption(card))"
          >
            <span class="v15-pic">
              <img
                :src="card.starter.poster"
                alt=""
                loading="lazy"
                :class="g.weak && 'grayscale'"
              />
              <video
                v-if="card.starter.clip && !g.weak"
                :src="card.starter.clip"
                :poster="card.starter.poster"
                muted
                loop
                playsinline
                preload="none"
              />
            </span>
            <span class="v15-text">
              <span class="v15-name" :title="card.title">{{ card.title }}</span>
              <span class="v15-meta">{{ needsSignIn(card) ? 'Sign in to use' : card.family }}</span>
            </span>
            <span class="flex flex-wrap gap-1.5 px-0.5">
              <MarStatus
                v-for="c in chipsOf(card)"
                :key="c.label"
                status="stopped"
                :icon="ICONS[c.tone]"
                :label="c.label"
              />
            </span>
          </div>
        </div>
        <SmartAgentRow
          v-if="g.id === 'templates' && !lead"
          :id="optionId(agentIndex)"
          role="option"
          class="mt-4"
          :aria-selected="active === agentIndex"
          :data-i="agentIndex"
          :query="answer.query"
          :at="active === agentIndex"
          @pointermove="onPointer($event, agentIndex)"
          @click="emit('pick', agentOption)"
        />
      </section>
    </div>
    <div v-if="nothing" class="v15-ways">
      <Button variant="ghost" size="sm" @click="startBlank"
        ><Plus :size="14" />Start with a blank canvas</Button
      >
      <Button variant="ghost" size="sm" @click="browseTemplates"
        ><LayoutGrid :size="14" />Browse all templates</Button
      >
    </div>
  </div>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v15-starts.is-agent-first {
  gap: 24px;
  margin-top: 16px;
}
:root .proto-ui.proto-ui.proto-ui .v15-starts.is-none {
  width: min(640px, 100%);
  gap: 10px;
}
:root .proto-ui.proto-ui.proto-ui .v15-none {
  margin: 0;
  padding: 0 4px;
  color: var(--color-muted-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v15-ways {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-left: -4px;
}
</style>
