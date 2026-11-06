import type { Template } from '../../mock'
import { needsFor, type TplMedia } from './templateData'

/**
 * A tidy, hand-laid node graph for the template modal's Graph view: the
 * template's real node types and model files, ComfyUI's slot colours, and
 * the example input and output inside the image nodes.
 */

export type SlotType = 'MODEL' | 'CLIP' | 'VAE' | 'IMAGE' | 'LATENT' | 'CONDITIONING'

/** ComfyUI's link colours per type (litegraph's default palette). */
export const SLOT_COLOR: Record<SlotType, string> = {
  MODEL: '#b39ddb',
  CLIP: '#ffd500',
  VAE: '#ff6e6e',
  IMAGE: '#64b5f6',
  LATENT: '#ff9cf9',
  CONDITIONING: '#ffa931'
}

export interface GNode {
  id: string
  title: string
  x: number
  y: number
  w: number
  /** loader / input / process / output: tints the header dot. */
  role: 'loader' | 'input' | 'process' | 'output'
  ins: [string, SlotType][]
  outs: [string, SlotType][]
  widgets: [string, string][]
  text?: string
  image?: string
  imageH?: number
}

export interface GLink {
  from: [string, number]
  to: [string, number]
  type: SlotType
}

export interface GraphSpec {
  width: number
  height: number
  nodes: GNode[]
  links: GLink[]
}

export const HEADER = 30
export const ROW = 22
export const WIDGET = 24

export function nodeHeight(n: GNode): number {
  const slots = Math.max(n.ins.length, n.outs.length)
  return (
    HEADER +
    slots * ROW +
    (n.widgets.length ? 6 + n.widgets.length * (WIDGET + 4) : 0) +
    (n.text ? 72 : 0) +
    (n.image ? (n.imageH ?? 120) + 8 : 0) +
    10
  )
}

export function slotPos(n: GNode, side: 'in' | 'out', i: number): [number, number] {
  return [side === 'in' ? n.x : n.x + n.w, n.y + HEADER + i * ROW + ROW / 2 + 2]
}

const short = (f: string): string => f.replace('.safetensors', '')

export function graphFor(t: Template, media: TplMedia): GraphSpec {
  const models = needsFor(t)
  if (t.id === 'image_qwen_image_edit_2511') {
    return {
      width: 1064,
      height: 440,
      nodes: [
        {
          id: 'unet',
          title: 'Load Diffusion Model',
          role: 'loader',
          x: 16,
          y: 16,
          w: 224,
          ins: [],
          outs: [['MODEL', 'MODEL']],
          widgets: [['unet_name', short(models[0]!.name)]]
        },
        {
          id: 'clip',
          title: 'Load CLIP',
          role: 'loader',
          x: 16,
          y: 128,
          w: 224,
          ins: [],
          outs: [['CLIP', 'CLIP']],
          widgets: [['clip_name', short(models[1]!.name)]]
        },
        {
          id: 'vae',
          title: 'Load VAE',
          role: 'loader',
          x: 16,
          y: 240,
          w: 224,
          ins: [],
          outs: [['VAE', 'VAE']],
          widgets: [['vae_name', short(models[2]!.name)]]
        },
        {
          id: 'pos',
          title: 'Text Encode Qwen Image Edit',
          role: 'process',
          x: 288,
          y: 16,
          w: 244,
          ins: [
            ['clip', 'CLIP'],
            ['vae', 'VAE'],
            ['image', 'IMAGE']
          ],
          outs: [['CONDITIONING', 'CONDITIONING']],
          widgets: [],
          text: 'Rotate the camera 45° to the left. Keep the product, light and background.'
        },
        {
          id: 'img',
          title: 'Load Image',
          role: 'input',
          x: 288,
          y: 214,
          w: 244,
          ins: [],
          outs: [['IMAGE', 'IMAGE']],
          widgets: [],
          image: media.input,
          imageH: 136
        },
        {
          id: 'ks',
          title: 'KSampler',
          role: 'process',
          x: 580,
          y: 16,
          w: 216,
          ins: [
            ['model', 'MODEL'],
            ['positive', 'CONDITIONING'],
            ['latent_image', 'LATENT']
          ],
          outs: [['LATENT', 'LATENT']],
          widgets: [
            ['steps', '4'],
            ['cfg', '1.0'],
            ['sampler', 'euler']
          ]
        },
        {
          id: 'enc',
          title: 'VAE Encode',
          role: 'process',
          x: 580,
          y: 254,
          w: 216,
          ins: [
            ['pixels', 'IMAGE'],
            ['vae', 'VAE']
          ],
          outs: [['LATENT', 'LATENT']],
          widgets: []
        },
        {
          id: 'dec',
          title: 'VAE Decode',
          role: 'process',
          x: 844,
          y: 16,
          w: 204,
          ins: [
            ['samples', 'LATENT'],
            ['vae', 'VAE']
          ],
          outs: [['IMAGE', 'IMAGE']],
          widgets: []
        },
        {
          id: 'save',
          title: 'Save Image',
          role: 'output',
          x: 844,
          y: 128,
          w: 204,
          ins: [['images', 'IMAGE']],
          outs: [],
          widgets: [],
          image: media.output,
          imageH: 122
        }
      ],
      links: [
        { from: ['unet', 0], to: ['ks', 0], type: 'MODEL' },
        { from: ['clip', 0], to: ['pos', 0], type: 'CLIP' },
        { from: ['vae', 0], to: ['pos', 1], type: 'VAE' },
        { from: ['img', 0], to: ['pos', 2], type: 'IMAGE' },
        { from: ['img', 0], to: ['enc', 0], type: 'IMAGE' },
        { from: ['vae', 0], to: ['enc', 1], type: 'VAE' },
        { from: ['pos', 0], to: ['ks', 1], type: 'CONDITIONING' },
        { from: ['enc', 0], to: ['ks', 2], type: 'LATENT' },
        { from: ['ks', 0], to: ['dec', 0], type: 'LATENT' },
        { from: ['vae', 0], to: ['dec', 1], type: 'VAE' },
        { from: ['dec', 0], to: ['save', 0], type: 'IMAGE' }
      ]
    }
  }

  // Any other template: a text-to-output graph around its main model.
  const video = t.category === 'video'
  return {
    width: 1120,
    height: 470,
    nodes: [
      {
        id: 'unet',
        title: 'Load Diffusion Model',
        role: 'loader',
        x: 20,
        y: 30,
        w: 260,
        ins: [],
        outs: [['MODEL', 'MODEL']],
        widgets: [
          ['unet_name', short(models[0]?.name ?? 'model.safetensors')],
          ['weight_dtype', 'default']
        ]
      },
      {
        id: 'clip',
        title: 'Load CLIP',
        role: 'loader',
        x: 20,
        y: 170,
        w: 260,
        ins: [],
        outs: [['CLIP', 'CLIP']],
        widgets: [['clip_name', short(models[1]?.name ?? 'umt5_xxl_fp8')]]
      },
      {
        id: 'vae',
        title: 'Load VAE',
        role: 'loader',
        x: 20,
        y: 290,
        w: 260,
        ins: [],
        outs: [['VAE', 'VAE']],
        widgets: [['vae_name', video ? 'wan_2.1_vae' : 'ae']]
      },
      {
        id: 'pos',
        title: 'CLIP Text Encode',
        role: 'process',
        x: 340,
        y: 40,
        w: 250,
        ins: [['clip', 'CLIP']],
        outs: [['CONDITIONING', 'CONDITIONING']],
        widgets: [],
        text: t.title
      },
      {
        id: 'lat',
        title: video ? 'Empty Video Latent' : 'Empty Latent Image',
        role: 'input',
        x: 340,
        y: 230,
        w: 250,
        ins: [],
        outs: [['LATENT', 'LATENT']],
        widgets: [
          ['width', video ? '1280' : '1024'],
          ['height', video ? '720' : '1024']
        ]
      },
      {
        id: 'ks',
        title: 'KSampler',
        role: 'process',
        x: 650,
        y: 40,
        w: 210,
        ins: [
          ['model', 'MODEL'],
          ['positive', 'CONDITIONING'],
          ['latent_image', 'LATENT']
        ],
        outs: [['LATENT', 'LATENT']],
        widgets: [
          ['steps', '8'],
          ['cfg', '1.0'],
          ['sampler_name', 'res_multistep']
        ]
      },
      {
        id: 'dec',
        title: 'VAE Decode',
        role: 'process',
        x: 650,
        y: 300,
        w: 210,
        ins: [
          ['samples', 'LATENT'],
          ['vae', 'VAE']
        ],
        outs: [['IMAGE', 'IMAGE']],
        widgets: []
      },
      {
        id: 'save',
        title: video ? 'Save Video' : 'Save Image',
        role: 'output',
        x: 900,
        y: 110,
        w: 200,
        ins: [['images', 'IMAGE']],
        outs: [],
        widgets: [],
        image: media.output,
        imageH: 150
      }
    ],
    links: [
      { from: ['unet', 0], to: ['ks', 0], type: 'MODEL' },
      { from: ['clip', 0], to: ['pos', 0], type: 'CLIP' },
      { from: ['pos', 0], to: ['ks', 1], type: 'CONDITIONING' },
      { from: ['lat', 0], to: ['ks', 2], type: 'LATENT' },
      { from: ['ks', 0], to: ['dec', 0], type: 'LATENT' },
      { from: ['vae', 0], to: ['dec', 1], type: 'VAE' },
      { from: ['dec', 0], to: ['save', 0], type: 'IMAGE' }
    ]
  }
}
