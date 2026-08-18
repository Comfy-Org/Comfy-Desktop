/** Stills for the install-wait slider.
 *
 *  PLACEHOLDER SET, and short of the count the design wants. The art is
 *  borrowed from assets that already ship with the app and the website, and
 *  only the pieces with no baked-in text survive here: a still with its own
 *  headline fights the label we lay over it. The real set is meant to arrive
 *  from the CDN with its own metadata, so none of this is final.
 */
export interface ShowcaseStill {
  id: string
  /** Laid over the art. Deliberately the capability, never a vendor or a model
   *  name: this screen is selling what the user can do, not whose weights do
   *  it, and the names churn faster than a desktop release can follow. */
  label: string
  art: string
}

const dir = '/images/showcase'

export const SHOWCASE_STILLS: readonly ShowcaseStill[] = [
  { id: 'portrait', label: 'Text to image', art: `${dir}/image_z_image_turbo.webp` },
  { id: 'video', label: 'Text to video', art: `${dir}/text_to_video_wan.webp` },
  { id: 'character', label: 'Character design', art: `${dir}/luma-uni-1.webp` },
  { id: 'relight', label: 'Relighting', art: `${dir}/krea-2.webp` },
  { id: 'scene', label: 'Scene building', art: `${dir}/ideogram-4.jpg` },
  { id: 'abstract', label: 'Motion and effects', art: `${dir}/gemma-4.jpg` },
  { id: 'splat', label: 'Photo to 3D', art: `${dir}/triposplat.webp` },
  { id: 'audio', label: 'Music and sound', art: `${dir}/stable-audio-3.jpg` }
]
