import { HUB_WORKFLOWS, hubById, type HubUseCase, type HubWorkflow } from './hubWorkflows'

export const START_HERE: string[] = [
  'image_z_image_turbo',
  'image_qwen_image_2_1_image_edit',
  'video_ltx2_3_i2v',
  'image_qwen_image_2_1_background_removal',
  'utility_seedvr2_7b_int8_upscale_image',
  '3d_hunyuan3d-v2.1'
]

export interface WorkflowIntent {
  id: string
  label: string
  thumbId: string
  useCase: HubUseCase
  title: RegExp
  related?: RegExp
}

export const WORKFLOW_INTENTS: WorkflowIntent[] = [
  {
    id: 'animate',
    label: 'Animate a photo',
    thumbId: 'video_ltx2_3_i2v',
    useCase: 'Video generation',
    title: /image to video/i
  },
  {
    id: 'background',
    label: 'Remove a background',
    thumbId: 'image_qwen_image_2_1_background_removal',
    useCase: 'Image editing',
    title: /background/i,
    related: /cutout|transparen/i
  },
  {
    id: 'upscale',
    label: 'Upscale',
    thumbId: 'utility_seedvr2_7b_int8_upscale_image',
    useCase: 'Upscale',
    title: /image upscale|upscaler/i,
    related: /upscale/i
  },
  {
    id: 'video',
    label: 'Make a video',
    thumbId: 'video_minimax_h3_t2v',
    useCase: 'Video generation',
    title: /text to video|t2v/i,
    related: /reference to video/i
  },
  {
    id: 'edit',
    label: 'Edit an image',
    thumbId: 'image_qwen_image_2_1_image_edit',
    useCase: 'Image editing',
    title: /image edit/i
  },
  {
    id: 'generate',
    label: 'Text to image',
    thumbId: 'image_z_image_turbo',
    useCase: 'Image generation',
    title: /text to image|t2i/i
  }
]

const MAX_PICKS = 4

const byUsage = (a: HubWorkflow, b: HubWorkflow): number => b.usage - a.usage

export function picksFor(
  intent: WorkflowIntent,
  passes: (w: HubWorkflow) => boolean = () => true
): HubWorkflow[] {
  const inCase = HUB_WORKFLOWS.filter((w) => w.useCase === intent.useCase && passes(w))
  const named = inCase.filter((w) => intent.title.test(w.title)).sort(byUsage)
  const related = intent.related
  const nearby = related
    ? inCase
        .filter((w) => !named.includes(w))
        .filter((w) => related.test(`${w.title} ${w.description}`))
        .sort(byUsage)
    : []
  return [...named, ...nearby].slice(0, MAX_PICKS)
}

export const startHere = (): HubWorkflow[] =>
  START_HERE.map(hubById).filter((w): w is HubWorkflow => Boolean(w))
