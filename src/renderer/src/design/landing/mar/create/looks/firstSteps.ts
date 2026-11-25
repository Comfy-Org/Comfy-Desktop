import { mock } from '../../assets/mock'
import type { Recipe } from '../../graph/canvasData'
import { starterById } from './lookKitB'

export interface Step {
  id: string
  title: string
  line: string
  chain: string
  src: string
  clip?: string
  recipe?: Recipe
  agent?: boolean
}

const video = starterById('video_ltx2_3_i2v', 'Image to video', 'waves')

export const STEPS: Step[] = [
  {
    id: 'image',
    title: 'Generate an image',
    line: 'Describe it, get a picture.',
    chain: 'Prompt, Generate Image, Output',
    src: mock('asset-neon-alley'),
    recipe: {
      nodes: [
        {
          key: 'p',
          kind: 'prompt',
          dx: 0,
          dy: 0,
          text: 'A woman with a clear umbrella in a neon alley, rain, 35mm'
        },
        { key: 'g', kind: 'generate', dx: 360, dy: 0 },
        { key: 'o', kind: 'output', dx: 720, dy: 0 }
      ],
      links: [
        ['p', 0, 'g', 0],
        ['g', 0, 'o', 0]
      ]
    }
  },
  {
    id: 'video',
    title: 'Generate a video',
    line: 'Turn a still or a sentence into a clip.',
    chain: 'Prompt and Image, Generate Video',
    src: video?.poster ?? mock('gv-waves'),
    clip: video?.clip,
    recipe: {
      nodes: [
        { key: 'p', kind: 'prompt', dx: 0, dy: 0, text: 'Slow push in over the waves at dusk' },
        { key: 'i', kind: 'image', dx: 0, dy: 280 },
        { key: 'v', kind: 'generateVideo', dx: 360, dy: 0 }
      ],
      links: [
        ['p', 0, 'v', 0],
        ['i', 0, 'v', 1]
      ]
    }
  },
  {
    id: 'mine',
    title: 'Use my image',
    line: 'Start from a picture you already have.',
    chain: 'Image, Upscale, Output',
    src: mock('asset-fisherman-portrait'),
    recipe: {
      nodes: [
        { key: 'i', kind: 'image', dx: 0, dy: 0 },
        { key: 'u', kind: 'upscale', dx: 340, dy: 0 },
        { key: 'o', kind: 'output', dx: 680, dy: 0 }
      ],
      links: [
        ['i', 0, 'u', 0],
        ['u', 0, 'o', 0]
      ]
    }
  },
  {
    id: 'edit',
    title: 'Edit an image',
    line: 'Change a photo with words.',
    chain: 'Image and Prompt, Generate Image, Output',
    src: mock('asset-sneaker-dust'),
    recipe: {
      nodes: [
        { key: 'p', kind: 'prompt', dx: 0, dy: 0, text: 'Same shoe, golden hour, orange dust' },
        { key: 'i', kind: 'image', dx: 0, dy: 280 },
        { key: 'g', kind: 'generate', dx: 360, dy: 0 },
        { key: 'o', kind: 'output', dx: 720, dy: 0 }
      ],
      links: [
        ['p', 0, 'g', 0],
        ['i', 0, 'g', 1],
        ['g', 0, 'o', 0]
      ]
    }
  },
  {
    id: 'agent',
    title: 'Ask the agent',
    line: 'Say what you want; it builds the graph.',
    chain: 'The agent adds and wires the nodes for you',
    src: mock('asset-astronaut-sunflowers'),
    agent: true
  }
]
