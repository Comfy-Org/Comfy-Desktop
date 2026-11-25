import type { Template } from '../../mock'
import { hubById, type HubWorkflow } from '../explore/hubWorkflows'

export type InputKind = 'image' | 'text' | 'video' | 'audio'

export interface TplInput {
  kind: InputKind
  label: string
  optional?: boolean
}

const PROMPT: TplInput = { kind: 'text', label: 'A text prompt' }
const PHOTO: TplInput = { kind: 'image', label: 'A photo' }
const CHANGE: TplInput = { kind: 'text', label: 'What to change' }
const SHORT_VIDEO: TplInput = { kind: 'video', label: 'A video, ≤ 10 s' }
const MOTION: TplInput = { kind: 'text', label: 'How it moves', optional: true }
const SPEECH: TplInput = { kind: 'text', label: 'The words to say' }

const OWN_INPUTS: Record<string, TplInput[]> = {
  image_qwen_image_2_1_image_edit: [{ kind: 'image', label: 'One or two photos' }, CHANGE],
  image_qwen_image_2_1_background_removal: [PHOTO],
  template_qwen_multiangle: [{ kind: 'image', label: 'A photo of the subject' }],
  image_qwen_image_edit_2511: [PHOTO, { kind: 'text', label: 'The new material' }],
  video_ltx2_5_flf2v: [{ kind: 'image', label: 'A first and a last frame' }, MOTION],
  video_ltx2_3_ia2v: [PHOTO, { kind: 'audio', label: 'A voice or music clip, ≤ 20 s' }],
  video_wan_animate2: [
    { kind: 'image', label: 'A photo of the character' },
    { kind: 'video', label: 'A driving video, ≤ 10 s' }
  ],
  template_purz_wan22_animate_auto_character_replace: [
    { kind: 'image', label: 'A photo of the character' },
    { kind: 'video', label: 'A video to replace them in, ≤ 10 s' }
  ],
  'templates-wan2_1_infinitetalk_music': [
    { kind: 'image', label: 'A portrait' },
    { kind: 'audio', label: 'A song or voice clip, ≤ 30 s' }
  ],
  template_image_speech_to_video: [
    { kind: 'image', label: 'A portrait' },
    { kind: 'audio', label: 'A voice sample, ≤ 30 s' },
    SPEECH
  ],
  api_elevenlabs_v4_text_to_speech: [SPEECH],
  api_fishaudio_voice_clone_tts: [{ kind: 'audio', label: 'A voice sample, ≤ 30 s' }, SPEECH],
  api_fishaudio_drama3_directed: [SPEECH, { kind: 'text', label: 'How to perform it' }],
  api_mirelo_video_to_sfx: [SHORT_VIDEO],
  api_minimax_h3_max_recast: [SHORT_VIDEO, { kind: 'image', label: 'A photo of the new cast' }],
  utility_sam3d_body: [SHORT_VIDEO],
  'templates-fashion_shoot_vton': [
    { kind: 'image', label: 'A photo of the character' },
    { kind: 'image', label: 'A flat lay of the outfit' }
  ],
  'templates-subject_product_swap': [
    { kind: 'image', label: 'A photo of the character' },
    { kind: 'image', label: 'A photo of the product' }
  ],
  'templates-assemble_dieline': [{ kind: 'image', label: 'A dieline' }, PROMPT],
  'templates-3D_logo_texture_animation': [
    { kind: 'image', label: 'Your logo, as a vector image' },
    { kind: 'text', label: 'The texture you want' }
  ]
}

const isReference = (key: string): boolean => /r2v|ref2v|reference/i.test(key)
const isMultiView = (key: string): boolean => /multi.?view/i.test(key)

function fromCatalog(w: HubWorkflow): TplInput[] {
  const key = `${w.id} ${w.title}`
  const uploads = /\bupload\b|\bimage of\b|single image|1 image|from a photo/i.test(w.description)
  const prompts = /\bprompt\b/i.test(w.description)
  switch (w.useCase) {
    case 'Image generation':
      return [PROMPT]
    case 'Image editing':
      return [PHOTO, CHANGE]
    case 'Upscale':
      return [w.media === 'video' ? SHORT_VIDEO : PHOTO]
    case 'Video editing':
      return [SHORT_VIDEO]
    case 'Video generation':
      if (isReference(key)) return [{ kind: 'image', label: 'Up to 9 reference images' }, PROMPT]
      if (/i2v|image to video/i.test(key)) return [PHOTO, MOTION]
      return [PROMPT]
    case 'Audio':
      return [/music/i.test(key) ? { kind: 'text', label: 'A style, and lyrics' } : PROMPT]
    case '3D':
      return [
        isMultiView(key)
          ? { kind: 'image', label: 'Photos from a few sides' }
          : { kind: 'image', label: 'A photo of an object' }
      ]
    default:
      return [
        ...(uploads || !prompts ? [PHOTO] : []),
        ...(prompts ? [{ ...PROMPT, optional: uploads }] : [])
      ]
  }
}

const CATEGORY_INPUTS: Record<Template['category'], TplInput[]> = {
  image: [PROMPT],
  video: [PROMPT],
  audio: [PROMPT],
  '3d': [{ kind: 'image', label: 'A photo of an object' }]
}

export function inputsFor(t: Template): TplInput[] {
  const own = OWN_INPUTS[t.id.replace(/\.app$/, '')]
  if (own) return own
  const w = hubById(t.id)
  if (w) return fromCatalog(w)
  return CATEGORY_INPUTS[t.category]
}
