/** Stills for the install-wait slider.
 *
 *  PLACEHOLDER SET, and short of the count the design wants. The art is
 *  borrowed from assets that already ship with the app and the website, and
 *  only the pieces with no baked-in text survive here: a still with its own
 *  headline fights anything laid over it.
 *
 *  The provider/model pairing below is illustrative, NOT a credit: none of
 *  these stills is known to have come from the model named against it. Art and
 *  attribution have to arrive together from the CDN before this ships, or the
 *  screen credits work to a model that did not make it.
 */
export interface ShowcaseStill {
  id: string
  /** Capability, for the image's alt text. */
  label: string
  art: string
  /** Provider mark, taken from the design system's partner icons and rendered
   *  in neutral (see the component: the artwork is flattened to white). */
  providerIcon: string
  /** Partner model, revealed beside the mark while the pointer is on the card. */
  model: string
}

const dir = '/images/showcase'

export const SHOWCASE_STILLS: readonly ShowcaseStill[] = [
  {
    id: 'portrait',
    label: 'Text to image',
    art: `${dir}/image_z_image_turbo.webp`,
    providerIcon: `${dir}/providers/bfl.svg`,
    model: 'FLUX.2 Pro'
  },
  {
    id: 'video',
    label: 'Text to video',
    art: `${dir}/text_to_video_wan.webp`,
    providerIcon: `${dir}/providers/kling.svg`,
    model: 'Kling 2.5'
  },
  {
    id: 'character',
    label: 'Character design',
    art: `${dir}/luma-uni-1.webp`,
    providerIcon: `${dir}/providers/luma.svg`,
    model: 'Ray 3'
  },
  {
    id: 'relight',
    label: 'Relighting',
    art: `${dir}/krea-2.webp`,
    providerIcon: `${dir}/providers/runway.svg`,
    model: 'Gen-4'
  },
  {
    id: 'scene',
    label: 'Scene building',
    art: `${dir}/ideogram-4.jpg`,
    providerIcon: `${dir}/providers/ideogram.svg`,
    model: 'Ideogram 3'
  },
  {
    id: 'abstract',
    label: 'Motion and effects',
    art: `${dir}/gemma-4.jpg`,
    providerIcon: `${dir}/providers/gemini.svg`,
    model: 'Nano Banana Pro'
  },
  {
    id: 'splat',
    label: 'Photo to 3D',
    art: `${dir}/triposplat.webp`,
    providerIcon: `${dir}/providers/bytedance.svg`,
    model: 'Seedance'
  },
  {
    id: 'audio',
    label: 'Music and sound',
    art: `${dir}/stable-audio-3.jpg`,
    providerIcon: `${dir}/providers/elevenlabs.svg`,
    model: 'ElevenLabs Music'
  }
]
