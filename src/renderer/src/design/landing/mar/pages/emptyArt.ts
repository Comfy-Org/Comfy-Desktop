import { thumb } from '../../mock'

/** Three pictures per empty state (MarEmpty), each a hint of what will
 *  live there; no two places share the same hand. */
const hand = (...ids: string[]): string[] => ids.map(thumb)

export const EMPTY_PICS = {
  workflows: hand('image_z_image_turbo', 'templates_graphic_design_recomposer', 'image_flux2'),
  apps: hand(
    'template_product_placement',
    'utility_seedvr2_image_upscale',
    'image_krea2_turbo_t2i'
  ),
  assets: hand(
    'video_ltx2_5_i2v',
    'api_google_nano_banana2_image_edit',
    '3d_pixal3d_trellis2_image_to_model'
  ),
  builds: hand('video_minimax_h3_i2v', 'image_qwen_image_edit_2511', 'image_z_image_turbo'),
  models: hand('image_krea2_turbo_t2i', 'video_wan2_2_14B_i2v', 'utility_seedvr2_image_upscale'),
  projects: hand('image_flux2', 'template_product_placement', 'video_ltx2_5_i2v'),
  spaces: hand(
    'templates_graphic_design_recomposer',
    'api_google_nano_banana2_image_edit',
    'image_krea2_turbo_t2i'
  ),
  people: hand('image_qwen_image_edit_2511', 'image_krea2_turbo_t2i', 'video_minimax_h3_i2v'),
  tools: hand('utility_seedvr2_image_upscale', 'image_flux2', '3d_pixal3d_trellis2_image_to_model'),
  activity: hand('image_z_image_turbo', 'video_ltx2_5_i2v', 'template_product_placement')
}
