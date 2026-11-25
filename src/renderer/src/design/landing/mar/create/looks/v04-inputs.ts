import { hubById } from '../../explore/hubWorkflows'
import type { Starter } from '../createStarters'

export type InputSide =
  | { kind: 'prompt'; label: string; text: string }
  | { kind: 'image'; label: string; src: string; look: 'still' | 'soft' | 'flat' }

const PROMPTS: Record<Starter['media'], string> = {
  image: 'A woman on a harbour wall at golden hour, wind in her hair, 85 mm, soft film grain',
  video: 'Slow dolly over desert dunes at dawn, wind lifting fine sand, long shadows',
  audio: 'Warm lo-fi beat, brushed drums, a mellow Rhodes and vinyl crackle, 84 bpm',
  '3d': 'A small ceramic robot with rounded edges, matte glaze, studio light'
}

export function inputOf(s: Starter): InputSide {
  const w = hubById(s.id)
  const useCase = w?.useCase
  const fromImage = /i2v|image to video|image_to/i.test(`${s.id} ${s.makes}`)
  if (useCase === 'Upscale')
    return { kind: 'image', label: 'Your picture', src: s.poster, look: 'soft' }
  if (useCase === 'Image editing' || useCase === 'Video editing')
    return { kind: 'image', label: 'Your photo', src: s.poster, look: 'flat' }
  if (useCase === '3D' || fromImage)
    return { kind: 'image', label: 'Your image', src: s.poster, look: 'still' }
  return { kind: 'prompt', label: 'Your prompt', text: PROMPTS[s.media] }
}
