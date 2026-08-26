/** First-frame still for each scene's opening clip, keyed by scene id. Painted
 *  instantly on mount so a mask never shows empty while its video decodes; the
 *  runtime hides it once the video presents a real frame. */
export const START_POSTERS: Record<string, string> = {
  '1': './install-showcase-scene/Assets/posters/clouds.webp',
  '2': './install-showcase-scene/Assets/posters/eat-it-dance.webp',
  '3': './install-showcase-scene/Assets/posters/flower.webp',
  '4': './install-showcase-scene/Assets/posters/dududu.webp'
}
