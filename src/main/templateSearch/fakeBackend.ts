import { thumbnailUrlFor } from '../sources/standalone/curatedTemplates'
import { isPartnerTemplate } from './decisionApi'
import type { TemplateSearchCandidate, TemplateSearchResult } from '../../types/ipc'
import type { TemplateSearchBackend } from './types'

function candidate(
  templateId: string,
  title: string,
  family: string,
  extra: { missing?: string[]; rewrite?: boolean } = {}
): TemplateSearchCandidate {
  return {
    templateId,
    title,
    thumbnailUrl: thumbnailUrlFor(templateId, 'webp'),
    family,
    partner: isPartnerTemplate(templateId),
    rewrite: extra.rewrite ?? false,
    missing: extra.missing ?? []
  }
}

const TEXT_TO_IMAGE = candidate(
  'image_z_image_turbo',
  'Z-Image-Turbo Text to Image',
  'text-to-image',
  {
    rewrite: true
  }
)
const FAST_IMAGE = candidate('sdxlturbo_example', 'SDXL Turbo', 'text-to-image')
const PIXEL_IMAGE = candidate('image_pixeldit_t2i', 'PixelDiT: Text to Image', 'text-to-image', {
  missing: ['PixelDiT model']
})
const IMAGE_EDIT = candidate(
  'api_bytedance_seedream_5_0_pro_image_edit',
  'Seedream 5.0 Pro: Image Edit',
  'image-edit'
)
const TEXT_TO_VIDEO = candidate(
  'video_minimax_h3_t2v',
  'MiniMax H3: Text to Video',
  'text-to-video',
  {
    rewrite: true
  }
)
const CAMERA_VIDEO = candidate(
  'video_wan2.1_fun_camera_v1.1_1.3B',
  'Wan 2.1 Fun Camera 1.3B',
  'text-to-video',
  { missing: ['Wan 2.1 Fun Camera model'] }
)
const MUSIC = candidate(
  'audio_ace_step_1_5_checkpoint',
  'ACE-Step 1.5 Music Generation AIO',
  'music'
)
const SOUND = candidate('audio_stable_audio_3_medium', 'Stable Audio 3.0 Medium', 'sound')
const IMAGE_TO_3D = candidate(
  '3d_hunyuan3d_multiview_to_model_turbo',
  'HY 3D 2.0 MV Turbo',
  'image-to-3d',
  { missing: ['Hunyuan3D 2.0 MV Turbo model'] }
)

const NOTHING_TO_MAKE =
  'Say what you want to make, for example a poster for a bake sale or a short clip of waves.'

interface FakeAnswer {
  pattern: RegExp
  result: TemplateSearchResult
}

function templates(
  run: TemplateSearchCandidate[],
  download: TemplateSearchCandidate[] = [],
  alsoTry: TemplateSearchCandidate[] = []
): TemplateSearchResult {
  return { outcome: 'template', reply: null, run, download, alsoTry }
}

const ANSWERS: readonly FakeAnswer[] = [
  {
    pattern: /^[^\p{L}]*$/u,
    result: { outcome: 'bad_input', reply: NOTHING_TO_MAKE, run: [], download: [], alsoTry: [] }
  },
  {
    pattern: /\b(how|why|explain|help|set up|install)\b|\?\s*$/i,
    result: { outcome: 'agent', reply: null, run: [], download: [], alsoTry: [TEXT_TO_IMAGE] }
  },
  {
    pattern: /\b(video|clip|animate|animation|motion)\b/i,
    result: templates([TEXT_TO_VIDEO], [CAMERA_VIDEO], [TEXT_TO_IMAGE])
  },
  { pattern: /\b(music|song|beat|jingle)\b/i, result: templates([MUSIC], [], [SOUND]) },
  { pattern: /\b(sound|audio|voice)\b/i, result: templates([SOUND], [], [MUSIC]) },
  { pattern: /\b(3d|mesh|model of)\b/i, result: templates([], [IMAGE_TO_3D], [TEXT_TO_IMAGE]) },
  {
    pattern: /\b(edit|remove|replace|background|upscale|restore|this photo|my photo)\b/i,
    result: templates([IMAGE_EDIT], [], [TEXT_TO_IMAGE, FAST_IMAGE])
  }
]

const DEFAULT_ANSWER = templates([TEXT_TO_IMAGE], [PIXEL_IMAGE], [FAST_IMAGE])

export function fakeDecision(query: string): TemplateSearchResult {
  return ANSWERS.find((answer) => answer.pattern.test(query))?.result ?? DEFAULT_ANSWER
}

export function createFakeBackend(): TemplateSearchBackend {
  return {
    search: (query) => Promise.resolve(fakeDecision(query))
  }
}
