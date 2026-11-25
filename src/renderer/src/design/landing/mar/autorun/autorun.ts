import { watch } from 'vue'
import type { ProtoInstance, Template } from '../../mock'
import { hostActions, instanceById, proto } from '../../useProto'
import { dismiss, notify, undoToast } from '../pages/undo'
import { downloadFor, remove } from '../downloads/templateDownloads'
import { graphOpen } from '../graph/graphOpen'
import { hubById } from '../explore/hubWorkflows'
import { infoFor, mediaFor, tplById, type Target } from '../templateModal/templateData'
import { markDownloaded } from './installed'
import { dropPrepTab, prepOfTab, prepOfTemplate } from './prepTabs'

const EXAMPLE_PROMPTS: Record<string, string> = {
  image_moss_image_t2i:
    'A woman in a long white coat walking past a glowing theatre marquee at night, rain on the street, cinematic film still',
  image_z_image_turbo:
    'A fox curled up in a moss-covered hollow at dawn, soft fog, golden backlight, 50 mm photo',
  image_krea2_turbo_t2i:
    'Editorial portrait of a ceramicist in her studio, clay dust in the light, muted earth tones'
}

const FALLBACK_PROMPTS = {
  image: 'A quiet harbour town at golden hour, boats on still water, warm film tones',
  edit: 'Keep the subject, relight it with warm window light from the left',
  video: 'Slow push in, the camera drifts forward as the light shifts, gentle motion'
}

export const shortName = (t: Template): string => t.title.split(':')[0]!.trim()

function takesImage(t: Template): boolean {
  const use = hubById(t.id)?.useCase ?? ''
  return /editing|Upscale/i.test(use) || /image to video|i2v|edit/i.test(`${t.title} ${t.id}`)
}

function examplePrompt(t: Template): string {
  const own = EXAMPLE_PROMPTS[t.id]
  if (own) return own
  if (t.category === 'video') return FALLBACK_PROMPTS.video
  return takesImage(t) ? FALLBACK_PROMPTS.edit : FALLBACK_PROMPTS.image
}

export function runAction(s: Target): string {
  if (s.action === 'Download and start') return 'Download and run'
  if (s.inst.kind === 'local' && (s.state === 'running' || s.state === 'ready')) return 'Run'
  return s.action
}

export function runNote(s: Target, t: Template): string {
  if (s.state === 'download')
    return s.note.replace(
      /then starts (.+)\.$/,
      `then runs ${shortName(t)} on $1 with its example inputs.`
    )
  if (s.inst.kind === 'local' && (s.state === 'running' || s.state === 'ready'))
    return `Opens in ${s.inst.name} with its example inputs and runs it. Free on this Mac.`
  return s.note
}

export const autoRuns = (s: Target | undefined): boolean =>
  Boolean(
    s &&
    !s.disabled &&
    (s.state === 'download' ||
      s.state === 'running' ||
      s.state === 'ready' ||
      (s.state === 'cloud' && !s.inst.deployment))
  )

const readyMessage = (t: Template, inst: ProtoInstance): string =>
  `${shortName(t)} is ready on ${inst.name}`

export function runTemplate(t: Template, inst: ProtoInstance): void {
  const media = mediaFor(t)
  const prep = prepOfTemplate(t.id)
  const inTab = prep && prep.instId === inst.id ? prep : undefined
  graphOpen.autorun = {
    title: t.title,
    model: infoFor(t).model ?? shortName(t),
    prompt: examplePrompt(t),
    output: media.output,
    input: takesImage(t) ? (media.input ?? '') : undefined,
    video: t.category === 'video',
    tabId: inTab?.tabId
  }
  if (downloadFor(t.id)?.status === 'done') remove(t.id)
  if (undoToast.message === readyMessage(t, inst)) dismiss()
  if (!inTab) {
    hostActions.launch(inst, t.title)
    return
  }
  dropPrepTab(inTab.tabId)
  proto.detail = null
  proto.activeInstanceId = inst.id
  proto.activeTab = inTab.tabId
}

const watching = (templateId: string): boolean =>
  (proto.detail?.kind === 'template' && proto.detail.id === templateId) ||
  prepOfTemplate(templateId)?.tabId === proto.activeTab

export function downloadFinished(templateId: string, instId: string): void {
  markDownloaded(templateId, instId)
  const t = tplById(templateId)
  const inst = instanceById(instId)
  if (!t || !inst) return
  if (watching(templateId)) {
    runTemplate(t, inst)
    return
  }
  const prep = prepOfTemplate(templateId)
  if (prep) prep.ready = true
  notify(readyMessage(t, inst), () => runTemplate(t, inst), 'success', 'Open and run')
}

watch(
  () => proto.activeTab,
  (tabId) => {
    const prep = prepOfTab(tabId)
    const t = prep?.ready ? tplById(prep.templateId) : undefined
    const inst = prep ? instanceById(prep.instId) : undefined
    if (t && inst) runTemplate(t, inst)
  }
)
