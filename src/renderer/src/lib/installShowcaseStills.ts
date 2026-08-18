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
  /** Short provider mark. Two characters at most: it renders inside a 22px
   *  disc. Stands in for the provider's own logo, which belongs with the art. */
  providerMark: string
  /** Partner model, revealed beside the mark while the pointer is on the card. */
  model: string
}

const dir = '/images/showcase'

export const SHOWCASE_STILLS: readonly ShowcaseStill[] = [
  {
    id: 'portrait',
    label: 'Text to image',
    art: `${dir}/image_z_image_turbo.webp`,
    providerMark: 'Z',
    model: 'Z Image Turbo'
  },
  {
    id: 'video',
    label: 'Text to video',
    art: `${dir}/text_to_video_wan.webp`,
    providerMark: 'W',
    model: 'Wan 2.2'
  },
  {
    id: 'character',
    label: 'Character design',
    art: `${dir}/luma-uni-1.webp`,
    providerMark: 'L',
    model: 'Luma Ray'
  },
  {
    id: 'relight',
    label: 'Relighting',
    art: `${dir}/krea-2.webp`,
    providerMark: 'K',
    model: 'Krea Realtime'
  },
  {
    id: 'scene',
    label: 'Scene building',
    art: `${dir}/ideogram-4.jpg`,
    providerMark: 'ID',
    model: 'Ideogram 3'
  },
  {
    id: 'abstract',
    label: 'Motion and effects',
    art: `${dir}/gemma-4.jpg`,
    providerMark: 'G',
    model: 'Gemma 3'
  },
  {
    id: 'splat',
    label: 'Photo to 3D',
    art: `${dir}/triposplat.webp`,
    providerMark: 'TS',
    model: 'TripoSplat'
  },
  {
    id: 'audio',
    label: 'Music and sound',
    art: `${dir}/stable-audio-3.jpg`,
    providerMark: 'SA',
    model: 'Stable Audio 3'
  }
]
