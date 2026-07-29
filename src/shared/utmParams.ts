/** Attribution tags for Desktop → web hand-offs. Shared so main and the
 *  renderer can't drift on the source token. */
export const DEFAULT_UTM_PARAMS: Record<string, string> = {
  utm_source: 'comfy.desktop',
  utm_medium: 'app_feature'
}
