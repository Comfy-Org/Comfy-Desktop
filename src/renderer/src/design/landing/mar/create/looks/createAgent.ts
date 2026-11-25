import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { activeInstance } from '../../../useProto'
import type { NodeKind } from '../../graph/canvasData'
import { readiness, type Starter } from '../createStarters'
import { graphFor, reducedMotion } from './lookKitB'
import { answer, subjectOf, type AgentAnswer } from './v07Agent'
import type { GhostAgent } from './GhostGraph.vue'

export interface Exchange {
  id: number
  prompt: string
  reply: string
  typed: number
  rec: Starter | null
  choice: string | null
}

const BUILD_STEP_MS = 700
const TYPE_STEP_MS = 24
const STEP_LABEL: Partial<Record<NodeKind, string>> = {
  image: 'Adding your photo input',
  prompt: 'Adding the prompt',
  output: 'Wiring to Output'
}

export function useCreateAgent() {
  const panel = ref(false)
  const talk = ref<Exchange[]>([])
  const last = computed(() => talk.value.at(-1))
  const followUp = ref('')
  const focusAsk = ref(0)
  const scrollAsk = ref(0)
  const build = ref<{ starter: Starter; shown: number; total: number; prompt: string } | null>(null)
  const built = computed(() => !!build.value && build.value.shown >= build.value.total)
  let timer: ReturnType<typeof setTimeout> | undefined
  let typer: ReturnType<typeof setInterval> | undefined

  function stopBuild(): void {
    clearTimeout(timer)
    build.value = null
  }

  function step(): void {
    const b = build.value
    if (!b || b.shown >= b.total) return
    timer = setTimeout(() => {
      if (!build.value) return
      build.value.shown += 1
      scrollAsk.value++
      step()
    }, BUILD_STEP_MS)
  }

  function startBuild(starter: Starter, prompt: string): void {
    stopBuild()
    const total = graphFor(starter).nodes.length
    build.value = { starter, total, prompt, shown: reducedMotion() ? total : 1 }
    step()
  }

  function replyFor(a: AgentAnswer, prev: Starter | null): { text: string; rec: Starter | null } {
    const rec = a.picks[0] ?? prev
    if (!rec)
      return {
        text: `I couldn’t match “${a.prompt}” to a template yet. You can start blank and add nodes yourself.`,
        rec: null
      }
    const lead = a.understood ? `${a.understood}.` : 'Got it.'
    return {
      text: `${lead} I’d start from ${rec.model} ${rec.makes}, and I’m setting it up on the canvas now.`,
      rec
    }
  }

  function stream(): void {
    clearInterval(typer)
    typer = setInterval(() => {
      const e = last.value
      if (!e || e.typed >= e.reply.length) {
        clearInterval(typer)
        return
      }
      e.typed = Math.min(e.reply.length, e.typed + 3)
    }, TYPE_STEP_MS)
  }

  function ask(a: AgentAnswer): void {
    const { text, rec } = replyFor(a, last.value?.rec ?? null)
    talk.value.push({
      id: talk.value.length,
      prompt: a.prompt,
      reply: text,
      typed: reducedMotion() ? text.length : 0,
      rec,
      choice: null
    })
    panel.value = true
    stream()
    if (rec) startBuild(rec, a.prompt)
    nextTick(() => scrollAsk.value++)
  }

  function refine(): void {
    const text = followUp.value.trim()
    if (!text) return
    followUp.value = ''
    ask(answer(text))
  }

  function close(): void {
    clearInterval(typer)
    panel.value = false
  }

  function reset(): void {
    close()
    stopBuild()
    talk.value = []
  }

  onBeforeUnmount(() => {
    clearTimeout(timer)
    clearInterval(typer)
  })

  const steps = computed(() =>
    build.value
      ? graphFor(build.value.starter).nodes.map((n) => STEP_LABEL[n.kind] ?? `Adding ${n.title}`)
      : []
  )

  const ghost = computed<GhostAgent | null>(() => {
    const b = build.value
    if (!b) return null
    const subject = subjectOf(b.prompt)
    const video = b.starter.media === 'video'
    return {
      shown: b.shown,
      drop: subject ? `Drop your ${subject} photo` : 'Drop your photo',
      prompt: video
        ? subject
          ? `Your ${subject}, gentle camera push-in`
          : 'Gentle camera push-in, soft natural light'
        : b.prompt.charAt(0).toUpperCase() + b.prompt.slice(1),
      out: video ? 'Your video appears here' : 'Your image appears here'
    }
  })

  function questionOf(e: Exchange): { label: string; options: string[] } {
    return e.rec?.media === 'video'
      ? { label: 'Length', options: ['5 s', '10 s'] }
      : { label: 'Runs on', options: [activeInstance.value.name, 'Comfy Cloud'] }
  }
  const choiceOf = (e: Exchange): string => e.choice ?? questionOf(e).options[0]!

  function resultLine(e: Exchange): string {
    const rec = e.rec!
    const choice = choiceOf(e)
    const cost =
      choice === 'Comfy Cloud'
        ? 'Runs on Comfy Cloud, nothing to download'
        : readiness(rec.template).label
    const length = choice === '10 s' ? ' · 10 s clip' : ''
    return `${rec.makes} · ${build.value?.total ?? 0} nodes · ${cost}${length}`
  }

  return {
    panel,
    talk,
    last,
    followUp,
    focusAsk,
    scrollAsk,
    build,
    built,
    steps,
    ghost,
    ask,
    refine,
    close,
    reset,
    questionOf,
    choiceOf,
    resultLine
  }
}

export type CreateAgent = ReturnType<typeof useCreateAgent>
